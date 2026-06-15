<script setup lang="ts">
import { ref, computed, nextTick, type ComponentPublicInstance } from "vue";
import { Pencil } from "lucide-vue-next";
import { highlightSegments } from "@/highlight.js";
import { setPluralForms } from "@/api.js";
import { categoriesFor } from "@/plurals.js";
import type { PluralForm } from "@/types.js";
import { toast } from "@/components/ui/toast";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const props = defineProps<{
  keyName: string;
  locale: string;
  sourceLocale: string;
  arg: string;
  forms: Partial<Record<PluralForm, string>>;
  // Kept for prop compatibility; the visible source row is the reference now.
  sourceForms?: Partial<Record<PluralForm, string>>;
  maxLength?: number;
}>();

const emit = defineEmits<{ (e: "changed"): void; (e: "edit-start"): void }>();

const isSource = computed(() => props.locale === props.sourceLocale);

// The selectors shown for THIS locale: any explicit "=N" matches present in the
// data (numerically ordered, as ICU expects them first), then the CLDR categories
// valid for the locale (en → one/other; pl → one/few/many/other). Surfacing the
// exact selectors keeps imported "=1"-style plurals visible and editable instead
// of silently hidden.
const selectors = computed<string[]>(() => {
  const exact = Object.keys(props.forms)
    .filter((k) => /^=\d+$/.test(k))
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  return [...exact, ...categoriesFor(props.locale)];
});

const editingCat = ref<string | null>(null);
const draft = ref("");
const saving = ref(false);
const textareaEl = ref<ComponentPublicInstance | null>(null);

// Function ref: the editing Textarea lives inside a v-for, so a static ref would
// collect an array. This captures the single mounted instance (and clears it on unmount).
function setTextareaRef(el: Element | ComponentPublicInstance | null) {
  textareaEl.value = el as ComponentPublicInstance | null;
}

function valueFor(cat: string) {
  return props.forms[cat as PluralForm] ?? "";
}
function segmentsFor(cat: string) {
  return highlightSegments(valueFor(cat));
}
function overLength(cat: string): boolean {
  return props.maxLength !== undefined && valueFor(cat).length > props.maxLength;
}

function autogrow(el?: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
}

async function startEdit(cat: string) {
  draft.value = valueFor(cat);
  editingCat.value = cat;
  emit("edit-start");
  await nextTick();
  const el = textareaEl.value?.$el as HTMLTextAreaElement | undefined;
  el?.focus();
  el?.select();
  autogrow(el);
}

function cancel() {
  editingCat.value = null;
}

async function commit() {
  const cat = editingCat.value;
  if (!cat) return;
  editingCat.value = null;
  const next = draft.value;
  if (next === valueFor(cat)) return;
  saving.value = true;
  try {
    // setPluralForms replaces the locale's whole forms object, so send every
    // existing form — including any "=N" exact selectors the locale's CLDR
    // categories don't cover — with just the edited one replaced. Rebuilding
    // from categories alone would silently drop those exact selectors.
    const merged: Record<string, string> = {};
    for (const [k, v] of Object.entries(props.forms)) merged[k] = v ?? "";
    merged[cat] = next;
    await setPluralForms(props.keyName, props.locale, merged);
    emit("changed");
  } catch (e) {
    toast.error(`Could not save: ${(e as Error).message}`);
    emit("changed");
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="flex min-w-0 flex-col gap-2">
    <div
      v-for="cat in selectors"
      :key="cat"
      data-testid="plural-field"
      class="flex items-start gap-2.5"
    >
      <!-- Category pill (ONE / FEW / MANY / OTHER); dim when empty on a target. -->
      <span
        :class="cn(
          'mt-0.5 min-w-[46px] shrink-0 rounded border border-border px-1.5 py-1 text-center font-mono text-[9.5px] font-semibold uppercase tracking-wide text-muted-foreground',
          !isSource && !valueFor(cat) && 'opacity-55',
        )"
        >{{ cat }}</span
      >

      <div class="min-w-0 flex-1">
        <!-- Edit mode -->
        <div v-if="editingCat === cat" class="flex flex-col gap-1">
          <span class="font-mono text-[10px] font-semibold uppercase tracking-wide text-primary">Plural: {{ cat }}</span>
          <Textarea
            :ref="setTextareaRef"
            v-model="draft"
            rows="1"
            :maxlength="maxLength"
            class="max-w-[560px] resize-none rounded-lg border-2 border-primary text-sm shadow-[0_0_0_3px_var(--ring)]"
            @input="autogrow(($event.target as HTMLTextAreaElement))"
            @blur="commit"
            @keydown.escape.prevent="cancel"
            @keydown.enter.exact.prevent="commit"
          />
          <span class="text-[10.5px] text-muted-foreground">
            <kbd class="rounded border border-border-soft bg-accent px-1 font-mono text-[10px]">↵</kbd> save ·
            <kbd class="rounded border border-border-soft bg-accent px-1 font-mono text-[10px]">esc</kbd> cancel
          </span>
        </div>

        <!-- Read mode with a value -->
        <button
          v-else-if="valueFor(cat)"
          type="button"
          :class="cn(
            'group inline-flex max-w-full items-center gap-1.5 rounded-md px-2 py-1 -mx-2 -my-1 text-left text-sm leading-relaxed hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            overLength(cat) && 'text-destructive',
          )"
          @click.stop="startEdit(cat)"
        >
          <span class="whitespace-pre-wrap break-words">
            <template v-for="(seg, i) in segmentsFor(cat)" :key="i">
              <span
                v-if="seg.placeholder"
                class="rounded bg-ph-bg px-1 font-mono text-[0.85em] font-semibold text-ph-fg"
                >{{ seg.text }}</span
              >
              <template v-else>{{ seg.text }}</template>
            </template>
          </span>
          <Pencil class="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-60" aria-hidden="true" />
        </button>

        <!-- Empty category: muted Empty marker, click to edit. -->
        <button
          v-else
          type="button"
          data-testid="empty-marker"
          class="group inline-flex items-center gap-1.5 rounded-md border border-dashed border-input px-2.5 py-1 text-[12.5px] font-medium italic text-muted-foreground transition-colors hover:border-border hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          @click.stop="startEdit(cat)"
        >
          Empty
          <Pencil class="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" aria-hidden="true" />
        </button>
      </div>
    </div>
  </div>
</template>
