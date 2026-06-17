<script setup lang="ts">
import { reactive, ref, watch, computed } from "vue";
import { FileText, Image as ImageIcon, Upload, Trash2, AlertTriangle, RefreshCw, Sparkles, Code2, ExternalLink, Asterisk, Info, Tags, Ruler, Folder, BellOff } from "lucide-vue-next";
import type { Issue, KeyEntry } from "@/types.js";
import { patchKey, uploadScreenshot, deleteScreenshot, convertToPlural, convertToScalar, buildContextStream, keyUsage, suppressFinding, type KeyUsage, type KeyUsageRef } from "@/api.js";
import { buildOpenUrl } from "@/editor.js";
import { buildUsageTree } from "@/usageTree.js";
import { isTargetMissing } from "@/missing.js";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import NotesEditor from "./NotesEditor.vue";
import Flag from "@/components/lang/Flag.vue";
import { cn, copyText } from "@/lib/utils";

const props = defineProps<{
  keyName: string | null;
  entry: KeyEntry | null;
  issues?: Issue[];
  // All configured locales + the source locale, so "untranslated" reflects true
  // completeness regardless of the editor's bilingual/multilingual view.
  locales?: string[];
  sourceLocale?: string;
  // Increments when a scan refreshes the editor's scan-derived data; signals this
  // panel to re-fetch the selected key's usage even though its key name is unchanged.
  usageRevision?: number;
}>();
const emit = defineEmits<{ (e: "changed"): void }>();

const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleString() : "—");

// Most recent edit across the key's locale values (ISO strings sort chronologically).
const keyNameHtml = computed(() => {
  if (!props.keyName) return "";
  const escaped = props.keyName.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return escaped.replace(/\./g, ".<wbr>");
});

const lastUpdated = computed(() => {
  let max = "";
  for (const v of Object.values(props.entry?.values ?? {})) {
    if (v.updatedAt && v.updatedAt > max) max = v.updatedAt;
  }
  return max || undefined;
});

const isPlural = computed(() => Boolean(props.entry?.plural));

// Clicking the key name copies it; the hover tooltip flips to "Copied" as
// feedback instead of firing a toast.
const keyCopied = ref(false);
let keyCopiedTimer: ReturnType<typeof setTimeout> | undefined;
function copyKeyName() {
  copyText(props.keyName!)
    .then(() => {
      keyCopied.value = true;
      clearTimeout(keyCopiedTimer);
      keyCopiedTimer = setTimeout(() => (keyCopied.value = false), 1500);
    })
    .catch(() => {});
}

// Split attention: genuine issues (red) vs untranslated targets (muted).
const CHECK_LABELS: Record<string, string> = {
  placeholder: "Placeholder",
  spelling: "Spelling",
  length: "Length",
  glossary: "Glossary",
};
const realIssues = computed(() => (props.issues ?? []).filter((i) => i.check !== "untranslated"));

// Warning-level checks can be dismissed: the matching lint rule is suppressed for
// this key+locale until the source text changes. Error-level checks (placeholder,
// glossary) block a release, so they stay.
const DISMISSIBLE_RULE: Record<string, string> = { spelling: "spelling", length: "max-length" };
const dismissing = ref(false);
async function dismissIssue(r: Issue) {
  const rule = DISMISSIBLE_RULE[r.check];
  if (!rule || !props.keyName || dismissing.value) return;
  dismissing.value = true;
  try {
    await suppressFinding(props.keyName, rule, r.locale);
    toast.success("Dismissed until the source text changes");
    emit("changed");
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    dismissing.value = false;
  }
}
const untranslatedLocales = computed(() => {
  const entry = props.entry;
  const src = props.sourceLocale;
  if (!entry || !src) return [];
  return (props.locales ?? []).filter((l) => isTargetMissing(entry, l, src));
});

const fileInput = ref<HTMLInputElement | null>(null);
const uploading = ref(false);
const removing = ref(false);

function pickFile() {
  fileInput.value?.click();
}

async function onFileSelected(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file || !props.keyName) return;
  uploading.value = true;
  try {
    await uploadScreenshot(props.keyName, file);
    toast.success("Screenshot uploaded");
    emit("changed");
  } catch (e) {
    toast.error(`Upload failed: ${(e as Error).message}`);
  } finally {
    uploading.value = false;
  }
}

