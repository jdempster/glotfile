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
import { Check, X, Loader2, AlertTriangle, ChevronRight, SkipForward } from "lucide-vue-next";
import { Button } from "@/components/ui/button";
import { respondConfirm, type UiMessage, type UiToolCall } from "@/chat";
import { classifyToken, applyChatLink } from "@/chatLinks";

const props = defineProps<{ message: UiMessage }>();

// Lingo cites things in backticks (so they arrive as <code> spans). Tag the ones
// that classify as an editor action — a real key, a review state, a target locale
// — with `gf-key` so they read and behave as links; source strings and other code
// spans stay inert. Operates on already-sanitized HTML, only ADDING attributes, so
// it can't reintroduce XSS.
function tagChatLinks(sanitized: string): string {
  if (!sanitized.includes("<code")) return sanitized;
  const tpl = document.createElement("template");
  tpl.innerHTML = sanitized;
  for (const code of Array.from(tpl.content.querySelectorAll("code"))) {
    if (classifyToken(code.textContent ?? "")) {
      code.classList.add("gf-key");
      code.setAttribute("role", "button");
      code.setAttribute("tabindex", "0");
    }
  }
  return tpl.innerHTML;
}

// Assistant text is model output that can echo content the agent read from the
// user's codebase (file bodies, key values), so it is NOT trusted. Render the
// markdown, then sanitize the HTML before v-html to strip <script>, inline event
// handlers, and javascript:/data: URLs.
const html = computed(() =>
  props.message.text ? tagChatLinks(purifier.sanitize(marked.parse(props.message.text, { async: false, renderer }) as string)) : "",
);

// A reference Lingo mentioned (a key, a review state, a locale) was clicked/
// activated → drive the editor to it (open the key, or filter to the state/locale).
function activate(target: EventTarget | null): boolean {
  const el = (target as HTMLElement | null)?.closest?.("code.gf-key");
  const link = el ? classifyToken(el.textContent ?? "") : null;
  if (!link) return false;
  applyChatLink(link);
  return true;
}
function onLinkClick(e: MouseEvent) {
  if (activate(e.target)) e.preventDefault();
}
function onLinkKeydown(e: KeyboardEvent) {
  if ((e.key === "Enter" || e.key === " ") && activate(e.target)) e.preventDefault();
}

// Per-tool expand state (reveals the applied change / raw result).
const expanded = ref<Record<string, boolean>>({});
const toggle = (id: string) => { expanded.value[id] = !expanded.value[id]; };

// A row has something to reveal — and so is clickable — once it's resolved. A
// skipped (declined) row counts too: it reads like a done row (collapsed, with a
// chevron) and expands to show what the edit would have been.
const expandable = (tool: UiToolCall) => tool.status === "done" || tool.status === "error" || tool.status === "declined";

// Coerce a tool result/input (which may arrive as a JSON string on reload) to a
// plain object, or null if it isn't one.
function asObject(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try { const o = JSON.parse(raw); return o && typeof o === "object" ? (o as Record<string, unknown>) : null; }
    catch { return null; }
  }
  return null;
}

// The full key a tool acted on, for the expanded detail line.
function toolKey(tool: UiToolCall): string {
  const k = asObject(tool.result)?.key ?? asObject(tool.input)?.key;
  return typeof k === "string" ? k : "";
}

// A compact identifier shown at the row's right edge: the key's last segment, a
// glossary term, a locale, or the primary search argument — whichever the tool
// carries. Keeps the row scannable as an activity log.
function shortLabel(tool: UiToolCall): string {
  const r = asObject(tool.result) ?? {};
  const i = asObject(tool.input) ?? {};
  const key = r.key ?? i.key;
  if (typeof key === "string") { const p = key.split("."); return p[p.length - 1] || key; }
  const term = r.term ?? i.term; if (typeof term === "string") return term;
  const locale = r.locale ?? i.locale; if (typeof locale === "string") return locale;
  const q = i.query ?? i.pattern ?? i.glob ?? i.path; if (typeof q === "string") return q;
  return "";
}

