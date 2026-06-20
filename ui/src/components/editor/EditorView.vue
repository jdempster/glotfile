<script setup lang="ts">
import { ref, shallowRef, computed, watch, onMounted, onUnmounted } from "vue";
import { useVirtualizer } from "@tanstack/vue-virtual";
import { Search, Plus, ListFilter, FileDown, Sparkles, X, TriangleAlert, ScanSearch, Loader2, Check, Minus, CircleQuestionMark, PanelRight } from "lucide-vue-next";
import type { State, Issue } from "@/types.js";
import { filterKeys, type KeyFilter } from "@/filter.js";
import { filterFromUrl, filterToUrl, type SortMode, type ViewMode } from "@/filterUrl.js";
import { getHashSearch, setHashSearch } from "@/router.js";
import { fetchState, fetchChecks, usedKeys } from "@/api.js";
import { onExternalChange } from "@/liveReload";
import { activeKey } from "@/chat";
import { pendingFilter, pendingKey } from "@/drilldown.js";
import { nextRowIndex, scrollAlignForRow } from "./keyNav.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import FilterMenu from "./FilterMenu.vue";
import SelectionBar from "./SelectionBar.vue";
import { useSelection } from "@/selection.js";
import { ALL_CHECKS, CHECK_LABELS, STATE_LABELS, PLURALITY_LABELS, DEFAULT_ENABLED, indexIssuesByKey } from "@/checks.js";
import type { CheckId } from "@/types.js";
import type { StateFacet, PluralityFacet } from "@/filter.js";
import { TooltipProvider } from "@/components/ui/tooltip";
import { scanInfo, runScan, scanPending } from "@/scanStatus.js";
import KeyRow from "./KeyRow.vue";
import DetailPanel from "./DetailPanel.vue";
import AddKeyDialog from "./AddKeyDialog.vue";
import ExportDialog from "./ExportDialog.vue";
import TranslateDialog from "./TranslateDialog.vue";
import ContextDialog from "./ContextDialog.vue";
import BatchBanner from "./BatchBanner.vue";
import LocaleCombobox from "@/components/lang/LocaleCombobox.vue";
import ResizeHandle from "@/components/ResizeHandle.vue";
import { keyColumn, detailPanel, detailPanelToggle } from "@/panel-widths.js";

const keyColumnWidth = keyColumn.width;
const detailPanelWidth = detailPanel.width;
const detailPanelOpen = detailPanelToggle.open;

// shallowRef, not ref: the state tree (3.7k keys × 19 locales ≈ 55k values) is
// treated as immutable — every edit goes through the API then a full reload that
// replaces this wholesale. Deep reactivity would Proxy-wrap and dep-track every
// nested value, making filter/sort/search ~8× slower for no benefit.
const state = shallowRef<State | null>(null);
const { filter: _urlFilter, sort: _urlSort, view: _urlView, locale: _urlLocale } = filterFromUrl(getHashSearch());
const filter = ref<KeyFilter>(_urlFilter);
const selection = useSelection();

const STORAGE_KEY = "glotfile:enabledChecks";
function loadEnabled(): CheckId[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as CheckId[];
      return ALL_CHECKS.filter((c) => parsed.includes(c));
    }
  } catch { /* fall through to defaults */ }
  return [...DEFAULT_ENABLED];
}
const enabledChecks = ref<CheckId[]>(loadEnabled());

const issuesByKey = ref<Map<string, Issue[]>>(new Map());

// Keys with code references, loaded from /scan/used (mirrors issuesByKey).
// `scanIndexed` gates the "Unused" filter toggle in the menu.
const usedKeySet = ref<Set<string> | null>(null);
const scanIndexed = ref(false);
// Bumped whenever scan-derived data is refreshed, so the detail panel re-fetches
// the selected key's usage even though its key name didn't change.
const usageRevision = ref(0);

async function reloadUsed() {
  try {
    const res = await usedKeys();
    scanIndexed.value = res.indexed;
    usedKeySet.value = res.indexed ? new Set(res.used) : null;
  } catch {
    // Advisory, like reloadChecks — treat a failure as "no index".
    scanIndexed.value = false;
    usedKeySet.value = null;
  }
  usageRevision.value++;
}