async function removeScreenshot() {
  if (!props.keyName) return;
  removing.value = true;
  try {
    await deleteScreenshot(props.keyName);
    toast.success("Screenshot removed");
    emit("changed");
  } catch (e) {
    toast.error(`Could not remove: ${(e as Error).message}`);
  } finally {
    removing.value = false;
  }
}

const form = reactive({
  context: "",
  tags: "",
  maxLength: undefined as number | undefined,
});
const saving = ref(false);
const suggesting = ref(false);

async function suggestContext() {
  if (!props.keyName) return;
  suggesting.value = true;
  try {
    let written = 0;
    let errors: { key: string; error: string }[] = [];
    for await (const event of buildContextStream({ keyGlob: props.keyName, all: true, force: true })) {
      if (event.type === "done") { written = event.written; errors = event.errors; }
    }
    if (written > 0) {
      toast.success("Context suggested and saved — review it below");
      emit("changed");
    } else if (errors.length > 0) {
      toast.error(errors[0]!.error);
    } else {
      toast.info("No usage found — add a code snippet or type context manually");
    }
  } catch (e) {
    toast.error(`Could not suggest: ${(e as Error).message}`);
  } finally {
    suggesting.value = false;
  }
}

// Snapshot of the last server values loaded into the form. Used to tell an
// untouched form (safe to re-sync) from one the user is editing (must not be
// clobbered) — a live-reload swaps the whole state, so props.entry becomes a new
// object on every out-of-band change even when this key is unchanged.
const synced = { context: "", tags: "", maxLength: undefined as number | undefined };
function syncForm(): void {
  form.context = synced.context = props.entry?.context ?? "";
  form.tags = synced.tags = (props.entry?.tags ?? []).join(", ");
  form.maxLength = synced.maxLength = props.entry?.maxLength;
}
function formIsPristine(): boolean {
  return form.context === synced.context && form.tags === synced.tags && form.maxLength === synced.maxLength;
}
// Switching keys always loads the new key's metadata.
watch(() => props.keyName, syncForm, { immediate: true });
// A live-reload (same key, new entry object) re-syncs ONLY when the user has no
// unsaved edits, so an out-of-band state swap never eats in-progress input but
// still picks up server-side changes (e.g. suggested context) on an idle form.
watch(() => props.entry, () => { if (formIsPristine()) syncForm(); });

// ── Code usage (from the last scan) ───────────────────────────────────────────
const usage = ref<KeyUsage | null>(null);
const usageShown = ref(6);
async function loadUsage() {
  const k = props.keyName;
  if (!k) { usage.value = null; return; }
  try { usage.value = await keyUsage(k); } catch { usage.value = null; }
}
// Switching keys clears + resets paging before fetching the new key's usage.
watch(
  () => props.keyName,
  async () => {
    usage.value = null;
    usageShown.value = 6;
    await loadUsage();
  },
  { immediate: true },
);
// A scan refreshes usage for the same key in place — no clear/reset, so the row
// list and "+ N more" paging don't flicker.
watch(() => props.usageRevision, loadUsage);

// Each ref gets an "open in editor" URL (null when the chosen editor can't build
// one — e.g. PhpStorm with no derivable project — so the row falls back to text).
const openUrl = (r: KeyUsageRef) => buildOpenUrl(r, usage.value?.project ?? "");
const exactRows = computed(() => (usage.value?.refs ?? []).map((r) => ({ ...r, url: openUrl(r) })));
const prefixRows = computed(() => (usage.value?.prefixRefs ?? []).map((r) => ({ ...r, url: openUrl(r) })));
const literalRows = computed(() => (usage.value?.literalRefs ?? []).map((r) => ({ ...r, url: buildOpenUrl(r, usage.value?.project ?? "") })));

// Exact usages rendered as a compact file tree, capped to `usageShown` references
// (the "+ N more" reveal raises the cap to usage.count).
const usageTree = computed(() => buildUsageTree(exactRows.value.slice(0, usageShown.value)));

// A file row links to its first (lowest-line) usage, so the filename — not just
// the line-number chips — opens the file in the editor.
const fileOpenUrl = (refs: { url: string | null }[]) => refs.find((r) => r.url)?.url ?? null;

const pluralArg = ref("count");
const converting = ref(false);

