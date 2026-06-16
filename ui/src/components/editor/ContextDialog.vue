<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { Sparkles, TriangleAlert } from "lucide-vue-next";
import { buildContextStream, contextBatchStatus, contextBatchSubmit, contextEstimate } from "@/api.js";
import type { State, ContextEstimate } from "@/types.js";
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

const props = defineProps<{ state: State | null; keys: string[] }>();
const open = defineModel<boolean>("open", { required: true });
const emit = defineEmits<{ (e: "changed"): void; (e: "batch-submitted"): void }>();

const running = ref(false);
const controller = ref<AbortController | null>(null);
const error = ref("");
const errors = ref<{ key: string; error: string }[]>([]);
const progressDone = ref(0);
const progressTotal = ref(0);

// Selected keys that don't already have context — the ones a build would actually write.
const withoutContextCount = computed(() => {
  const s = props.state;
  if (!s) return 0;
  return props.keys.filter((k) => s.keys[k] && !s.keys[k]!.context).length;
});

// Pre-flight cost preview, fetched whenever the dialog opens. Advisory only —
// a failed estimate must never block building.
const estimate = ref<ContextEstimate | null>(null);

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
    estimate.value = await contextEstimate({ keys: props.keys });
  } catch {
    // Leave estimate null; the dialog simply shows no preview line.
  }
}

// Batch availability, fetched on open. Hidden whenever unsupported, a batch is
// already pending (the editor banner owns that state), or the check fails.
const batchAvailable = ref(false);
const submittingBatch = ref(false);

async function loadBatchAvailability() {
  batchAvailable.value = false;
  try {
    const s = await contextBatchStatus();
    batchAvailable.value = s.supported && !s.pending;
  } catch {
    // Advisory only — a failed check just hides the batch button.
  }
}

async function runBatch() {
  submittingBatch.value = true;
  try {
    const res = await contextBatchSubmit({ keys: props.keys });
    toast.success(`Context batch of ${res.total.toLocaleString()} keys submitted — results apply when processing finishes (usually under an hour).`);
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
    errors.value = [];
    progressDone.value = 0;
    progressTotal.value = 0;
    void loadEstimate();
    void loadBatchAvailability();
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
  errors.value = [];
  progressDone.value = 0;
  progressTotal.value = 0;
  controller.value = new AbortController();
  let finished = false;
  try {
    for await (const event of buildContextStream({ keys: props.keys }, controller.value.signal)) {
      if (event.type === "start") {
        progressTotal.value = event.total;
      } else if (event.type === "progress") {
        progressDone.value = event.done;
        progressTotal.value = event.total;
      } else if (event.type === "done") {
        finished = true;
        progressDone.value = progressTotal.value;
        errors.value = event.errors;
        emit("changed");
        toast.success(`Built context for ${event.written} key${event.written === 1 ? "" : "s"}`);
        if (event.errors.length === 0) open.value = false;
      }
    }
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    // On abort the stream ends without a "done" event — keys built so far were
    // still written server-side, so refresh and let the user know where it stopped.
    if (!finished && controller.value?.signal.aborted) {
      emit("changed");
      toast(`Build cancelled after ${progressDone.value} of ${progressTotal.value} keys`);
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
        <DialogTitle>Build context</DialogTitle>
        <DialogDescription>
          <template v-if="withoutContextCount === 0">
            All selected keys already have context — nothing to build.
          </template>
          <template v-else>
            Build AI context notes for {{ withoutContextCount }} selected key{{ withoutContextCount === 1 ? "" : "s" }} that
            currently have none? The AI will scan call-site code snippets to write a short
            translator hint for each key.
          </template>
        </DialogDescription>
      </DialogHeader>

      <!-- Pre-flight estimate (±20% heuristic; input is dominated by call-site snippets). -->
      <div
        v-if="estimate && estimate.keys > 0 && withoutContextCount > 0 && !running && progressDone === 0"
        class="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
      >
        <p>
          ≈ {{ estimate.keys.toLocaleString() }} key{{ estimate.keys === 1 ? "" : "s" }} · {{ estimate.batches.toLocaleString() }} batch{{ estimate.batches === 1 ? "" : "es" }} ·
          ~{{ fmtTokens(estimate.inputTokens) }} in / ~{{ fmtTokens(estimate.outputTokens) }} out tokens<template v-if="estimate.estimatedCost !== null">
            · <span class="font-medium text-foreground">≈ {{ fmtCost(estimate.estimatedCost) }}</span> (±20%)</template>
        </p>
        <p v-if="!estimate.pricing" class="mt-0.5">
          No pricing known for this model — set a price in Settings → AI for a dollar estimate.
        </p>
      </div>

      <div v-if="running || progressDone > 0" class="flex flex-col gap-1.5">
        <div class="flex justify-between text-xs text-muted-foreground">
          <span>{{ progressDone.toLocaleString() }} / {{ progressTotal.toLocaleString() }} built</span>
        </div>
        <Progress :model-value="progressTotal > 0 ? (progressDone / progressTotal) * 100 : 0" />
      </div>

      <div
        v-if="error"
        class="flex flex-col gap-1 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
      >
        <p class="flex items-center gap-1.5 font-medium">
          <TriangleAlert class="size-4" /> Build failed
        </p>
        <p>{{ error }}</p>
      </div>

      <div v-if="errors.length" class="flex min-h-0 flex-col gap-1.5">
        <p class="flex items-center gap-1.5 text-sm font-medium text-amber-700 dark:text-amber-400">
          <TriangleAlert class="size-4" />
          {{ errors.length }} key{{ errors.length === 1 ? "" : "s" }} could not be processed
        </p>
        <ul class="min-h-0 flex-1 overflow-y-auto rounded-md border text-sm">
          <li
            v-for="(err, i) in errors"
            :key="`${err.key}-${i}`"
            class="border-b px-3 py-1.5 last:border-b-0"
          >
            <span class="font-mono text-xs">{{ err.key }}</span>
            <span class="text-muted-foreground"> — {{ err.error }}</span>
          </li>
        </ul>
      </div>

      <DialogFooter>
        <Button v-if="running" variant="outline" @click="cancel">Cancel</Button>
        <Button v-else variant="outline" @click="open = false">Close</Button>
        <Button
          v-if="withoutContextCount > 0 && batchAvailable"
          variant="outline"
          :disabled="running || submittingBatch"
          @click="runBatch"
        >
          {{ submittingBatch ? "Submitting…" : batchLabel }}
        </Button>
        <Button v-if="withoutContextCount > 0" :disabled="running || submittingBatch" @click="run">
          <Sparkles class="size-4" />
          {{ running ? "Building…" : "Build context" }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
