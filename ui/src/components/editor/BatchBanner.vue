<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { LoaderCircle, Check, X } from "lucide-vue-next";
import { batchStatus, batchApply, batchCancel, contextBatchStatus, contextBatchApply, contextBatchCancel } from "@/api.js";
import type { BatchPending } from "@/types.js";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

// One banner instance per batch kind — translation and context batches have
// independent server-side handles, so both can be in flight at once.
const props = withDefaults(defineProps<{ kind?: "translate" | "context" }>(), { kind: "translate" });
const emit = defineEmits<{ (e: "changed"): void }>();

const pending = ref<BatchPending | null>(null);
const applying = ref(false);
let timer: ReturnType<typeof setInterval> | undefined;

async function refresh() {
  try {
    const s = await (props.kind === "context" ? contextBatchStatus() : batchStatus());
    pending.value = s.pending;
  } catch {
    // Transient fetch failure — keep showing the last known state.
  }
}

// Cheap no-op poll when idle (the server answers from disk without touching
// the provider), live counts while a batch is in flight.
onMounted(() => { void refresh(); timer = setInterval(() => void refresh(), 30_000); });
onUnmounted(() => clearInterval(timer));

defineExpose({ refresh });

const ended = computed(() => pending.value?.status === "ended");

async function apply() {
  applying.value = true;
  try {
    if (props.kind === "context") {
      const res = await contextBatchApply();
      const extras = [
        res.retried ? `${res.retried} retried` : "",
        res.errors.length ? `${res.errors.length} error(s)` : "",
      ].filter(Boolean).join(", ");
      toast.success(`Context batch applied — wrote ${res.written} context(s)${extras ? ` (${extras})` : ""}`);
    } else {
      const res = await batchApply();
      const extras = [
        res.retried ? `${res.retried} retried` : "",
        res.staleSkipped ? `${res.staleSkipped} stale skipped` : "",
        res.errors.length ? `${res.errors.length} error(s)` : "",
      ].filter(Boolean).join(", ");
      toast.success(`Batch applied — wrote ${res.written} translation(s)${extras ? ` (${extras})` : ""}`);
    }
    emit("changed");
    await refresh();
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    applying.value = false;
  }
}

async function cancel() {
  if (!window.confirm("Cancel this batch? Finished entries are discarded.")) return;
  try {
    await (props.kind === "context" ? contextBatchCancel() : batchCancel());
    await refresh();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
</script>

<template>
  <div
    v-if="pending"
    class="flex items-center gap-3 rounded-md border bg-muted/40 px-3 py-2 text-sm"
  >
    <component :is="ended ? Check : LoaderCircle" class="size-4 shrink-0" :class="ended ? 'text-emerald-600 dark:text-emerald-400' : 'animate-spin text-primary'" />
    <div class="flex min-w-0 flex-1 flex-col gap-1">
      <span class="truncate">
        {{ props.kind === "context" ? "Batch context build" : "Batch translation" }} ({{ pending.total.toLocaleString() }} {{ props.kind === "context" ? "keys" : "strings" }})
        <template v-if="ended"> — finished, ready to apply</template>
        <template v-else> — processing…</template>
      </span>
      <Progress v-if="!ended" indeterminate class="h-1" />
    </div>
    <Button size="sm" :disabled="!ended || applying" @click="apply">
      {{ applying ? "Applying…" : ended ? "Apply results" : "Waiting…" }}
    </Button>
    <Button size="sm" variant="ghost" :disabled="applying" @click="cancel">
      <X class="size-4" />
    </Button>
  </div>
</template>