watch(
  () => [props.keyName, props.entry] as const,
  () => {
    pluralArg.value = props.entry?.plural?.arg ?? "count";
  },
  { immediate: true },
);

async function makePlural() {
  if (!props.keyName) return;
  const arg = pluralArg.value.trim() || "count";
  converting.value = true;
  try {
    await convertToPlural(props.keyName, arg);
    toast.success("Converted to plural");
    emit("changed");
  } catch (e) {
    toast.error(`Could not convert: ${(e as Error).message}`);
  } finally {
    converting.value = false;
  }
}

async function makeScalar() {
  if (!props.keyName) return;
  converting.value = true;
  try {
    await convertToScalar(props.keyName);
    toast.success("Converted to a single string");
    emit("changed");
  } catch (e) {
    toast.error(`Could not convert: ${(e as Error).message}`);
  } finally {
    converting.value = false;
  }
}

async function savePluralArg() {
  const arg = pluralArg.value.trim();
  if (!props.keyName || !arg || arg === props.entry?.plural?.arg) return;
  try {
    await patchKey(props.keyName, { pluralArg: arg });
    toast.success("Renamed count variable");
    emit("changed");
  } catch (e) {
    toast.error(`Could not rename: ${(e as Error).message}`);
  }
}

async function save() {
  if (!props.keyName) return;
  saving.value = true;
  try {
    await patchKey(props.keyName, {
      metadata: {
        // Send empties explicitly (not undefined, which JSON drops) so the server
        // can clear a field that was previously filled.
        context: form.context.trim(),
        tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
        maxLength: form.maxLength ? Number(form.maxLength) : null,
      },
    });
    toast.success("Metadata saved");
    emit("changed");
  } catch (e) {
    toast.error(`Could not save: ${(e as Error).message}`);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <!-- Width comes from the resizable panel pref, applied as an inline style by EditorView. -->
  <aside class="flex shrink-0 flex-col overflow-y-auto border-l border-border bg-card max-[1080px]:hidden">
    <!-- Empty state -->
    <div
      v-if="!keyName || !entry"
      class="flex flex-1 flex-col items-center justify-center gap-2.5 p-10 text-center text-muted-foreground"
    >
      <FileText class="size-5" />
      <p class="max-w-[200px] text-sm leading-relaxed">Select a key to view and edit its details.</p>
    </div>

    <div v-else class="flex flex-col gap-4 px-5 pb-10 pt-[18px]">
      <!-- Key identity -->
      <div class="flex flex-col gap-0.5">
        <span class="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">Key</span>
        <Tooltip disable-closing-trigger>
          <TooltipTrigger as-child>
            <span
              class="inline-block w-fit break-words cursor-pointer font-mono text-base font-semibold tracking-tight"
              v-html="keyNameHtml"
              @click="copyKeyName"
            />
          </TooltipTrigger>
          <TooltipContent>{{ keyCopied ? "Copied" : "Click to copy" }}</TooltipContent>
        </Tooltip>
      </div>

      <!-- Type row (compact; keeps the arg input for scalar→plural) -->
      <div class="flex flex-wrap items-center gap-2">
        <span
          v-if="isPlural"
          class="rounded-md border border-primary-border bg-primary-soft px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide text-primary"
          >PLURAL</span
        >
        <span
          v-else
          class="rounded-md border border-border-soft bg-accent px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide text-muted-foreground"
          >SINGLE</span
        >
        <template v-if="isPlural">
          <span class="text-[11.5px] text-muted-foreground">arg</span>
          <Input
            v-model="pluralArg"
            class="h-7 w-24 font-mono text-xs"
            aria-label="Number variable name"
            @blur="savePluralArg"
            @keydown.enter.prevent="savePluralArg"
          />
          <button
            type="button"
            class="ml-auto rounded-md px-2 py-1 text-[12px] font-semibold text-primary transition-colors hover:bg-primary-soft disabled:opacity-50"
            :disabled="converting"
            @click="makeScalar"
          >Make single</button>
        </template>
        <template v-else>
          <button
            type="button"
            class="ml-auto rounded-md px-2 py-1 text-[12px] font-semibold text-primary transition-colors hover:bg-primary-soft disabled:opacity-50"
            :disabled="converting"
            @click="makePlural"
          >Make plural</button>
        </template>
      </div>

      <!-- Needs attention: genuine issues (red) + untranslated (muted) -->
      <div
        v-if="realIssues.length || untranslatedLocales.length"
        :class="cn(
          'flex flex-col gap-3 rounded-xl border border-border bg-background p-3',
          realIssues.length && 'border-primary-border',
        )"
      >
        <div v-if="realIssues.length" class="flex flex-col gap-1.5">
          <div class="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-destructive">
            <AlertTriangle class="size-3.5" /> {{ realIssues.length }} issue{{ realIssues.length === 1 ? '' : 's' }}
          </div>
          <div v-for="(r, i) in realIssues" :key="i" class="group flex items-center gap-2 text-[12.5px]">
            <Flag :code="r.locale" :size="14" />
            <span class="font-mono text-[11px] font-semibold">{{ r.locale.toUpperCase() }}</span>
            <span class="ml-auto rounded border border-destructive px-1.5 py-0.5 text-[10.5px] font-semibold text-destructive">{{ CHECK_LABELS[r.check] ?? r.check }}</span>
            <Tooltip v-if="DISMISSIBLE_RULE[r.check]">
              <TooltipTrigger as-child>
                <button
                  type="button"
                  class="flex size-[20px] items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
                  :disabled="dismissing"
                  aria-label="Dismiss until the source changes"
                  @click="dismissIssue(r)"
                >
                  <BellOff class="size-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Dismiss until the source text changes</TooltipContent>
            </Tooltip>
          </div>
        </div>
        <div v-if="untranslatedLocales.length" class="flex flex-col gap-1.5">
          <div class="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            <span class="size-[7px] rounded-full bg-muted-foreground" /> {{ untranslatedLocales.length }} untranslated
          </div>
          <div v-for="loc in untranslatedLocales" :key="loc" class="flex items-center gap-2 text-[12.5px]">
            <Flag :code="loc" :size="14" />
            <span class="font-mono text-[11px] font-semibold">{{ loc.toUpperCase() }}</span>
            <span class="ml-auto rounded border border-border-soft bg-accent px-1.5 py-0.5 text-[10.5px] font-semibold italic text-muted-foreground">Empty</span>
          </div>
        </div>
      </div>

      <!-- Usage (from the last code scan) -->
      <div class="flex flex-col gap-1.5">
        <div class="flex items-center gap-1.5">
          <Code2 class="size-3.5 text-muted-foreground" />
          <span class="text-[13px] font-semibold">Usage</span>
          <span v-if="usage?.indexed" class="ml-auto text-[11.5px] text-muted-foreground">
            {{ usage.count }} reference{{ usage.count === 1 ? "" : "s" }}
          </span>
        </div>
        <p v-if="!usage || !usage.indexed" class="text-[12px] text-muted-foreground">
          Run a scan to find where this key is used in your code.
        </p>
        <template v-else>
          <p v-if="usage.count === 0 && prefixRows.length === 0 && literalRows.length === 0" class="rounded-md border border-border-soft bg-accent px-2 py-1.5 text-[12px] text-muted-foreground">
            Not referenced in the last scan — this key may be unused.
          </p>
          <div v-if="exactRows.length" class="flex flex-col gap-0.5 text-[11.5px]">
            <template v-for="(row, i) in usageTree" :key="i">
              <!-- Directory node: collapsed single-child chains share one label. -->
              <div
                v-if="row.kind === 'dir'"
                class="flex items-center gap-1 text-muted-foreground"
                :style="{ paddingLeft: `${row.depth * 12}px` }"
              >
                <Folder class="size-3 shrink-0" />
                <Tooltip>
                  <TooltipTrigger as-child>
                    <span class="min-w-0 truncate font-mono" style="direction: rtl; text-align: left">{{ row.label }}</span>
                  </TooltipTrigger>
                  <TooltipContent class="font-mono">{{ row.label }}</TooltipContent>
                </Tooltip>
              </div>
              <!-- File node: one row per file, its line numbers as clickable chips. -->
              <div
                v-else
                class="flex items-baseline gap-1.5"
                :style="{ paddingLeft: `${row.depth * 12 + 16}px` }"
              >
                <Tooltip>
                  <TooltipTrigger as-child>
                    <a
                      v-if="fileOpenUrl(row.refs)"
                      :href="fileOpenUrl(row.refs)!"
                      class="min-w-0 shrink truncate rounded px-0.5 font-mono text-foreground hover:bg-accent hover:text-primary"
                    >{{ row.name }}</a>
                    <span v-else class="min-w-0 shrink truncate font-mono text-foreground">{{ row.name }}</span>
                  </TooltipTrigger>
                  <TooltipContent class="font-mono">{{ fileOpenUrl(row.refs) ? `Open ${row.name}` : row.name }}</TooltipContent>
                </Tooltip>
                <span class="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                  <template v-for="(r, j) in row.refs" :key="j">
                    <Tooltip v-if="r.url">
                      <TooltipTrigger as-child>
                        <a :href="r.url" class="shrink-0 rounded px-0.5 font-mono text-muted-foreground hover:bg-accent hover:text-primary">:{{ r.line }}</a>
                      </TooltipTrigger>
                      <TooltipContent class="font-mono">Open {{ row.name }}:{{ r.line }}</TooltipContent>
                    </Tooltip>
                    <span v-else class="shrink-0 font-mono text-muted-foreground">:{{ r.line }}</span>
                  </template>
                </span>
              </div>
            </template>
            <button
              v-if="usage.count > usageShown"
              type="button"
              class="mt-0.5 self-start text-[11.5px] text-primary hover:underline"
              @click="usageShown = usage.count"
            >
              + {{ usage.count - usageShown }} more
            </button>
          </div>

          <!-- Indirect: dynamically-built keys whose static prefix this key falls under -->
          <div v-if="prefixRows.length" class="flex flex-col gap-1">
            <p class="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
              <Asterisk class="size-3" /> Possible usage (dynamic keys)
            </p>
            <ul class="flex flex-col gap-1">
              <li v-for="(r, i) in prefixRows" :key="i" class="text-[11.5px]">
                <Tooltip>
                  <TooltipTrigger as-child>
                    <component
                      :is="r.url ? 'a' : 'div'"
                      :href="r.url || undefined"
                      class="group flex items-baseline gap-2 text-muted-foreground"
                      :class="r.url ? 'hover:text-primary' : ''"
                    >
                      <span class="min-w-0 flex-1 truncate font-mono" style="direction: rtl; text-align: left">{{ r.file }}</span>
                      <span class="shrink-0 rounded border border-dashed border-border-soft px-1 font-mono text-[10px]">{{ r.prefix }}*</span>
                      <span class="shrink-0 font-mono">:{{ r.line }}</span>
                      <ExternalLink v-if="r.url" class="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                    </component>
                  </TooltipTrigger>
                  <TooltipContent class="font-mono">{{ r.url ? `Open ${r.file}:${r.line}` : `${r.file}:${r.line}` }}</TooltipContent>
                </Tooltip>
              </li>
            </ul>
          </div>

          <!-- Indirect: key-shaped string literals outside a call site (ternaries, arrays, variables) -->
          <div v-if="literalRows.length" class="flex flex-col gap-1">
            <p class="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
              <Asterisk class="size-3" /> Possible usage (string literals)
            </p>
            <ul class="flex flex-col gap-1">
              <li v-for="(r, i) in literalRows" :key="i" class="text-[11.5px]">
                <Tooltip>
                  <TooltipTrigger as-child>
                    <component
                      :is="r.url ? 'a' : 'div'"
                      :href="r.url || undefined"
                      class="group flex items-baseline gap-2 text-muted-foreground"
                      :class="r.url ? 'hover:text-primary' : ''"
                    >
                      <span class="min-w-0 flex-1 truncate font-mono" style="direction: rtl; text-align: left">{{ r.file }}</span>
                      <span class="shrink-0 rounded border border-dashed border-border-soft px-1 font-mono text-[10px]">'{{ r.literal }}'</span>
                      <span class="shrink-0 font-mono">:{{ r.line }}</span>
                      <ExternalLink v-if="r.url" class="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                    </component>
                  </TooltipTrigger>
                  <TooltipContent class="font-mono">{{ r.url ? `Open ${r.file}:${r.line}` : `${r.file}:${r.line}` }}</TooltipContent>
                </Tooltip>
              </li>
            </ul>
          </div>
        </template>
      </div>

      <!-- Context -->
      <div class="flex flex-col gap-1.5">
        <div class="flex items-center gap-1.5">
          <Info class="size-3.5 text-muted-foreground" />
          <label for="detail-context" class="text-[13px] font-semibold">Context</label>
          <Tooltip v-if="entry.contextSource === 'ai'">
            <TooltipTrigger as-child>
              <span class="ml-0.5 flex items-center gap-0.5 rounded border border-primary/30 bg-primary/10 px-1 py-0.5 text-[10px] font-semibold text-primary">
                <Sparkles class="size-2.5" /> AI
              </span>
            </TooltipTrigger>
            <TooltipContent>AI-generated</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger as-child>
              <button
                type="button"
                class="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-[11.5px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
                :disabled="suggesting"
                @click="suggestContext"
              >
                <Sparkles class="size-3" />
                {{ suggesting ? "Suggesting…" : "Suggest" }}
              </button>
            </TooltipTrigger>
            <TooltipContent>{{ suggesting ? "Suggesting…" : "Suggest context with AI" }}</TooltipContent>
          </Tooltip>
        </div>
        <Textarea id="detail-context" v-model="form.context" rows="5" class="min-h-28" placeholder="Where/how this string is used…" />
      </div>

      <!-- Tags -->
      <div class="flex flex-col gap-1.5">
        <div class="flex items-center gap-1.5">
          <Tags class="size-3.5 text-muted-foreground" />
          <label for="detail-tags" class="text-[13px] font-semibold">Tags</label>
        </div>
        <Input id="detail-tags" v-model="form.tags" placeholder="comma, separated" />
      </div>

      <!-- Max length -->
      <div class="flex flex-col gap-1.5">
        <div class="flex items-center gap-1.5">
          <Ruler class="size-3.5 text-muted-foreground" />
          <label for="detail-maxlen" class="text-[13px] font-semibold">Max length</label>
        </div>
        <Input id="detail-maxlen" v-model.number="form.maxLength" type="number" min="0" placeholder="—" class="font-mono" />
      </div>

      <Button class="w-full" :disabled="saving" @click="save">Save details</Button>

      <div class="h-px bg-border-soft" />

      <NotesEditor v-if="keyName" :key-name="keyName" :notes="entry.notes ?? []" @changed="emit('changed')" />

      <div class="h-px bg-border-soft" />

      <!-- Screenshot (keep the real preview; add Replace) -->
      <div class="flex flex-col gap-2">
        <div class="flex items-center gap-1.5">
          <ImageIcon class="size-3.5 text-muted-foreground" />
          <span class="text-[13px] font-semibold">Screenshot</span>
        </div>
        <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="onFileSelected" />
        <div v-if="entry.screenshot" class="flex flex-col gap-2">
          <img
            :src="'/' + entry.screenshot"
            :alt="`Screenshot for ${keyName}`"
            class="max-h-48 w-full rounded-lg border border-border object-contain"
          />
          <div class="flex gap-2">
            <Button variant="outline" size="sm" :disabled="uploading" @click="pickFile">
              <RefreshCw class="size-4" /> Replace
            </Button>
            <Button
              variant="outline"
              size="sm"
              class="text-muted-foreground hover:text-destructive"
              :disabled="removing"
              @click="removeScreenshot"
            >
              <Trash2 class="size-4" /> Remove
            </Button>
          </div>
        </div>
        <button
          v-else
          type="button"
          class="flex w-full flex-col items-center gap-2 rounded-xl border-[1.5px] border-dashed border-input p-[22px] text-center text-[12.5px] font-medium text-muted-foreground transition-colors hover:border-primary-border hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60"
          :disabled="uploading"
          @click="pickFile"
        >
          <Upload class="size-5" />
          {{ uploading ? "Uploading…" : "Upload screenshot" }}
        </button>
      </div>

      <div class="h-px bg-border-soft" />

      <!-- Timestamps -->
      <div class="flex flex-col gap-1.5 text-[11.5px] text-muted-foreground">
        <div class="flex items-center justify-between gap-3">
          <span>Created</span><span class="font-mono text-[11px] text-foreground">{{ fmtDate(entry.createdAt) }}</span>
        </div>
        <div class="flex items-center justify-between gap-3">
          <span>Last updated</span><span class="font-mono text-[11px] text-foreground">{{ fmtDate(lastUpdated) }}</span>
        </div>
      </div>
    </div>
  </aside>
</template>
