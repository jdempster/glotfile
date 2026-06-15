<script setup lang="ts">
import { computed } from "vue";
import { Globe } from "lucide-vue-next";
import { resolveLanguage, type LanguageOverride } from "@/languages.js";
import { flagUrl } from "@/flags.js";

const props = withDefaults(
  defineProps<{
    code: string;
    override?: LanguageOverride;
    // Height in px; width follows the 4x3 aspect ratio.
    size?: number;
  }>(),
  { size: 16 },
);

const resolved = computed(() => resolveLanguage(props.code, props.override));
const url = computed(() => (resolved.value.flagRegion ? flagUrl(resolved.value.flagRegion) : undefined));
const width = computed(() => Math.round((props.size * 4) / 3));
</script>

<template>
  <img
    v-if="url"
    :src="url"
    :alt="resolved.name"
    :width="width"
    :height="size"
    class="inline-block shrink-0 rounded-[2px] object-cover ring-1 ring-black/10"
    :style="{ width: `${width}px`, height: `${size}px` }"
  />
  <Globe
    v-else
    class="inline-block shrink-0 text-muted-foreground"
    :style="{ width: `${size}px`, height: `${size}px` }"
    aria-hidden="true"
  />
</template>
