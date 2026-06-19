import type { KeyEntry } from "./schema.js";

// Scoped + regex key search, shared by the CLI `get` command and mirrored by the
// editor UI's filter (ui/src/filter.ts) — keep the two in step. A query is an
// optional scope prefix (`key:` / `value:` / `context:` / `all:`, case-insensitive)
// plus a case-insensitive substring, or a /…/ regular expression. No prefix
// searches everything; an unrecognised prefix is treated literally.

export type SearchScope = "all" | "key" | "value" | "context";
const SCOPES: SearchScope[] = ["key", "value", "context", "all"];

function compileRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, "i");
  } catch {
    return null;
  }
}

// Every translatable string on a key: scalar values and plural `forms` alike, across all locales.
function valueText(entry: KeyEntry): string {
  return Object.values(entry.values)
    .flatMap((v) => [v.value, ...Object.values(v.forms ?? {})])
    .filter((s): s is string => !!s)
    .join(" ");
}

function haystack(key: string, entry: KeyEntry, scope: SearchScope): string {
  switch (scope) {
    case "key": return key;
    case "value": return valueText(entry);
    case "context": return entry.context ?? "";
    case "all": return `${key} ${entry.context ?? ""} ${(entry.tags ?? []).join(" ")} ${valueText(entry)}`;
  }
}

export interface ParsedSearch {
  scope: SearchScope;
  // "none" → no text constraint; "invalid-regex" → match nothing (half-typed pattern).
  mode: "none" | "substring" | "regex" | "invalid-regex";
  needle: string;       // lowercased, for substring
  regex: RegExp | null; // for regex
}

export function parseSearch(text: string): ParsedSearch {
  let scope: SearchScope = "all";
  let rest = text.trim();
  const lower = rest.toLowerCase();
  for (const s of SCOPES) {
    if (lower.startsWith(`${s}:`)) { scope = s; rest = rest.slice(s.length + 1).trim(); break; }
  }
  if (rest === "") return { scope, mode: "none", needle: "", regex: null };
  if (rest.length >= 2 && rest.startsWith("/") && rest.endsWith("/")) {
    const regex = compileRegex(rest.slice(1, -1));
    return { scope, mode: regex ? "regex" : "invalid-regex", needle: "", regex };
  }
  return { scope, mode: "substring", needle: rest.toLowerCase(), regex: null };
}

export function keyMatchesSearch(key: string, entry: KeyEntry, q: ParsedSearch): boolean {
  switch (q.mode) {
    case "none": return true;
    case "invalid-regex": return false;
    case "regex": return q.regex!.test(haystack(key, entry, q.scope));
    case "substring": return haystack(key, entry, q.scope).toLowerCase().includes(q.needle);
  }
}
