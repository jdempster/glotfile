<script setup lang="ts">
import { ref, computed, nextTick, type ComponentPublicInstance } from "vue";
import { Pencil } from "lucide-vue-next";
import { highlightSegments } from "@/highlight.js";
import { patchKey, setValue } from "@/api.js";
import { toast } from "@/components/ui/toast";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const props = defineProps<{
  keyName: string;
  locale: string;
  sourceLocale: string;
  value: string;
  maxLength?: number;
}>();

const emit = defineEmits<{ (e: "changed"): void; (e: "edit-start"): void }>();

const editing = ref(false);
const draft = ref("");
const saving = ref(false);
const textareaEl = ref<ComponentPublicInstance | null>(null);

const isSource = computed(() => props.locale === props.sourceLocale);
const segments = computed(() => highlightSegments(props.value));
const overLength = computed(
  () => props.maxLength !== undefined && props.value.length > props.maxLength,
);

function autogrow(el?: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
}

async function startEdit() {
  draft.value = props.value;
  editing.value = true;
  emit("edit-start");
  await nextTick();
  const el = textareaEl.value?.$el as HTMLTextAreaElement | undefined;
  el?.focus();
  el?.select();
  autogrow(el);
}

function cancel() {
  editing.value = false;
}

async function commit() {
  if (!editing.value) return;
  editing.value = false;
  const next = draft.value;
  if (next === props.value) return;
  saving.value = true;
  try {
    // Source-locale edits keep state `source` via patchKey({source});
    // targets route through setValue.
    if (isSource.value) {
      await patchKey(props.keyName, { source: next });
    } else {
      await setValue(props.keyName, props.locale, next);
    }
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
  <div class="min-w-0">
    <!-- Edit mode: single auto-grow textarea + keyboard hint. -->
    <div v-if="editing" class="flex flex-col gap-1">
      <Textarea
        ref="textareaEl"
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

    <!-- Read mode with a value: click to edit, pencil fades in on hover. -->
    <button
      v-else-if="value"
      type="button"
      :class="cn(
        'group inline-flex max-w-full items-center gap-1.5 rounded-md px-2 py-1 -mx-2 -my-1 text-left text-sm leading-relaxed hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        overLength && 'text-destructive',
      )"
      @click.stop="startEdit"
    >
      <span class="whitespace-pre-wrap break-words">
        <template v-for="(seg, i) in segments" :key="i">
          <span
            v-if="seg.placeholder"
            class="rounded bg-ph-bg px-1 font-mono text-[0.85em] font-semibold text-ph-fg"
            >{{ seg.text }}</span
          >
          <template v-else>{{ seg.text }}</template>
        </template>
      </span>
      <Pencil aria-hidden="true" class="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-60" />
    </button>

    <!-- Empty: calm muted dashed marker — the click target (red is reserved for issues). -->
    <button
      v-else
      type="button"
      data-testid="empty-marker"
      class="group inline-flex items-center gap-1.5 rounded-md border border-dashed border-input px-2.5 py-1 text-[12.5px] font-medium italic text-muted-foreground transition-colors hover:border-border hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      @click.stop="startEdit"
    >
      Empty
      <Pencil class="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" aria-hidden="true" />
    </button>
  </div>
</template>
