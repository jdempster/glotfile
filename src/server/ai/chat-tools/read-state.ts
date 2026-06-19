import { matchesGlob } from "../../scanner.js";
import { computeStats } from "../../stats.js";
import { findMissing } from "../../scan.js";
import type { State, KeyEntry } from "../../schema.js";
import type { ChatTool, ToolContext } from "../chat-types.js";

// Read-only views over the glotfile state, so the assistant can orient itself,
// find keys to work on, inspect a key's translations, and see the guidance that
// is already configured. All derive from the same core helpers the API uses.

const SEARCH_LIMIT = 50;

function sourceText(entry: KeyEntry, sourceLocale: string): string {
  const lv = entry.values[sourceLocale];
  return (lv?.value ?? lv?.forms?.other ?? "").trim();
}

const overview: ChatTool = {
  def: {
    name: "overview",
    description: "Summarise the project: source locale, target locales, key count, per-locale translation/review progress and missing counts, and which guidance (project context, per-locale rules, glossary) is already set.",
    schema: { type: "object", properties: {}, additionalProperties: false },
  },
  humanSummary: () => "project overview",
  run: async (_input, ctx) => {
    const s = ctx.load();
    const stats = computeStats(s);
    const missing = findMissing(s);
    const missingByLocale = new Map<string, number>();
    for (const m of missing) missingByLocale.set(m.locale, (missingByLocale.get(m.locale) ?? 0) + 1);
    return {
      sourceLocale: s.config.sourceLocale,
      locales: s.config.locales,
      keyCount: Object.keys(s.keys).length,
      totals: stats.totals,
      perLocale: stats.locales.map((l) => ({
        locale: l.locale,
        total: l.total,
        translatedPct: l.translatedPct,
        reviewedPct: l.reviewedPct,
        missing: missingByLocale.get(l.locale) ?? 0,
      })),
      guidance: {
        hasProjectContext: !!s.config.projectContext?.trim(),
        localeInstructionLocales: Object.keys(s.config.localeInstructions ?? {}),
        glossaryTermCount: s.glossary.length,
        pendingSuggestionCount: s.glossarySuggestions.filter((g) => g.status === "pending").length,
      },
    };
  },
};

const searchKeys: ChatTool = {
  def: {
    name: "search_keys",
    description: "Find keys by free-text query (matches key path or source text, case-insensitive), key glob, and/or translation state. Use to locate strings to work on. Returns key, source text, and per-locale state.",
    schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Case-insensitive substring matched against key path and source text." },
        keyGlob: { type: "string", description: "Glob matched against the key path (e.g. \"emails.*\")." },
        state: { type: "string", enum: ["source", "machine", "reviewed", "needs-review", "missing"], description: "Keep keys that have this state in a target locale (or in `locale` when given). \"missing\" = no translation." },
        locale: { type: "string", description: "Scope the state filter and returned states to this locale." },
        limit: { type: "number", description: `Max keys to return (default ${SEARCH_LIMIT}).` },
      },
      additionalProperties: false,
    },
  },
  humanSummary: (input) => {
    const i = input as { query?: string; keyGlob?: string; state?: string };
    return `search keys ${[i.query && `"${i.query}"`, i.keyGlob, i.state].filter(Boolean).join(" ") || "(all)"}`;
  },
  run: async (input, ctx) => {
    const { query, keyGlob, state, locale, limit } = input as
      { query?: string; keyGlob?: string; state?: string; locale?: string; limit?: number };
    const s = ctx.load();
    const cap = Math.min(limit ?? SEARCH_LIMIT, 200);
    const targets = s.config.locales.filter((l) => l !== s.config.sourceLocale);
    const q = query?.trim().toLowerCase();
    const out: { key: string; source: string; states: Record<string, string> }[] = [];
    let truncated = false;
    const localeState = (entry: KeyEntry, loc: string): string => {
      const lv = entry.values[loc];
      if (!lv) return "missing";
      const filled = entry.plural ? lv.forms?.other?.trim() : lv.value?.trim();
      return filled ? lv.state : "missing";
    };
    for (const key of Object.keys(s.keys).sort()) {
      const entry = s.keys[key]!;
      const src = sourceText(entry, s.config.sourceLocale);
      if (q && !key.toLowerCase().includes(q) && !src.toLowerCase().includes(q)) continue;
      if (keyGlob && !matchesGlob(key, keyGlob)) continue;
      if (state) {
        const scope = locale ? [locale] : targets;
        if (!scope.some((loc) => localeState(entry, loc) === state)) continue;
      }
      if (out.length >= cap) { truncated = true; break; }
      const states: Record<string, string> = {};
      for (const loc of locale ? [locale] : s.config.locales) states[loc] = localeState(entry, loc);
      out.push({ key, source: src, states });
    }
    return { keys: out, truncated };
  },
};

const readKey: ChatTool = {
  def: {
    name: "read_key",
    description: "Read one key in full: source text, human context, notes, tags, max length, whether it is plural or has a screenshot, and every locale's value/forms + state.",
    schema: {
      type: "object",
      properties: { key: { type: "string" } },
      required: ["key"],
      additionalProperties: false,
    },
  },
  humanSummary: (input) => `read key ${(input as { key?: string }).key ?? ""}`,
  run: async (input, ctx) => {
    const { key } = input as { key: string };
    const s = ctx.load();
    const entry = s.keys[key];
    if (!entry) throw new Error(`Key "${key}" not found.`);
    const values: Record<string, { state: string; value?: string; forms?: Record<string, string> }> = {};
    for (const [loc, lv] of Object.entries(entry.values)) {
      values[loc] = entry.plural
        ? { state: lv.state, forms: lv.forms as Record<string, string> | undefined }
        : { state: lv.state, value: lv.value };
    }
    return {
      key,
      source: sourceText(entry, s.config.sourceLocale),
      context: entry.context,
      contextSource: entry.contextSource,
      notes: (entry.notes ?? []).map((n) => n.text),
      tags: entry.tags ?? [],
      maxLength: entry.maxLength,
      skipTranslate: entry.skipTranslate ?? false,
      plural: entry.plural?.arg ?? null,
      hasScreenshot: !!entry.screenshot,
      values,
    };
  },
};

const readGuidance: ChatTool = {
  def: {
    name: "read_guidance",
    description: "Read the configured translation guidance: project context, per-locale instructions, glossary entries, and pending glossary suggestions awaiting review.",
    schema: { type: "object", properties: {}, additionalProperties: false },
  },
  humanSummary: () => "read guidance",
  run: async (_input, ctx) => {
    const s = ctx.load();
    return {
      projectContext: s.config.projectContext ?? "",
      localeInstructions: s.config.localeInstructions ?? {},
      glossary: s.glossary.map((g) => ({
        term: g.term,
        doNotTranslate: g.doNotTranslate ?? false,
        translations: g.translations ?? {},
        notes: g.notes,
      })),
      pendingSuggestions: s.glossarySuggestions
        .filter((g) => g.status === "pending")
        .map((g) => ({ term: g.term, note: g.note })),
    };
  },
};

export const stateReadTools: ChatTool[] = [overview, searchKeys, readKey, readGuidance];
