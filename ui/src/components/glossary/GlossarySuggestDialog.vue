<script setup lang="ts">
import { ref, watch } from "vue";
import { Sparkles, TriangleAlert } from "lucide-vue-next";
import { suggestGlossaryStream } from "@/api.js";
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
const emit = defineEmits<{ (e: "found"): void }>();

const running = ref(false);
const controller = ref<AbortController | null>(null);
const error = ref("");
const progressDone = ref(0);
const progressTotal = ref(0);

watch(open, (v) => {
  if (v) {
    error.value = "";
    progressDone.value = 0;
    progressTotal.value = 0;
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
        toast.success(`Found ${event.added} candidate term${event.added === 1 ? "" : "s"}`);
        emit("found");
        if (event.added >= 0) open.value = false;
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
        <Button :disabled="running" @click="run">
          <Sparkles class="size-4" />
          {{ running ? "Scanning…" : "Find terms" }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
