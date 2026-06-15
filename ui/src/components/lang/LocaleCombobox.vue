<script setup lang="ts">
import { computed, ref } from "vue";
import {
  ComboboxRoot,
  ComboboxAnchor,
  ComboboxTrigger,
  ComboboxPortal,
  ComboboxContent,
  ComboboxInput,
  ComboboxViewport,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxEmpty,
} from "reka-ui";
import { Check, ChevronDown, Search } from "lucide-vue-next";
import { resolveLanguage } from "@/languages.js";
import { cn } from "@/lib/utils";
import LanguageLabel from "./LanguageLabel.vue";

const props = defineProps<{
  locales: string[];
  placeholder?: string;
  class?: string;
}>();

const model = defineModel<string>();

const open = ref(false);
const search = ref("");

const sorted = computed(() =>
  props.locales
    .map((code) => ({ code, resolved: resolveLanguage(code) }))
    .sort((a, b) => a.resolved.name.localeCompare(b.resolved.name, "en")),
);

// Match against display name, code (both stored and BCP-47 forms) and endonym,
// so "german", "de" and "Deutsch" all find German.
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
</script>

<template>
  <ComboboxRoot v-model="model" :open="open" ignore-filter @update:open="onOpenChange">
    <ComboboxAnchor as-child>
      <ComboboxTrigger
        :class="cn(
          'flex h-9 items-center justify-between gap-2 whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
          props.class,
        )"
      >
        <LanguageLabel v-if="model" :code="model" show-name :show-code="false" :size="14" />
        <span v-else class="text-muted-foreground">{{ placeholder ?? "Locale" }}</span>
        <ChevronDown class="size-4 shrink-0 opacity-50" />
      </ComboboxTrigger>
    </ComboboxAnchor>
    <ComboboxPortal>
      <ComboboxContent
        position="popper"
        align="start"
        :side-offset="4"
        class="z-50 max-h-96 w-[260px] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1"
      >
        <div class="flex items-center gap-2 border-b px-3">
          <Search class="size-4 shrink-0 opacity-50" />
          <!-- Without display-value, reka's resetSearchTerm fills the input with the
               selected code ("ar"), pre-filtering the list on open. -->
          <ComboboxInput
            v-model="search"
            :display-value="() => ''"
            placeholder="Search locales…"
            class="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <ComboboxViewport class="max-h-72 p-1">
          <ComboboxEmpty class="py-6 text-center text-sm text-muted-foreground">
            No locales found
          </ComboboxEmpty>
          <ComboboxItem
            v-for="{ code } in filtered"
            :key="code"
            :value="code"
            class="relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
          >
            <span class="absolute left-2 flex size-3.5 items-center justify-center">
              <ComboboxItemIndicator>
                <Check class="size-4" />
              </ComboboxItemIndicator>
            </span>
            <span class="flex w-full min-w-0 items-center justify-between gap-2">
              <LanguageLabel :code="code" show-name :show-code="false" :size="14" />
              <span class="shrink-0 font-mono text-xs text-muted-foreground">{{ code.toUpperCase() }}</span>
            </span>
          </ComboboxItem>
        </ComboboxViewport>
      </ComboboxContent>
    </ComboboxPortal>
  </ComboboxRoot>
</template>
