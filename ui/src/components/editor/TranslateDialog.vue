<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { Sparkles, TriangleAlert, LoaderCircle, Check, Circle } from "lucide-vue-next";
import { translateStream, translateEstimate, batchStatus, batchSubmit } from "@/api.js";
import { isTargetMissing } from "@/missing.js";
import type { State, TranslateError, TranslateEstimate } from "@/types.js";
import { toast } from "@/components/ui/toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import LanguageLabel from "@/components/lang/LanguageLabel.vue";

const props = defineProps<{ state: State | null; filteredKeys?: string[]; targetLocale?: string }>();
const open = defineModel<boolean>("open", { required: true });
const emit = defineEmits<{ (e: "changed"): void; (e: "batch-submitted"): void }>();

const running = ref(false);
const error = ref("");
const errors = ref<TranslateError[]>([]);
const progressDone = ref(0);
const progressTotal = ref(0);
let abortController: AbortController | null = null;

// Per-language live status, driven by the SSE start/locale-start/progress/locale-done
// events. This is the "things are happening" feedback: every target language shows
// up as queued the instant the run begins, flips to active the moment a worker picks
// it up (before its first slow LLM call returns), and ticks its own count thereafter.
type LocaleStatus = "queued" | "active" | "done";
interface LocaleRow { locale: string; total: number; done: number; status: LocaleStatus }
const localeRows = ref<LocaleRow[]>([]);
const rowFor = (locale: string) => localeRows.value.find((r) => r.locale === locale);
const activeCount = computed(() => localeRows.value.filter((r) => r.status === "active").length);
// Active first, then queued, then done — done languages sink to the bottom.
const STATUS_RANK: Record<LocaleStatus, number> = { active: 0, queued: 1, done: 2 };
const sortedRows = computed(() =>
  [...localeRows.value].sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status]),
);
const statusIcon = (status: LocaleStatus) => (status === "active" ? LoaderCircle : status === "done" ? Check : Circle);

const targetLocales = computed(() => {
  const s = props.state;
  if (!s) return [];
  if (props.targetLocale) return [props.targetLocale];
  return s.config.locales.filter((l) => l !== s.config.sourceLocale);
});

// Mirror the server's selectRequests({ onlyMissing: true }) counting: skip
// skipTranslate keys, then count target pairs that isTargetMissing flags (which
// handles both scalar values and plural forms). Scoped to filteredKeys/targetLocale when set.
const missingCount = computed(() => {
  const s = props.state;
  if (!s) return 0;
  const keySet = props.filteredKeys ? new Set(props.filteredKeys) : null;
  let count = 0;
  for (const [key, entry] of Object.entries(s.keys)) {
    if (keySet && !keySet.has(key)) continue;
    if (entry.skipTranslate) continue;
    for (const locale of targetLocales.value) {
      if (isTargetMissing(entry, locale, s.config.sourceLocale)) count++;
    }
  }
  return count;
});

// Snapshot of missingCount taken when a run starts. The description prompt and
// button read displayCount, so the count stays put as the editor's state
// refreshes mid-run (each progress event emits "changed"). Null = no run yet,
// so the prompt tracks the live count until the user commits. Reset on open.
const lockedCount = ref<number | null>(null);
const displayCount = computed(() => lockedCount.value ?? missingCount.value);

// Batch availability, fetched on open. Hidden whenever unsupported, a batch is
// already pending (the editor banner owns that state), or the check fails.
const batchAvailable = ref(false);
const submittingBatch = ref(false);

async function loadBatchAvailability() {
  batchAvailable.value = false;
  try {
    const s = await batchStatus();
    batchAvailable.value = s.supported && !s.pending;
  } catch {
    // Advisory only — a failed check just hides the batch button.
  }
}

async function runBatch() {
  submittingBatch.value = true;
  try {
    const res = await batchSubmit({
      keys: props.filteredKeys?.length ? props.filteredKeys : undefined,
      locales: props.targetLocale ? [props.targetLocale] : undefined,
    });
    toast.success(`Batch of ${res.total.toLocaleString()} strings submitted — results apply when processing finishes (usually under an hour).`);
    emit("batch-submitted");
    open.value = false;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    submittingBatch.value = false;
  }
}