const spellPending = ref(false);
let spellPolls = 0;

async function reloadChecks() {
  if (enabledChecks.value.length === 0) {
    issuesByKey.value = new Map();
    spellPending.value = false;
    return;
  }
  try {
    const res = await fetchChecks(enabledChecks.value);
    issuesByKey.value = indexIssuesByKey(res.issues);
    spellPending.value = res.spellPending;
    // Spelling warms in the background server-side; re-fetch a few times until ready.
    if (res.spellPending && spellPolls < 6) {
      spellPolls++;
      setTimeout(reloadChecks, 800);
    } else {
      spellPolls = 0;
    }
  } catch {
    // Checks are advisory — a failure just means no markers this cycle.
    issuesByKey.value = new Map();
  }
}

watch(enabledChecks, (v) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
  spellPolls = 0;
  void reloadChecks();
}, { deep: true });

const sort = ref<SortMode>(_urlSort);
const view = ref<ViewMode>(_urlView);
const selectedTarget = ref<string>(_urlLocale);

let textDebounce: ReturnType<typeof setTimeout> | null = null;

watch(
  [sort, view, selectedTarget, () => ({ ...filter.value, text: undefined })],
  () => {
    setHashSearch(filterToUrl({ filter: filter.value, sort: sort.value, view: view.value, locale: selectedTarget.value }));
  },
  { deep: true },
);

watch(
  () => filter.value.text,
  () => {
    if (textDebounce) clearTimeout(textDebounce);
    textDebounce = setTimeout(() => {
      setHashSearch(filterToUrl({ filter: filter.value, sort: sort.value, view: view.value, locale: selectedTarget.value }));
    }, 300);
  },
);

const activeFacetCount = computed(() =>
  filter.value.states.length +
  filter.value.issues.length +
  filter.value.plurality.length +
  (filter.value.emptySource ? 1 : 0) +
  (filter.value.aiContextUnreviewed ? 1 : 0) +
  (filter.value.noUsages ? 1 : 0) +
  (filter.value.skipTranslate ? 1 : 0),
);

const totalIssues = computed(() => {
  let n = 0;
  for (const arr of issuesByKey.value.values()) n += arr.length;
  return n;
});

function removeState(s: StateFacet) {
  filter.value.states = filter.value.states.filter((x) => x !== s);
}
function removeIssue(c: CheckId) {
  filter.value.issues = filter.value.issues.filter((x) => x !== c);
}
function removePlurality(p: PluralityFacet) {
  filter.value.plurality = filter.value.plurality.filter((x) => x !== p);
}

// Apply a drill-down handed over from another view (Analytics) or set live by the
// chat assistant (Lingo's filter_view tool). Replaces the whole filter from
// defaults so omitted facets reset.
function applyDrilldown(pf: Partial<KeyFilter>) {
  filter.value = { text: "", states: [], issues: [], plurality: [], tag: "", needsAttention: false, emptySource: false, aiContextUnreviewed: false, noUsages: false, skipTranslate: false, ...pf };
  // A drilled issue filter is useless unless its check is fetched — checks the
  // user has toggled off (e.g. spelling, off by default) are re-enabled here.
  if (pf.issues?.length) {
    const want = new Set([...enabledChecks.value, ...pf.issues]);
    enabledChecks.value = ALL_CHECKS.filter((c) => want.has(c));
  }
  if (pf.locale) {
    view.value = "bilingual";
    selectedTarget.value = pf.locale;
  }
}
// EditorView is remounted on route change, so the setup-time read covers arriving
// with a pending filter (drilled from Analytics, or navigated by Lingo from
// elsewhere); the watch covers Lingo filtering while the editor is already open.
if (pendingFilter.value) {
  applyDrilldown(pendingFilter.value);
  pendingFilter.value = null;
}
watch(pendingFilter, (pf) => {
  if (!pf) return;
  applyDrilldown(pf);
  pendingFilter.value = null;
});

