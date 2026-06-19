<script setup lang="ts">
import { ref, computed, nextTick, watch, onMounted } from "vue";
import { Send, Square, Trash2, Sparkles, X, Maximize2, Minimize2 } from "lucide-vue-next";
import { Button } from "@/components/ui/button";
import ChatMessage from "./ChatMessage.vue";
import { messages, isSending, loaded, expanded, focusNonce, inputFocused, send, cancel, clear, loadHistory, toggleExpanded } from "@/chat";

// `dock` shows a close affordance in the header for the floating panel.
defineProps<{ dock?: boolean }>();
const emit = defineEmits<{ close: [] }>();

const draft = ref("");
const scroller = ref<HTMLElement | null>(null);
const textarea = ref<HTMLTextAreaElement | null>(null);

// Single line by default, growing with content up to a cap (then it scrolls).
const MAX_TEXTAREA_PX = 160;
function autosize() {
  const el = textarea.value;
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_PX)}px`;
}
// Re-fit after programmatic changes too (e.g. clearing on send).
watch(draft, () => nextTick(autosize));

// A few starter prompts surfaced when the conversation is empty — the entry
// point to the setup interview.
const starters = [
  "Help me set up this project's translation guidance.",
  "What does this app do? Read the codebase and draft a project context.",
  "Suggest glossary terms from my source strings.",
];

const isEmpty = computed(() => messages.value.length === 0);

// Rotate Lingo's greeting through languages on each open — a little flourish.
const GREETINGS = [
  "Bonjour", "Hello", "Ciao", "Hola", "Hallo", "Olá", "Hej", "Salut",
  "Hoi", "Cześć", "Konnichiwa", "Privet", "Namaste", "Merhaba", "Yassou",
];
const greetKey = "glotfile-lingo-greeting";
const greetIndex = (Number(localStorage.getItem(greetKey)) || 0) % GREETINGS.length;
const greeting = GREETINGS[greetIndex];
localStorage.setItem(greetKey, String((greetIndex + 1) % GREETINGS.length));

// Show the "thinking" dots while a turn is in flight but nothing visible is
// happening yet — right after sending, and in the gaps between tool calls. Hide
// it once text is streaming or a tool row is already spinning (those show work).
const thinking = computed(() => {
  if (!isSending.value) return false;
  const last = messages.value[messages.value.length - 1];
  if (!last || last.role === "user") return true;
  const hasText = last.text.trim().length > 0;
  const toolBusy = last.tools.some((t) => t.status === "running" || t.status === "pending-confirm");
  return !hasText && !toolBusy;
});

async function submit() {
  const text = draft.value;
  if (!text.trim() || isSending.value) return;
  draft.value = "";
  await send(text);
}

function onKeydown(e: KeyboardEvent) {
  // Enter sends; Shift+Enter inserts a newline.
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    void submit();
    return;
  }
  // Escape closes the panel from the keyboard.
  if (e.key === "Escape") {
    e.preventDefault();
    emit("close");
  }
}

function focus() {
  textarea.value?.focus();
}
// Focus when the composer mounts (panel opened) and whenever a focus is requested.
watch(focusNonce, () => nextTick(focus));

function runStarter(text: string) {
  draft.value = "";
  void send(text);
}

// Keep the view pinned to the latest message as a turn streams in.
watch(() => [messages.value.length, isSending.value, messages.value[messages.value.length - 1]?.text], async () => {
  await nextTick();
  if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight;
}, { deep: true });

onMounted(() => {
  if (!loaded.value) void loadHistory();
  autosize();
  // Focus the input by default when the panel opens.
  void nextTick(focus);
});
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <!-- Header (h-12 to line up with the app header bar) -->
    <div class="flex h-12 shrink-0 items-center justify-between border-b px-4">
      <div class="flex items-center gap-1.5 text-sm font-medium">
        <Sparkles class="size-4 text-primary" />
        Lingo
      </div>
      <div class="flex items-center gap-1">
        <Button v-if="!isEmpty" variant="ghost" size="sm" class="h-7 gap-1 text-muted-foreground" @click="clear">
          <Trash2 class="size-3.5" />New chat
        </Button>
        <Button v-if="dock" variant="ghost" size="icon" class="size-7 text-muted-foreground" :aria-label="expanded ? 'Collapse to side panel' : 'Expand over content'" @click="toggleExpanded">
          <Minimize2 v-if="expanded" class="size-4" />
          <Maximize2 v-else class="size-4" />
        </Button>
        <Button v-if="dock" variant="ghost" size="icon" class="size-7 text-muted-foreground" aria-label="Close" @click="emit('close')">
          <X class="size-4" />
        </Button>
      </div>
    </div>

    <!-- Messages -->
    <div ref="scroller" class="flex-1 overflow-y-auto px-4 py-3">
      <div v-if="isEmpty" class="mx-auto flex max-w-[40rem] flex-col items-center gap-4 py-10 text-center">
        <Sparkles class="size-8 text-primary/70" />
        <div class="text-sm text-muted-foreground">
          <span class="font-medium text-foreground">{{ greeting }}, I'm Lingo —</span> your translation companion. I can read your project and codebase, then help you shape project guidance, a glossary, per-string context, and the translations themselves. Ask me anything, or start here:
        </div>
        <div class="flex w-full flex-col gap-2">
          <button
            v-for="s in starters"
            :key="s"
            type="button"
            class="rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-muted/60"
            @click="runStarter(s)"
          >
            {{ s }}
          </button>
        </div>
      </div>

      <div v-else class="flex flex-col gap-3">
        <ChatMessage v-for="(m, i) in messages" :key="i" :message="m" />
        <div v-if="thinking" data-thinking class="flex justify-start">
          <div class="flex items-center gap-1 rounded-lg border border-border bg-muted px-3 py-3" aria-label="Lingo is thinking">
            <span class="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.3s]" />
            <span class="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.15s]" />
            <span class="size-1.5 animate-bounce rounded-full bg-muted-foreground/60" />
          </div>
        </div>
      </div>
    </div>

    <!-- Composer -->
    <div class="shrink-0 border-t p-3">
      <div class="flex items-end gap-2">
        <textarea
          ref="textarea"
          v-model="draft"
          rows="1"
          placeholder="Message the assistant…"
          class="block max-h-40 w-full flex-1 resize-none overflow-y-auto rounded-md border bg-background px-3 py-2 text-sm leading-5 outline-none focus:ring-2 focus:ring-ring"
          @input="autosize"
          @keydown="onKeydown"
          @focus="inputFocused = true"
          @blur="inputFocused = false"
        />
        <Button v-if="isSending" variant="outline" size="icon" class="size-10 shrink-0" aria-label="Stop" @click="cancel">
          <Square class="size-4" />
        </Button>
        <Button v-else size="icon" class="size-10 shrink-0" aria-label="Send" :disabled="!draft.trim()" @click="submit">
          <Send class="size-4" />
        </Button>
      </div>
    </div>
  </div>
</template>
