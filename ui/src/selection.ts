import { ref, computed, type Ref } from "vue";

export interface KeySelection {
  has(key: string): boolean;
  toggle(key: string): void;
  // Shift-click: select the contiguous range between the last-clicked key and `key`.
  // Intentionally ADDITIVE — never deselects keys already in the selection.
  toggleRange(key: string, orderedKeys: string[]): void;
  selectAll(keys: string[]): void;
  clear(): void;
  // Enforce the invariant: selection ⊆ the given (filtered) keys.
  pruneTo(keys: string[]): void;
  // Returns keys in insertion order; callers must not rely on sort order.
  keys(): string[];
  count: Ref<number>;
  // Returns false when `keys` is empty by design — an empty list is not "all selected"
  // (drives the master checkbox: unchecked when no rows are visible).
  allSelected(keys: string[]): boolean;
  someSelected(keys: string[]): boolean;
}

export function useSelection(): KeySelection {
  // ref(new Set) is reactive in Vue 3: .add/.delete/.clear are tracked mutations.
  const selected = ref<Set<string>>(new Set());
  let anchor: string | null = null;

  function has(key: string) {
    return selected.value.has(key);
  }

  function toggle(key: string) {
    if (selected.value.has(key)) selected.value.delete(key);
    else selected.value.add(key);
    anchor = key;
  }

  function toggleRange(key: string, orderedKeys: string[]) {
    if (anchor === null) return toggle(key);
    const a = orderedKeys.indexOf(anchor);
    const b = orderedKeys.indexOf(key);
    if (a === -1 || b === -1) return toggle(key);
    const [lo, hi] = a < b ? [a, b] : [b, a];
    for (let i = lo; i <= hi; i++) selected.value.add(orderedKeys[i]!);
    anchor = key;
  }

  function selectAll(keys: string[]) {
    for (const k of keys) selected.value.add(k);
    anchor = keys.length ? keys[keys.length - 1]! : null;
  }

  function clear() {
    selected.value.clear();
    anchor = null;
  }

  function pruneTo(keys: string[]) {
    const keep = new Set(keys);
    for (const k of [...selected.value]) if (!keep.has(k)) selected.value.delete(k);
    if (anchor !== null && !keep.has(anchor)) anchor = null;
  }

  return {
    has,
    toggle,
    toggleRange,
    selectAll,
    clear,
    pruneTo,
    keys: () => [...selected.value],
    count: computed(() => selected.value.size),
    allSelected: (keys) => keys.length > 0 && keys.every((k) => selected.value.has(k)),
    someSelected: (keys) => keys.some((k) => selected.value.has(k)),
  };
}
