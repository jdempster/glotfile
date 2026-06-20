<script setup lang="ts">
import { reactive, ref, computed, watch } from "vue";
import { X } from "lucide-vue-next";
import { putGlossaryEntry } from "@/api.js";
import { toast } from "@/components/ui/toast";
import type { GlossaryEntry } from "@/types.js";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import LanguageLabel from "@/components/lang/LanguageLabel.vue";

const props = defineProps<{
  // The entry being edited, or null when adding a new term.
  entry: GlossaryEntry | null;
  // Prefill the form for a NEW entry, e.g. accepting an AI suggestion; unlike `entry`, stays in ADD mode.
  prefill?: GlossaryEntry | null;
  // Target locales (config.locales minus sourceLocale) available to pin translations for.
  targetLocales: string[];
}>();
const open = defineModel<boolean>("open", { required: true });
const emit = defineEmits<{ (e: "saved"): void }>();

const form = reactive({
  term: "",
  aliases: [] as string[],
  doNotTranslate: false,
  caseSensitive: false,
  notes: "",
  // Only locales the user has chosen to pin appear here — not every target.
  translations: {} as Record<string, string>,
});

const aliasDraft = ref("");
const pinPicker = ref("");
const saving = ref(false);
const error = ref("");
const isEditing = ref(false);

// Target locales not yet pinned — offered in the "pin a translation" picker.
const unpinnedLocales = computed(() =>
  props.targetLocales.filter((l) => !(l in form.translations)),
);
const pinnedLocales = computed(() =>
  props.targetLocales.filter((l) => l in form.translations),
);

// Reset the form from the incoming entry whenever the dialog opens.
watch(
  open,
  (isOpen) => {
    if (!isOpen) return;
    const e = props.entry ?? props.prefill ?? null;
    isEditing.value = props.entry !== null;
    form.term = e?.term ?? "";
    form.aliases = [...(e?.aliases ?? [])];
    form.doNotTranslate = e?.doNotTranslate ?? false;
    form.caseSensitive = e?.caseSensitive ?? false;
    form.notes = e?.notes ?? "";
    form.translations = {};
    for (const [loc, value] of Object.entries(e?.translations ?? {})) {
      if (props.targetLocales.includes(loc)) form.translations[loc] = value;
    }
    aliasDraft.value = "";
    pinPicker.value = "";
    error.value = "";
  },
  { immediate: true },
);

function commitAlias() {
  for (const part of aliasDraft.value.split(",")) {
    const a = part.trim();
    if (a && a !== form.term && !form.aliases.includes(a)) form.aliases.push(a);
  }
  aliasDraft.value = "";
}

function removeAlias(a: string) {
  form.aliases = form.aliases.filter((x) => x !== a);
}

function aliasBackspace() {
  if (aliasDraft.value === "" && form.aliases.length) form.aliases.pop();
}

function pinLocale(loc: string) {
  if (!loc) return;
  form.translations[loc] = "";
  pinPicker.value = "";
}

function unpinLocale(loc: string) {
  delete form.translations[loc];
}

