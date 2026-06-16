<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { Sparkles, TriangleAlert } from "lucide-vue-next";
import { suggestGlossaryStream, glossarySuggestEstimate, glossarySuggestBatchStatus, glossarySuggestBatchSubmit } from "@/api.js";
import type { GlossarySuggestEstimate } from "@/types.js";
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

const open = defineModel<boolean>("open", { required: true });
const emit = defineEmits<{ (e: "found"): void; (e: "batch-submitted"): void }>();

const running = ref(false);
const controller = ref<AbortController | null>(null);
const error = ref("");
const progressDone = ref(0);
const progressTotal = ref(0);

const estimate = ref<GlossarySuggestEstimate | null>(null);
const batchAvailable = ref(false);
const submittingBatch = ref(false);

const fmtTokens = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n.toLocaleString());
const fmtCost = (n: number) => (n >= 0.1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`);

const batchLabel = computed(() => {
  const cost = estimate.value?.estimatedCost;
  return cost != null ? `Batch ≈ ${fmtCost(cost / 2)} (50% off)` : "Batch (50% off)";
});

async function loadEstimateAndBatch() {
  estimate.value = null;
  batchAvailable.value = false;
  try {
    estimate.value = await glossarySuggestEstimate({});
  } catch {
    // Advisory only — failure just hides the estimate line.
  }
  try {
    const s = await glossarySuggestBatchStatus();
    batchAvailable.value = s.supported && !s.pending;
  } catch {
    // Advisory only — failure just hides the batch button.
  }
}

async function runBatch() {
  submittingBatch.value = true;
  try {
    const res = await glossarySuggestBatchSubmit({});
    toast.success(`Glossary batch of ${res.total} source(s) submitted — applies when processing finishes`);
    emit("batch-submitted");
    open.value = false;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    submittingBatch.value = false;
  }
}

watch(open, (v) => {
  if (v) {
    error.value = "";
    progressDone.value = 0;
    progressTotal.value = 0;
    void loadEstimateAndBatch();
  } else {
    controller.value?.abort();
  }
});

function cancel() {
  controller.value?.abort();
}

async function run() {
  running.value = true;
  error.value = "";
  progressDone.value = 0;
  progressTotal.value = 0;
  controller.value = new AbortController();
  let finished = false;
  try {
    for await (const event of suggestGlossaryStream({}, controller.value.signal)) {
      if (event.type === "start") {
        progressTotal.value = event.total;
      } else if (event.type === "progress") {
        progressDone.value = event.done;
        progressTotal.value = event.total;
      } else if (event.type === "done") {
        finished = true;
        progressDone.value = progressTotal.value;
        emit("found");
        if (event.added > 0) {
          toast.success(`Found ${event.added} candidate term${event.added === 1 ? "" : "s"}`);
          open.value = false;
        } else {
          toast.info("No new candidate terms found");
        }
      }
    }
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    if (!finished && controller.value?.signal.aborted) {
      toast(`Suggestion scan cancelled after ${progressDone.value} of ${progressTotal.value} keys`);
    }
    controller.value = null;
    running.value = false;
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="flex max-h-[85vh] max-w-lg flex-col">
      <DialogHeader>
        <DialogTitle>Find glossary terms</DialogTitle>
        <DialogDescription>
          Scan your translation keys with AI to suggest new glossary terms — brand names, technical
          terms, and phrases that should be translated consistently.
        </DialogDescription>
      </DialogHeader>

      <!-- Pre-flight estimate (±20% heuristic). -->
      <div
        v-if="estimate && estimate.sources > 0 && !running && progressDone === 0"
        class="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
      >
        <p>
          ≈ {{ estimate.sources.toLocaleString() }} source{{ estimate.sources === 1 ? "" : "s" }} · {{ estimate.batches.toLocaleString() }} batch{{ estimate.batches === 1 ? "" : "es" }} ·
          ~{{ fmtTokens(estimate.inputTokens) }} in / ~{{ fmtTokens(estimate.outputTokens) }} out tokens<template v-if="estimate.estimatedCost !== null">
            · <span class="font-medium text-foreground">≈ {{ fmtCost(estimate.estimatedCost) }}</span> (±20%)</template>
        </p>
      </div>

      <div v-if="running || progressDone > 0" class="flex flex-col gap-1.5">
        <div class="flex justify-between text-xs text-muted-foreground">
          <span>{{ progressDone.toLocaleString() }} / {{ progressTotal.toLocaleString() }} scanned</span>
        </div>
        <Progress :model-value="progressTotal > 0 ? (progressDone / progressTotal) * 100 : 0" />
      </div>

      <div
        v-if="error"
        class="flex flex-col gap-1 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
      >
        <p class="flex items-center gap-1.5 font-medium">
          <TriangleAlert class="size-4" /> Scan failed
        </p>
        <p>{{ error }}</p>
      </div>

      <DialogFooter>
        <Button v-if="running" variant="outline" @click="cancel">Cancel</Button>
        <Button v-else variant="outline" @click="open = false">Close</Button>
        <Button
          v-if="batchAvailable"
          variant="outline"
          :disabled="running || submittingBatch"
          @click="runBatch"
        >
          {{ submittingBatch ? "Submitting…" : batchLabel }}
        </Button>
        <Button :disabled="running || submittingBatch" @click="run">
          <Sparkles class="size-4" />
          {{ running ? "Scanning…" : "Find terms" }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
