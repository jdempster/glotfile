<script setup lang="ts">
import { ref, computed } from "vue";
import {
  DialogRoot,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "reka-ui";
import {
  RefreshCw,
  Plus,
  Pencil,
  Check,
  Trash2,
  X,
  TriangleAlert,
  Loader2,
  ChevronRight,
  ArrowRight,
} from "lucide-vue-next";
import { syncPreview, syncApply, type SyncPlan, type SyncApplied } from "@/api.js";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

const emit = defineEmits<{ dismiss: []; synced: [] }>();

type Step = "loading" | "review" | "applying" | "done" | "error";

const open = ref(true);
const step = ref<Step>("loading");
const plan = ref<SyncPlan | null>(null);
const warnings = ref<string[]>([]);
const result = ref<SyncApplied | null>(null);
const errorMsg = ref("");
const prune = ref(false);
const showWarnings = ref(false);
// Which changeset categories are expanded to show their key lists.
const expanded = ref<Record<string, boolean>>({});

defineExpose({ init });

async function init() {
  step.value = "loading";
  try {
    const preview = await syncPreview();
    plan.value = preview.plan;
    warnings.value = preview.warnings;
    step.value = "review";
  } catch (e) {
    errorMsg.value = (e as Error).message;
    step.value = "error";
  }
}

const changeCount = computed(() => {
  const p = plan.value;
  if (!p) return 0;
  return p.added.length + p.sourceChanged.length + p.adopted.length + p.removed.length;
});
const nothingToDo = computed(() => changeCount.value === 0);

// The category tiles, in display order. `keys` drives the expandable list.
const categories = computed(() => {
  const p = plan.value;
  if (!p) return [];
  return [
    { id: "added", label: "Added", icon: Plus, tone: "added", keys: p.added },
    { id: "sourceChanged", label: "Source changed", icon: Pencil, tone: "changed", keys: p.sourceChanged },
    { id: "adopted", label: "Adopted", icon: Check, tone: "adopted", keys: p.adopted.map((a) => `${a.key} · ${a.locale}`) },
    { id: "removed", label: "Removed", icon: Trash2, tone: "removed", keys: p.removed },
  ];
});

const TONE: Record<string, string> = {
  added: "text-success",
  changed: "text-amber-600 dark:text-amber-400",
  adopted: "text-primary",
  removed: "text-destructive",
};

async function doApply(): Promise<void> {
  step.value = "applying";
  try {
    result.value = await syncApply({ prune: prune.value });
    step.value = "done";
  } catch (e) {
    errorMsg.value = (e as Error).message;
    step.value = "error";
  }
}

function onOpenChange(next: boolean): void {
  if (next) return;
  if (step.value === "applying") return;
  if (step.value === "done") emit("synced");
  else emit("dismiss");
}
</script>

<template>
  <DialogRoot :open="open" @update:open="onOpenChange">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-foreground/40 gf-content-fade" />
      <DialogContent
        class="fixed left-1/2 top-1/2 z-50 w-[30rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card text-card-foreground shadow-2xl focus:outline-none gf-content-fade"
        @interact-outside.prevent
      >
        <!-- ═══════════════ LOADING ═══════════════ -->
        <template v-if="step === 'loading'">
          <DialogTitle class="sr-only">Comparing files</DialogTitle>
          <div class="flex flex-col items-center justify-center gap-4 p-6 py-10 text-center">
            <Loader2 class="size-9 text-primary gf-spin" />
            <div class="text-[13px] text-muted-foreground">Reading your locale files…</div>
          </div>
        </template>

        <!-- ═══════════════ REVIEW ═══════════════ -->
        <template v-else-if="step === 'review' && plan">
          <button
            type="button"
            class="absolute right-3.5 top-3.5 z-10 grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            @click="emit('dismiss')"
          >
            <X class="size-4" />
          </button>

          <div class="p-6">
            <div class="flex items-start gap-3 pr-6">
              <div class="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
                <RefreshCw class="size-5" />
              </div>
              <div class="min-w-0">
                <DialogTitle class="text-base font-semibold leading-tight">Sync from files</DialogTitle>
                <DialogDescription class="mt-0.5 text-[13px] text-muted-foreground">
                  Re-reads your locale files and merges changes in. Glossary, context and existing
                  translations are kept.
                </DialogDescription>
              </div>
            </div>

            <!-- nothing to do -->
            <div
              v-if="nothingToDo"
              class="mt-5 flex items-center gap-3 rounded-lg border border-success-border bg-success-bg/50 px-4 py-3.5"
            >
              <Check class="size-4 shrink-0 text-success" :stroke-width="2.5" />
              <span class="text-[13px] text-foreground">Already in sync — nothing changed on disk.</span>
            </div>

            <!-- changeset summary -->
            <template v-else>
              <div class="mt-4 grid grid-cols-4 gap-2">
                <div
                  v-for="c in categories"
                  :key="c.id"
                  class="flex flex-col items-center rounded-lg border border-border bg-muted/40 px-2 py-2.5"
                >
                  <component :is="c.icon" class="size-3.5" :class="TONE[c.tone]" />
                  <span class="mt-1.5 text-[17px] font-semibold leading-none tabular-nums">{{ c.keys.length }}</span>
                  <span class="mt-1 whitespace-nowrap text-[10.5px] text-muted-foreground">{{ c.label }}</span>
                </div>
              </div>
              <p class="mt-2 text-center text-[11px] text-muted-foreground">
                {{ plan.unchanged.toLocaleString() }} key{{ plan.unchanged === 1 ? "" : "s" }} unchanged
              </p>

              <!-- expandable per-category key lists -->
              <div class="mt-4 divide-y divide-border overflow-hidden rounded-lg border border-border">
                <template v-for="c in categories" :key="c.id">
                  <div v-if="c.keys.length">
                    <button
                      type="button"
                      class="flex w-full items-center gap-2 px-3 py-2 text-[12.5px] transition-colors hover:bg-muted/50"
                      @click="expanded[c.id] = !expanded[c.id]"
                    >
                      <ChevronRight class="size-3.5 shrink-0 transition-transform" :class="expanded[c.id] ? 'rotate-90' : ''" />
                      <component :is="c.icon" class="size-3.5 shrink-0" :class="TONE[c.tone]" />
                      <span>{{ c.label }}</span>
                      <span class="ml-auto font-mono text-[11px] text-muted-foreground tabular-nums">{{ c.keys.length }}</span>
                    </button>
                    <ul
                      v-if="expanded[c.id]"
                      class="max-h-36 divide-y divide-border/50 overflow-auto border-t border-border bg-muted/20 gf-content-fade"
                    >
                      <li v-for="k in c.keys" :key="k" class="truncate px-3 py-1.5 font-mono text-[11.5px] text-muted-foreground">{{ k }}</li>
                    </ul>
                  </div>
                </template>
              </div>

              <!-- prune toggle (only when there are removed keys) -->
              <div
                v-if="plan.removed.length"
                class="mt-4 flex items-center justify-between gap-4 rounded-lg border border-destructive/30 bg-destructive-soft/40 p-3.5"
              >
                <div class="flex items-start gap-2.5">
                  <Trash2 class="mt-0.5 size-4 shrink-0 text-destructive" />
                  <div>
                    <div class="text-[13px] font-medium">Delete {{ plan.removed.length }} removed {{ plan.removed.length === 1 ? "key" : "keys" }}</div>
                    <div class="mt-0.5 text-[11.5px] text-muted-foreground">
                      Keys gone from the source file. Off keeps them — safer if an edited string just changed its id.
                    </div>
                  </div>
                </div>
                <Switch data-testid="prune-toggle" v-model="prune" />
              </div>
            </template>
          </div>

          <!-- footer -->
          <div class="flex items-center gap-2 border-t border-border px-6 py-4">
            <Button variant="ghost" size="sm" @click="emit('dismiss')">{{ nothingToDo ? "Close" : "Cancel" }}</Button>
            <div class="ml-auto">
              <Button v-if="nothingToDo" variant="outline" @click="emit('dismiss')">Done</Button>
              <Button v-else data-testid="apply-btn" @click="doApply">
                <RefreshCw class="size-4" /> Apply {{ changeCount }} {{ changeCount === 1 ? "change" : "changes" }}
              </Button>
            </div>
          </div>
        </template>

        <!-- ═══════════════ APPLYING ═══════════════ -->
        <template v-else-if="step === 'applying'">
          <DialogTitle class="sr-only">Applying changes</DialogTitle>
          <div class="flex flex-col items-center justify-center gap-4 p-6 py-10 text-center">
            <Loader2 class="size-9 text-primary gf-spin" />
            <div class="text-[13px] text-muted-foreground">Merging changes…</div>
          </div>
        </template>

        <!-- ═══════════════ DONE ═══════════════ -->
        <template v-else-if="step === 'done' && result">
          <div class="p-6">
            <div class="flex flex-col items-center gap-3 pt-1 text-center">
              <div class="grid h-12 w-12 place-items-center rounded-full bg-success-bg text-success ring-1 ring-success-border">
                <Check class="size-6" :stroke-width="2.5" />
              </div>
              <div>
                <DialogTitle class="text-base font-semibold">Sync complete</DialogTitle>
                <DialogDescription class="mt-1 text-[13px] text-muted-foreground">
                  <span class="font-semibold text-foreground">+{{ result.plan.added.length }}</span> added,
                  <span class="font-semibold text-foreground">~{{ result.plan.sourceChanged.length }}</span> changed,
                  <span class="font-semibold text-foreground">{{ result.plan.removed.length }}</span> removed.
                </DialogDescription>
              </div>
            </div>

            <div
              v-if="result.warnings.length"
              class="mt-5 overflow-hidden rounded-lg border border-warning-border bg-warning-bg/60"
            >
              <button
                type="button"
                class="flex w-full items-center gap-2 px-3 py-2.5 text-left"
                @click="showWarnings = !showWarnings"
              >
                <TriangleAlert class="size-3.5 shrink-0 text-warning" />
                <span class="whitespace-nowrap text-[13px] font-medium text-warning">
                  {{ result.warnings.length }} {{ result.warnings.length === 1 ? "warning" : "warnings" }}
                </span>
                <ChevronRight class="ml-auto size-3.5 shrink-0 text-warning transition-transform" :class="showWarnings ? 'rotate-90' : ''" />
              </button>
              <ul v-if="showWarnings" class="max-h-44 divide-y divide-warning-border/40 overflow-auto border-t border-warning-border/70 gf-content-fade">
                <li v-for="(w, i) in result.warnings" :key="i" class="px-3 py-2 text-[12px] text-muted-foreground">{{ w }}</li>
              </ul>
            </div>
          </div>

          <div class="flex items-center border-t border-border px-6 py-4">
            <div class="ml-auto">
              <Button @click="emit('synced')">Reload editor <ArrowRight class="size-4" /></Button>
            </div>
          </div>
        </template>

        <!-- ═══════════════ ERROR ═══════════════ -->
        <template v-else-if="step === 'error'">
          <button
            type="button"
            class="absolute right-3.5 top-3.5 z-10 grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            @click="emit('dismiss')"
          >
            <X class="size-4" />
          </button>
          <div class="p-6">
            <div class="flex items-start gap-3 pr-6">
              <div class="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-destructive-soft text-destructive">
                <TriangleAlert class="size-5" />
              </div>
              <div class="min-w-0">
                <DialogTitle class="text-base font-semibold">Couldn't sync</DialogTitle>
                <DialogDescription class="mt-1 text-[13px] text-muted-foreground">{{ errorMsg }}</DialogDescription>
              </div>
            </div>
          </div>
          <div class="flex items-center border-t border-border px-6 py-4">
            <div class="ml-auto">
              <Button variant="outline" @click="emit('dismiss')">Dismiss</Button>
            </div>
          </div>
        </template>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