async function submit() {
  commitAlias();
  const term = form.term.trim();
  if (!term) {
    error.value = "Term is required.";
    return;
  }

  const entry: GlossaryEntry = { term };
  const aliases = form.aliases.map((a) => a.trim()).filter((a) => a && a !== term);
  if (aliases.length) entry.aliases = aliases;
  if (form.doNotTranslate) entry.doNotTranslate = true;
  if (form.caseSensitive) entry.caseSensitive = true;
  if (form.notes.trim()) entry.notes = form.notes.trim();
  // Do-not-translate terms never carry pinned translations.
  if (!form.doNotTranslate) {
    const translations: Record<string, string> = {};
    for (const [loc, value] of Object.entries(form.translations)) {
      const trimmed = value.trim();
      if (trimmed) translations[loc] = trimmed;
    }
    if (Object.keys(translations).length > 0) entry.translations = translations;
  }

  saving.value = true;
  error.value = "";
  try {
    await putGlossaryEntry(entry);
    toast.success(isEditing.value ? `Updated ${term}` : `Added ${term}`);
    open.value = false;
    emit("saved");
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="max-h-[85vh] max-w-lg overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{{ isEditing ? "Edit term" : "Add term" }}</DialogTitle>
        <DialogDescription>
          Teach the AI a term so it translates the same way across every key.
        </DialogDescription>
      </DialogHeader>

      <div class="grid gap-5">
        <div class="grid gap-1.5">
          <Label for="glossary-term">Term</Label>
          <Input
            id="glossary-term"
            v-model="form.term"
            class="font-mono"
            placeholder="feed"
            :disabled="isEditing"
            @keydown.enter.prevent="submit"
          />
          <p v-if="isEditing" class="text-xs text-muted-foreground">
            The term is the entry's identity and can't be changed.
          </p>
        </div>

        <div class="flex items-center justify-between gap-4 rounded-lg border p-3">
          <div>
            <Label for="glossary-dnt">Don't translate</Label>
            <p class="text-xs text-muted-foreground">Keep this term verbatim in every language — brand and product names.</p>
          </div>
          <Switch id="glossary-dnt" v-model="form.doNotTranslate" />
        </div>

        <div class="flex items-center justify-between gap-4 rounded-lg border p-3">
          <div>
            <Label for="glossary-case-sensitive">Case-sensitive</Label>
            <p class="text-xs text-muted-foreground">Match only the exact spelling — for a product name that's also a common word, like <span class="font-mono">Sprout</span> vs <span class="font-mono">sprout</span>.</p>
          </div>
          <Switch id="glossary-case-sensitive" v-model="form.caseSensitive" />
        </div>

        <div class="grid gap-1.5">
          <Label for="glossary-notes">Meaning &amp; usage</Label>
          <Textarea
            id="glossary-notes"
            v-model="form.notes"
            rows="3"
            class="min-h-20 resize-y"
            placeholder="What does this term mean? e.g. “feed = give a plant fertilizer, never a social-media feed.”"
          />
          <p class="text-xs text-muted-foreground">
            The single biggest quality lever — it tells the AI which sense of a word you mean.
          </p>
        </div>

        <div class="grid gap-1.5">
          <Label for="glossary-aliases">Also matches</Label>
          <div
            class="flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-2 py-1.5 text-sm focus-within:ring-1 focus-within:ring-ring"
          >
            <span
              v-for="a in form.aliases"
              :key="a"
              class="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-xs"
            >
              {{ a }}
              <button type="button" class="text-muted-foreground hover:text-foreground" :aria-label="`Remove ${a}`" @click="removeAlias(a)">
                <X class="size-3" />
              </button>
            </span>
            <input
              id="glossary-aliases"
              v-model="aliasDraft"
              class="min-w-24 flex-1 bg-transparent font-mono outline-none placeholder:text-muted-foreground"
              :placeholder="form.aliases.length ? '' : 'feeding, feeds, fed'"
              @keydown.enter.prevent="commitAlias"
              @keydown="(e: KeyboardEvent) => { if (e.key === ',') { e.preventDefault(); commitAlias(); } }"
              @keydown.backspace="aliasBackspace"
              @blur="commitAlias"
            />
          </div>
          <p class="text-xs text-muted-foreground">
            Other forms of the same word — inflections and plurals. Matching is whole-word, so add the variants you want governed too.
          </p>
        </div>

        <div v-if="!form.doNotTranslate" class="grid gap-2 border-t pt-4">
          <div>
            <p class="text-sm font-medium">Pinned translations</p>
            <p class="text-xs text-muted-foreground">
              Optional. Lingo can fill these for you — pin one to force exact wording in a language.
            </p>
          </div>

          <div v-for="loc in pinnedLocales" :key="loc" class="grid gap-1.5">
            <div class="flex items-center justify-between">
              <Label :for="`glossary-tr-${loc}`" class="text-xs text-muted-foreground">
                <LanguageLabel :code="loc" show-name :show-code="false" :size="12" />
              </Label>
              <button
                type="button"
                class="text-muted-foreground hover:text-destructive"
                :aria-label="`Unpin ${loc}`"
                @click="unpinLocale(loc)"
              >
                <X class="size-3.5" />
              </button>
            </div>
            <Input :id="`glossary-tr-${loc}`" v-model="form.translations[loc]" :placeholder="`Exact ${loc} translation`" />
          </div>

          <select
            v-if="unpinnedLocales.length"
            v-model="pinPicker"
            class="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm text-muted-foreground"
            aria-label="Pin a translation for a language"
            @change="pinLocale(pinPicker)"
          >
            <option value="">+ Pin a translation…</option>
            <option v-for="loc in unpinnedLocales" :key="loc" :value="loc">{{ loc }}</option>
          </select>
        </div>

        <p v-if="error" class="text-sm text-destructive">{{ error }}</p>
      </div>

      <DialogFooter>
        <Button variant="outline" :disabled="saving" @click="open = false">Cancel</Button>
        <Button :disabled="saving" @click="submit">{{ isEditing ? "Save" : "Add term" }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
