<script setup lang="ts">
defineProps<{ modelValue?: number; indeterminate?: boolean }>();
</script>

<template>
  <div class="relative h-2 w-full overflow-hidden rounded-full bg-muted">
    <div
      v-if="indeterminate"
      class="gf-progress-indeterminate absolute inset-y-0 w-1/3 rounded-full bg-primary"
    />
    <div
      v-else
      class="h-full bg-primary transition-all"
      :style="{ width: `${Math.min(100, Math.max(0, modelValue ?? 0))}%` }"
    />
  </div>
</template>

<style scoped>
.gf-progress-indeterminate {
  animation: gf-progress-slide 1.4s ease-in-out infinite;
}
@keyframes gf-progress-slide {
  from {
    left: -33.333%;
  }
  to {
    left: 100%;
  }
}
</style>
