<script setup lang="ts">
import { ref, computed } from "vue";
import { Plus, Pencil, Trash2, Search, X, Sparkles } from "lucide-vue-next";
import { getGlossary, fetchState, deleteGlossaryEntry, getGlossarySuggestions, dismissGlossarySuggestion as apiDismiss, removeGlossarySuggestion } from "@/api.js";
import { onExternalChange } from "@/liveReload";
import { toast } from "@/components/ui/toast";
import type { GlossaryEntry, GlossarySuggestion } from "@/types.js";
import { filterGlossary } from "@/glossaryFilter.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import GlossaryEntryDialog from "./GlossaryEntryDialog.vue";
import GlossarySuggestDialog from "./GlossarySuggestDialog.vue";
import BatchBanner from "@/components/editor/BatchBanner.vue";

const entries = ref<GlossaryEntry[]>([]);
const sourceLocale = ref("");
const locales = ref<string[]>([]);
const loaded = ref(false);

const dialogOpen = ref(false);
const editing = ref<GlossaryEntry | null>(null);

const deleting = ref<GlossaryEntry | null>(null);
const busy = ref(false);

const search = ref("");
const filteredEntries = computed(() => filterGlossary(entries.value, search.value));

const targetLocales = computed(() => locales.value.filter((l) => l !== sourceLocale.value));

const suggestBanner = ref<InstanceType<typeof BatchBanner> | null>(null);

const suggestions = ref<GlossarySuggestion[]>([]);
const suggestOpen = ref(false);
const prefill = ref<GlossaryEntry | null>(null);
const acceptingTerm = ref<string | null>(null);

async function reloadSuggestions() { suggestions.value = await getGlossarySuggestions(); }

async function reload() {
  const [glossary, state] = await Promise.all([getGlossary(), fetchState()]);
  entries.value = glossary;
  sourceLocale.value = state.config.sourceLocale;
  locales.value = state.config.locales;
  loaded.value = true;
}
reload();
reloadSuggestions();
// Refresh when the catalog changes on disk out of band (the glossary lives in the
// state file too).
onExternalChange(() => { void reload(); void reloadSuggestions(); });

function add() {
  editing.value = null;
  prefill.value = null;
  acceptingTerm.value = null;
  dialogOpen.value = true;
}

function edit(entry: GlossaryEntry) {
  editing.value = entry;
  prefill.value = null;
  acceptingTerm.value = null;
  dialogOpen.value = true;
}

function acceptSuggestion(s: GlossarySuggestion) {
  acceptingTerm.value = s.term;
  editing.value = null;
  prefill.value = { term: s.term, doNotTranslate: s.doNotTranslate, caseSensitive: s.caseSensitive, wholeWord: s.wholeWord, notes: s.note };
  dialogOpen.value = true;
}

async function dismissSuggestion(s: GlossarySuggestion) { await apiDismiss(s.term); await reloadSuggestions(); }

async function onDialogSaved() {
  if (acceptingTerm.value) { await removeGlossarySuggestion(acceptingTerm.value); acceptingTerm.value = null; }
  await Promise.all([reload(), reloadSuggestions()]);
}

// Forced translations as `loc: value` chips for the row.
function translationChips(entry: GlossaryEntry): string[] {
  return Object.entries(entry.translations ?? {}).map(([loc, value]) => `${loc}: ${value}`);
}

