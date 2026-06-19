<script setup lang="ts">
import { computed, ref } from "vue";
import { marked } from "marked";
import createDOMPurify from "dompurify";

// Bind DOMPurify to the window explicitly so it sanitizes in every environment
// (the bare default export can no-op when it can't auto-detect a DOM).
const purifier = createDOMPurify(window);

// Assistant text is model output that can echo content the agent read from the
// user's codebase, so it is untrusted. Two layers neutralize it:
//  1. marked escapes any RAW HTML in the markdown source → it renders as visible
//     text, never as live nodes (deterministic, no DOM needed).
//  2. DOMPurify scrubs the generated HTML in the browser (e.g. javascript: URLs
//     produced by markdown links).
const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const renderer = new marked.Renderer();
renderer.html = ({ text }) => escapeHtml(text);
import { Wrench, Search, FileText, Check, X, Loader2, AlertTriangle, ChevronRight } from "lucide-vue-next";
import { Button } from "@/components/ui/button";
import { respondConfirm, type UiMessage, type UiToolCall } from "@/chat";

const props = defineProps<{ message: UiMessage }>();

// Assistant text is model output that can echo content the agent read from the
// user's codebase (file bodies, key values), so it is NOT trusted. Render the
// markdown, then sanitize the HTML before v-html to strip <script>, inline event
// handlers, and javascript:/data: URLs.
const html = computed(() =>
  props.message.text ? purifier.sanitize(marked.parse(props.message.text, { async: false, renderer }) as string) : "",
);

// Per-tool expand state (show the raw result/input).
const expanded = ref<Record<string, boolean>>({});
const toggle = (id: string) => { expanded.value[id] = !expanded.value[id]; };

const iconFor = (name: string) => {
  if (name === "grep_codebase" || name === "search_keys") return Search;
  if (name === "read_file" || name === "read_key" || name === "read_guidance") return FileText;
  if (name === "find_files") return FileText;
  return Wrench;
};

function detail(tool: UiToolCall): string {
  if (tool.status === "error") return tool.error ?? "error";
  if (tool.result === undefined || tool.result === null) return "";
  try { return typeof tool.result === "string" ? tool.result : JSON.stringify(tool.result, null, 2); }
  catch { return String(tool.result); }
}
</script>

<template>
  <div :class="message.role === 'user' ? 'flex justify-end' : 'flex justify-start'">
    <div
      :class="[
        'max-w-[44rem] rounded-lg px-3 py-2 text-sm',
        message.role === 'user' ? 'bg-primary text-primary-foreground' : 'w-full border border-border bg-muted',
      ]"
    >
      <!-- Tool action rows (assistant only) -->
      <div v-if="message.tools.length" class="mb-2 flex flex-col gap-1">
        <div
          v-for="tool in message.tools"
          :key="tool.id"
          class="rounded-md border bg-background/60 px-2 py-1.5 text-xs"
        >
          <div class="flex items-center gap-1.5">
            <Loader2 v-if="tool.status === 'running'" class="size-3.5 shrink-0 animate-spin text-muted-foreground" />
            <Check v-else-if="tool.status === 'done'" class="size-3.5 shrink-0 text-emerald-500" />
            <AlertTriangle v-else-if="tool.status === 'error'" class="size-3.5 shrink-0 text-destructive" />
            <component :is="iconFor(tool.name)" v-else class="size-3.5 shrink-0 text-muted-foreground" />
            <span class="font-medium">{{ tool.humanSummary || tool.name }}</span>
            <span v-if="tool.progress" class="text-muted-foreground">· {{ tool.progress.done }}/{{ tool.progress.total }}</span>
            <button
              v-if="tool.status === 'done' || tool.status === 'error'"
              type="button"
              class="ml-auto flex items-center gap-0.5 text-muted-foreground hover:text-foreground"
              @click="toggle(tool.id)"
            >
              <ChevronRight :class="['size-3 transition-transform', expanded[tool.id] ? 'rotate-90' : '']" />
            </button>
          </div>

          <!-- Confirm card for a gated tool awaiting approval -->
          <div v-if="tool.status === 'pending-confirm'" class="mt-2 flex flex-col gap-2">
            <pre class="overflow-x-auto rounded bg-muted/60 p-1.5 text-[11px]">{{ JSON.stringify(tool.input, null, 2) }}</pre>
            <div class="flex gap-2">
              <Button size="sm" class="h-7 gap-1" @click="respondConfirm(tool.id, true)"><Check class="size-3.5" />Apply</Button>
              <Button size="sm" variant="outline" class="h-7 gap-1" @click="respondConfirm(tool.id, false)"><X class="size-3.5" />Skip</Button>
            </div>
          </div>

          <span v-else-if="tool.status === 'declined'" class="mt-1 block text-muted-foreground">Skipped.</span>

          <pre v-if="expanded[tool.id]" class="mt-1.5 max-h-60 overflow-auto rounded bg-muted/60 p-1.5 text-[11px] leading-snug">{{ detail(tool) }}</pre>
        </div>
      </div>

      <!-- Rendered assistant markdown / plain user text -->
      <div
        v-if="message.role === 'assistant' && html"
        class="prose prose-sm dark:prose-invert max-w-none break-words"
        v-html="html"
      />
      <div v-else-if="message.text" class="whitespace-pre-wrap break-words">{{ message.text }}</div>

      <div v-if="message.error" class="mt-1 flex items-start gap-1.5 text-xs text-destructive">
        <AlertTriangle class="mt-0.5 size-3.5 shrink-0" />
        <span>{{ message.error }}</span>
      </div>
    </div>
  </div>
</template>
