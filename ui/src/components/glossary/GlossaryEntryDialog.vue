<script setup lang="ts">
import { reactive, ref, watch } from "vue";
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
  // Target locales (config.locales minus sourceLocale) to offer forced translations for.
  targetLocales: string[];
}>();
const open = defineModel<boolean>("open", { required: true });
const emit = defineEmits<{ (e: "saved"): void }>();

const form = reactive({
  term: "",
  doNotTranslate: false,
  caseSensitive: false,
  // Whole-word matching is the default; a term is a word, not a substring.
  wholeWord: true,
  notes: "",
  translations: {} as Record<string, string>,
});

const saving = ref(false);
const error = ref("");

const isEditing = ref(false);

// Reset the form from the incoming entry whenever the dialog opens.
watch(
  open,
  (isOpen) => {
    if (!isOpen) return;
    const e = props.entry ?? props.prefill ?? null;
    isEditing.value = props.entry !== null;
    form.term = e?.term ?? "";
    form.doNotTranslate = e?.doNotTranslate ?? false;
    form.caseSensitive = e?.caseSensitive ?? false;
    form.wholeWord = e?.wholeWord ?? true;
    form.notes = e?.notes ?? "";
    form.translations = {};
    for (const loc of props.targetLocales) {
      form.translations[loc] = e?.translations?.[loc] ?? "";
    }
    error.value = "";
  },
  { immediate: true },
);

async function submit() {
  const term = form.term.trim();
  if (!term) {
    error.value = "Term is required.";
    return;
  }

  const translations: Record<string, string> = {};
  for (const [loc, value] of Object.entries(form.translations)) {
    const trimmed = value.trim();
    if (trimmed) translations[loc] = trimmed;
  }

  const entry: GlossaryEntry = { term };
  if (form.doNotTranslate) entry.doNotTranslate = true;
  if (form.caseSensitive) entry.caseSensitive = true;
  // Whole-word is the default, so only the opt-out needs persisting.
  if (!form.wholeWord) entry.wholeWord = false;
  if (form.notes.trim()) entry.notes = form.notes.trim();
  if (Object.keys(translations).length > 0) entry.translations = translations;

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
          Guide AI translations with do-not-translate terms and forced translations.
        </DialogDescription>
      </DialogHeader>

      <div class="grid gap-4">
        <div class="grid gap-1.5">
          <Label for="glossary-term">Term</Label>
          <Input
            id="glossary-term"
            v-model="form.term"
            class="font-mono"
            placeholder="Sign in"
            :disabled="isEditing"
            @keydown.enter.prevent="submit"
          />
          <p v-if="isEditing" class="text-xs text-muted-foreground">
            The term is the entry's identity and can't be changed.
          </p>
        </div>

        <div class="flex items-center justify-between">
          <div>
            <Label for="glossary-dnt">Do not translate</Label>
            <p class="text-xs text-muted-foreground">Keep this term verbatim in every language.</p>
          </div>
          <Switch id="glossary-dnt" v-model="form.doNotTranslate" />
        </div>

        <div class="flex items-center justify-between">
          <div>
            <Label for="glossary-cs">Case sensitive</Label>
            <p class="text-xs text-muted-foreground">Only match the exact casing.</p>
          </div>
          <Switch id="glossary-cs" v-model="form.caseSensitive" />
        </div>

        <div class="flex items-center justify-between">
          <div>
            <Label for="glossary-ww">Whole word</Label>
            <p class="text-xs text-muted-foreground">
              Apply this term only as a standalone word (e.g. "Pro" won't match "Process"). Turn off
              to also match inside larger words.
            </p>
          </div>
          <Switch id="glossary-ww" v-model="form.wholeWord" />
        </div>

        <div class="grid gap-1.5">
          <Label for="glossary-notes">Notes</Label>
          <Textarea
            id="glossary-notes"
            v-model="form.notes"
            rows="5"
            class="min-h-24 resize-y"
            placeholder="Optional guidance for translators."
          />
        </div>

        <div v-if="targetLocales.length > 0" class="grid gap-2 border-t pt-3">
          <p class="text-sm font-medium">Forced translations</p>
          <div v-for="loc in targetLocales" :key="loc" class="grid gap-1.5">
            <Label :for="`glossary-tr-${loc}`" class="text-xs text-muted-foreground">
              <LanguageLabel :code="loc" show-name :show-code="false" :size="12" />
            </Label>
            <Input
              :id="`glossary-tr-${loc}`"
              v-model="form.translations[loc]"
              :placeholder="`Forced translation for ${loc}`"
            />
          </div>
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
