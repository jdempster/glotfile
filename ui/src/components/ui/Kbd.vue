<script setup lang="ts">
import { cn } from "@/lib/utils";

defineProps<{ class?: string }>();
</script>

<template>
  <kbd
    :class="cn(
      'inline-flex h-5 min-w-5 items-center justify-center rounded border bg-muted px-1.5 font-mono text-xs font-medium text-muted-foreground',
      $props.class,
    )"
  >
    <slot />
  </kbd>
</template>
