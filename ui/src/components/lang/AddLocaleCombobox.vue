<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import {
  ComboboxRoot,
  ComboboxAnchor,
  ComboboxTrigger,
  ComboboxPortal,
  ComboboxContent,
  ComboboxInput,
  ComboboxViewport,
  ComboboxVirtualizer,
  ComboboxItem,
} from "reka-ui";
import { ChevronDown, Plus, Search } from "lucide-vue-next";
import { LOCALE_CATALOG, isKnownLocale } from "@/locale-catalog.js";
import { resolveLanguage } from "@/languages.js";
import { cn } from "@/lib/utils";
import LanguageLabel from "./LanguageLabel.vue";

interface Suggestion {
  code: string;
  name: string;
  endonym?: string;
}

// The helper list: every catalog locale the browser's Intl can actually name,
// resolved once and sorted A-Z by name. Built lazily and memoised because resolving
// ~1k codes isn't free and the catalog never changes. Codes the browser can't name
// (Intl returns the bare code) are left out — users type those by hand instead.
let namedCatalog: Suggestion[] | null = null;
function suggestions(): Suggestion[] {
  if (!namedCatalog) {
    namedCatalog = LOCALE_CATALOG.flatMap((code) => {
      const base = resolveLanguage(code.split(/[-_]/)[0]!);
      if (base.isCustom || base.name.toLowerCase() === base.bcp47.toLowerCase()) return [];
      const resolved = resolveLanguage(code);
      return [{ code, name: resolved.name, endonym: resolved.endonym }];
    }).sort((a, b) => a.name.localeCompare(b.name, "en"));
  }
  return namedCatalog;
}

// Already-present locales — excluded from the list (stored lowercase).
const props = defineProps<{
  existing: string[];
  class?: string;
}>();

const emit = defineEmits<{ add: [code: string] }>();

const open = ref(false);
const search = ref("");

const existingSet = computed(() => new Set(props.existing.map((l) => l.toLowerCase())));

const available = computed(() => suggestions().filter((s) => !existingSet.value.has(s.code.toLowerCase())));

// Match on display name, code and endonym, so "german", "de" and "Deutsch" all find German.
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return available.value;
  return available.value.filter((s) =>
    s.code.toLowerCase().includes(q)
    || s.name.toLowerCase().includes(q)
    || (s.endonym?.toLowerCase().includes(q) ?? false),
  );
});

// A custom/invented locale the user can create (e.g. "yoda", "en-pirate"): a typed
// code that isn't a known locale, isn't already added, has no spaces, and matches
// nothing in the list — so we only offer "create" when there's nothing to pick.
const customCode = computed(() => {
  const q = search.value.trim();
  if (!q || /\s/.test(q) || filtered.value.length > 0) return null;
  const low = q.toLowerCase();
  if (existingSet.value.has(low) || isKnownLocale(low)) return null;
  return low;
});

// Guards against a single Enter both selecting reka's highlighted item AND running
// our own commit — the first add wins, the duplicate is dropped within the tick.
let adding = false;
function add(code: string) {
  if (adding) return;
  adding = true;
  emit("add", code);
  search.value = "";
  open.value = false;
  nextTick(() => {
    adding = false;
  });
}

// Enter adds what was typed: an exact known code as-is, else the best match in the
// filtered list, else the custom locale.
function commitTyped() {
  const q = search.value.trim();
  if (!q) return;
  if (isKnownLocale(q)) {
    add(q.toLowerCase());
  } else if (filtered.value.length > 0) {
    add(filtered.value[0]!.code.toLowerCase());
  } else if (customCode.value) {
    add(customCode.value);
  }
}

function onOpenChange(value: boolean) {
  open.value = value;
  if (!value) search.value = "";
}
</script>

<template>
  <ComboboxRoot :open="open" ignore-filter @update:open="onOpenChange">
    <ComboboxAnchor as-child>
      <div
        :class="cn(
          'flex h-9 items-center gap-2 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2',
          props.class,
        )"
      >
        <Search class="size-4 shrink-0 opacity-50" />
        <ComboboxInput
          id="add-locale"
          v-model="search"
          :display-value="() => search"
          placeholder="Search every language and locale…"
          class="h-full w-full bg-transparent font-mono outline-none placeholder:font-sans placeholder:text-muted-foreground"
          @focus="open = true"
          @keydown.enter.prevent="commitTyped"
        />
        <ComboboxTrigger class="shrink-0 opacity-50 hover:opacity-100">
          <ChevronDown class="size-4" />
        </ComboboxTrigger>
      </div>
    </ComboboxAnchor>
    <ComboboxPortal>
      <ComboboxContent
        position="popper"
        align="start"
        :side-offset="4"
        class="z-50 max-h-96 w-[var(--reka-combobox-trigger-width)] min-w-[260px] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
      >
        <ComboboxViewport class="max-h-80 overflow-y-auto p-1">
          <!-- Create a custom / invented locale from the typed code. Only shown when
               nothing matches, so it never overlaps the virtualized list below. -->
          <ComboboxItem
            v-if="customCode"
            :value="customCode"
            class="flex w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
            @select="add(customCode)"
          >
            <Plus class="size-4 shrink-0 opacity-60" />
            <span class="flex min-w-0 items-center gap-1.5">
              Add custom locale
              <LanguageLabel :code="customCode" show-name :size="14" />
            </span>
            <span class="ml-auto shrink-0 font-mono text-xs text-muted-foreground">{{ customCode }}</span>
          </ComboboxItem>

          <!-- Virtualized: only the visible rows render, so opening the full ~1k list
               stays instant. Rows are a uniform ~32px tall. -->
          <ComboboxVirtualizer
            v-if="filtered.length"
            v-slot="{ option }"
            :options="filtered"
            :estimate-size="32"
            :text-content="(o) => o.name"
          >
            <ComboboxItem
              :value="option.code"
              class="flex h-8 w-full cursor-default select-none items-center justify-between gap-2 rounded-sm px-2 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
              @select="add(option.code.toLowerCase())"
            >
              <LanguageLabel :code="option.code" show-name :show-code="false" :size="14" />
              <span class="shrink-0 font-mono text-xs text-muted-foreground">{{ option.code }}</span>
            </ComboboxItem>
          </ComboboxVirtualizer>

          <div
            v-if="!filtered.length && !customCode"
            class="py-6 text-center text-sm text-muted-foreground"
          >
            No languages found
          </div>
        </ComboboxViewport>
      </ComboboxContent>
    </ComboboxPortal>
  </ComboboxRoot>
</template>
