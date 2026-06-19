<script setup lang="ts">
import ChatPanel from "./ChatPanel.vue";
import ResizeHandle from "@/components/ResizeHandle.vue";
import { chatPanel } from "@/panel-widths.js";
import { isOpen, expanded, available, toggleOpen, toggleExpanded } from "@/chat";

// The assistant panel. Two open layouts, toggled from the panel header:
//  - docked: a resizable right-hand column that shares the layout (content
//    shrinks); width persists via ui prefs;
//  - expanded: a right-anchored drawer over MOST of the content (a sidebar
//    modal) with the rest dimmed behind it. Clicking the dim area collapses
//    back to docked.
const chatWidth = chatPanel.width;
</script>

<template>
  <!-- Docked, resizable side column -->
  <template v-if="available && isOpen && !expanded">
    <ResizeHandle
      side="left"
      :width="chatWidth"
      :min="chatPanel.min"
      :max="chatPanel.max"
      @update:width="chatPanel.set"
      @commit="chatPanel.commit"
      @reset="chatPanel.reset"
    />
    <aside class="flex shrink-0 flex-col border-l bg-background" :style="{ width: `${chatWidth}px` }">
      <ChatPanel dock @close="toggleOpen" />
    </aside>
  </template>

  <!-- Expanded: sidebar-modal drawer over most of the content -->
  <template v-else-if="available && isOpen && expanded">
    <div
      data-chat-backdrop
      class="fixed bottom-0 left-14 right-0 top-12 z-30 bg-foreground/20"
      @click="toggleExpanded"
    />
    <aside
      class="fixed bottom-0 right-0 top-12 z-40 flex w-[62%] min-w-[26rem] max-w-[60rem] flex-col border-l bg-background shadow-2xl"
    >
      <ChatPanel dock @close="toggleOpen" />
    </aside>
  </template>
</template>
