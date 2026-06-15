<script setup lang="ts">
import { ref, computed } from "vue";
import {
  MoreVertical, Image as ImageIcon, Pencil, Trash2, AlertTriangle, Sparkles, Tag, LoaderCircle, RefreshCw, Check, Languages,
} from "lucide-vue-next";
import type { Issue, KeyEntry } from "@/types.js";
import { bulkMeta, deleteKey, patchKey, translate } from "@/api.js";
import { missingTargetLocales, staleTargetLocales } from "@/missing.js";
import { toast } from "@/components/ui/toast";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import TranslationRow from "./TranslationRow.vue";
import { cn } from "@/lib/utils";

const props = defineProps<{
  keyName: string;
  entry: KeyEntry;
  sourceLocale: string;
  // Locales to render, source first, already ordered by the parent.
  locales: string[];
  selected: boolean;
  checked?: boolean;
  issues?: Issue[];
}>();

const keyNameHtml = computed(() => {
  const escaped = props.keyName.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return escaped.replace(/\./g, ".<wbr>");
});

const issuesByLocale = computed(() => {
  const m = new Map<string, Issue[]>();
  for (const i of props.issues ?? []) {
    const arr = m.get(i.locale);
    if (arr) arr.push(i);
    else m.set(i.locale, [i]);
  }
  return m;
});

const emit = defineEmits<{
  (e: "changed"): void;
  (e: "select"): void;
  (e: "toggle-select", payload: { shift: boolean }): void;
  (e: "renamed", to: string): void;
  (e: "filter-tag", tag: string): void;
}>();

const renaming = ref(false);
const renameDraft = ref("");
const confirmingDelete = ref(false);
const busy = ref(false);
const translatingMissing = ref(false);
const retranslatingStale = ref(false);

// Target locales this key's "translate missing" call would fill.
const missingLocales = computed(() =>
  missingTargetLocales(props.entry, props.locales, props.sourceLocale),
);

// Target locales whose translation is stale: needs-review state AND holds a value.
const staleLocales = computed(() =>
  staleTargetLocales(props.entry, props.locales, props.sourceLocale),
);

async function retranslateStale() {
  retranslatingStale.value = true;
  try {
    const res = await translate({
      onlyMissing: false,
      force: true,
      keyGlob: props.keyName,
      locales: staleLocales.value,
    });
    if (res.errors?.length) toast.error(res.errors[0]?.error ?? "Translation failed");
    else toast.success(`Re-translated ${res.written} stale value${res.written === 1 ? "" : "s"}`);
    emit("changed");
  } catch (e) {
    toast.error(`Translate failed: ${(e as Error).message}`);
  } finally {
    retranslatingStale.value = false;
  }
}

async function translateMissing() {
  translatingMissing.value = true;
  try {
    const res = await translate({ onlyMissing: true, keyGlob: props.keyName });
    if (res.errors?.length) toast.error(res.errors[0]?.error ?? "Translation failed");
    else toast.success(`Translated ${res.written} missing value${res.written === 1 ? "" : "s"}`);
    emit("changed");
  } catch (e) {
    toast.error(`Translate failed: ${(e as Error).message}`);
  } finally {
    translatingMissing.value = false;
  }
}

function onCheckboxClick(e: MouseEvent) {
  emit("toggle-select", { shift: e.shiftKey });
}

// Click anywhere on the row selects it (opens the detail panel), except clicks that
// land on an interactive control — those keep doing their own thing (edit a value,
// toggle the checkbox, open the menu, translate, change state…).
function onRowClick(e: MouseEvent) {
  if ((e.target as HTMLElement | null)?.closest('button, input, textarea, select, a, [contenteditable="true"]')) return;
  emit("select");
}

async function toggleSkip() {
  const next = !props.entry.skipTranslate;
  busy.value = true;
  try {
    await bulkMeta([props.keyName], { skipTranslate: next });
    toast.success(next ? "Excluded from translation" : "Included in translation");
    emit("changed");
  } catch (e) {
    toast.error(`Update failed: ${(e as Error).message}`);
  } finally {
    busy.value = false;
  }
}

function openRename() {
  renameDraft.value = props.keyName;
  renaming.value = true;
}

async function doRename() {
  const to = renameDraft.value.trim();
  if (!to || to === props.keyName) {
    renaming.value = false;
    return;
  }
  busy.value = true;
  try {
    await patchKey(props.keyName, { rename: to });
    renaming.value = false;
    toast.success(`Renamed to ${to}`);
    emit("renamed", to);
  } catch (e) {
    toast.error(`Rename failed: ${(e as Error).message}`);
  } finally {
    busy.value = false;
  }
}

