<script setup lang="ts">
import { ArrowRight, Image as ImageIcon } from "lucide-vue-next";
import type { LogEntry, GlossaryHint } from "@/types.js";
import { Badge } from "@/components/ui/badge";

type AiItem = NonNullable<LogEntry["items"]>[number];
type AiResult = NonNullable<LogEntry["results"]>[number];

defineProps<{ item: AiItem; result?: AiResult }>();

function glossaryLabel(hint: GlossaryHint): string {
  if (hint.doNotTranslate) return `${hint.term} (do-not-translate)`;
  if (hint.forced) return `${hint.term} → ${hint.forced}`;
  return hint.term;
}
</script>

<template>
  <div class="flex flex-col gap-1.5 px-4 py-3">
    <div class="flex items-center gap-2">
      <span class="truncate font-mono text-xs text-muted-foreground">{{ item.key }}</span>
      <Badge v-if="item.targetLocale" variant="outline" class="shrink-0 font-mono uppercase">{{ item.targetLocale }}</Badge>
    </div>
    <div class="flex items-start gap-2 text-sm">
      <span class="min-w-0 flex-1 break-words">{{ item.source }}</span>
      <ArrowRight class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <span class="min-w-0 flex-1 break-words">
        <span v-if="result?.error" class="text-destructive">{{ result.error }}</span>
        <span v-else>{{ result?.translation ?? result?.value }}</span>
      </span>
    </div>
    <p v-if="item.context" class="text-xs text-muted-foreground">{{ item.context }}</p>
    <div v-if="item.glossary?.length" class="flex flex-wrap gap-1">
      <span v-for="hint in item.glossary" :key="hint.term" class="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">{{ glossaryLabel(hint) }}</span>
    </div>
    <div v-if="item.screenshot" class="flex items-center gap-1.5 text-xs text-muted-foreground">
      <ImageIcon class="size-3.5 shrink-0" />
      <span class="truncate font-mono">{{ item.screenshot }}</span>
    </div>
  </div>
</template>
