import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, relative, resolve, isAbsolute, extname } from "node:path";
import { ALWAYS_EXCLUDE, matchesGlob, outputExcludeGlobs } from "../../scanner.js";
import type { ChatTool, ToolContext } from "../chat-types.js";

// Claude-Code-style read-only access to the user's repository, so the assistant
// can read the README, see how a key is used, inspect locale files, etc. Always
// rooted at the project root, never writes, honours config.scan include/exclude
// + the scanner's ALWAYS_EXCLUDE dirs, and caps everything to stay cheap.

const FIND_LIMIT = 200;
const GREP_LIMIT = 100;
const GREP_MAX_FILE_BYTES = 512 * 1024;
const LINE_TRUNC = 200;
const READ_MAX_LINES = 400;
const READ_MAX_BYTES = 64 * 1024;

// Extensions we never try to read as text (binary / compiled / media).
const BINARY_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".tiff",
  ".pdf", ".zip", ".gz", ".tar", ".tgz", ".bz2", ".7z", ".rar",
  ".mp3", ".mp4", ".mov", ".avi", ".webm", ".wav", ".ogg",
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".exe", ".dll", ".so", ".dylib", ".bin", ".class", ".jar", ".wasm",
]);

// The exported locale files live inside the project, so without this the chat
// tools read keys straight back out of glotfile's own output. Merge the user's
// scan excludes with the auto-derived export-target globs, mirroring the usage
// scanner's scanOptions() so the assistant never greps its generated catalog.
function scanGlobs(ctx: ToolContext): { include: string[]; exclude: string[] } {
  const config = ctx.load().config;
  const scan = config.scan;
  return {
    include: scan?.include ?? [],
    exclude: [...(scan?.exclude ?? []), ...outputExcludeGlobs(config.outputs)],
  };
}

// Walk the tree yielding repo-relative file paths, skipping always-excluded dir
// names at any depth and applying the project's scan include/exclude globs.
function* candidateFiles(ctx: ToolContext): Generator<string> {
  const { include, exclude } = scanGlobs(ctx);
  function* walk(dir: string): Generator<string> {
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const name of entries) {
      if (ALWAYS_EXCLUDE.has(name)) continue;
      const abs = join(dir, name);
      let st;
      try { st = statSync(abs); } catch { continue; }
      if (st.isDirectory()) {
        yield* walk(abs);
      } else if (st.isFile()) {
        const rel = relative(ctx.projectRoot, abs);
        if (exclude.some((p) => matchesGlob(rel, p))) continue;
        if (include.length && !include.some((p) => matchesGlob(rel, p))) continue;
        yield rel;
      }
    }
  }
  yield* walk(ctx.projectRoot);
}

// Resolve a user-supplied path against the root and refuse anything that escapes
// it (../, absolute paths, symlink-style traversal).
function safeResolve(projectRoot: string, p: string): string {
  const abs = resolve(projectRoot, p);
  const rel = relative(projectRoot, abs);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Path "${p}" is outside the project root.`);
  }
  return abs;
}

const findFiles: ChatTool = {
  def: {
    name: "find_files",
    description:
      "List files in the project repository matching a glob (** = any depth, * = within a path segment), e.g. \"src/**/*.ts\" or \"**/README.md\". Read-only. Skips node_modules/.git/etc. and honours the project's scan include/exclude.",
    schema: {
      type: "object",
      properties: {
        glob: { type: "string", description: "Glob to match against repo-relative paths." },
        limit: { type: "number", description: `Max files to return (default ${FIND_LIMIT}).` },
      },
      required: ["glob"],
      additionalProperties: false,
    },
  },
  humanSummary: (input) => `find files ${JSON.stringify((input as { glob?: string }).glob ?? "")}`,
  run: async (input, ctx) => {
    const { glob, limit } = input as { glob: string; limit?: number };
    const cap = Math.min(limit ?? FIND_LIMIT, FIND_LIMIT);
    const files: string[] = [];
    let truncated = false;
    for (const rel of candidateFiles(ctx)) {
      if (!matchesGlob(rel, glob)) continue;
      if (files.length >= cap) { truncated = true; break; }
      files.push(rel);
    }
    return { files, truncated };
  },
};

const grepCodebase: ChatTool = {
  def: {
    name: "grep_codebase",
    description:
      "Search file contents in the project repository with a JavaScript regular expression. Returns matching lines as {file, line, text}. Read-only, capped, skips binary/large files. Optionally restrict to files matching a glob.",
    schema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "JavaScript regex to search for." },
        glob: { type: "string", description: "Optional glob to restrict which files are searched." },
        limit: { type: "number", description: `Max matches to return (default ${GREP_LIMIT}).` },
      },
      required: ["pattern"],
      additionalProperties: false,
    },
  },
  humanSummary: (input) => `search ${JSON.stringify((input as { pattern?: string }).pattern ?? "")}`,
  run: async (input, ctx) => {
    const { pattern, glob, limit } = input as { pattern: string; glob?: string; limit?: number };
    const cap = Math.min(limit ?? GREP_LIMIT, GREP_LIMIT);
    let re: RegExp;
    try { re = new RegExp(pattern); } catch (e) { throw new Error(`Invalid regex: ${(e as Error).message}`); }
    const matches: { file: string; line: number; text: string }[] = [];
    let truncated = false;
    outer: for (const rel of candidateFiles(ctx)) {
      if (glob && !matchesGlob(rel, glob)) continue;
      if (BINARY_EXT.has(extname(rel).toLowerCase())) continue;
      const abs = join(ctx.projectRoot, rel);
      let content: string;
      try {
        if (statSync(abs).size > GREP_MAX_FILE_BYTES) continue;
        content = readFileSync(abs, "utf8");
      } catch { continue; }
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (!re.test(lines[i]!)) continue;
        if (matches.length >= cap) { truncated = true; break outer; }
        matches.push({ file: rel, line: i + 1, text: lines[i]!.slice(0, LINE_TRUNC) });
      }
    }
    return { matches, truncated };
  },
};

const readFile: ChatTool = {
  def: {
    name: "read_file",
    description:
      "Read a UTF-8 text file from the project repository (rooted at the project root; paths that escape it are rejected). Optionally a line range. Capped to keep replies small.",
    schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Repo-relative file path." },
        startLine: { type: "number", description: "1-based first line (optional)." },
        endLine: { type: "number", description: "1-based last line, inclusive (optional)." },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  humanSummary: (input) => `read ${(input as { path?: string }).path ?? ""}`,
  run: async (input, ctx) => {
    const { path, startLine, endLine } = input as { path: string; startLine?: number; endLine?: number };
    const abs = safeResolve(ctx.projectRoot, path);
    let raw: string;
    try { raw = readFileSync(abs, "utf8"); } catch (e) { throw new Error(`Cannot read "${path}": ${(e as Error).message}`); }
    let lines = raw.split("\n");
    const from = startLine && startLine > 0 ? startLine - 1 : 0;
    const to = endLine && endLine > 0 ? endLine : from + READ_MAX_LINES;
    let truncated = false;
    if (to - from > READ_MAX_LINES) truncated = true;
    lines = lines.slice(from, Math.min(to, from + READ_MAX_LINES));
    let content = lines.join("\n");
    if (content.length > READ_MAX_BYTES) { content = content.slice(0, READ_MAX_BYTES); truncated = true; }
    return { path, content, truncated };
  },
};

export const codebaseTools: ChatTool[] = [findFiles, grepCodebase, readFile];