// Tools whose effect is setting a single text value. For these the expanded view
// shows the applied value rather than a raw JSON dump.
const EDIT_TOOLS = new Set([
  "set_source_text", "add_key",
  "set_key_context", "set_project_context", "set_locale_instruction",
]);

// The value an edit tool applied (its "after"). The backend doesn't return the
// previous value, so we surface only what the string is now set to. Read tools
// (and anything we can't read a value from) return null and fall back to detail().
function appliedValue(tool: UiToolCall): string | null {
  if (!EDIT_TOOLS.has(tool.name)) return null;
  const r = asObject(tool.result);
  if (r) {
    if (tool.name === "set_source_text" && typeof r.source === "string") return r.source;
    if (tool.name === "add_key" && typeof r.source === "string") return r.source;
    if (tool.name === "set_key_context" && typeof r.context === "string") return r.context;
    if (tool.name === "set_project_context" && typeof r.projectContext === "string") return r.projectContext;
    if (tool.name === "set_locale_instruction" && typeof r.instruction === "string") return r.instruction;
  }
  const i = asObject(tool.input);
  if (i) {
    if (typeof i.value === "string") return i.value;
    if (typeof i.context === "string") return i.context;
    if (typeof i.text === "string") return i.text;
  }
  return null;
}

function detail(tool: UiToolCall): string {
  if (tool.status === "error") return tool.error ?? "error";
  const raw = tool.result;
  if (raw === undefined || raw === null) return "";
  // Pretty-print as indented JSON: objects directly, and strings that are
  // themselves JSON after parsing. Plain (non-JSON) strings pass through as-is.
  if (typeof raw === "string") {
    try { return JSON.stringify(JSON.parse(raw), null, 2); }
    catch { return raw; }
  }
  try { return JSON.stringify(raw, null, 2); }
  catch { return String(raw); }
}
</script>