// Shared with the chat store so Lingo knows which key is open ("this key").
const selectedKey = activeKey;
// Stale once we leave the editor — don't let the chat keep pointing at it.
onUnmounted(() => { activeKey.value = null; });

// Banner refs so a just-submitted batch shows up immediately instead of
// waiting for the banners' 30s poll.
const translateBanner = ref<InstanceType<typeof BatchBanner> | null>(null);
const contextBanner = ref<InstanceType<typeof BatchBanner> | null>(null);

// A specific key handed over (e.g. from the Screenshots view, or Lingo's
// select_key tool) — open its detail panel. Setup-time read covers arriving with
// one pending; the watch covers Lingo selecting while the editor is already open.
function consumePendingKey() {
  if (!pendingKey.value) return;
  selectedKey.value = pendingKey.value;
  pendingKey.value = null;
}
consumePendingKey();
watch(pendingKey, consumePendingKey);
const addOpen = ref(false);
const exportOpen = ref(false);
const translateOpen = ref(false);
const contextOpen = ref(false);
// A scan can be triggered from the header chip or Settings; refresh the used-keys
// index when it completes so the Unused filter and per-key usage stay correct.
watch(scanInfo, () => void reloadUsed());

const parent = ref<HTMLElement | null>(null);

// Initial load only — drives the body spinner. `showSpinner` is armed on a delay
// so fast (small-file) loads never flash it; only a slow large-glotfile load
// keeps the fetch in flight long enough for the spinner to appear.
const loading = ref(true);
const showSpinner = ref(false);

async function reload() {
  state.value = await fetchState();
  void reloadChecks();
}
// Re-fetch when the catalog changes on disk out of band (a CLI sync/translate, a
// git restore). Same swap the editor already does after each of its own edits, so
// scroll and selection survive.
onExternalChange(reload);

const spinnerTimer = setTimeout(() => {
  if (loading.value) showSpinner.value = true;
}, 250);
reload().finally(() => {
  loading.value = false;
  showSpinner.value = false;
  clearTimeout(spinnerTimer);
});

const sourceLocale = computed(() => state.value?.config.sourceLocale ?? "");
const allLocales = computed(() => state.value?.config.locales ?? []);
const targetLocales = computed(() => allLocales.value.filter((l) => l !== sourceLocale.value));

// Default the bilingual target to the first non-source locale once state loads.
watch(
  targetLocales,
  (locs) => {
    if (!selectedTarget.value && locs.length > 0) selectedTarget.value = locs[0]!;
  },
  { immediate: true },
);

// Locales rendered per row: all (source first) in multilingual, source + target in bilingual.
const visibleLocales = computed(() => {
  if (view.value === "bilingual") {
    return selectedTarget.value
      ? [sourceLocale.value, selectedTarget.value]
      : [sourceLocale.value];
  }
  const rest = allLocales.value.filter((l) => l !== sourceLocale.value);
  return [sourceLocale.value, ...rest];
});

const filteredKeys = computed(() => {
  const s = state.value;
  if (!s) return [] as string[];
  // In bilingual view, state/issue facets are scoped to the target being viewed:
  // "Missing" means missing in that locale, not missing in any locale.
  const locale = view.value === "bilingual" && selectedTarget.value ? selectedTarget.value : undefined;
  return filterKeys(s, { ...filter.value, locale }, issuesByKey.value, usedKeySet.value ?? undefined);
});

const rows = computed<string[]>(() => {
  const s = state.value;
  const keys = filteredKeys.value;
  if (sort.value === "key-desc") return [...keys].reverse();
  if (sort.value === "created") {
    const createdAt = (k: string): number => {
      const iso = s?.keys[k]?.createdAt;
      return iso ? Date.parse(iso) : 0;
    };
    return [...keys].sort((a, b) => createdAt(b) - createdAt(a));
  }
  // key-asc is filterKeys' natural order.
  return keys;
});

