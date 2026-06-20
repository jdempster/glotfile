<script setup lang="ts">
import { computed, ref } from "vue";
import { Languages, Check, Search } from "lucide-vue-next";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { resolveLanguage, compareByLanguageName } from "@/languages.js";
import LanguageLabel from "@/components/lang/LanguageLabel.vue";
import { toggleMultilingual } from "@/multilingualLocales.js";

const props = defineProps<{
  // All target locales (source excluded), in config order.
  targets: string[];
  // The remembered subset; null means "show all".
  selected: string[] | null;
}>();

const emit = defineEmits<{
  // null when every target is selected, so locales added later stay visible.
  (e: "update:selected", v: string[] | null): void;
}>();

const open = ref(false);
const search = ref("");

// The effective on-screen set: every target when "all", else the stored subset
// intersected with locales that still exist.
const effective = computed(
  () => new Set(props.selected === null ? props.targets : props.targets.filter((l) => props.selected!.includes(l))),
);

const showingAll = computed(() => props.selected === null);
// Show the language name when focused on a single locale (the old "bilingual"
// view), the count otherwise.
const label = computed(() => {
  if (showingAll.value) return "All locales";
  const sel = [...effective.value];
  if (sel.length === 1) return resolveLanguage(sel[0]!).name;
  return `${sel.length}/${props.targets.length}`;
});

// A-Z by language name — the same order the editor columns use.
const sorted = computed(() =>
  [...props.targets]
    .sort(compareByLanguageName)
    .map((code) => ({ code, resolved: resolveLanguage(code) })),
);

// Match against display name, code (stored + BCP-47 forms) and endonym, so
// "german", "de" and "Deutsch" all find German — mirrors LocaleCombobox.
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return sorted.value;
  return sorted.value.filter(({ code, resolved }) =>
    code.toLowerCase().includes(q)
    || resolved.bcp47.toLowerCase().includes(q)
    || resolved.name.toLowerCase().includes(q)
    || (resolved.endonym?.toLowerCase().includes(q) ?? false),
  );
});

function onOpenChange(value: boolean) {
  open.value = value;
  if (value) search.value = "";
}

function toggle(locale: string) {
  emit("update:selected", toggleMultilingual(props.targets, props.selected, locale));
}

function selectAll() {
  emit("update:selected", null);
}

// One-click focus on a single locale (the old "bilingual" view).
function only(locale: string) {
  emit("update:selected", [locale]);
}
</script>

<template>
  <Popover :open="open" @update:open="onOpenChange">
    <PopoverTrigger as-child>
      <Button variant="outline" size="sm" class="h-8 gap-1.5">
        <Languages class="size-4 opacity-60" />
        {{ label }}
      </Button>
    </PopoverTrigger>
    <PopoverContent align="start" class="w-64 p-0">
      <div class="flex items-center gap-2 border-b px-3">
        <Search class="size-4 shrink-0 opacity-50" />
        <input
          v-model="search"
          placeholder="Search locales…"
          class="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      <div class="flex items-center justify-between px-2 pt-2">
        <p class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Locales shown</p>
        <button
          type="button"
          class="rounded px-1.5 py-0.5 text-xs text-muted-foreground enabled:hover:bg-accent enabled:hover:text-foreground disabled:opacity-40"
          :disabled="showingAll"
          @click="selectAll"
        >
          Show all
        </button>
      </div>
      <div class="max-h-72 overflow-y-auto p-1">
        <p v-if="!filtered.length" class="py-6 text-center text-sm text-muted-foreground">No locales found</p>
        <div
          v-for="{ code } in filtered"
          :key="code"
          class="group flex items-center gap-1 rounded pr-1 hover:bg-accent"
        >
          <button
            type="button"
            role="checkbox"
            :aria-checked="effective.has(code)"
            class="flex min-w-0 flex-1 items-center gap-2 rounded px-1.5 py-1 text-sm"
            @click="toggle(code)"
          >
            <span
              class="flex size-4 shrink-0 items-center justify-center rounded border transition-colors"
              :class="effective.has(code) ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground group-hover:border-primary'"
            >
              <Check v-if="effective.has(code)" class="size-3" />
            </span>
            <LanguageLabel :code="code" show-name />
          </button>
          <button
            type="button"
            class="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground opacity-0 transition hover:bg-background hover:text-foreground focus:opacity-100 group-hover:opacity-100"
            title="Show only this locale"
            @click="only(code)"
          >
            Only
          </button>
        </div>
      </div>
    </PopoverContent>
  </Popover>
</template>
