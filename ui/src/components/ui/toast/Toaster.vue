<script setup lang="ts">
import { computed } from "vue";
import { useToasts, dismiss, type ToastVariant } from ".";
import { isOpen, expanded } from "@/chat";
import { chatPanel } from "@/panel-widths.js";
import { CircleCheck, CircleAlert, Info } from "lucide-vue-next";
import { cn } from "@/lib/utils";

const state = useToasts();

// The 56px (w-14) nav rail on the left and, when open, the chat on the right are
// the two things a top-centered toast must clear. The container spans the
// content band between them and centers its toasts inside it, so they always
// land in the open space at top-center — never under the dock.
const NAV_RAIL = 56;
const rightInset = computed(() => {
  if (!isOpen.value) return 0;
  if (!expanded.value) return chatPanel.width.value;
  // Expanded drawer: w-[62%] clamped to [26rem, 60rem].
  return Math.min(Math.max(window.innerWidth * 0.62, 416), 960);
});

const iconFor = (v: ToastVariant) => (v === "success" ? CircleCheck : v === "error" ? CircleAlert : Info);
const cardFor = (v: ToastVariant) =>
  v === "success" ? "border-state-reviewed/30 bg-state-reviewed/10"
  : v === "error" ? "border-destructive/30 bg-destructive/10"
  : "border-border bg-card";
const chipFor = (v: ToastVariant) =>
  v === "success" ? "bg-state-reviewed text-white"
  : v === "error" ? "bg-destructive text-white"
  : "bg-foreground/10 text-foreground";
const barFor = (v: ToastVariant) =>
  v === "success" ? "bg-state-reviewed"
  : v === "error" ? "bg-destructive"
  : "bg-foreground/40";
</script>

<template>
  <!-- Teleported to body so the toast always stacks above dialogs/popovers
       (all of which use z-50) and any local stacking context in #app. -->
  <Teleport to="body">
    <div
      class="pointer-events-none fixed top-3 z-[200] flex flex-col items-center gap-2"
      :style="{ left: `${NAV_RAIL}px`, right: `${rightInset}px` }"
      aria-live="polite"
    >
      <TransitionGroup name="toast">
        <button
          v-for="t in state.toasts"
          :key="t.id"
          type="button"
          :class="cn(
            'pointer-events-auto relative flex max-w-[26rem] items-center gap-3 overflow-hidden rounded-xl border py-3 pl-3 pr-5 text-left text-sm font-medium text-foreground shadow-xl ring-1 ring-black/5 backdrop-blur-sm transition hover:brightness-[0.98]',
            cardFor(t.variant),
          )"
          @click="dismiss(t.id)"
        >
          <span :class="cn('flex size-7 shrink-0 items-center justify-center rounded-full shadow-sm', chipFor(t.variant))">
            <component :is="iconFor(t.variant)" class="size-4" :stroke-width="2.5" />
          </span>
          <span class="leading-snug">{{ t.message }}</span>
          <!-- Countdown bar: depletes left→right over the toast's lifetime, hitting
               zero as it auto-dismisses. -->
          <span
            :class="cn('toast-timer-bar pointer-events-none absolute inset-x-0 bottom-0 h-0.5', barFor(t.variant))"
            :style="{ '--toast-duration': `${t.duration}ms` }"
          />
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
  transform: translateY(-0.5rem);
}

.toast-timer-bar {
  transform-origin: left;
  animation: toast-timer var(--toast-duration, 4000ms) linear forwards;
}
@keyframes toast-timer {
  from { transform: scaleX(1); }
  to { transform: scaleX(0); }
}
</style>
