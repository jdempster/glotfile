<script setup lang="ts">
import { ref, computed } from "vue";
import { Languages, Loader2, Eraser, AlertTriangle, Plus } from "lucide-vue-next";
import type { Issue, LocaleState, LocaleValue, PluralCategory } from "@/types.js";
import { setState, translate, clearValue, addToDictionary } from "@/api.js";
import { isRtl } from "@/languages.js";
import { toast } from "@/components/ui/toast";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import StateBadge from "./StateBadge.vue";
import ValueEditor from "./ValueEditor.vue";
import PluralValueEditor from "./PluralValueEditor.vue";
import LanguageLabel from "@/components/lang/LanguageLabel.vue";
import { cn } from "@/lib/utils";

const props = defineProps<{
  keyName: string;
  locale: string;
  sourceLocale: string;
  value: LocaleValue | undefined;
  maxLength?: number;
  issues?: Issue[];
  // Longest locale-code length in view (inline-label era — retained for compatibility).
  labelChars?: number;
  // Presence marks the key as plural; arg is the count token name.
  plural?: { arg: string };
  // The source locale's forms (passed through; reference is the visible source row).
  sourceForms?: Partial<Record<PluralCategory, string>>;
  // True while a key-level "translate missing" call is filling this empty cell.
  filling?: boolean;
}>();

const emit = defineEmits<{ (e: "changed"): void; (e: "edit-start"): void }>();

const isSource = computed(() => props.locale === props.sourceLocale);
const state = computed<LocaleState>(() => props.value?.state ?? (isSource.value ? "source" : "needs-review"));
const text = computed(() => props.value?.value ?? "");
const isPlural = computed(() => Boolean(props.plural));
const forms = computed(() => props.value?.forms ?? {});
const rtl = computed(() => isRtl(props.locale));

// Clear shows only on target cells that hold a value (scalar text or any plural form).
const canClear = computed(() =>
  !isSource.value &&
  (isPlural.value ? Object.keys(forms.value).length > 0 : Boolean(props.value?.value)),
);

const hasIssues = computed(() => (props.issues?.length ?? 0) > 0);

// Distinct misspelled words across this cell's spelling issues — offered for the dictionary.
const spellWords = computed(() => [
  ...new Set((props.issues ?? []).filter((i) => i.check === "spelling").flatMap((i) => i.detail ?? [])),
]);

async function addWord(word: string) {
  try {
    await addToDictionary(word);
    toast.success(`Added "${word}" to the dictionary`);
    emit("changed");
  } catch (e) {
    toast.error(`Could not add word: ${(e as Error).message}`);
  }
}

const translating = ref(false);

async function clearCell() {
  try {
    await clearValue(props.keyName, props.locale);
    toast.success("Cleared");
    emit("changed");
  } catch (e) {
    toast.error((e as Error).message);
  }
}

async function changeState(next: LocaleState) {
  try {
    await setState(props.keyName, props.locale, next);
    emit("changed");
  } catch (e) {
    toast.error(`Could not update state: ${(e as Error).message}`);
  }
}

async function translateCell() {
  translating.value = true;
  try {
    // Explicit per-cell translate overwrites whatever is there, even a reviewed value.
    const res = await translate({
      onlyMissing: false,
      locales: [props.locale],
      keyGlob: props.keyName,
      force: true,
    });
    if (res.errors?.length) {
      toast.error(res.errors[0]?.error ?? "Translation failed");
    } else {
      toast.success(`Translated ${props.locale.toUpperCase()} (${res.written} written)`);
    }
    emit("changed");
  } catch (e) {
    toast.error(`Translate failed: ${(e as Error).message}`);
  } finally {
    translating.value = false;
  }
}
</script>

