import { canonLocale } from "../../state.js";
import type { State, KeyEntry } from "../../schema.js";
import type { ChatTool, ToolContext } from "../chat-types.js";

// filter_view drives the EDITOR's key list — the same filtering the user gets by
// typing in the search box and toggling facets, but applied by Lingo. It writes
// nothing to disk (it changes only what the UI shows), so no confirm gate; the
// `viewFilter` it returns is the partial filter the client applies to the editor.
//
// The matching predicates below MIRROR ui/src/filter.ts (parseSearch + filterKeys)
// so the `matched`/`sample` Lingo reports equal what the editor will actually show.
// Keep the two in sync. Only the state-file-derivable facets are supported here;
// issue/usage facets (which need check/scan indexes) are intentionally out of scope.

const SAMPLE_LIMIT = 10;

type StateFacet = "missing" | "machine" | "reviewed" | "needs-review";
type PluralityFacet = "plural" | "single";

interface ViewFilter {
  text?: string;
  states?: StateFacet[];
  plurality?: PluralityFacet[];
  tag?: string;
  locale?: string;
  emptySource?: boolean;
  aiContextUnreviewed?: boolean;
  skipTranslate?: boolean;
}

// --- text search (faithful port of ui/src/filter.ts parseSearch/matchesText) ---

type SearchScope = "all" | "key" | "value" | "context";
const SCOPES: SearchScope[] = ["key", "value", "context", "all"];

interface ParsedSearch {
  scope: SearchScope;
  mode: "none" | "substring" | "regex" | "invalid-regex";
  needle: string;
  regex: RegExp | null;
}

function parseSearch(text: string): ParsedSearch {
  let scope: SearchScope = "all";
  let rest = text.trim();
  const lower = rest.toLowerCase();
  for (const s of SCOPES) {
    if (lower.startsWith(`${s}:`)) { scope = s; rest = rest.slice(s.length + 1).trim(); break; }
  }
  if (rest === "") return { scope, mode: "none", needle: "", regex: null };
  if (rest.length >= 2 && rest.startsWith("/") && rest.endsWith("/")) {
    let regex: RegExp | null = null;
    try { regex = new RegExp(rest.slice(1, -1), "i"); } catch { regex = null; }
    return { scope, mode: regex ? "regex" : "invalid-regex", needle: "", regex };
  }
  return { scope, mode: "substring", needle: rest.toLowerCase(), regex: null };
}

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

function matchesText(key: string, entry: KeyEntry, q: ParsedSearch): boolean {
  switch (q.mode) {
    case "none": return true;
    case "invalid-regex": return false;
    case "regex": return q.regex!.test(haystack(key, entry, q.scope));
    case "substring": return haystack(key, entry, q.scope).toLowerCase().includes(q.needle);
  }
}

// --- state predicates (mirror ui/src/filter.ts isMissing/matchesState) ---

function isMissing(entry: KeyEntry, locale: string): boolean {
  const lv = entry.values[locale];
  if (!lv) return true;
  return entry.plural ? (lv.forms?.other ?? "").trim() === "" : (lv.value ?? "").trim() === "";
}

function matchesState(state: State, entry: KeyEntry, facet: StateFacet, locale?: string): boolean {
  if (facet === "missing") {
    if (locale) return isMissing(entry, locale);
    return state.config.locales.some((l) => l !== state.config.sourceLocale && isMissing(entry, l));
  }
  if (locale) return entry.values[locale]?.state === facet;
  return Object.values(entry.values).some((v) => v.state === facet);
}

function matchingKeys(state: State, f: ViewFilter): string[] {
  const search = f.text?.trim() ? parseSearch(f.text) : null;
  return Object.keys(state.keys).sort().filter((key) => {
    const entry = state.keys[key]!;
    if (f.tag && !(entry.tags ?? []).includes(f.tag)) return false;
    if (f.aiContextUnreviewed && entry.contextSource !== "ai") return false;
    if (f.emptySource && !isMissing(entry, state.config.sourceLocale)) return false;
    if (f.skipTranslate && !entry.skipTranslate) return false;
    if (f.plurality?.length) {
      const kind: PluralityFacet = entry.plural ? "plural" : "single";
      if (!f.plurality.includes(kind)) return false;
    }
    if (f.states?.length && !f.states.some((s) => matchesState(state, entry, s, f.locale))) return false;
    if (search && !matchesText(key, entry, search)) return false;
    return true;
  });
}

