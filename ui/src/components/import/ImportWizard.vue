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
  Zap,
  FolderSearch,
  ChevronRight,
  Check,
  X,
  TriangleAlert,
  Loader2,
  ArrowRight,
} from "lucide-vue-next";
import { detectImport, runImportApi, type ImportDetected, type ImportResult } from "@/api.js";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { localeMeta } from "./locale-meta.js";
import Flag from "@/components/lang/Flag.vue";

const emit = defineEmits<{ dismiss: []; imported: [] }>();

type Step = "confirm" | "importing" | "done" | "error";

const open = ref(true);
const step = ref<Step>("confirm");
const detection = ref<ImportDetected | null>(null);
const selectedSource = ref("");
// code -> true means the user excluded it from the import. Source is always in.
const excluded = ref<Record<string, boolean>>({});
const showPreview = ref(false);
const showWarnings = ref(false);
const result = ref<ImportResult | null>(null);
const errorMsg = ref("");
// Convert exact "=N" plural selectors (e.g. =1) into CLDR categories on import,
// the way Crowdin does. On by default.
const convertPluralsToCldr = ref(true);

defineExpose({ init });

// Called by App.vue once mounted. Self-dismisses when there's nothing to import.
async function init() {
  try {
    const det = await detectImport();
    if (!det.found) {
      emit("dismiss");
      return;
    }
    detection.value = det;
    selectedSource.value = det.sourceLocale;
  } catch {
    // Detection shouldn't trap the user on the empty editor — just bow out.
    emit("dismiss");
  }
}

const FORMATS: Record<string, { label: string; glyph: string; file: string }> = {
  "laravel-php": { label: "Laravel PHP", glyph: "</>", file: "lang/{locale}/*.php" },
  "vue-i18n-json": { label: "Vue i18n JSON", glyph: "{ }", file: "locales/{locale}.json" },
  "next-intl-json": { label: "Next.js (next-intl)", glyph: "{ }", file: "messages/{locale}.json" },
  "flutter-arb": { label: "Flutter ARB", glyph: "arb", file: "lib/l10n/app_{locale}.arb" },
  "apple-strings": { label: "Apple .strings", glyph: "", file: "{locale}.lproj/Localizable.strings" },
};
const formatInfo = computed(
  () => FORMATS[detection.value?.format ?? ""] ?? { label: detection.value?.format ?? "", glyph: "{}", file: "" },
);

// Source is always included; everything else toggles via the exclusion set.
function isIncluded(code: string): boolean {
  return code === selectedSource.value || !excluded.value[code];
}
function toggleLocale(code: string): void {
  if (code === selectedSource.value) return;
  excluded.value = { ...excluded.value, [code]: !excluded.value[code] };
}
const selectedLocales = computed(() =>
  detection.value ? detection.value.locales.filter(isIncluded) : [],
);
const importCount = computed(() => selectedLocales.value.length);
const moreCount = computed(() =>
  detection.value ? Math.max(0, detection.value.keyCount - detection.value.sampleKeys.length) : 0,
);

async function doImport(): Promise<void> {
  if (!detection.value) return;
  step.value = "importing";
  try {
    result.value = await runImportApi({
      format: detection.value.format,
      sourceLocale: selectedSource.value,
      locales: selectedLocales.value,
      cldr: convertPluralsToCldr.value,
    });
    step.value = "done";
  } catch (e) {
    errorMsg.value = (e as Error).message;
    step.value = "error";
  }
}

function onOpenChange(next: boolean): void {
  if (next) return;
  // ESC reaches here (outside-click is suppressed below). Don't let the user
  // bail mid-import; on the done screen, treat dismissal as "open editor".
  if (step.value === "importing") return;
  if (step.value === "done") emit("imported");
  else emit("dismiss");
}
</script>