<template>
  <div
    :class="cn(
      'grid grid-cols-[172px_minmax(0,1fr)_232px] items-start gap-[18px] border-b border-border-soft py-[11px] pl-4 pr-[18px] last:border-b-0 max-[1080px]:grid-cols-[150px_minmax(0,1fr)_200px] max-[1080px]:gap-3',
      isSource && 'bg-foreground/[0.015] dark:bg-foreground/[0.025]',
    )"
    :data-state="state"
  >
    <!-- Column 1 — language identity -->
    <div class="flex flex-wrap items-start gap-2 pt-0.5">
      <LanguageLabel :code="locale" layout="stacked" show-name :size="15" />
      <span
        v-if="isSource"
        class="rounded-md border border-border-soft bg-accent px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground"
        >Source</span
      >
    </div>

    <!-- Column 2 — value body (dir flips for RTL locales) -->
    <div class="flex min-w-0 flex-col gap-2" :dir="rtl ? 'rtl' : 'ltr'">
      <div
        v-if="filling"
        data-testid="filling-hint"
        class="flex items-center gap-1.5 text-sm italic text-muted-foreground"
      >
        <Loader2 class="size-3.5 shrink-0 animate-spin" /> filling…
      </div>
      <PluralValueEditor
        v-else-if="isPlural"
        :key-name="keyName"
        :locale="locale"
        :source-locale="sourceLocale"
        :arg="plural!.arg"
        :forms="forms"
        :source-forms="sourceForms"
        :max-length="maxLength"
        @changed="emit('changed')"
        @edit-start="emit('edit-start')"
      />
      <ValueEditor
        v-else
        :key-name="keyName"
        :locale="locale"
        :source-locale="sourceLocale"
        :value="text"
        :max-length="maxLength"
        @changed="emit('changed')"
        @edit-start="emit('edit-start')"
      />
    </div>

    <!-- Column 3 — right rail (target cells only) -->
    <div v-if="!isSource" class="flex items-center justify-end gap-1.5 pt-0.5">
      <Popover v-if="hasIssues">
        <PopoverTrigger as-child>
          <button
            type="button"
            class="flex size-7 items-center justify-center rounded-md bg-destructive-soft text-destructive transition hover:brightness-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Show issues"
          >
            <AlertTriangle class="size-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" class="w-fit max-w-xs text-xs">
          <ul class="flex flex-col gap-1">
            <li v-for="(issue, i) in issues" :key="i" class="whitespace-pre-line text-foreground/80">{{ issue.message }}</li>
          </ul>
          <div v-if="spellWords.length" class="mt-2 border-t pt-2">
            <p class="mb-1 text-[11px] font-medium text-muted-foreground">Add to dictionary</p>
            <div class="flex flex-wrap gap-1">
              <Tooltip v-for="word in spellWords" :key="word">
                <TooltipTrigger as-child>
                  <button
                    type="button"
                    class="inline-flex items-center gap-0.5 rounded border border-amber-500/40 px-1.5 py-0.5 text-[11px] text-amber-700 transition-colors hover:bg-amber-500/10 dark:text-amber-300"
                    @click="addWord(word)"
                  >
                    <Plus class="size-3" />{{ word }}
                  </button>
                </TooltipTrigger>
                <TooltipContent>Add '{{ word }}' to the custom dictionary</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </PopoverContent>
      </Popover>

      <Tooltip v-if="canClear">
        <TooltipTrigger as-child>
          <button
            type="button"
            class="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Clear translation"
            @click.stop="clearCell"
          >
            <Eraser class="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Clear translation</TooltipContent>
      </Tooltip>

      <!-- AI translate: present on every target row (uniform position) -->
      <Tooltip>
        <TooltipTrigger as-child>
          <button
            type="button"
            class="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-primary-soft hover:text-primary disabled:opacity-50"
            :disabled="translating || filling"
            aria-label="AI translate this cell"
            @click.stop="translateCell"
          >
            <Loader2 v-if="translating || filling" class="size-4 animate-spin" />
            <Languages v-else class="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent>AI translate</TooltipContent>
      </Tooltip>

      <StateBadge :state="state" :editable="true" @set-state="changeState" />
    </div>
  </div>
</template>
