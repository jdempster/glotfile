<script setup lang="ts">
import { computed } from "vue";
import { resolveLanguage, type LanguageOverride } from "@/languages.js";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import Flag from "./Flag.vue";

const props = withDefaults(
  defineProps<{
    code: string;
    override?: LanguageOverride;
    showName?: boolean;
    // showCode + codeMinChars apply to the inline layout only; stacked always shows the code.
    showCode?: boolean;
    size?: number;
    // Reserve a min-width (in mono chars) for the code so codes of varying
    // length still line up the columns that follow (inline layout only).
    codeMinChars?: number;
    layout?: "inline" | "stacked";
  }>(),
  { showName: false, showCode: true, size: 16, layout: "inline" },
);

const resolved = computed(() => resolveLanguage(props.code, props.override));
</script>

<template>
  <!-- Stacked: code over name, used in the redesigned row identity. -->
  <Tooltip v-if="layout === 'stacked'">
    <TooltipTrigger as-child>
      <span class="inline-flex min-w-0 items-start gap-2">
        <Flag :code="code" :override="override" :size="size" class="mt-0.5 shrink-0" />
        <span class="flex min-w-0 flex-col leading-tight">
          <span class="flex items-center gap-1.5">
            <span class="font-mono text-[11.5px] font-semibold tracking-wide">{{ code.toUpperCase() }}</span>
            <Tooltip v-if="resolved.rtl">
              <TooltipTrigger as-child>
                <span class="rounded border border-border px-1 text-[9px] font-bold uppercase tracking-wide text-muted-foreground">RTL</span>
              </TooltipTrigger>
              <TooltipContent>Right-to-left</TooltipContent>
            </Tooltip>
          </span>
          <span v-if="showName" class="truncate text-[11px] text-muted-foreground">{{ resolved.name }}</span>
        </span>
      </span>
    </TooltipTrigger>
    <TooltipContent>{{ resolved.name }}</TooltipContent>
  </Tooltip>

  <!-- Inline (default): unchanged — preserves every existing call site. -->
  <Tooltip v-else>
    <TooltipTrigger as-child>
      <span class="inline-flex min-w-0 items-center gap-1.5">
        <Flag :code="code" :override="override" :size="size" />
        <span v-if="showName" class="truncate">{{ resolved.name }}</span>
        <span
          v-if="showCode"
          class="font-mono text-xs"
          :style="codeMinChars != null ? { minWidth: `${codeMinChars}ch` } : undefined"
        >{{ code.toUpperCase() }}</span>
      </span>
    </TooltipTrigger>
    <TooltipContent>{{ resolved.name }}</TooltipContent>
  </Tooltip>
</template>