const filterView: ChatTool = {
  def: {
    name: "filter_view",
    description:
      "Drive the editor's key list to SHOW the user a set of keys — the same as if they typed in the search box and toggled filters. Use it whenever you want them to LOOK at specific strings (e.g. \"let's review the untranslated German ones\", \"here are the keys mentioning 'feed'\"): filter the view, then talk about what's there. It only changes what's displayed — it writes nothing — so apply it directly without asking. Each call sets the WHOLE view: facets you omit are cleared, so calling it with no arguments clears all filters. Note: it does not select or open a key, only filters the list.",
    schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Search box text. Plain text is a case-insensitive substring over key path + source/translations + context. Prefix with key:/value:/context: to scope, or wrap in /…/ for a regex (e.g. \"key:/^emails\\./\")." },
        states: {
          type: "array",
          items: { type: "string", enum: ["missing", "machine", "reviewed", "needs-review"] },
          description: "Keep keys having any of these states (OR). \"missing\" = no translation. Scoped to `locale` when given, else any target locale.",
        },
        locale: { type: "string", description: "Target locale (BCP-47, e.g. \"de\") to focus on: scopes the state filter to it and opens the editor on that language." },
        plurality: { type: "array", items: { type: "string", enum: ["plural", "single"] }, description: "Keep only plural or only single (non-plural) keys." },
        tag: { type: "string", description: "Keep only keys carrying this tag." },
        emptySource: { type: "boolean", description: "Keep only keys whose source-locale text is blank." },
        aiContextUnreviewed: { type: "boolean", description: "Keep only keys whose context was AI-generated and not yet human-reviewed." },
        skipTranslate: { type: "boolean", description: "Keep only keys flagged skip-translate." },
      },
      additionalProperties: false,
    },
  },
  humanSummary: (input) => {
    const i = input as ViewFilter;
    const parts = [
      i.text && `"${i.text}"`,
      i.states?.length && i.states.join("/"),
      i.locale && `@${canonLocale(i.locale)}`,
      i.plurality?.length && i.plurality.join("/"),
      i.tag && `#${i.tag}`,
      i.emptySource && "empty-source",
      i.aiContextUnreviewed && "ai-context",
      i.skipTranslate && "skip-translate",
    ].filter(Boolean);
    return `filter view: ${parts.length ? parts.join(" · ") : "clear"}`;
  },
  run: async (input, ctx: ToolContext) => {
    const i = (input ?? {}) as ViewFilter;
    const s = ctx.load();
    const targets = s.config.locales.filter((l) => l !== s.config.sourceLocale);

    // Build the normalised partial the UI will apply — only the fields actually
    // provided (omitted fields fall back to the editor's filter defaults).
    const viewFilter: ViewFilter = {};
    if (i.text !== undefined) viewFilter.text = i.text;
    if (i.states !== undefined) viewFilter.states = i.states;
    if (i.plurality !== undefined) viewFilter.plurality = i.plurality;
    if (i.tag !== undefined) viewFilter.tag = i.tag;
    if (i.emptySource !== undefined) viewFilter.emptySource = i.emptySource;
    if (i.aiContextUnreviewed !== undefined) viewFilter.aiContextUnreviewed = i.aiContextUnreviewed;
    if (i.skipTranslate !== undefined) viewFilter.skipTranslate = i.skipTranslate;
    if (i.locale !== undefined) {
      const loc = canonLocale(i.locale);
      if (!targets.includes(loc)) {
        throw new Error(`Locale "${i.locale}" is not a target locale on this project (have: ${targets.join(", ") || "none"}).`);
      }
      viewFilter.locale = loc;
    }

    const keys = matchingKeys(s, viewFilter);
    return {
      ok: true,
      matched: keys.length,
      total: Object.keys(s.keys).length,
      sample: keys.slice(0, SAMPLE_LIMIT),
      viewFilter,
    };
  },
};

const selectKey: ChatTool = {
  def: {
    name: "select_key",
    strict: true,
    description: "Open ONE key in the editor's detail panel so the user sees its source, translations, context and notes side by side. Use after pointing them at a key you want to discuss or edit. It only changes what's selected — writes nothing — so apply it directly. Leaves the list filter untouched (it doesn't filter the list to this key); pair it with filter_view first if you also want the list narrowed.",
    schema: {
      type: "object",
      properties: { key: { type: "string", description: "The key path to open (e.g. \"plant.feed\")." } },
      required: ["key"],
      additionalProperties: false,
    },
  },
  humanSummary: (input) => `open ${(input as { key?: string }).key ?? ""}`,
  run: async (input, ctx: ToolContext) => {
    const { key } = input as { key: string };
    const s = ctx.load();
    if (!s.keys[key]) throw new Error(`Key "${key}" not found.`);
    return { ok: true, key, selectKey: key };
  },
};

export const viewTools: ChatTool[] = [filterView, selectKey];
