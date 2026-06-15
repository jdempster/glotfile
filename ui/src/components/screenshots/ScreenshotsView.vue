<script setup lang="ts">
import { ref, shallowRef, computed } from "vue";
import { ImageOff, SquarePen } from "lucide-vue-next";
import { fetchState } from "@/api.js";
import { onExternalChange } from "@/liveReload";
import { drillToKey } from "@/drilldown.js";
import type { State, KeyEntry } from "@/types.js";
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

interface ScreenshotKey {
  key: string;
  entry: KeyEntry;
  screenshot: string;
  source: string;
}

// shallowRef: state is read-only here and replaced wholesale; the items computed
// scans every key, so deep-Proxy reactivity would tax that scan for no benefit.
const state = shallowRef<State | null>(null);
const loaded = ref(false);
const selected = ref<ScreenshotKey | null>(null);

async function reload() {
  state.value = await fetchState();
  loaded.value = true;
}
reload();
// Refresh when the catalog changes on disk out of band.
onExternalChange(reload);

const sourceLocale = computed(() => state.value?.config.sourceLocale ?? "");

const items = computed<ScreenshotKey[]>(() => {
  const s = state.value;
  if (!s) return [];
  return Object.entries(s.keys)
    .filter(([, entry]) => Boolean(entry.screenshot))
    .map(([key, entry]) => ({
      key,
      entry,
      screenshot: entry.screenshot!,
      source: entry.values[sourceLocale.value]?.value ?? "",
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
});
</script>

<template>
  <div class="min-h-0 flex-1 overflow-y-auto">
    <div v-if="!loaded" class="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
      Loading screenshots…
    </div>

    <div
      v-else-if="items.length === 0"
      class="flex h-full items-center justify-center p-8"
    >
      <div class="flex max-w-md flex-col items-center gap-3 text-center text-muted-foreground">
        <ImageOff class="size-8 opacity-60" />
        <p class="text-sm">
          No screenshots yet — add one from a key's detail panel in the Editor.
        </p>
      </div>
    </div>

    <div v-else class="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3 p-6">
      <button
        v-for="item in items"
        :key="item.key"
        type="button"
        class="group flex flex-col overflow-hidden rounded-lg border bg-card text-left shadow-sm transition-colors hover:border-ring focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        @click="selected = item"
      >
        <div class="flex aspect-video items-center justify-center overflow-hidden border-b bg-muted/30">
          <img
            :src="'/' + item.screenshot"
            :alt="`Screenshot for ${item.key}`"
            class="h-full w-full object-contain"
          />
        </div>
        <div class="flex flex-col gap-0.5 p-2.5">
          <Tooltip>
            <TooltipTrigger as-child>
              <span class="truncate font-mono text-xs font-medium">{{ item.key }}</span>
            </TooltipTrigger>
            <TooltipContent class="font-mono">{{ item.key }}</TooltipContent>
          </Tooltip>
          <Tooltip v-if="item.source">
            <TooltipTrigger as-child>
              <span class="truncate text-xs text-muted-foreground">{{ item.source }}</span>
            </TooltipTrigger>
            <TooltipContent>{{ item.source }}</TooltipContent>
          </Tooltip>
          <span v-else class="truncate text-xs text-muted-foreground">—</span>
        </div>
      </button>
    </div>

    <Dialog :open="selected !== null" @update:open="(v) => { if (!v) selected = null; }">
      <DialogContent v-if="selected" class="max-w-3xl">
        <DialogHeader>
          <DialogTitle class="break-all font-mono text-sm">{{ selected.key }}</DialogTitle>
          <DialogDescription>{{ selected.source || "—" }}</DialogDescription>
        </DialogHeader>

        <div class="flex max-h-[70vh] items-center justify-center overflow-auto rounded-md border bg-muted/30 p-2">
          <img
            :src="'/' + selected.screenshot"
            :alt="`Screenshot for ${selected.key}`"
            class="max-h-[65vh] w-auto object-contain"
          />
        </div>

        <p v-if="selected.entry.context" class="text-sm text-muted-foreground">
          <span class="font-medium text-foreground">Context:</span> {{ selected.entry.context }}
        </p>

        <DialogFooter>
          <Button size="sm" @click="drillToKey(selected.key)">
            <SquarePen class="size-4" /> Open in editor
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