// Pre-flight cost preview, fetched whenever the dialog opens. Advisory only —
// a failed estimate must never block translating.
const estimate = ref<TranslateEstimate | null>(null);

const fmtTokens = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n.toLocaleString());
const fmtCost = (n: number) => (n >= 0.1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`);

// The batch API bills at half the synchronous price — show the actual figure
// when an estimate is available rather than making the user do the maths.
const batchLabel = computed(() => {
  const cost = estimate.value?.estimatedCost;
  return cost != null ? `Batch ≈ ${fmtCost(cost / 2)} (50% off)` : "Batch (50% off)";
});

async function loadEstimate() {
  estimate.value = null;
  try {
    estimate.value = await translateEstimate({
      keys: props.filteredKeys?.length ? props.filteredKeys : undefined,
      locales: props.targetLocale ? [props.targetLocale] : undefined,
    });
  } catch {
    // Leave estimate null; the dialog simply shows no preview line.
  }
}

watch(open, (v) => {
  if (v) {
    error.value = "";
    errors.value = [];
    progressDone.value = 0;
    progressTotal.value = 0;
    localeRows.value = [];
    lockedCount.value = null;
    void loadEstimate();
    void loadBatchAvailability();
  }
}, { immediate: true });

function cancel() {
  abortController?.abort();
}

async function run() {
  abortController = new AbortController();
  running.value = true;
  error.value = "";
  errors.value = [];
  progressDone.value = 0;
  localeRows.value = [];
  lockedCount.value = missingCount.value;
  progressTotal.value = lockedCount.value;
  try {
    const signal = abortController.signal;
    let written = 0;
    const keys = props.filteredKeys?.length ? props.filteredKeys : undefined;
    const locales = props.targetLocale ? [props.targetLocale] : undefined;
    const streamArgs: Parameters<typeof translateStream> = locales
      ? [signal, keys, locales]
      : keys ? [signal, keys] : [signal];
    for await (const event of translateStream(...streamArgs)) {
      if (event.type === "start") {
        progressTotal.value = event.total;
        localeRows.value = event.locales.map((l) => ({ locale: l.locale, total: l.total, done: 0, status: "queued" }));
      } else if (event.type === "locale-start") {
        const row = rowFor(event.locale);
        if (row) row.status = "active";
      } else if (event.type === "progress") {
        progressDone.value = event.done;
        progressTotal.value = event.total;
        const row = rowFor(event.locale);
        if (row) {
          row.done = event.localeDone;
          if (row.status === "queued") row.status = "active";
        }
        emit("changed");
      } else if (event.type === "locale-done") {
        const row = rowFor(event.locale);
        if (row) { row.status = "done"; row.done = row.total; }
      } else if (event.type === "done") {
        written = event.written;
        errors.value = event.errors;
        progressDone.value = progressTotal.value;
        emit("changed");
      }
    }
    if (!signal.aborted) {
      toast.success(`Translated ${written} string${written === 1 ? "" : "s"}`);
      if (errors.value.length === 0) open.value = false;
    }
  } catch (e) {
    if ((e as Error).name !== "AbortError") error.value = (e as Error).message;
  } finally {
    running.value = false;
    abortController = null;
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="flex max-h-[85vh] max-w-lg flex-col">
      <DialogHeader>
        <DialogTitle>Translate missing strings</DialogTitle>
        <DialogDescription>
          <template v-if="displayCount === 0">Nothing missing — all translations are filled.</template>
          <template v-else>
            Translate {{ displayCount.toLocaleString() }} missing string{{ displayCount === 1 ? "" : "s" }}
            across {{ targetLocales.length }} language{{ targetLocales.length === 1 ? "" : "s" }} with Claude?
            This sends source strings + context to the AI provider.
          </template>
        </DialogDescription>
      </DialogHeader>

      <!-- Pre-flight estimate (±20% heuristic; excludes screenshot image tokens). -->
      <div
        v-if="estimate && estimate.requests > 0 && displayCount > 0 && !running && progressDone === 0"
        class="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
      >
        <p>
          ≈ {{ estimate.requests.toLocaleString() }} requests · {{ estimate.batches.toLocaleString() }} batch{{ estimate.batches === 1 ? "" : "es" }} ·
          ~{{ fmtTokens(estimate.inputTokens) }} in / ~{{ fmtTokens(estimate.outputTokens) }} out tokens<template v-if="estimate.estimatedCost !== null">
            · <span class="font-medium text-foreground">≈ {{ fmtCost(estimate.estimatedCost) }}</span> (±20%)</template>
        </p>
        <p v-if="!estimate.pricing" class="mt-0.5">
          No pricing known for this model — set a price in Settings → AI for a dollar estimate.
        </p>
        <details v-if="estimate.perLocale.length > 1" class="mt-1">
          <summary class="cursor-pointer select-none">Per-language breakdown</summary>
          <ul class="mt-1">
            <li v-for="l in estimate.perLocale" :key="l.locale" class="flex justify-between font-mono tabular-nums">
              <span>{{ l.locale }}</span>
              <span>{{ l.requests.toLocaleString() }} req · ~{{ fmtTokens(l.inputTokens) }} / ~{{ fmtTokens(l.outputTokens) }}</span>
            </li>
          </ul>
        </details>
      </div>

      <div v-if="running || progressDone > 0" class="flex min-h-0 flex-col gap-1.5">
        <div class="flex justify-between text-xs text-muted-foreground">
          <span>{{ progressDone.toLocaleString() }} / {{ progressTotal.toLocaleString() }} translated</span>
          <span v-if="running && localeRows.length">{{ activeCount }} of {{ localeRows.length }} language{{ localeRows.length === 1 ? "" : "s" }} active</span>
        </div>
        <Progress :model-value="progressTotal > 0 ? (progressDone / progressTotal) * 100 : 0" />

        <!-- Per-language live status: queued → active (spinner) → done (check). -->
        <ul v-if="localeRows.length" class="mt-1 flex max-h-56 min-h-0 flex-col overflow-y-auto rounded-md border text-sm">
          <li
            v-for="row in sortedRows"
            :key="row.locale"
            class="flex items-center gap-2 border-b px-3 py-1.5 last:border-b-0"
            :class="row.status === 'queued' && 'opacity-55'"
          >
            <component
              :is="statusIcon(row.status)"
              class="size-3.5 shrink-0"
              :class="row.status === 'active' ? 'animate-spin text-primary' : row.status === 'done' ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'"
            />
            <LanguageLabel :code="row.locale" :size="14" show-name />
            <span
              class="ml-auto font-mono text-xs tabular-nums"
              :class="row.status === 'active' ? 'text-foreground' : 'text-muted-foreground'"
            >{{ row.done.toLocaleString() }} / {{ row.total.toLocaleString() }}</span>
          </li>
        </ul>
      </div>

      <div
        v-if="error"
        class="flex flex-col gap-1 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
      >
        <p class="flex items-center gap-1.5 font-medium">
          <TriangleAlert class="size-4" /> Translation failed
        </p>
        <p>{{ error }}</p>
      </div>

      <div v-if="errors.length" class="flex min-h-0 flex-col gap-1.5">
        <p class="flex items-center gap-1.5 text-sm font-medium text-amber-700 dark:text-amber-400">
          <TriangleAlert class="size-4" />
          {{ errors.length }} string{{ errors.length === 1 ? "" : "s" }} could not be translated
        </p>
        <ul class="min-h-0 flex-1 overflow-y-auto rounded-md border text-sm">
          <li
            v-for="(err, i) in errors"
            :key="`${err.key}-${err.locale}-${i}`"
            class="border-b px-3 py-1.5 last:border-b-0"
          >
            <span class="inline-flex items-center gap-1.5 font-mono text-xs">
              {{ err.key }} @ <LanguageLabel :code="err.locale" :size="12" />
            </span>
            <span class="text-muted-foreground"> — {{ err.error }}</span>
          </li>
        </ul>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="running ? cancel() : (open = false)">
          {{ running ? "Cancel" : "Close" }}
        </Button>
        <Button
          v-if="displayCount > 0 && batchAvailable"
          variant="outline"
          :disabled="running || submittingBatch"
          @click="runBatch"
        >
          {{ submittingBatch ? "Submitting…" : batchLabel }}
        </Button>
        <Button v-if="displayCount > 0" :disabled="running" @click="run">
          <Sparkles class="size-4" />
          {{ running ? "Translating…" : "Translate" }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