async function doDelete() {
  busy.value = true;
  try {
    await deleteKey(props.keyName);
    confirmingDelete.value = false;
    toast.success(`Deleted ${props.keyName}`);
    emit("changed");
  } catch (e) {
    toast.error(`Delete failed: ${(e as Error).message}`);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div
    :class="cn(
      'relative flex border-b-2 border-border bg-card',
      selected && 'z-[1]',
    )"
    role="button"
    :aria-pressed="selected"
    aria-label="Select key"
    @click="onRowClick"
  >
    <!-- Continuous selection border, drawn above row content so child backgrounds can't break it up. -->
    <span v-if="selected" class="pointer-events-none absolute inset-0 z-[3] border-2 border-primary" aria-hidden="true" />
    <!-- Primary accent bar on the leading edge, above the border. -->
    <span v-if="selected" class="pointer-events-none absolute inset-y-0 left-0 z-[4] w-1 bg-primary" aria-hidden="true" />

    <!-- LEFT IDENTITY / ACTION COLUMN — narrow, stable width. -->
    <div
      :class="cn(
        'relative w-[var(--key-col-width,272px)] shrink-0 border-r border-border-soft p-[14px_16px_14px_18px]',
        selected && 'bg-primary-soft/60',
      )"
    >
      <div class="sticky top-3">
        <!-- Bulk-select checkbox — lives in the floating header so it sticks with the key as tall rows scroll. -->
        <button
          type="button"
          role="checkbox"
          :aria-checked="!!checked"
          data-testid="row-select"
          class="absolute left-0 top-0.5 flex size-4 items-center justify-center rounded border transition-colors"
          :class="checked ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground hover:border-primary hover:bg-primary/10'"
          aria-label="Select key"
          @click.stop="onCheckboxClick"
        >
          <Check v-if="checked" class="size-3" />
        </button>

        <!-- Overflow menu, top-right of the floating header (moved here so it sticks with the content). -->
        <div class="absolute right-0 top-0">
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <button
                type="button"
                class="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Key actions"
                :disabled="translatingMissing"
                @click.stop
              >
                <MoreVertical class="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                v-if="missingLocales.length > 0"
                :disabled="translatingMissing"
                @select="translateMissing"
              >
                <Sparkles class="size-4" /> Translate missing ({{ missingLocales.length }})
              </DropdownMenuItem>
              <DropdownMenuItem @select="openRename">
                <Pencil class="size-4" /> Rename
              </DropdownMenuItem>
              <DropdownMenuItem data-testid="toggle-skip" :disabled="busy" @select="toggleSkip">
                <Languages class="size-4" /> {{ entry.skipTranslate ? "Include in translation" : "Skip translation" }}
              </DropdownMenuItem>
              <DropdownMenuItem class="text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive" @select="confirmingDelete = true">
                <Trash2 class="size-4" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div
          class="break-words pl-6 pr-7 font-mono text-[13.5px] font-semibold tracking-tight cursor-pointer"
          @click.stop="onCheckboxClick($event)"
        ><span v-html="keyNameHtml" /><ImageIcon v-if="entry.screenshot" class="ml-1.5 inline size-3.5 align-[-2px] text-muted-foreground" aria-label="Has screenshot" /></div>

        <div
          v-if="entry.plural || entry.skipTranslate || (issues?.length ?? 0) > 0"
          class="mt-1.5 flex flex-wrap items-center gap-1.5 pl-6"
        >
          <span
            v-if="entry.plural"
            class="inline-flex items-center gap-1 rounded-md border border-primary-border bg-primary/[0.09] px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide text-primary"
            >PLURAL<span class="font-medium normal-case text-muted-foreground">· {{ entry.plural.arg }}</span></span
          >
          <Tooltip v-if="entry.skipTranslate">
            <TooltipTrigger as-child>
              <span
                data-testid="skip-badge"
                class="inline-flex items-center gap-1 rounded-md border border-warning-border bg-warning-bg px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide text-warning"
                >SKIP</span
              >
            </TooltipTrigger>
            <TooltipContent>Excluded from translation</TooltipContent>
          </Tooltip>
          <Tooltip v-if="(issues?.length ?? 0) > 0">
            <TooltipTrigger as-child>
              <span
                data-testid="issue-badge"
                class="inline-flex items-center gap-1 rounded-md bg-destructive-soft px-1.5 py-0.5 text-[11.5px] font-bold text-destructive"
              >
                <AlertTriangle class="size-3" />{{ issues!.length }}
              </span>
            </TooltipTrigger>
            <TooltipContent>{{ issues!.length }} issue{{ issues!.length === 1 ? "" : "s" }}</TooltipContent>
          </Tooltip>
        </div>

        <div v-if="(entry.tags ?? []).length" class="mt-2 flex flex-wrap gap-1.5 pl-6">
          <Tooltip v-for="t in entry.tags" :key="t">
            <TooltipTrigger as-child>
              <button
                type="button"
                class="inline-flex h-[22px] items-center gap-1.5 rounded-full border border-primary-border bg-transparent px-[9px] text-xs font-medium text-foreground transition-colors hover:border-primary hover:bg-primary/[0.07]"
                @click.stop="emit('filter-tag', t)"
              >
                <Tag class="size-3 text-primary" />{{ t }}
              </button>
            </TooltipTrigger>
            <TooltipContent>Filter by tag: {{ t }}</TooltipContent>
          </Tooltip>
        </div>

        <!-- Inline Translate-missing; doubles as the in-flight indicator (testid flips). -->
        <Tooltip v-if="missingLocales.length > 0">
          <TooltipTrigger as-child>
            <button
              type="button"
              :data-testid="translatingMissing ? 'translating-missing' : 'translate-missing-btn'"
              :disabled="translatingMissing"
              class="ml-6 mt-2.5 inline-flex items-center gap-1.5 rounded-lg border border-primary-border bg-primary-soft px-2.5 py-1.5 text-[11.5px] font-semibold text-primary transition hover:brightness-95 disabled:opacity-80"
              @click.stop="translateMissing"
            >
              <LoaderCircle v-if="translatingMissing" class="size-3 animate-spin" />
              <Sparkles v-else class="size-3" />
              {{ translatingMissing ? "Translating…" : `Translate ${missingLocales.length} missing` }}
            </button>
          </TooltipTrigger>
          <TooltipContent>Translate the {{ missingLocales.length }} missing language{{ missingLocales.length > 1 ? "s" : "" }} for this key</TooltipContent>
        </Tooltip>
        <!-- In-flight feedback when nothing is "missing" by the prop's measure. -->
        <span
          v-else-if="translatingMissing"
          data-testid="translating-missing"
          class="ml-6 mt-2.5 inline-flex items-center gap-1 text-[11px] text-primary"
        >
          <LoaderCircle class="size-3 animate-spin" /> Translating…
        </span>

        <!-- Re-translate stale: shown when the source changed and targets need re-review. -->
        <Tooltip v-if="staleLocales.length > 0">
          <TooltipTrigger as-child>
            <button
              type="button"
              data-testid="retranslate-stale-btn"
              :disabled="retranslatingStale"
              class="ml-6 mt-2.5 inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11.5px] font-semibold text-amber-700 transition hover:brightness-95 disabled:opacity-80 dark:text-amber-300"
              @click.stop="retranslateStale"
            >
              <LoaderCircle v-if="retranslatingStale" class="size-3 animate-spin" />
              <RefreshCw v-else class="size-3" />
              {{ retranslatingStale ? "Re-translating…" : `Re-translate ${staleLocales.length} stale` }}
            </button>
          </TooltipTrigger>
          <TooltipContent>Re-translate the {{ staleLocales.length }} stale language{{ staleLocales.length > 1 ? "s" : "" }} for this key</TooltipContent>
        </Tooltip>
      </div>
    </div>

    <!-- PER-LANGUAGE ROWS — zebra by language row, confined to the value stack. -->
    <div class="min-w-0 flex-1 [&>*:nth-child(even)]:bg-zebra">
      <TranslationRow
        v-for="loc in locales"
        :key="loc"
        :key-name="keyName"
        :locale="loc"
        :source-locale="sourceLocale"
        :value="entry.values[loc]"
        :max-length="entry.maxLength"
        :issues="issuesByLocale.get(loc) ?? []"
        :plural="entry.plural"
        :source-forms="entry.values[sourceLocale]?.forms"
        :filling="(translatingMissing && missingLocales.includes(loc)) || (retranslatingStale && staleLocales.includes(loc))"
        @changed="emit('changed')"
        @edit-start="emit('select')"
      />
    </div>

    <Dialog v-model:open="renaming">
      <DialogContent class="max-w-md">
        <DialogHeader>
          <DialogTitle>Rename key</DialogTitle>
          <DialogDescription>Use dot notation, e.g. <span class="font-mono">home.title</span>.</DialogDescription>
        </DialogHeader>
        <div class="grid gap-2">
          <Label for="rename-key">New key</Label>
          <Input id="rename-key" v-model="renameDraft" class="font-mono" @keydown.enter.prevent="doRename" />
        </div>
        <DialogFooter>
          <Button variant="outline" :disabled="busy" @click="renaming = false">Cancel</Button>
          <Button :disabled="busy" @click="doRename">Rename</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="confirmingDelete">
      <DialogContent class="max-w-md">
        <DialogHeader>
          <DialogTitle>Delete key</DialogTitle>
          <DialogDescription>
            Delete <code class="break-all rounded bg-muted px-1 py-0.5 font-mono text-sm">{{ keyName }}</code> and all its translations? This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" :disabled="busy" @click="confirmingDelete = false">Cancel</Button>
          <Button variant="destructive" :disabled="busy" @click="doDelete">Delete</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
