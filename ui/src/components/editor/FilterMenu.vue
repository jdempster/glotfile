<script setup lang="ts">
import { computed } from "vue";
import { Check, Sparkles } from "lucide-vue-next";
import type { CheckId } from "@/types.js";
import type { StateFacet, PluralityFacet } from "@/filter.js";
import { ALL_CHECKS, ALL_STATES, ALL_PLURALITY, CHECK_LABELS, STATE_LABELS, PLURALITY_LABELS } from "@/checks.js";
import { Switch } from "@/components/ui/switch";

const props = defineProps<{
  states: StateFacet[];
  issues: CheckId[];
  enabled: CheckId[];
  plurality: PluralityFacet[];
  emptySource: boolean;
  aiContextUnreviewed: boolean;
  noUsages: boolean;
  skipTranslate: boolean;
  scanIndexed: boolean;
}>();

const emit = defineEmits<{
  (e: "update:states", v: StateFacet[]): void;
  (e: "update:issues", v: CheckId[]): void;
  (e: "update:enabled", v: CheckId[]): void;
  (e: "update:plurality", v: PluralityFacet[]): void;
  (e: "update:emptySource", v: boolean): void;
  (e: "update:aiContextUnreviewed", v: boolean): void;
  (e: "update:noUsages", v: boolean): void;
  (e: "update:skipTranslate", v: boolean): void;
}>();

const enabledSet = computed(() => new Set(props.enabled));

function toggleState(facet: StateFacet) {
  emit("update:states", props.states.includes(facet)
    ? props.states.filter((s) => s !== facet)
    : [...props.states, facet]);
}

function togglePlurality(facet: PluralityFacet) {
  emit("update:plurality", props.plurality.includes(facet)
    ? props.plurality.filter((p) => p !== facet)
    : [...props.plurality, facet]);
}

function toggleIssue(check: CheckId) {
  if (!enabledSet.value.has(check)) return;
  emit("update:issues", props.issues.includes(check)
    ? props.issues.filter((c) => c !== check)
    : [...props.issues, check]);
}

function setEnabled(check: CheckId, on: boolean) {
  if (on) {
    if (!enabledSet.value.has(check)) emit("update:enabled", [...props.enabled, check]);
  } else {
    emit("update:enabled", props.enabled.filter((c) => c !== check));
    if (props.issues.includes(check)) emit("update:issues", props.issues.filter((c) => c !== check));
  }
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div>
      <p class="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</p>
      <button
        v-for="facet in ALL_STATES"
        :key="facet"
        type="button"
        role="checkbox"
        :aria-checked="states.includes(facet)"
        class="flex w-full items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-accent"
        @click="toggleState(facet)"
      >
        <span class="flex size-4 items-center justify-center rounded border transition-colors" :class="states.includes(facet) ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground hover:border-primary hover:bg-primary/10'">
          <Check v-if="states.includes(facet)" class="size-3" />
        </span>
        {{ STATE_LABELS[facet] }}
      </button>
      <button
        type="button"
        role="checkbox"
        :aria-checked="emptySource"
        class="flex w-full items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-accent"
        @click="emit('update:emptySource', !emptySource)"
      >
        <span class="flex size-4 items-center justify-center rounded border transition-colors" :class="emptySource ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground hover:border-primary hover:bg-primary/10'">
          <Check v-if="emptySource" class="size-3" />
        </span>
        Empty source
      </button>
      <button
        type="button"
        role="checkbox"
        :aria-checked="noUsages"
        :disabled="!scanIndexed"
        class="flex w-full items-center gap-2 rounded px-1.5 py-1 text-sm enabled:hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
        @click="emit('update:noUsages', !noUsages)"
      >
        <span class="flex size-4 items-center justify-center rounded border transition-colors" :class="noUsages ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground hover:border-primary hover:bg-primary/10'">
          <Check v-if="noUsages" class="size-3" />
        </span>
        Unused
      </button>
      <p v-if="!scanIndexed" class="ml-[30px] text-[11px] text-muted-foreground">Run a scan first</p>
      <button
        type="button"
        role="checkbox"
        :aria-checked="skipTranslate"
        class="flex w-full items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-accent"
        @click="emit('update:skipTranslate', !skipTranslate)"
      >
        <span class="flex size-4 items-center justify-center rounded border transition-colors" :class="skipTranslate ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground hover:border-primary hover:bg-primary/10'">
          <Check v-if="skipTranslate" class="size-3" />
        </span>
        Skip-translate
      </button>
    </div>

    <div class="border-t pt-2">
      <p class="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Type</p>
      <button
        v-for="facet in ALL_PLURALITY"
        :key="facet"
        type="button"
        role="checkbox"
        :aria-checked="plurality.includes(facet)"
        class="flex w-full items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-accent"
        @click="togglePlurality(facet)"
      >
        <span class="flex size-4 items-center justify-center rounded border transition-colors" :class="plurality.includes(facet) ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground hover:border-primary hover:bg-primary/10'">
          <Check v-if="plurality.includes(facet)" class="size-3" />
        </span>
        {{ PLURALITY_LABELS[facet] }}
      </button>
    </div>

    <div class="border-t pt-2">
      <p class="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Context</p>
      <button
        type="button"
        role="checkbox"
        :aria-checked="aiContextUnreviewed"
        class="flex w-full items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-accent"
        @click="emit('update:aiContextUnreviewed', !aiContextUnreviewed)"
      >
        <span class="flex size-4 items-center justify-center rounded border transition-colors" :class="aiContextUnreviewed ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground hover:border-primary hover:bg-primary/10'">
          <Check v-if="aiContextUnreviewed" class="size-3" />
        </span>
        <Sparkles class="size-3.5 text-muted-foreground" />
        AI context (unreviewed)
      </button>
    </div>

    <div class="border-t pt-2">
      <p class="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Issues</p>
      <p class="mb-1.5 text-[11px] text-muted-foreground">Toggle a check to run it; tick its box to filter by it.</p>
      <div v-for="check in ALL_CHECKS" :key="check" class="flex items-center gap-2 py-0.5">
        <button
          type="button"
          role="checkbox"
          :aria-checked="issues.includes(check)"
          class="flex min-w-0 flex-1 items-center gap-2 rounded px-1.5 py-1 text-sm disabled:opacity-50 enabled:hover:bg-accent"
          :disabled="!enabledSet.has(check)"
          @click="toggleIssue(check)"
        >
          <span class="flex size-4 shrink-0 items-center justify-center rounded border transition-colors" :class="issues.includes(check) ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground hover:border-primary hover:bg-primary/10'">
            <Check v-if="issues.includes(check)" class="size-3" />
          </span>
          <span class="truncate">{{ CHECK_LABELS[check] }}</span>
        </button>
        <Switch
          :model-value="enabledSet.has(check)"
          :aria-label="`Enable ${CHECK_LABELS[check]} check`"
          @update:model-value="(v: boolean) => setEnabled(check, v)"
        />
      </div>
    </div>
  </div>
</template>