<template>
  <DialogRoot :open="open" @update:open="onOpenChange">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-foreground/40 gf-content-fade" />
      <DialogContent
        class="fixed left-1/2 top-1/2 z-50 w-[28rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card text-card-foreground shadow-2xl focus:outline-none gf-content-fade"
        @interact-outside.prevent
      >
        <!-- ═══════════════ CONFIRM ═══════════════ -->
        <template v-if="step === 'confirm' && detection">
          <button
            type="button"
            class="absolute right-3.5 top-3.5 z-10 grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            @click="emit('dismiss')"
          >
            <X class="size-4" />
          </button>

          <div class="p-6">
            <!-- header -->
            <div class="flex items-start gap-3 pr-6">
              <div class="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-primary/25 bg-primary/10 font-mono text-[13px] font-semibold leading-none tracking-tight text-primary">
                {{ formatInfo.glyph }}
              </div>
              <div class="min-w-0">
                <DialogTitle class="text-base font-semibold leading-tight">Import your translations</DialogTitle>
                <DialogDescription class="mt-0.5 text-[13px] text-muted-foreground">
                  Found a <span class="font-medium text-foreground">{{ formatInfo.label }}</span> setup in
                  <span class="font-mono text-[12px]">{{ formatInfo.file }}</span>.
                </DialogDescription>
              </div>
            </div>

            <!-- detected summary -->
            <div class="mt-4 flex items-center gap-4 rounded-lg border border-border bg-muted/40 px-3.5 py-2.5">
              <div class="flex flex-col">
                <span class="text-[17px] font-semibold leading-none tabular-nums">{{ detection.keyCount.toLocaleString() }}</span>
                <span class="mt-1 whitespace-nowrap text-[11px] text-muted-foreground">keys detected</span>
              </div>
              <div class="h-7 w-px bg-border" />
              <div class="flex flex-col">
                <span class="text-[17px] font-semibold leading-none tabular-nums">{{ detection.locales.length }}</span>
                <span class="mt-1 whitespace-nowrap text-[11px] text-muted-foreground">locales</span>
              </div>
              <div class="ml-auto flex items-center gap-1.5 whitespace-nowrap text-[11px] text-muted-foreground">
                <FolderSearch class="size-3.5 opacity-70" /> Detected automatically
              </div>
            </div>

            <!-- source language -->
            <div class="mt-5">
              <Label class="flex items-center gap-1.5 whitespace-nowrap">
                Source language
                <span class="text-[12px] font-normal text-muted-foreground">· the original text</span>
              </Label>
              <Select v-model="selectedSource">
                <SelectTrigger class="mt-1.5">
                  <!-- !flex: SelectTrigger applies [&>span]:line-clamp-1, which forces
                       display:-webkit-box on this wrapper and would kill the gap. -->
                  <span class="!flex min-w-0 items-center gap-2">
                    <Flag :code="selectedSource" :size="14" />
                    <span class="font-mono text-[13px]">{{ selectedSource }}</span>
                    <span class="truncate text-[13px] text-muted-foreground">{{ localeMeta(selectedSource).name }}</span>
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="loc in detection.locales" :key="loc" :value="loc">
                    <span class="flex items-center gap-2">
                      <Flag :code="loc" :size="14" />
                      <span class="font-mono text-[13px]">{{ loc }}</span>
                      <span class="text-[13px] text-muted-foreground">{{ localeMeta(loc).name }}</span>
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <!-- locales to import -->
            <div class="mt-4">
              <div class="flex items-center justify-between">
                <Label class="whitespace-nowrap">Locales to import</Label>
                <span class="whitespace-nowrap text-[12px] tabular-nums text-muted-foreground">{{ importCount }} of {{ detection.locales.length }}</span>
              </div>
              <div class="mt-1.5 flex flex-wrap gap-1.5 rounded-lg border border-border bg-muted/30 p-2.5">
                <Tooltip v-for="loc in detection.locales" :key="loc">
                  <TooltipTrigger as-child>
                    <button
                      type="button"
                      :disabled="loc === selectedSource"
                      class="group inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border pl-1.5 pr-2 text-[12px] transition-colors"
                      :class="loc === selectedSource
                        ? 'border-primary/40 bg-primary/10 cursor-default'
                        : isIncluded(loc)
                          ? 'border-input bg-card text-foreground hover:bg-muted'
                          : 'border-dashed border-border bg-transparent text-muted-foreground hover:bg-muted/50'"
                      @click="toggleLocale(loc)"
                    >
                      <Flag :code="loc" :size="14" />
                      <span class="font-mono">{{ loc }}</span>
                      <span
                        v-if="loc === selectedSource"
                        class="ml-0.5 rounded-sm bg-primary/15 px-1 text-[9px] font-semibold uppercase tracking-wide text-primary"
                      >src</span>
                      <span
                        v-else
                        class="grid size-3.5 place-items-center rounded-[3px] border"
                        :class="isIncluded(loc) ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-transparent'"
                      >
                        <Check class="size-2.5" :stroke-width="3" />
                      </span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{{ loc === selectedSource ? "Source language — always imported" : isIncluded(loc) ? "Click to exclude" : "Click to include" }}</TooltipContent>
                </Tooltip>
              </div>
            </div>

            <!-- sample preview -->
            <div v-if="detection.sampleKeys.length" class="mt-4">
              <div class="overflow-hidden rounded-lg border border-border">
                <button
                  type="button"
                  class="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-muted-foreground transition-colors hover:bg-muted/50"
                  @click="showPreview = !showPreview"
                >
                  <ChevronRight class="size-3.5 shrink-0 transition-transform" :class="showPreview ? 'rotate-90' : ''" />
                  <span class="whitespace-nowrap">Preview sample keys</span>
                  <span class="ml-auto font-mono text-[11px] text-muted-foreground/70">{{ formatInfo.glyph }}</span>
                </button>
                <div v-if="showPreview" class="divide-y divide-border border-t border-border gf-content-fade">
                  <div
                    v-for="s in detection.sampleKeys"
                    :key="s.key"
                    class="flex items-baseline gap-3 px-3 py-1.5 text-[12px]"
                  >
                    <span class="shrink-0 font-mono text-foreground">{{ s.key }}</span>
                    <span class="ml-auto truncate text-right text-muted-foreground">{{ s.value }}</span>
                  </div>
                  <div v-if="moreCount > 0" class="px-3 py-1.5 text-[11px] text-muted-foreground/70">
                    + {{ moreCount.toLocaleString() }} more keys
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- footer -->
          <div class="flex items-center gap-2 border-t border-border px-6 py-4">
            <Button variant="ghost" size="sm" @click="emit('dismiss')">Skip</Button>
            <Tooltip>
              <TooltipTrigger as-child>
                <label class="ml-1 flex cursor-pointer select-none items-center gap-1.5 text-[12px] text-muted-foreground">
                  <input
                    type="checkbox"
                    data-testid="cldr-toggle"
                    v-model="convertPluralsToCldr"
                    class="size-3.5 accent-primary"
                  />
                  Convert plurals to CLDR categories
                </label>
              </TooltipTrigger>
              <TooltipContent class="max-w-xs">Rewrite exact =N plural selectors (e.g. =1) into each language's CLDR plural categories, the way Crowdin does.</TooltipContent>
            </Tooltip>
            <div class="ml-auto">
              <Button data-testid="import-btn" :disabled="importCount === 0" @click="doImport">
                <Zap class="size-4" /> Import {{ importCount }} {{ importCount === 1 ? "locale" : "locales" }}
              </Button>
            </div>
          </div>
        </template>

        <!-- ═══════════════ IMPORTING ═══════════════ -->
        <template v-else-if="step === 'importing'">
          <DialogTitle class="sr-only">Importing translations</DialogTitle>
          <div class="flex flex-col items-center justify-center gap-4 p-6 py-8 text-center">
            <Loader2 class="size-10 text-primary gf-spin" />
            <div>
              <div class="text-sm font-semibold">Importing translations…</div>
              <div v-if="detection" class="mt-1 text-[13px] text-muted-foreground">
                Reading {{ detection.keyCount.toLocaleString() }} keys across {{ importCount }} locales
              </div>
            </div>
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
                <DialogTitle class="text-base font-semibold">Import complete</DialogTitle>
                <DialogDescription class="mt-1 text-[13px] text-muted-foreground">
                  <span class="font-semibold text-foreground tabular-nums">{{ result.keyCount.toLocaleString() }} keys</span>
                  across <span class="font-semibold text-foreground">{{ result.localeCount }} locales</span> imported.
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
                <span class="whitespace-nowrap text-[12px] text-warning/70">· import still succeeded</span>
                <ChevronRight
                  class="ml-auto size-3.5 shrink-0 text-warning transition-transform"
                  :class="showWarnings ? 'rotate-90' : ''"
                />
              </button>
              <ul
                v-if="showWarnings"
                class="max-h-44 divide-y divide-warning-border/40 overflow-auto border-t border-warning-border/70 gf-content-fade"
              >
                <li v-for="(w, i) in result.warnings" :key="i" class="px-3 py-2 text-[12px] text-muted-foreground">
                  {{ w }}
                </li>
              </ul>
            </div>
          </div>

          <div class="flex items-center border-t border-border px-6 py-4">
            <div class="ml-auto">
              <Button @click="emit('imported')">Open editor <ArrowRight class="size-4" /></Button>
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
                <DialogTitle class="text-base font-semibold">Couldn't import translations</DialogTitle>
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
