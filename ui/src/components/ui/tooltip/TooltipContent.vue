<script setup lang="ts">
import {
  TooltipContent,
  type TooltipContentProps,
  type TooltipContentEmits,
  TooltipPortal,
  useForwardPropsEmits,
} from "reka-ui";
import { cn } from "@/lib/utils";

const props = withDefaults(
  defineProps<TooltipContentProps & { class?: string }>(),
  { sideOffset: 4 },
);
const emits = defineEmits<TooltipContentEmits>();

const forwarded = useForwardPropsEmits(props, emits);
</script>

<template>
  <TooltipPortal>
    <TooltipContent
      v-bind="forwarded"
      :class="cn(
        'z-50 overflow-hidden rounded-md bg-foreground px-3 py-1.5 text-xs text-background shadow-md data-[state=delayed-open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95',
        props.class,
      )"
    >
      <slot />
    </TooltipContent>
  </TooltipPortal>
</template>
