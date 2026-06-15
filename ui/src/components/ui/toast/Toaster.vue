<script setup lang="ts">
import { useToasts, dismiss } from ".";
import { cn } from "@/lib/utils";

const state = useToasts();
</script>

<template>
  <!-- Teleported to body so the toast always stacks above dialogs/popovers
       (all of which use z-50) and any local stacking context in #app. -->
  <Teleport to="body">
    <div class="pointer-events-none fixed bottom-4 right-4 z-[200] flex w-80 flex-col gap-2">
      <TransitionGroup name="toast">
        <button
          v-for="t in state.toasts"
          :key="t.id"
          type="button"
          :class="cn(
            'pointer-events-auto flex items-center rounded-md border bg-card px-4 py-3 text-left text-sm text-card-foreground shadow-lg',
            t.variant === 'success' && 'border-state-reviewed/50 text-state-reviewed',
            t.variant === 'error' && 'border-destructive/50 text-destructive',
          )"
          @click="dismiss(t.id)"
        >
          {{ t.message }}
        </button>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: all 0.2s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(0.5rem);
}
</style>
