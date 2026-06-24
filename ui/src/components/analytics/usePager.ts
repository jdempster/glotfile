import { reactive } from "vue";

// Keyed incremental pagination for the analytics lists. These lists are unbounded
// (a large project can produce thousands of worklist items / lint findings), and
// rendering them all blows the DOM up to tens of thousands of nodes — the page
// stalls before the user can act. We render a capped window per list and reveal
// more on demand. State is keyed by a string so one pager serves several lists
// (the worklist, each Quality rule-group, the suppressed drawer).
export function usePager(pageSize = 50) {
  const limits = reactive(new Map<string, number>());

  const limit = (key: string) => limits.get(key) ?? pageSize;

  return {
    pageSize,
    // The visible window for `key`'s list.
    slice<T>(key: string, arr: readonly T[]): T[] {
      return arr.slice(0, limit(key));
    },
    // How many items are hidden past the current window.
    remaining(key: string, arr: readonly unknown[]): number {
      return Math.max(0, arr.length - limit(key));
    },
    // Reveal the next page.
    more(key: string) {
      limits.set(key, limit(key) + pageSize);
    },
  };
}