const scopeLocales = computed(() =>
  view.value === "bilingual"
    ? (selectedTarget.value ? [selectedTarget.value] : [])
    : targetLocales.value,
);
const scopeLabel = computed(() =>
  view.value === "bilingual"
    ? (selectedTarget.value || "—")
    : `all ${targetLocales.value.length} targets`,
);
const selectedKeys = computed(() => selection.keys());
const selectedCount = computed(() => selection.count.value);
const allRowsSelected = computed(() => selection.allSelected(rows.value));
const someRowsSelected = computed(() => selection.someSelected(rows.value));
const tagsOnSelection = computed(() => {
  const s = state.value;
  if (!s) return [] as string[];
  const set = new Set<string>();
  for (const k of selection.keys()) for (const t of s.keys[k]?.tags ?? []) set.add(t);
  return [...set].sort();
});

function toggleAll() {
  if (selection.allSelected(rows.value)) selection.clear();
  else selection.selectAll(rows.value);
}
function onRowToggle(key: string, shift: boolean) {
  if (shift) selection.toggleRange(key, rows.value);
  else selection.toggle(key);
}

// Enforce the invariant selection ⊆ filtered keys: when the filter changes,
// drop any selected key that is no longer shown.
watch(rows, (r) => selection.pruneTo(r));

const selectedEntry = computed(() =>
  state.value && selectedKey.value ? (state.value.keys[selectedKey.value] ?? null) : null,
);

const virtualizer = useVirtualizer(
  computed(() => ({
    count: rows.value.length,
    getScrollElement: () => parent.value,
    // A row stacks one sub-row per visible locale, so its height scales with the
    // locale count (~64px each) — not a fixed 56px. A wildly-low estimate makes
    // the virtualizer keep far too many giant rows mounted and forces a costly
    // re-measure/reflow on every scroll into an unmeasured row.
    estimateSize: () => Math.max(56, visibleLocales.value.length * 64),
    // Tall rows: a small overscan keeps the mounted DOM bounded. With 25-locale
    // rows, overscan:8 meant ~8 extra ~1700px rows mounted in each direction.
    overscan: 2,
    // Key by the actual key string so measurements survive reorders/filtering.
    getItemKey: (index: number) => rows.value[index] ?? index,
  })),
);

const virtualItems = computed(() => virtualizer.value.getVirtualItems());
const totalSize = computed(() => virtualizer.value.getTotalSize());

// Row indices currently inside the scroll viewport (partially-visible rows
// count), ascending. getVirtualItems() also yields a couple of overscan rows
// outside the viewport, so clip to the visible band.
function visibleRowIndices(): number[] {
  const el = parent.value;
  if (!el) return [];
  const top = el.scrollTop;
  const bottom = top + el.clientHeight;
  return virtualizer.value
    .getVirtualItems()
    .filter((it) => it.start < bottom && it.start + it.size > top)
    .map((it) => it.index);
}

// Keep the selected row on screen whenever the selection changes — arrow-key
// nav, Lingo's select_key, and drilldown navigation all set selectedKey, so
// routing the scroll through one watcher means every path reliably "focuses"
// its key. A fully-visible row stays put (no jump); otherwise we anchor its top
// to the viewport top so the key name is visible even for rows taller than the
// viewport. flush "post" runs it after the row list has rendered.
//
// Clicking a row is the exception: the row is already under the cursor, so
// selectKey() sets this flag to skip the scroll once and avoid yanking the list.
let suppressScrollOnce = false;
function scrollSelectedIntoView() {
  if (suppressScrollOnce) {
    suppressScrollOnce = false;
    return;
  }
  const key = selectedKey.value;
  if (!key) return;
  const idx = rows.value.indexOf(key);
  if (idx === -1) return;
  const el = parent.value;
  const item = el ? virtualizer.value.getVirtualItems().find((it) => it.index === idx) : undefined;
  // When the row is offscreen (not currently rendered) we have no measurement —
  // bring it in top-aligned. Otherwise decide from its measured position.
  const align =
    el && item
      ? scrollAlignForRow({
          start: item.start,
          size: item.size,
          scrollTop: el.scrollTop,
          viewport: el.clientHeight,
        })
      : "start";
  if (align) virtualizer.value.scrollToIndex(idx, { align });
}
watch(selectedKey, scrollSelectedIntoView, { flush: "post" });

