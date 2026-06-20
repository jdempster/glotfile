import type { KeyFilter, StateFacet, PluralityFacet } from "./filter.js";
import type { CheckId } from "./types.js";
import { ALL_CHECKS, ALL_STATES, ALL_PLURALITY } from "./checks.js";

export type SortMode = "key-asc" | "key-desc" | "created";

const ALL_SORTS: SortMode[] = ["key-asc", "key-desc", "created"];

export const EMPTY_FILTER: KeyFilter = {
  text: "",
  states: [],
  issues: [],
  plurality: [],
  tag: "",
  needsAttention: false,
  emptySource: false,
  aiContextUnreviewed: false,
  noUsages: false,
  skipTranslate: false,
};

export interface UrlState {
  filter: KeyFilter;
  sort: SortMode;
  // Editor locale selection: a subset of target locales, or null for "show all".
  // Lives in the URL like the filters so a refresh restores it.
  locales: string[] | null;
}

export function filterFromUrl(params: URLSearchParams): UrlState {
  const text = params.get("q") ?? "";
  const tag = params.get("tag") ?? "";

  const states = (params.get("states") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is StateFacet => (ALL_STATES as string[]).includes(s));

  const issues = (params.get("issues") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is CheckId => (ALL_CHECKS as string[]).includes(s));

  const plurality = (params.get("plurality") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is PluralityFacet => (ALL_PLURALITY as string[]).includes(s));

  const rawSort = params.get("sort") ?? "";
  const sort: SortMode = (ALL_SORTS as string[]).includes(rawSort) ? (rawSort as SortMode) : "key-asc";

  const rawLocales = params.get("locales");
  const locales = rawLocales === null
    ? null
    : (() => {
        const list = rawLocales.split(",").map((l) => l.trim().toLowerCase()).filter(Boolean);
        return list.length ? [...new Set(list)] : null;
      })();

  return {
    filter: {
      ...EMPTY_FILTER,
      text,
      tag,
      states,
      issues,
      plurality,
      needsAttention: params.get("attention") === "1",
      emptySource: params.get("emptySource") === "1",
      aiContextUnreviewed: params.get("aiContext") === "1",
      noUsages: params.get("noUsages") === "1",
      skipTranslate: params.get("skipTranslate") === "1",
    },
    sort,
    locales,
  };
}

export function filterToUrl(state: UrlState): URLSearchParams {
  const p = new URLSearchParams();
  const { filter, sort, locales } = state;

  if (filter.text) p.set("q", filter.text);
  if (filter.tag) p.set("tag", filter.tag);
  if (filter.states.length) p.set("states", filter.states.join(","));
  if (filter.issues.length) p.set("issues", filter.issues.join(","));
  if (filter.plurality.length) p.set("plurality", filter.plurality.join(","));
  if (filter.needsAttention) p.set("attention", "1");
  if (filter.emptySource) p.set("emptySource", "1");
  if (filter.aiContextUnreviewed) p.set("aiContext", "1");
  if (filter.noUsages) p.set("noUsages", "1");
  if (filter.skipTranslate) p.set("skipTranslate", "1");
  if (sort !== "key-asc") p.set("sort", sort);
  if (locales && locales.length) p.set("locales", locales.join(","));

  return p;
}
