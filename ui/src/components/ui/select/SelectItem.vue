<script setup lang="ts">
import {
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  type SelectItemProps,
  useForwardProps,
} from "reka-ui";
import { Check } from "lucide-vue-next";
import { cn } from "@/lib/utils";

const props = defineProps<SelectItemProps & { class?: string }>();
const forwarded = useForwardProps(props);
</script>

<template>
  <SelectItem
    v-bind="forwarded"
    :class="cn(
      'relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      props.class,
    )"
  >
    <span class="absolute left-2 flex size-3.5 items-center justify-center">
      <SelectItemIndicator>
        <Check class="size-4" />
      </SelectItemIndicator>
    </span>
    <SelectItemText>
      <slot />
    </SelectItemText>
  </SelectItem>
</template>
