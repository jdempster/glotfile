<script setup lang="ts">
import { ref } from "vue";
import { cn } from "@/lib/utils";

// Zero-width drag handle: the wrapper takes no layout space, the inner strip
// straddles the adjacent panel border to give an 8px grab target.
const props = defineProps<{
  // Which side of the panel being resized the handle sits on: a handle on the
  // panel's "right" edge grows it when dragged right, "left" when dragged left.
  side: "left" | "right";
  width: number;
  min: number;
  max: number;
}>();
const emit = defineEmits<{
  (e: "update:width", px: number): void;
  (e: "commit"): void;
  (e: "reset"): void;
}>();

const dragging = ref(false);

function onPointerDown(e: PointerEvent) {
  if (e.button !== 0) return;
  const strip = e.currentTarget as HTMLElement;
  const startX = e.clientX;
  const startWidth = props.width;
  const dir = props.side === "right" ? 1 : -1;
  dragging.value = true;
  strip.setPointerCapture(e.pointerId);
  // Keep the col-resize cursor and suppress text selection for the whole drag,
  // even when the pointer leaves the 8px strip.
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";

  const clamp = (px: number) => Math.min(props.max, Math.max(props.min, Math.round(px)));
  const onMove = (ev: PointerEvent) => {
    emit("update:width", clamp(startWidth + dir * (ev.clientX - startX)));
  };
  const onUp = () => {
    strip.removeEventListener("pointermove", onMove);
    strip.removeEventListener("pointerup", onUp);
    strip.removeEventListener("pointercancel", onUp);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    dragging.value = false;
    emit("commit");
  };
  strip.addEventListener("pointermove", onMove);
  strip.addEventListener("pointerup", onUp);
  strip.addEventListener("pointercancel", onUp);
}
</script>

<template>
  <div class="relative w-0 shrink-0">
    <div
      :class="cn(
        'absolute inset-y-0 -left-1 z-[25] w-2 cursor-col-resize transition-colors hover:bg-primary/20',
        dragging && 'bg-primary/30',
      )"
      role="separator"
      aria-orientation="vertical"
      :aria-valuenow="width"
      :aria-valuemin="min"
      :aria-valuemax="max"
      aria-label="Resize panel (double-click to reset)"
      @pointerdown="onPointerDown"
      @dblclick="emit('reset')"
    />
  </div>
</template>