function selectKey(key: string) {
  // No-op if unchanged, so the flag is only armed when the watcher will fire.
  if (selectedKey.value === key) return;
  suppressScrollOnce = true;
  selectedKey.value = key;
}

// The search box, focused by the "/" hotkey.
const searchInput = ref<{ $el: HTMLInputElement } | null>(null);
function focusSearch() {
  const el = searchInput.value?.$el;
  el?.focus?.();
  // Select existing text so typing replaces the current query.
  el?.select?.();
}

// Global key handling for the editor, skipped while the user is typing in a field
// or a popover/menu/dialog is open.
function onKeydown(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  const typing = !!(t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable));
  const overlayOpen = !!document.querySelector('[role="listbox"],[role="menu"],[role="dialog"]');

  // "/" jumps to the search box (the classic search hotkey).
  if (e.key === "/" && !typing && !overlayOpen && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    focusSearch();
    return;
  }

  // Arrow up/down move the selection between key rows; the selectedKey watcher
  // keeps the new row on screen.
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  if (typing || overlayOpen) return;
  const list = rows.value;
  if (list.length === 0) return;
  e.preventDefault();
  const down = e.key === "ArrowDown";
  const cur = selectedKey.value ? list.indexOf(selectedKey.value) : -1;
  const next = nextRowIndex({ down, cur, visible: visibleRowIndices(), count: list.length });
  const key = list[next];
  if (key) selectedKey.value = key;
}

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
  // Arriving with a key already selected (e.g. Lingo's select_key navigated here
  // while the editor was closed) — scroll it into view now the list has mounted.
  scrollSelectedIntoView();
});
onUnmounted(() => {
  window.removeEventListener("keydown", onKeydown);
  if (textDebounce) clearTimeout(textDebounce);
});

// Load the used-keys index on mount so the Unused filter gate is correct.
onMounted(() => void reloadUsed());

async function onRenamed(from: string, to: string) {
  if (selectedKey.value === from) selectedKey.value = to;
  await reload();
}

async function onCreated(key: string) {
  await reload();
  selectedKey.value = key;
  // Narrow the list to just the new key with an exact-match ("…") search rather
  // than scrolling the virtual list to it — the single resulting row is steadier
  // and cheaper than driving scrollToIndex over thousands of keys.
  filter.value.text = `"${key}"`;
}

</script>

