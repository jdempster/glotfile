<script setup lang="ts">
import { ref, computed } from "vue";
import { useVirtualizer } from "@tanstack/vue-virtual";
import type { LogEntry } from "@/types.js";
import AiItemRow from "./AiItemRow.vue";

type AiItem = NonNullable<LogEntry["items"]>[number];
type AiResult = NonNullable<LogEntry["results"]>[number];

const props = defineProps<{ items: AiItem[]; results: AiResult[] }>();

// O(1) result lookup: a run can carry thousands of items, so a per-item linear
// scan of `results` would make rendering O(items²) — enough to lock the tab.
const resultIndex = computed(() => new Map(props.results.map((r) => [r.id, r] as const)));
const resultFor = (id: string): AiResult | undefined => resultIndex.value.get(id);

// Short lists render plainly (the common case). Long lists virtualize so even
// thousands of items mount only the visible rows — no main-thread lock.
const VIRTUALIZE_OVER = 100;
const virtualize = computed(() => props.items.length > VIRTUALIZE_OVER);

const parent = ref<HTMLElement | null>(null);
const virtualizer = useVirtualizer(
  computed(() => ({
    count: props.items.length,
    getScrollElement: () => parent.value,
    estimateSize: () => 72,
    overscan: 12,
    getItemKey: (i: number) => props.items[i]?.id ?? i,
  })),
);
const virtualItems = computed(() => virtualizer.value.getVirtualItems());
const totalSize = computed(() => virtualizer.value.getTotalSize());
</script>

<template>
  <div v-if="!virtualize" class="divide-y">
    <AiItemRow v-for="item in items" :key="item.id" :item="item" :result="resultFor(item.id)" />
  </div>
  <div v-else ref="parent" class="max-h-[28rem] overflow-auto">
    <div :style="{ height: `${totalSize}px`, position: 'relative', width: '100%' }">
      <div
        v-for="vitem in virtualItems"
        :key="vitem.key"
        :ref="(el) => virtualizer.measureElement(el as Element | null)"
        :data-index="vitem.index"
        :style="{ position: 'absolute', top: `${vitem.start}px`, left: '0', width: '100%' }"
        class="border-b"
      >
        <AiItemRow v-if="items[vitem.index]" :item="items[vitem.index]!" :result="resultFor(items[vitem.index]!.id)" />
      </div>
    </div>
  </div>
</template>