async function confirmDelete() {
  const entry = deleting.value;
  if (!entry) return;
  busy.value = true;
  try {
    await deleteGlossaryEntry(entry.term);
    toast.success(`Deleted ${entry.term}`);
    deleting.value = null;
    await reload();
  } catch (e) {
    toast.error(`Delete failed: ${(e as Error).message}`);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="min-h-0 flex-1 overflow-y-auto">
    <div v-if="!loaded" class="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
      Loading glossary…
    </div>

    <div v-else class="mx-auto flex max-w-3xl flex-col gap-4 p-6">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-base font-semibold">Glossary</h2>
          <p class="text-sm text-muted-foreground">Do-not-translate terms and forced translations.</p>
        </div>
        <div class="flex items-center gap-2">
          <Button variant="outline" @click="suggestOpen = true">
            <Sparkles class="size-4" /> Suggest terms with AI
          </Button>
          <Button @click="add">
            <Plus class="size-4" /> Add term
          </Button>
        </div>
      </div>

      <div class="relative">
        <Search class="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          v-model="search"
          placeholder="Search terms, notes, translations…"
          class="h-8 w-full pl-8 pr-8"
          @keydown.esc="search = ''"
        />
        <button
          v-if="search"
          class="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          aria-label="Clear search"
          @click="search = ''"
        >
          <X class="size-4" />
        </button>
      </div>

      <BatchBanner ref="suggestBanner" kind="glossary-suggest" @changed="reloadSuggestions" />

      <div v-if="suggestions.length" class="flex flex-col gap-2">
        <p class="text-sm font-medium">AI term suggestions</p>
        <ul class="flex flex-col gap-2">
          <li
            v-for="s in suggestions"
            :key="s.term"
            class="flex items-start gap-3 rounded-lg border bg-card p-3 text-card-foreground shadow-sm"
          >
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-mono text-sm font-medium">{{ s.term }}</span>
                <Badge v-if="s.doNotTranslate" variant="secondary">Do-not-translate</Badge>
                <Badge v-if="s.caseSensitive" variant="outline">Case-sensitive</Badge>
                <Badge v-if="s.wholeWord === false" variant="outline">Substring</Badge>
              </div>
              <p v-if="s.note" class="mt-1 text-sm text-muted-foreground">{{ s.note }}</p>
              <p v-if="typeof s.occurrences === 'number'" class="mt-1 text-xs text-muted-foreground">
                used in {{ s.occurrences }} key{{ s.occurrences === 1 ? '' : 's' }}
              </p>
            </div>
            <div class="flex shrink-0 items-center gap-1">
              <Button size="sm" :aria-label="`Accept ${s.term}`" @click="acceptSuggestion(s)">Accept</Button>
              <Button variant="ghost" size="sm" :aria-label="`Dismiss ${s.term}`" @click="dismissSuggestion(s)">Dismiss</Button>
            </div>
          </li>
        </ul>
      </div>

      <div
        v-if="entries.length === 0"
        class="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground"
      >
        No glossary terms yet — add do-not-translate terms and forced translations to guide AI.
      </div>

      <div
        v-else-if="filteredEntries.length === 0"
        class="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground"
      >
        No terms match your search.
      </div>

      <ul v-else class="flex flex-col gap-2">
        <li
          v-for="entry in filteredEntries"
          :key="entry.term"
          class="flex items-start gap-3 rounded-lg border bg-card p-3 text-card-foreground shadow-sm"
        >
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-mono text-sm font-medium">{{ entry.term }}</span>
              <Badge v-if="entry.doNotTranslate" variant="secondary">Do-not-translate</Badge>
              <Badge v-if="entry.caseSensitive" variant="outline">Case-sensitive</Badge>
              <Badge v-if="entry.wholeWord === false" variant="outline">Substring</Badge>
            </div>
            <p v-if="entry.notes" class="mt-1 text-sm text-muted-foreground">{{ entry.notes }}</p>
            <div v-if="translationChips(entry).length" class="mt-2 flex flex-wrap gap-1.5">
              <span
                v-for="chip in translationChips(entry)"
                :key="chip"
                class="inline-flex items-center rounded-md border bg-background px-2 py-0.5 font-mono text-xs"
              >
                {{ chip }}
              </span>
            </div>
          </div>

          <div class="flex shrink-0 items-center gap-1">
            <Button variant="ghost" size="icon" :aria-label="`Edit ${entry.term}`" @click="edit(entry)">
              <Pencil class="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              class="text-muted-foreground hover:text-destructive"
              :aria-label="`Delete ${entry.term}`"
              @click="deleting = entry"
            >
              <Trash2 class="size-4" />
            </Button>
          </div>
        </li>
      </ul>
    </div>

    <GlossaryEntryDialog
      v-model:open="dialogOpen"
      :entry="editing"
      :prefill="prefill"
      :target-locales="targetLocales"
      @saved="onDialogSaved"
    />

    <GlossarySuggestDialog v-model:open="suggestOpen" @found="reloadSuggestions" @batch-submitted="suggestBanner?.refresh()" />

    <Dialog :open="deleting !== null" @update:open="(v) => { if (!v) deleting = null; }">
      <DialogContent class="max-w-md">
        <DialogHeader>
          <DialogTitle>Delete term</DialogTitle>
          <DialogDescription>
            Delete <span class="font-mono">{{ deleting?.term }}</span> from the glossary? This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" :disabled="busy" @click="deleting = null">Cancel</Button>
          <Button variant="destructive" :disabled="busy" @click="confirmDelete">Delete</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
