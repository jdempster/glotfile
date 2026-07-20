<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { LoaderCircle, Check, X } from "lucide-vue-next";
import { batchStatus, batchApply, batchCancel, contextBatchStatus, contextBatchApply, contextBatchCancel, glossarySuggestBatchStatus, glossarySuggestBatchApply, glossarySuggestBatchCancel } from "@/api.js";
import type { BatchPending } from "@/types.js";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

// One banner instance per batch kind — the three kinds have independent
// server-side handles, so all can be in flight at once. Translation batches
// additionally allow several concurrent handles (e.g. one per target locale),
// each rendered as its own row; context and glossary keep a single handle.
const props = withDefaults(defineProps<{ kind?: "translate" | "context" | "glossary-suggest" }>(), { kind: "translate" });
const emit = defineEmits<{ (e: "changed"): void }>();

const pendings = ref<BatchPending[]>([]);
// Whether the selected provider supports batch at all. A pending batch can
// outlive the provider that started it (e.g. submitted under Anthropic, then
// switched to a sync-only provider) — without a batch-capable provider it can
// neither be polled nor applied, so the banner must stay hidden.
const supported = ref(false);
// Per-batch, so applying one row doesn't lock its siblings.
const applying = ref(new Set<string>());
let timer: ReturnType<typeof setInterval> | undefined;

async function refresh() {
  try {
    if (props.kind === "context") {
      const s = await contextBatchStatus();
      supported.value = s.supported;
      pendings.value = s.pending ? [s.pending] : [];
    } else if (props.kind === "glossary-suggest") {
      const s = await glossarySuggestBatchStatus();
      supported.value = s.supported;
      pendings.value = s.pending ? [s.pending] : [];
    } else {
      const s = await batchStatus();
      supported.value = s.supported;
      pendings.value = s.pending;
    }
  } catch {
    // Transient fetch failure — keep showing the last known state.
  }
}

// Cheap no-op poll when idle (the server answers from disk without touching
// the provider), live counts while a batch is in flight.
onMounted(() => { void refresh(); timer = setInterval(() => void refresh(), 30_000); });
onUnmounted(() => clearInterval(timer));

defineExpose({ refresh });

async function apply(b: BatchPending) {
  applying.value.add(b.batchId);
  try {
    if (props.kind === "context") {
      const res = await contextBatchApply();
      const extras = [
        res.retried ? `${res.retried} retried` : "",
        res.errors.length ? `${res.errors.length} error(s)` : "",
      ].filter(Boolean).join(", ");
      toast.success(`Context batch applied — wrote ${res.written} context(s)${extras ? ` (${extras})` : ""}`);
    } else if (props.kind === "glossary-suggest") {
      const res = await glossarySuggestBatchApply();
      const extras = [
        res.retried ? `${res.retried} retried` : "",
        res.errors.length ? `${res.errors.length} error(s)` : "",
      ].filter(Boolean).join(", ");
      toast.success(`Glossary batch applied — ${res.added} new term(s)${extras ? ` (${extras})` : ""}`);
    } else {
      const res = await batchApply(b.batchId);
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
    applying.value.delete(b.batchId);
  }
}

async function cancel(b: BatchPending) {
  if (!window.confirm("Cancel this batch? Finished entries are discarded.")) return;
  try {
    if (props.kind === "context") {
      await contextBatchCancel();
    } else if (props.kind === "glossary-suggest") {
      await glossarySuggestBatchCancel();
    } else {
      await batchCancel(b.batchId);
    }
    await refresh();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
</script>

<template>
  <div v-if="pendings.length && supported" class="flex flex-col gap-2">
    <div
      v-for="b in pendings"
      :key="b.batchId"
      class="flex items-center gap-3 rounded-md border bg-muted/40 px-3 py-2 text-sm"
    >
      <component :is="b.status === 'ended' ? Check : LoaderCircle" class="size-4 shrink-0" :class="b.status === 'ended' ? 'text-emerald-600 dark:text-emerald-400' : 'animate-spin text-primary'" />
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <span class="truncate">
          <template v-if="props.kind === 'context'">Batch context build ({{ b.total.toLocaleString() }} keys)</template>
          <template v-else-if="props.kind === 'glossary-suggest'">Batch glossary scan ({{ b.total.toLocaleString() }} sources)</template>
          <template v-else>Batch translation ({{ b.locales?.length ? `${b.locales.join(", ")} — ` : "" }}{{ b.total.toLocaleString() }} strings)</template>
          <template v-if="b.status === 'ended'"> — finished, ready to apply</template>
          <template v-else> — processing…</template>
        </span>
        <Progress v-if="b.status !== 'ended'" indeterminate class="h-1" />
      </div>
      <Button size="sm" :disabled="b.status !== 'ended' || applying.has(b.batchId)" @click="apply(b)">
        {{ applying.has(b.batchId) ? "Applying…" : b.status === "ended" ? "Apply results" : "Waiting…" }}
      </Button>
      <Button size="sm" variant="ghost" :disabled="applying.has(b.batchId)" @click="cancel(b)">
        <X class="size-4" />
      </Button>
    </div>
  </div>
</template>
