<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { ArrowRight } from "lucide-vue-next";
import type { LogEntry } from "@/types.js";
import { getLog } from "@/api.js";
import { onExternalChange } from "@/liveReload";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import AiItemList from "./AiItemList.vue";

const entries = ref<LogEntry[]>([]);
const loading = ref(true);
const filter = ref<string>("all");

async function reload() {
  try {
    entries.value = await getLog();
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    loading.value = false;
  }
}

onMounted(reload);
// An out-of-band change (a CLI sync/translate) also appends to the activity log.
onExternalChange(reload);

const isAi = (e: LogEntry) => e.kind === "translate" || e.kind === "context";
// Kinds actually present, in first-seen order, for the filter chips.
const kinds = computed(() => [...new Set(entries.value.map((e) => e.kind))]);
const filtered = computed(() => (filter.value === "all" ? entries.value : entries.value.filter((e) => e.kind === filter.value)));

const chipClass = (k: string) =>
  cn(
    "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
    filter.value === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
  );

// A run's item detail is collapsed by default once it's large, so opening
// Activity never mounts thousands of rows; small runs stay open (glanceable).
const AUTO_OPEN_MAX = 10;
const openOverride = ref<Map<LogEntry, boolean>>(new Map());
const itemCount = (e: LogEntry): number => e.items?.length ?? 0;
const errorCount = (e: LogEntry): number => (e.results ?? []).filter((r) => r.error).length;
function isOpen(e: LogEntry): boolean {
  return openOverride.value.get(e) ?? itemCount(e) <= AUTO_OPEN_MAX;
}
function toggle(e: LogEntry): void {
  const next = new Map(openOverride.value);
  next.set(e, !isOpen(e));
  openOverride.value = next;
}
function fmt(v: unknown): string {
  if (v === undefined || v === null || v === "") return "∅";
  return typeof v === "string" ? v : JSON.stringify(v);
}
// Objects (plural forms, config snapshots) serialize to JSON — render them
// monospaced so the structure stays legible.
const isObject = (v: unknown) => v !== null && typeof v === "object";
</script>

<template>
  <div class="min-h-0 flex-1 overflow-y-auto p-4">
    <p v-if="!loading && entries.length === 0" class="mt-8 text-center text-sm text-muted-foreground">
      No activity yet — edits, translations, and config changes will show up here.
    </p>

    <div v-else class="mx-auto flex max-w-4xl flex-col gap-4">
      <div v-if="kinds.length > 1" class="flex flex-wrap gap-1.5">
        <button type="button" :class="chipClass('all')" @click="filter = 'all'">All</button>
        <button v-for="k in kinds" :key="k" type="button" :class="chipClass(k)" @click="filter = k">{{ k }}</button>
      </div>

      <article v-for="(entry, i) in filtered" :key="`${entry.at}-${i}`" class="rounded-lg border bg-card">
        <header class="flex flex-wrap items-center gap-3 border-b px-4 py-2.5">
          <span class="text-sm font-medium">{{ new Date(entry.at).toLocaleString() }}</span>
          <Badge variant="outline" class="font-mono uppercase">{{ entry.kind }}</Badge>
          <span class="text-sm text-muted-foreground">{{ entry.summary }}</span>
          <Badge v-if="entry.model" variant="secondary" class="ml-auto font-mono">{{ entry.model }}</Badge>
        </header>

        <!-- AI entries: a run summary + the system prompt, with item detail
             collapsed once a run is large (and virtualized when expanded). -->
        <template v-if="isAi(entry)">
          <details class="border-b">
            <summary class="cursor-pointer select-none px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground">
              System prompt
            </summary>
            <pre class="overflow-x-auto whitespace-pre-wrap break-words bg-muted/40 px-4 py-3 font-mono text-xs leading-relaxed">{{ entry.system }}</pre>
          </details>
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2 text-xs text-muted-foreground">
            <span v-if="errorCount(entry)" class="text-destructive">{{ errorCount(entry) }} {{ errorCount(entry) === 1 ? "error" : "errors" }}</span>
            <button
              v-if="itemCount(entry)"
              type="button"
              class="ml-auto rounded px-2 py-0.5 font-medium hover:bg-muted hover:text-foreground"
              @click="toggle(entry)"
            >
              {{ isOpen(entry) ? "Hide items" : `Show ${itemCount(entry)} items` }}
            </button>
          </div>
          <AiItemList v-if="isOpen(entry) && itemCount(entry)" :items="entry.items ?? []" :results="entry.results ?? []" />
        </template>

        <!-- General edits: key/locale and a before → after pair when present. -->
        <div v-else-if="entry.key || entry.before !== undefined || entry.after !== undefined" class="flex flex-col gap-1.5 px-4 py-3">
          <div v-if="entry.key" class="flex items-center gap-2">
            <span class="truncate font-mono text-xs text-muted-foreground">{{ entry.key }}</span>
            <Badge v-if="entry.locale" variant="outline" class="shrink-0 font-mono uppercase">{{ entry.locale }}</Badge>
          </div>
          <div v-if="entry.before !== undefined || entry.after !== undefined" class="flex items-start gap-2 text-sm">
            <span v-if="entry.before !== undefined" :class="cn('min-w-0 flex-1 break-words text-muted-foreground', isObject(entry.before) && 'font-mono text-xs')">{{ fmt(entry.before) }}</span>
            <ArrowRight v-if="entry.before !== undefined && entry.after !== undefined" class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span v-if="entry.after !== undefined" :class="cn('min-w-0 flex-1 break-words', isObject(entry.after) && 'font-mono text-xs')">{{ fmt(entry.after) }}</span>
          </div>
        </div>
      </article>
    </div>
  </div>
</template>
