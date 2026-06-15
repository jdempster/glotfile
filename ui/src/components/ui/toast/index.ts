import { reactive } from "vue";

export type ToastVariant = "default" | "success" | "error";

export interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
}

const state = reactive<{ toasts: ToastItem[] }>({ toasts: [] });
let nextId = 0;

function push(message: string, variant: ToastVariant, duration = 4000) {
  const id = nextId++;
  state.toasts.push({ id, message, variant });
  window.setTimeout(() => dismiss(id), duration);
}

export function dismiss(id: number) {
  const idx = state.toasts.findIndex((t) => t.id === id);
  if (idx !== -1) state.toasts.splice(idx, 1);
}

export const toast = Object.assign(
  (message: string) => push(message, "default"),
  {
    success: (message: string) => push(message, "success"),
    error: (message: string) => push(message, "error"),
    info: (message: string) => push(message, "default"),
  },
);

export function useToasts() {
  return state;
}

export { default as Toaster } from "./Toaster.vue";
