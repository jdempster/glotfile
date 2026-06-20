<script setup lang="ts">
import { ref, computed, nextTick, watch, onMounted } from "vue";
import { Pencil, ArrowUp, Sparkles, X, Maximize2, Minimize2 } from "lucide-vue-next";
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
  "Take a look at my project and tell me where to start.",
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

// Lingo is working whenever a turn is in flight, so keep the dots up until it's
// the user's turn again. Crucially we can't key off narrated text or a specific
// phase: while the model is generating its next tool call, nothing streams (only
// text deltas do — tool_use arrives whole at turn end), so a bubble that reads
// "text, no tools" is just as likely mid-generation as finished. Showing the
// dots unconditionally avoids that dead air. The one exception: a tool actually
// running (or awaiting confirm) already shows its own row state, so dots there
// would be redundant noise.
const thinking = computed(() => {
  if (!isSending.value) return false;
  const last = messages.value[messages.value.length - 1];
  if (!last || last.role === "user") return true;
  return !last.tools.some((t) => t.status === "running" || t.status === "pending-confirm");
});

// The reel flips through these scripts (Latin, Japanese, Arabic, Devanagari,
// Han). We shuffle the order each time the indicator appears so it never reads
// the same twice, then repeat the first glyph at the end so the 6-step reel
// animation loops seamlessly.
const REEL_GLYPHS = ["A", "あ", "ع", "क", "文"];
const reelGlyphs = ref<string[]>([]);
watch(thinking, (on) => {
  if (!on) return;
  const g = [...REEL_GLYPHS];
  for (let i = g.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [g[i], g[j]] = [g[j], g[i]];
  }
  reelGlyphs.value = [...g, g[0]];
}, { immediate: true });

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
    <div class="flex h-12 shrink-0 items-center justify-between border-b pl-5 pr-3">
      <div class="flex items-center gap-2.5">
        <Sparkles class="size-[18px] text-primary" />
        <span class="text-base font-bold tracking-tight text-foreground">Lingo</span>
      </div>
      <div class="flex items-center gap-0.5">
        <Button v-if="!isEmpty" variant="ghost" size="sm" class="h-7 gap-1.5 text-muted-foreground" @click="clear">
          <Pencil class="size-3.5" />New chat
        </Button>
        <Button v-if="dock" variant="ghost" size="icon" class="size-8 text-muted-foreground" :aria-label="expanded ? 'Collapse to side panel' : 'Expand over content'" @click="toggleExpanded">
          <Minimize2 v-if="expanded" class="size-4" />
          <Maximize2 v-else class="size-4" />
        </Button>
        <Button v-if="dock" variant="ghost" size="icon" class="size-8 text-muted-foreground" aria-label="Close" @click="emit('close')">
          <X class="size-4" />
        </Button>
      </div>
    </div>

    <!-- Messages -->
    <div ref="scroller" class="flex-1 overflow-y-auto px-[26px] pb-2 pt-6">
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
            class="rounded-xl border px-3.5 py-2.5 text-left text-sm transition-colors hover:border-primary-border hover:bg-primary-soft/50"
            @click="runStarter(s)"
          >
            {{ s }}
          </button>
        </div>
      </div>

      <div v-else class="flex flex-col">
        <!-- Spacing groups by response: tight between consecutive assistant turns
             (so a run of tool calls reads as one activity log), roomier only at
             user/response boundaries. -->
        <ChatMessage
          v-for="(m, i) in messages"
          :key="i"
          :message="m"
          :class="i === 0 ? '' : (m.role === 'user' || messages[i - 1].role === 'user' ? 'mt-5' : 'mt-2')"
        />
        <div v-if="thinking" data-thinking class="mt-3 flex">
          <div class="flex items-center gap-2.5 py-0.5" role="status" aria-label="Lingo is thinking">
            <span class="lf-reel" aria-hidden="true">
              <span class="lf-reel-strip">
                <span v-for="(g, i) in reelGlyphs" :key="i" class="lf-glyph">{{ g }}</span>
              </span>
            </span>
            <span class="flex gap-[5px]">
              <span class="lf-dot" /><span class="lf-dot" /><span class="lf-dot" />
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Composer: the textarea and a round send/stop button share one rounded
         field. Laid out as a flex row with items-end so the 34px button sets the
         resting height (button stays centered at one line) and stays pinned to
         the bottom as the textarea grows. -->
    <div class="shrink-0 px-5 pb-[18px] pt-3.5">
      <div class="flex items-end gap-2 rounded-2xl border border-input bg-background py-1.5 pl-4 pr-2 transition-colors focus-within:border-ring">
        <textarea
          ref="textarea"
          v-model="draft"
          rows="1"
          placeholder="Message Lingo…"
          class="block max-h-40 min-w-0 flex-1 resize-none overflow-y-auto bg-transparent py-1.5 text-[14.5px] leading-snug text-foreground outline-none placeholder:text-muted-foreground"
          @input="autosize"
          @keydown="onKeydown"
          @focus="inputFocused = true"
          @blur="inputFocused = false"
        />
        <button
          type="button"
          :aria-label="isSending ? 'Stop' : 'Send'"
          :disabled="!isSending && !draft.trim()"
          class="flex size-[34px] shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
          @click="isSending ? cancel() : submit()"
        >
          <span v-if="isSending" class="size-[11px] rounded-[2px] bg-primary-foreground" />
          <ArrowUp v-else class="size-[18px]" :stroke-width="2.2" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Glyph reel — Lingo's "thinking" indicator. A slot-style reel flips through
   scripts (Latin, Japanese, Arabic, Devanagari, Han) while three dots bounce
   below: a polyglot nod that suits translation work. Shown until the user's
   turn returns. Each glyph is 20px tall and the strip stacks six of them
   (the last repeats the first), so the reel loops seamlessly. */
.lf-reel {
  position: relative;
  display: inline-block;
  width: 20px;
  height: 20px;
  overflow: hidden;
}
.lf-reel-strip {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  animation: lf-reel 6s cubic-bezier(0.7, 0, 0.3, 1) infinite;
}
.lf-glyph {
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 600;
  line-height: 1;
  color: var(--primary);
}

@keyframes lf-reel {
  0%, 15% { transform: translateY(0); }
  20%, 35% { transform: translateY(-20px); }
  40%, 55% { transform: translateY(-40px); }
  60%, 75% { transform: translateY(-60px); }
  80%, 95% { transform: translateY(-80px); }
  100% { transform: translateY(-100px); }
}

.lf-dot {
  width: 7px;
  height: 7px;
  border-radius: 9999px;
  background: var(--primary);
  animation: lf-bounce 1s ease-in-out infinite;
}
.lf-dot:nth-child(2) { animation-delay: 0.13s; }
.lf-dot:nth-child(3) { animation-delay: 0.26s; }

@keyframes lf-bounce {
  0%, 70%, 100% { transform: translateY(0); }
  35% { transform: translateY(-6px); }
}

@media (prefers-reduced-motion: reduce) {
  .lf-reel-strip { animation: none; }
  .lf-dot { animation: none; opacity: 0.6; }
}
</style>