<template>
  <TooltipProvider :delay-duration="400">
    <div class="flex min-h-0 flex-1 flex-col">
      <!-- Toolbar -->
      <div class="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2">
        <div class="relative">
          <Search class="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref="searchInput"
            v-model="filter.text"
            placeholder="Search… try key:, value:, context:, /regex/"
            class="h-8 w-72 pl-8 pr-14"
            @keydown.esc="filter.text = ''"
          />
          <button
            v-if="filter.text"
            type="button"
            class="absolute right-7 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Clear search"
            @click="filter.text = ''"
          >
            <X class="size-3.5" />
          </button>
          <Popover>
            <PopoverTrigger as-child>
              <button
                type="button"
                class="absolute right-1.5 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="Search syntax help"
              >
                <CircleQuestionMark class="size-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" class="w-80 text-sm">
              <p class="mb-2 font-medium">Search syntax</p>
              <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
                <dt class="text-muted-foreground">(no prefix)</dt><dd>Search keys, values and context</dd>
                <dt><code class="rounded bg-muted px-1 py-0.5 font-mono text-xs">key:</code></dt><dd>Match key names only</dd>
                <dt><code class="rounded bg-muted px-1 py-0.5 font-mono text-xs">value:</code></dt><dd>Match translations (all locales)</dd>
                <dt><code class="rounded bg-muted px-1 py-0.5 font-mono text-xs">context:</code></dt><dd>Match context notes</dd>
                <dt><code class="rounded bg-muted px-1 py-0.5 font-mono text-xs">/…/</code></dt><dd>Regular expression</dd>
              </dl>
              <p class="mt-2 text-xs text-muted-foreground">
                Combine them: <code class="rounded bg-muted px-1 py-0.5 font-mono text-xs">value:/sign\s?in/</code>.
                Search is case-insensitive.
              </p>
            </PopoverContent>
          </Popover>
        </div>

        <Popover>
          <PopoverTrigger as-child>
            <Button variant="outline" size="sm" class="h-8 gap-1.5">
              <ListFilter class="size-4 opacity-60" />
              Filter
              <span v-if="activeFacetCount" class="rounded bg-primary px-1.5 text-xs text-primary-foreground">
                {{ activeFacetCount }}
              </span>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" class="w-64">
            <FilterMenu
              v-model:states="filter.states"
              v-model:issues="filter.issues"
              v-model:enabled="enabledChecks"
              v-model:plurality="filter.plurality"
              v-model:empty-source="filter.emptySource"
              v-model:ai-context-unreviewed="filter.aiContextUnreviewed"
              v-model:no-usages="filter.noUsages"
              v-model:skip-translate="filter.skipTranslate"
              :scan-indexed="scanIndexed"
            />
          </PopoverContent>
        </Popover>

        <Button
          :variant="filter.needsAttention ? 'default' : 'outline'"
          size="sm"
          class="h-8 gap-1.5"
          role="switch"
          :aria-checked="filter.needsAttention"
          @click="filter.needsAttention = !filter.needsAttention"
        >
          <TriangleAlert class="size-4" :class="filter.needsAttention ? '' : 'opacity-60'" />
          Needs attention
          <span
            v-if="totalIssues"
            class="ml-0.5 rounded-full bg-destructive-soft px-1.5 text-[11px] font-bold text-destructive tabular-nums"
            :aria-label="`${totalIssues} issue${totalIssues === 1 ? '' : 's'}`"
            >{{ totalIssues.toLocaleString() }}</span
          >
        </Button>

        <Select v-model="sort">
          <SelectTrigger class="h-8 w-[160px]">
            <SelectValue placeholder="Sort" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="key-asc">Key A→Z</SelectItem>
            <SelectItem value="key-desc">Key Z→A</SelectItem>
            <SelectItem value="created">Recently created</SelectItem>
          </SelectContent>
        </Select>

        <Tabs v-model="view">
          <TabsList class="h-8">
            <TabsTrigger value="bilingual" class="text-xs">Bilingual</TabsTrigger>
            <TabsTrigger value="multilingual" class="text-xs">Multilingual</TabsTrigger>
          </TabsList>
        </Tabs>

        <LocaleCombobox v-if="view === 'bilingual'" v-model="selectedTarget" :locales="targetLocales" class="h-8 w-[170px]" />

        <div class="ml-auto flex items-center gap-2">
          <span class="mr-1 text-xs text-muted-foreground tabular-nums">{{ rows.length.toLocaleString() }} keys</span>
          <Button size="sm" variant="outline" @click="exportOpen = true">
            <FileDown class="size-4" /> Export
          </Button>
          <Button size="sm" variant="outline" :disabled="scanPending" @click="runScan">
            <Loader2 v-if="scanPending" class="size-4 animate-spin" />
            <ScanSearch v-else class="size-4" />
            {{ scanPending ? "Scanning…" : "Run scan" }}
          </Button>
          <Button size="sm" @click="addOpen = true">
            <Plus class="size-4" /> Add key
          </Button>
          <Button
            size="sm"
            variant="outline"
            class="w-8 px-0 max-[1080px]:hidden"
            role="switch"
            :aria-checked="detailPanelOpen"
            :aria-label="detailPanelOpen ? 'Hide key details' : 'Show key details'"
            @click="detailPanelToggle.toggle()"
          >
            <PanelRight class="size-4" :class="detailPanelOpen ? '' : 'text-muted-foreground'" />
          </Button>
        </div>
      </div>

      <div
        v-if="filter.states.length || filter.issues.length || filter.plurality.length || filter.emptySource || filter.aiContextUnreviewed || filter.noUsages || filter.skipTranslate"
        class="flex shrink-0 flex-wrap items-center gap-1.5 border-b px-4 py-1.5"
      >
        <Badge v-for="s in filter.states" :key="`s-${s}`" variant="secondary" class="gap-1">
          {{ STATE_LABELS[s] }}
          <button type="button" class="hover:text-foreground" :aria-label="`Remove ${STATE_LABELS[s]} filter`" @click="removeState(s)">
            <X class="size-3" />
          </button>
        </Badge>
        <Badge v-for="p in filter.plurality" :key="`p-${p}`" variant="secondary" class="gap-1">
          {{ PLURALITY_LABELS[p] }}
          <button type="button" class="hover:text-foreground" :aria-label="`Remove ${PLURALITY_LABELS[p]} filter`" @click="removePlurality(p)">
            <X class="size-3" />
          </button>
        </Badge>
        <Badge v-if="filter.emptySource" variant="secondary" class="gap-1">
          Empty source
          <button type="button" class="hover:text-foreground" aria-label="Remove Empty source filter" @click="filter.emptySource = false">
            <X class="size-3" />
          </button>
        </Badge>
        <Badge v-for="c in filter.issues" :key="`i-${c}`" variant="outline" class="gap-1">
          {{ CHECK_LABELS[c] }}
          <button type="button" class="hover:text-foreground" :aria-label="`Remove ${CHECK_LABELS[c]} filter`" @click="removeIssue(c)">
            <X class="size-3" />
          </button>
        </Badge>
        <Badge v-if="filter.aiContextUnreviewed" variant="secondary" class="gap-1">
          <Sparkles class="size-3" /> AI context (unreviewed)
          <button type="button" class="hover:text-foreground" aria-label="Remove AI context filter" @click="filter.aiContextUnreviewed = false">
            <X class="size-3" />
          </button>
        </Badge>
        <Badge v-if="filter.noUsages" variant="secondary" class="gap-1">
          Unused
          <button type="button" class="hover:text-foreground" aria-label="Remove Unused filter" @click="filter.noUsages = false">
            <X class="size-3" />
          </button>
        </Badge>
        <Badge v-if="filter.skipTranslate" variant="secondary" class="gap-1">
          Skip-translate
          <button type="button" class="hover:text-foreground" aria-label="Remove Skip-translate filter" @click="filter.skipTranslate = false">
            <X class="size-3" />
          </button>
        </Badge>
      </div>

      <div class="flex flex-col gap-2 px-4 py-2 empty:hidden">
        <BatchBanner ref="translateBanner" @changed="reload" />
        <BatchBanner ref="contextBanner" kind="context" @changed="reload" />
      </div>

      <div v-if="rows.length" class="sticky top-0 z-20 flex h-11 shrink-0 items-center gap-2 border-b bg-background pl-[18px] pr-4">
        <button
          id="select-all-checkbox"
          type="button"
          role="checkbox"
          :aria-checked="allRowsSelected ? 'true' : someRowsSelected ? 'mixed' : 'false'"
          data-testid="select-all"
          class="flex size-4 items-center justify-center rounded border transition-colors"
          :class="allRowsSelected || someRowsSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground hover:border-primary hover:bg-primary/10'"
          :aria-label="allRowsSelected ? 'Deselect all' : 'Select all'"
          @click="toggleAll"
        >
          <Check v-if="allRowsSelected" class="size-3" />
          <Minus v-else-if="someRowsSelected" class="size-3" />
        </button>
        <template v-if="selectedCount">
          <span class="text-sm font-medium tabular-nums">{{ selectedCount.toLocaleString() }} selected</span>
          <span class="text-sm text-muted-foreground">· {{ scopeLabel }}</span>
        </template>
        <label v-else for="select-all-checkbox" class="cursor-pointer select-none text-sm text-muted-foreground">Select all</label>

        <SelectionBar
          v-if="selectedCount"
          class="ml-auto"
          :keys="selectedKeys"
          :locales="scopeLocales"
          :scope-label="scopeLabel"
          :tags-on-selection="tagsOnSelection"
          @changed="reload"
          @clear="selection.clear()"
          @translate="translateOpen = true"
          @build-context="contextOpen = true"
        />
      </div>

      <!-- Body: virtualized list + detail panel -->
      <div class="flex min-h-0 flex-1 overflow-hidden" :style="{ '--key-col-width': `${keyColumnWidth}px` }">
        <div class="relative min-w-0 flex-1 overflow-hidden">
          <div ref="parent" class="h-full overflow-auto">
            <div
              v-if="showSpinner"
              class="flex h-full items-center justify-center gap-2 p-8 text-sm text-muted-foreground"
            >
              <Loader2 class="size-4 animate-spin" />
              Loading…
            </div>
            <div
              v-else-if="!loading && rows.length === 0"
              class="flex h-full items-center justify-center p-8 text-sm text-muted-foreground"
            >
              No keys match the current filter.
            </div>
            <div v-else :style="{ height: `${totalSize}px`, position: 'relative', width: '100%' }">
              <div
                v-for="vitem in virtualItems"
                :key="vitem.key"
                :ref="(el) => virtualizer.measureElement(el as Element | null)"
                :data-index="vitem.index"
                :style="{
                  position: 'absolute',
                  top: `${vitem.start}px`,
                  left: '0',
                  width: '100%',
                }"
              >
                <KeyRow
                  v-if="state && rows[vitem.index]"
                  :key-name="rows[vitem.index]!"
                  :entry="state.keys[rows[vitem.index]!]!"
                  :source-locale="sourceLocale"
                  :locales="visibleLocales"
                  :selected="selectedKey === rows[vitem.index]"
                  :issues="issuesByKey.get(rows[vitem.index]!) ?? []"
                  :checked="selection.has(rows[vitem.index]!)"
                  @select="selectKey(rows[vitem.index]!)"
                  @changed="reload"
                  @renamed="(to: string) => onRenamed(rows[vitem.index]!, to)"
                  @filter-tag="(t: string) => (filter.text = t)"
                  @toggle-select="(p: { shift: boolean }) => onRowToggle(rows[vitem.index]!, p.shift)"
                />
              </div>
            </div>
          </div>
          <!-- Key column resizer, overlaid on the column border across the full list height.
               Positioned by a wrapper so the handle's own positioning classes aren't overridden. -->
          <div v-if="rows.length" class="absolute inset-y-0" :style="{ left: `${keyColumnWidth}px` }">
            <ResizeHandle
              side="right"
              class="h-full"
              :width="keyColumnWidth"
              :min="keyColumn.min"
              :max="keyColumn.max"
              @update:width="keyColumn.set"
              @commit="keyColumn.commit"
              @reset="keyColumn.reset"
            />
          </div>
        </div>

        <ResizeHandle
          v-if="detailPanelOpen"
          side="left"
          class="max-[1080px]:hidden"
          :width="detailPanelWidth"
          :min="detailPanel.min"
          :max="detailPanel.max"
          @update:width="detailPanel.set"
          @commit="detailPanel.commit"
          @reset="detailPanel.reset"
        />
        <DetailPanel
          v-if="detailPanelOpen"
          :key-name="selectedKey"
          :entry="selectedEntry"
          :issues="selectedKey ? (issuesByKey.get(selectedKey) ?? []) : []"
          :locales="allLocales"
          :source-locale="sourceLocale"
          :usage-revision="usageRevision"
          :style="{ width: `${detailPanelWidth}px` }"
          @changed="reload"
        />
      </div>

      <AddKeyDialog v-model:open="addOpen" @created="onCreated" />
      <ExportDialog v-model:open="exportOpen" :export-locales="state?.config.exportLocales ?? []" />
      <TranslateDialog v-model:open="translateOpen" :state="state" :filtered-keys="selectedKeys" :target-locale="view === 'bilingual' ? selectedTarget : undefined" @changed="reload" @batch-submitted="translateBanner?.refresh()" />
      <ContextDialog v-model:open="contextOpen" :state="state" :keys="selectedKeys" @changed="reload" @batch-submitted="contextBanner?.refresh()" />
    </div>
  </TooltipProvider>
</template>
