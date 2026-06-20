import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { State } from "../schema.js";
import type { UsageCacheFile, Reference } from "../scan.js";
import type { ImageData } from "./provider.js";
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

// Config-derived guidance the context writer needs to reason about translation
// nuance: the language the source is written in, and the project-wide note.
export interface ContextGuidance {
  // BCP-47 code of the source language. Lets the writer reason about what the
  // source does NOT encode (formality, grammatical gender, number) but that
  // target languages will demand — which is exactly what a note must surface.
  sourceLocale?: string;
  // config.projectContext — the same project-wide disambiguation the translation
  // engine receives, so the writer resolves product-name-vs-common-word
  // collisions (e.g. a "feed" homonym) the same way the translator will.
  projectContext?: string;
}

export function contextGuidance(state: State): ContextGuidance {
  return {
    sourceLocale: state.config.sourceLocale,
    projectContext: state.config.projectContext,
  };
}

export function buildContextSystemPrompt(guidance: ContextGuidance = {}): string {
  const sourceLocale = guidance.sourceLocale?.trim();
  const projectContext = guidance.projectContext?.trim();
  const lines = [
    "You are a localization context writer for a UI string catalog.",
    sourceLocale
      ? `The source strings are written in ${sourceLocale}. Your note guides translation of each string FROM ${sourceLocale} INTO many other languages, so judge ambiguity from a translator's point of view: what does ${sourceLocale} leave unsaid that a target language must decide?`
      : "Your note guides translation of each string into many other languages.",
    "For each translation key you are given: its dot-path name, its source string, and one or more code snippets showing where the string is referenced in the codebase.",
    "Your task: write a context note that removes ambiguity a translator cannot resolve from the source string alone. The note is read by human translators AND by an AI translation engine.",
    "",
    "Context exists to disambiguate. If the source string is already unambiguous, keep the note short or skip the obvious — don't restate what the string plainly says. Spend words only where a translator could plausibly get it wrong, and especially where the target language must encode a distinction the source language does not (formality/register, grammatical gender of the subject, singular vs. plural, inclusive vs. exclusive).",
    "",
    "Pin down, where relevant:",
    "- Part of speech / grammatical role — is it a button (imperative verb), a heading (noun), a label, or a status? A word like \"Open\", \"Complete\", or \"Water\" translates differently as verb vs. noun vs. adjective. Say which.",
    "- Who/what the subject or addressee is — does the string speak to the end user, or describe someone else? Register, pronouns, and (in many target languages) gender and formality depend on it even when the source marks none of them.",
    "- Where it appears — screen/component and surrounding flow (e.g. \"toggle on the plant detail screen\", \"shown on the onboarding welcome card\"). The UI surface signals tone and length budget.",
    "- Placeholders — what each {token} resolves to at runtime (e.g. \"{gardener} = the user's display name\", \"{count} = number of plants\"). Explain what they mean, not that they must be preserved.",
    "- Sense of ambiguous words — homonyms and product-name-vs-common-word collisions. Name the intended sense.",
    "",
    "Rules:",
    "- Use the code snippets as your primary signal. Look at the component name, surrounding labels, event handlers, and variable names.",
    "- Be concise and concrete: 1–3 sentences, under 500 characters. Lead with the disambiguation that matters most. Prefer \"Button that confirms deleting a plant\" over vague prose like \"This is a message shown to users.\"",
    "- Do NOT restate the source string itself.",
    "- Do NOT say 'This string is...' — write the context as a direct description.",
    "- If no code snippets are available, infer from the key path and source value.",
    "- Tokens: a source may contain interpolation placeholders ({name}, {{name}}, :name, %s) and ICU-apostrophe-quoted LITERAL tokens (e.g. '{{gardener}}', '{name}') that the app fills at runtime. Any provided `literals` are literal tokens, NOT plain placeholders. If you reference a token, write it EXACTLY as it appears in the source — keep apostrophe-quoted literals quoted, and never relabel a quoted literal as a placeholder or strip its quotes. The translation engine needs these to survive verbatim, so a note may simply remind translators to reproduce them exactly.",
  ];
  if (projectContext) {
    lines.push(
      "",
      "Project context (applies to every key):",
      projectContext,
    );
  }
  return lines.join("\n");
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
    written++;
  }
  return { written, errors };
}
