import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { State } from "../schema.js";
import type { UsageCacheFile, Reference } from "../scan.js";
import type { ImageData } from "./provider.js";
import type { Clock } from "../state.js";
import { systemClock } from "../state.js";
import { quotedLiterals } from "../placeholders.js";

export interface CodeSnippet {
  file: string;
  startLine: number;
  lines: string;
  scanner: string;
  extraRefs?: number;
}

export interface ContextRequest {
  id: string;
  key: string;
  source: string;
  usageSnippets: CodeSnippet[];
  image?: ImageData;
}

export interface ContextSelectOptions {
  since?: string;
  all?: boolean;
  keyGlob?: string;
  limit?: number;
  // Explicit set of keys to target (e.g. a bulk selection). When set, only these
  // keys are considered; keys that already have context are still skipped.
  keys?: string[];
  // Include keys that already have context and overwrite it (single-key re-suggest).
  force?: boolean;
}

const MAX_CONTEXT_LENGTH = 500;
const SNIPPET_WINDOW = 15;
const MAX_SNIPPETS = 3;
const EXCLUDED_DIRS = ["node_modules/", "vendor/", "dist/", ".git/", ".glotfile/"];

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

export function extractSnippets(
  refs: Reference[],
  projectRoot: string,
  fileCache: Map<string, string[]>,
): CodeSnippet[] {
  const filtered = refs.filter((r) => !EXCLUDED_DIRS.some((d) => r.file.startsWith(d)));
  const sorted = [...filtered].sort((a, b) => a.file.length - b.file.length);
  const selected = sorted.slice(0, MAX_SNIPPETS);
  const extraRefs = filtered.length > MAX_SNIPPETS ? filtered.length - MAX_SNIPPETS : 0;

  const snippets: CodeSnippet[] = [];
  for (const ref of selected) {
    const absPath = resolve(projectRoot, ref.file);
    if (!fileCache.has(ref.file)) {
      if (!existsSync(absPath)) continue;
      const content = readFileSync(absPath, "utf8");
      fileCache.set(ref.file, content.split("\n"));
    }
    const lines = fileCache.get(ref.file)!;
    const start = Math.max(0, ref.line - 1 - SNIPPET_WINDOW);
    const end = Math.min(lines.length, ref.line + SNIPPET_WINDOW);
    snippets.push({
      file: ref.file,
      startLine: start + 1,
      lines: lines.slice(start, end).join("\n"),
      scanner: ref.scanner,
      ...(snippets.length === 0 && extraRefs > 0 ? { extraRefs } : {}),
    });
  }
  return snippets;
}

// Populate each target's usageSnippets from the code-reference cache. Both the
// prompt builders and the cost estimate read snippets from here, so the build
// and its --estimate stay in lock-step.
export function attachUsageSnippets(targets: ContextRequest[], cache: UsageCacheFile, projectRoot: string): void {
  const fileCache = new Map<string, string[]>();
  for (const target of targets) {
    const allRefs = Object.entries(cache.files).flatMap(([file, entry]) =>
      entry.refs.filter((r) => r.key === target.key).map((r) => ({
        key: r.key, file, line: r.line, col: r.col, scanner: r.scanner,
      }))
    );
    target.usageSnippets = extractSnippets(allRefs, projectRoot, fileCache);
  }
}

export function buildUsageIndex(cache: UsageCacheFile): Map<string, Reference[]> {
  const index = new Map<string, Reference[]>();
  for (const [file, entry] of Object.entries(cache.files)) {
    for (const ref of entry.refs) {
      const existing = index.get(ref.key) ?? [];
      existing.push({ key: ref.key, file, line: ref.line, col: ref.col, scanner: ref.scanner });
      index.set(ref.key, existing);
    }
  }
  return index;
}

