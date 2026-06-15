<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { TriangleAlert, FileDown } from "lucide-vue-next";
import { exportPreview, runExport } from "@/api.js";
import type { ExportFile } from "@/types.js";
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
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const open = defineModel<boolean>("open", { required: true });

const props = defineProps<{ exportLocales?: string[] }>();
const limited = computed(() => (props.exportLocales?.length ?? 0) > 0);

const loading = ref(false);
const writing = ref(false);
const error = ref("");
const files = ref<ExportFile[]>([]);
const warnings = ref<string[]>([]);
const selectedPath = ref<string | null>(null);

const selectedFile = computed(
  () => files.value.find((f) => f.path === selectedPath.value) ?? null,
);

async function loadPreview() {
  loading.value = true;
  error.value = "";
  files.value = [];
  warnings.value = [];
  selectedPath.value = null;
  try {
    const preview = await exportPreview();
    files.value = [...preview.files].sort((a, b) => a.path.localeCompare(b.path));
    warnings.value = preview.warnings;
    selectedPath.value = files.value[0]?.path ?? null;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}

watch(
  open,
  (v) => {
    if (v) loadPreview();
  },
  { immediate: true },
);

async function write() {
  writing.value = true;
  try {
    const result = await runExport();
    toast.success(`Wrote ${result.files} file${result.files === 1 ? "" : "s"}`);
    open.value = false;
  } catch (e) {
    toast.error(`Export failed: ${(e as Error).message}`);
  } finally {
    writing.value = false;
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="flex max-h-[85vh] w-full max-w-5xl flex-col">
      <DialogHeader>
        <DialogTitle>Export preview</DialogTitle>
        <DialogDescription>Review the files that will be written to disk.</DialogDescription>
      </DialogHeader>

      <p
        v-if="limited"
        class="flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400"
      >
        <TriangleAlert class="size-3.5 shrink-0" />
        Export is limited to {{ props.exportLocales!.length }} language{{ props.exportLocales!.length === 1 ? "" : "s" }} (Settings → Export targets).
      </p>

      <p v-if="error" class="text-sm text-destructive">{{ error }}</p>

      <div v-if="loading" class="flex flex-1 items-center justify-center py-12 text-sm text-muted-foreground">
        Generating preview…
      </div>

      <template v-else-if="!error">
        <div
          v-if="warnings.length"
          class="flex flex-col gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400"
        >
          <p class="flex items-center gap-1.5 font-medium">
            <TriangleAlert class="size-4" />
            {{ warnings.length }} warning{{ warnings.length === 1 ? "" : "s" }}
          </p>
          <ul class="list-inside list-disc pl-1">
            <li v-for="(w, i) in warnings" :key="i">{{ w }}</li>
          </ul>
        </div>

        <div class="grid min-h-0 flex-1 grid-cols-[16rem_1fr] gap-3 overflow-hidden">
          <ul class="min-h-0 overflow-y-auto rounded-md border">
            <li v-for="file in files" :key="file.path">
              <Tooltip>
                <TooltipTrigger as-child>
                  <button
                    type="button"
                    :class="cn(
                      'w-full truncate px-3 py-1.5 text-left font-mono text-xs transition-colors',
                      file.path === selectedPath ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/60',
                    )"
                    @click="selectedPath = file.path"
                  >
                    {{ file.path }}
                  </button>
                </TooltipTrigger>
                <TooltipContent class="font-mono">{{ file.path }}</TooltipContent>
              </Tooltip>
            </li>
            <li v-if="files.length === 0" class="px-3 py-2 text-xs text-muted-foreground">
              No files to write.
            </li>
          </ul>

          <pre
            v-if="selectedFile"
            class="min-h-0 overflow-auto rounded-md border bg-muted/30 p-3 font-mono text-xs leading-relaxed [tab-size:2]"
          >{{ selectedFile.contents }}</pre>
          <div
            v-else
            class="flex min-h-0 items-center justify-center rounded-md border text-sm text-muted-foreground"
          >
            Select a file to preview its contents.
          </div>
        </div>
      </template>

      <DialogFooter>
        <Button variant="outline" :disabled="writing" @click="open = false">Cancel</Button>
        <Button :disabled="loading || writing || files.length === 0" @click="write">
          <FileDown class="size-4" />
          {{ writing ? "Writing…" : `Write ${files.length} file${files.length === 1 ? "" : "s"}` }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