<template>
  <!-- User: a lavender pill, right-aligned, with an asymmetric tail. -->
  <div v-if="message.role === 'user'" class="flex justify-end">
    <div
      class="max-w-[82%] whitespace-pre-wrap break-words bg-primary-soft px-3.5 py-2 text-[14.5px] leading-normal text-foreground"
      style="border-radius: 16px 16px 5px 16px"
    >{{ message.text }}</div>
  </div>

  <!-- Assistant: text flows on the panel (no bubble); tool calls render below as
       a quiet activity card. -->
  <div v-else class="flex flex-col gap-2.5">
    <div
      v-if="html"
      class="prose prose-sm dark:prose-invert max-w-none break-words [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 prose-strong:text-foreground prose-em:text-muted-foreground prose-a:text-primary prose-code:rounded prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:font-mono prose-code:text-[0.85em] prose-code:font-normal prose-code:text-primary prose-code:before:content-none prose-code:after:content-none prose-hr:my-3 prose-hr:border-border [&_code.gf-key]:cursor-pointer [&_code.gf-key]:underline [&_code.gf-key]:decoration-dotted [&_code.gf-key]:decoration-primary/40 [&_code.gf-key]:underline-offset-[3px] [&_code.gf-key:hover]:bg-primary-soft [&_code.gf-key:hover]:decoration-solid [&_code.gf-key:hover]:decoration-primary"
      @click="onLinkClick"
      @keydown="onLinkKeydown"
      v-html="html"
    />

    <div v-if="message.error" class="flex items-start gap-1.5 text-xs text-destructive">
      <AlertTriangle class="mt-0.5 size-3.5 shrink-0" />
      <span>{{ message.error }}</span>
    </div>

    <!-- Tool activity card: each call a row with a status disc, a summary, and a
         compact key; resolved rows expand to the applied value or raw result. -->
    <div v-if="message.tools.length" class="overflow-hidden rounded-xl border border-border bg-muted/40">
      <template v-for="(tool, i) in message.tools" :key="tool.id">
        <div v-if="i > 0" class="h-px bg-border" />

        <component
          :is="expandable(tool) ? 'button' : 'div'"
          :type="expandable(tool) ? 'button' : undefined"
          class="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors"
          :class="expandable(tool) ? 'hover:bg-background' : ''"
          :aria-expanded="expandable(tool) ? expanded[tool.id] : undefined"
          @click="expandable(tool) && toggle(tool.id)"
        >
          <span
            class="flex size-[18px] shrink-0 items-center justify-center rounded-full"
            :class="{
              'bg-success-bg text-success': tool.status === 'done',
              'bg-destructive-soft text-destructive': tool.status === 'error',
              'bg-primary-soft text-primary': tool.status === 'pending-confirm',
              'bg-muted text-muted-foreground': tool.status === 'declined',
              'text-muted-foreground': tool.status === 'running',
            }"
          >
            <Loader2 v-if="tool.status === 'running'" class="size-3.5 animate-spin" />
            <Check v-else-if="tool.status === 'done'" class="size-3" :stroke-width="3" />
            <AlertTriangle v-else-if="tool.status === 'error'" class="size-3" />
            <span v-else-if="tool.status === 'pending-confirm'" class="size-1.5 rounded-full bg-current" />
            <SkipForward v-else-if="tool.status === 'declined'" class="size-3" :stroke-width="2.5" />
            <X v-else class="size-3" />
          </span>

          <span class="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{{ tool.humanSummary || tool.name }}</span>
          <span v-if="tool.progress" class="shrink-0 text-[11px] text-muted-foreground">{{ tool.progress.done }}/{{ tool.progress.total }}</span>
          <span v-if="shortLabel(tool)" class="max-w-[150px] shrink-0 truncate font-mono text-[11px] text-muted-foreground">{{ shortLabel(tool) }}</span>
          <ChevronRight
            v-if="expandable(tool)"
            class="size-3.5 shrink-0 text-muted-foreground transition-transform"
            :class="expanded[tool.id] ? 'rotate-90' : ''"
          />
        </component>

        <!-- Expanded detail: the applied (or, for a skipped row, the would-be)
             value for edits, else the raw result. -->
        <div v-if="expanded[tool.id]" class="px-3 pb-3 pl-[42px]">
          <div v-if="appliedValue(tool) !== null" class="flex flex-col gap-1.5">
            <span v-if="toolKey(tool)" class="break-all font-mono text-[11px] text-muted-foreground">{{ toolKey(tool) }}</span>
            <div class="flex items-start gap-1.5 text-[13px] leading-snug">
              <span class="shrink-0 text-success">→</span>
              <span class="font-medium text-success">{{ appliedValue(tool) }}</span>
            </div>
          </div>
          <pre v-else class="max-h-[32rem] overflow-auto rounded-md bg-muted p-2.5 font-mono text-[11px] leading-relaxed text-foreground">{{ detail(tool) }}</pre>
        </div>
      </template>

      <!-- One Approve/Skip governs the whole batch of pending edits above, so an
           agreed task is approved with a single click rather than one per edit. -->
      <div v-if="message.pendingConfirm" class="flex items-center gap-2 px-3 py-2.5 pl-[42px]">
        <Button size="sm" class="h-7 gap-1" @click="message.pendingConfirm && respondConfirm(message.pendingConfirm.batchId, true)">
          <Check class="size-3.5" />Approve
          <kbd class="ml-0.5 rounded border border-primary-foreground/40 px-1 text-[10px] font-medium leading-none">A</kbd>
        </Button>
        <Button size="sm" variant="outline" class="h-7 gap-1" @click="message.pendingConfirm && respondConfirm(message.pendingConfirm.batchId, false)">
          <X class="size-3.5" />Skip
          <kbd class="ml-0.5 rounded border px-1 text-[10px] font-medium leading-none text-muted-foreground">S</kbd>
        </Button>
      </div>
    </div>
  </div>
</template>