export function selectContextTargets(
  state: State,
  opts: ContextSelectOptions,
  cache: UsageCacheFile,
  lastRunAt?: string,
): ContextRequest[] {
  const cutoff = opts.all ? undefined : (opts.since ?? lastRunAt);
  const keyRe = opts.keyGlob ? globToRegExp(opts.keyGlob) : null;
  const keySet = opts.keys ? new Set(opts.keys) : null;
  const usageIndex = buildUsageIndex(cache);

  let candidates: ContextRequest[] = [];
  for (const key of Object.keys(state.keys).sort()) {
    const entry = state.keys[key]!;
    if (entry.context && !opts.force) continue;
    if (keySet && !keySet.has(key)) continue;
    if (keyRe && !keyRe.test(key)) continue;
    if (cutoff) {
      if (!entry.createdAt) continue;
      if (entry.createdAt < cutoff) continue;
    }
    const source = entry.values[state.config.sourceLocale]?.value ?? "";
    candidates.push({ id: String(candidates.length), key, source, usageSnippets: [] });
  }

  // Sort newest-first by createdAt; no-createdAt keys sort last.
  candidates.sort((a, b) => {
    const ta = state.keys[a.key]!.createdAt ?? "";
    const tb = state.keys[b.key]!.createdAt ?? "";
    return tb.localeCompare(ta);
  });

  if (opts.limit !== undefined) candidates = candidates.slice(0, opts.limit);

  // Re-number IDs after sort/limit.
  candidates.forEach((c, i) => { c.id = String(i); });
  return candidates;
}

export function buildContextSystemPrompt(): string {
  return [
    "You are a localization context writer for a UI string catalog.",
    "For each translation key you are given: its dot-path name, its source string, and one or more code snippets showing where the string is referenced in the codebase.",
    "Your task: write a concise 1–2 sentence context note that describes WHERE in the UI this string appears and WHAT the user is doing at that point.",
    "The context is read by human translators AND by an AI translation engine. It must answer: what screen is this on, what element is this (button, label, error, etc.), and what action does it relate to?",
    "Rules:",
    "- Use the code snippets as your primary signal. Look at the component name, surrounding labels, event handlers, and variable names.",
    "- Do NOT restate the source string itself.",
    "- Do NOT say 'This string is...' — write the context as a direct description.",
    "- Keep it under 500 characters.",
    "- If no code snippets are available, infer from the key path and source value.",
    "- Tokens: a source may contain interpolation placeholders ({name}, {{name}}, :name, %s) and ICU-apostrophe-quoted LITERAL tokens (e.g. '{{visitor}}', '{name}') that the app fills at runtime. Any provided `literals` are literal tokens, NOT plain placeholders. If you reference a token, write it EXACTLY as it appears in the source — keep apostrophe-quoted literals quoted, and never relabel a quoted literal as a placeholder or strip its quotes. The translation engine needs these to survive verbatim, so a note may simply remind translators to reproduce them exactly.",
  ].join("\n");
}

export function buildContextBatchPrompt(reqs: ContextRequest[]): string {
  const items = reqs.map((r) => {
    const snippetText = r.usageSnippets.length > 0
      ? r.usageSnippets.map((s) => {
          const extra = s.extraRefs ? ` (and ${s.extraRefs} more call site${s.extraRefs > 1 ? "s" : ""} not shown)` : "";
          return `File: ${s.file} (lines ${s.startLine}+, scanner: ${s.scanner})${extra}\n\`\`\`\n${s.lines}\n\`\`\``;
        }).join("\n\n")
      : "(no code references found — infer from key path and source value)";
    const literals = quotedLiterals(r.source);
    return {
      id: r.id,
      key: r.key,
      source: r.source,
      ...(literals.length ? { literals } : {}),
      codeSnippets: snippetText,
    };
  });
  return "Write a context note for each key. Return JSON {\"items\":[{\"id\",\"context\"}]}.\n" +
    JSON.stringify(items, null, 2);
}

export const CONTEXT_BATCH_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          context: { type: "string" },
          error: { type: "string" },
        },
        required: ["id"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
} as const;

export function applyContext(
  state: State,
  reqs: ContextRequest[],
  results: Array<{ id: string; context?: string; error?: string }>,
  clock: Clock = systemClock,
  force = false,
): { written: number; errors: Array<{ key: string; error: string }> } {
  const byId = new Map(reqs.map((r) => [r.id, r]));
  let written = 0;
  const errors: Array<{ key: string; error: string }> = [];

  for (const res of results) {
    const req = byId.get(res.id);
    if (!req) continue;
    if (res.error) {
      errors.push({ key: req.key, error: res.error });
      continue;
    }
    const context = res.context?.trim() ?? "";
    if (!context) {
      errors.push({ key: req.key, error: "AI returned empty context" });
      continue;
    }
    if (context.length > MAX_CONTEXT_LENGTH) {
      errors.push({ key: req.key, error: `Context too long (${context.length} chars, max ${MAX_CONTEXT_LENGTH})` });
      continue;
    }
    const entry = state.keys[req.key];
    if (!entry || (entry.context && !force)) continue;
    entry.context = context;
    entry.contextSource = "ai";
    entry.contextAt = clock();
    written++;
  }
  return { written, errors };
}
