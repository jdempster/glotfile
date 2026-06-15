<script setup lang="ts">
import { Sun, Monitor, Moon } from "lucide-vue-next";
import { type Component } from "vue";
import { mode, setTheme, type ThemeMode } from "@/theme";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// System sits in the middle as the default; light/dark flank it as explicit overrides.
const options: { value: ThemeMode; label: string; icon: Component }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "system", label: "System", icon: Monitor },
  { value: "dark", label: "Dark", icon: Moon },
];
</script>

<template>
  <div class="flex flex-col items-center gap-0.5 rounded-lg bg-black/15 p-0.5">
    <Tooltip v-for="opt in options" :key="opt.value">
      <TooltipTrigger as-child>
        <button
          type="button"
          :data-mode="opt.value"
          :aria-label="opt.label"
          :aria-pressed="mode === opt.value"
          :class="cn(
            'flex size-8 items-center justify-center rounded-md transition-colors',
            mode === opt.value
              ? 'bg-primary text-primary-foreground'
              : 'text-rail-foreground/70 hover:bg-white/10 hover:text-rail-foreground',
          )"
          @click="setTheme(opt.value)"
        >
          <component :is="opt.icon" class="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{{ opt.label }}</TooltipContent>
    </Tooltip>
  </div>
</template>
