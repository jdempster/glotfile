<script setup lang="ts">
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import Kbd from "@/components/ui/Kbd.vue";
import { shortcuts } from "@/hotkeys.js";
import { available as chatAvailable } from "@/chat";

// v-model:open is owned by the shortcutsOpen singleton in App.vue. Escape closes
// via the Dialog primitive; "?" toggles it shut via the global listener (§7).
const open = defineModel<boolean>("open", { required: true });
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="max-w-sm">
      <DialogHeader>
        <DialogTitle>Keyboard shortcuts</DialogTitle>
      </DialogHeader>
      <ul class="flex flex-col gap-1">
        <li
          v-for="s in shortcuts"
          :key="s.route"
          class="flex items-center justify-between py-1 text-sm"
        >
          <span>{{ s.label }}</span>
          <span class="flex items-center gap-1">
            <Kbd v-for="(k, i) in s.keys" :key="i">{{ k }}</Kbd>
          </span>
        </li>
        <li class="flex items-center justify-between py-1 text-sm">
          <span>Search keys</span>
          <span class="flex items-center gap-1"><Kbd>/</Kbd></span>
        </li>
        <li class="flex items-center justify-between py-1 text-sm">
          <span>Toggle key details</span>
          <span class="flex items-center gap-1"><Kbd>⌘/Ctrl</Kbd><Kbd>I</Kbd></span>
        </li>
        <li v-if="chatAvailable" class="flex items-center justify-between py-1 text-sm">
          <span>Lingo</span>
          <span class="flex items-center gap-1"><Kbd>⌘/Ctrl</Kbd><Kbd>J</Kbd></span>
        </li>
      </ul>
    </DialogContent>
  </Dialog>
</template>
