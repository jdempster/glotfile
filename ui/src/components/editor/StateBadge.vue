<script setup lang="ts">
import { Check, ChevronDown } from "lucide-vue-next";
import type { LocaleState } from "@/types.js";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const props = defineProps<{ state: LocaleState; editable?: boolean }>();
const emit = defineEmits<{ (e: "setState", state: LocaleState): void }>();

// States a target value can be moved between.
const options: LocaleState[] = ["machine", "reviewed", "needs-review"];

const labels: Record<LocaleState, string> = {
  source: "Source",
  machine: "Machine",
  reviewed: "Reviewed",
  "needs-review": "Needs review",
};

const tone: Record<LocaleState, string> = {
  source: "bg-accent text-muted-foreground border-border-soft",
  machine: "bg-machine-soft text-machine border-transparent",
  reviewed: "bg-review-soft text-review border-transparent",
  "needs-review": "bg-muted text-muted-foreground border-border",
};

const dot: Record<LocaleState, string> = {
  source: "bg-muted-foreground",
  machine: "bg-machine",
  reviewed: "bg-review",
  "needs-review": "bg-muted-foreground",
};

const base =
  "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11.5px] font-medium leading-none whitespace-nowrap min-w-[132px]";
</script>

<template>
  <!-- Source / non-editable: static pill. -->
  <span
    v-if="!editable || state === 'source'"
    :class="cn(base, tone[state], 'cursor-default')"
    data-testid="state-badge"
  >
    <Check v-if="state === 'reviewed'" class="size-3 shrink-0" />
    <span v-else :class="cn('size-[7px] shrink-0 rounded-full', dot[state])" />
    {{ labels[state] }}
  </span>

  <!-- Target: opens a menu to change state. -->
  <DropdownMenu v-else>
    <DropdownMenuTrigger as-child>
      <button
        type="button"
        :class="cn(base, tone[state], 'transition hover:brightness-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring')"
        :aria-label="`${labels[state]} — change state`"
        data-testid="state-badge"
      >
        <Check v-if="state === 'reviewed'" class="size-3 shrink-0" />
        <span v-else :class="cn('size-[7px] shrink-0 rounded-full', dot[state])" />
        {{ labels[state] }}
        <ChevronDown class="ml-auto size-3 opacity-50" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="min-w-[10rem]">
      <DropdownMenuItem v-for="opt in options" :key="opt" @select="emit('setState', opt)">
        <span :class="cn('size-[7px] shrink-0 rounded-full', dot[opt])" />
        {{ labels[opt] }}
        <Check :class="cn('ml-auto size-4', opt === props.state ? 'opacity-100' : 'opacity-0')" />
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
