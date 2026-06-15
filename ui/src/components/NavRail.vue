<script setup lang="ts">
import { Languages, BarChart3, BookText, Image, Settings, ScrollText, BookOpen } from "lucide-vue-next";
import { type Component } from "vue";
import { useRoute, navigate, type Route } from "@/router";
import ThemeToggle from "@/components/ThemeToggle.vue";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import Kbd from "@/components/ui/Kbd.vue";
import { shortcuts, type Shortcut } from "@/hotkeys.js";
import { cn } from "@/lib/utils";

const route = useRoute();
const version = __APP_VERSION__;

// Merge each rail item with its hotkey from the shared registry so the tooltip
// hint can never drift from the binding the key actually performs.
const items: { id: Route; label: string; icon: Component; keys?: Shortcut["keys"] }[] = (
  [
    { id: "editor", label: "Editor", icon: Languages },
    { id: "analytics", label: "Analytics", icon: BarChart3 },
    { id: "glossary", label: "Glossary", icon: BookText },
    { id: "screenshots", label: "Screenshots", icon: Image },
    { id: "settings", label: "Settings", icon: Settings },
    { id: "activity", label: "Activity", icon: ScrollText },
    { id: "docs", label: "Docs", icon: BookOpen },
  ] as { id: Route; label: string; icon: Component }[]
).map((item) => ({ ...item, keys: shortcuts.find((s) => s.route === item.id)?.keys }));
</script>

<template>
  <TooltipProvider :delay-duration="300">
    <nav class="flex w-14 shrink-0 flex-col items-center gap-1 bg-rail py-3 text-rail-foreground">
      <div class="mb-3 flex size-9 items-center justify-center rounded-md bg-primary font-mono text-base font-semibold text-primary-foreground">
        G
      </div>

      <Tooltip v-for="item in items" :key="item.id">
        <TooltipTrigger as-child>
          <button
            type="button"
            :aria-label="item.label"
            :class="cn(
              'relative flex size-10 items-center justify-center rounded-md transition-colors',
              route === item.id
                ? 'bg-primary text-primary-foreground'
                : 'text-rail-foreground/70 hover:bg-white/10 hover:text-rail-foreground',
            )"
            @click="navigate(item.id)"
          >
            <component :is="item.icon" class="size-5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" class="flex items-center gap-2">
          <span>{{ item.label }}</span>
          <span v-if="item.keys" class="flex items-center gap-0.5">
            <Kbd v-for="(k, i) in item.keys" :key="i">{{ k }}</Kbd>
          </span>
        </TooltipContent>
      </Tooltip>

      <div class="mt-auto flex flex-col items-center gap-1.5">
        <ThemeToggle />
        <span class="font-mono text-[10px] text-rail-foreground/50">v{{ version }}</span>
      </div>
    </nav>
  </TooltipProvider>
</template>
