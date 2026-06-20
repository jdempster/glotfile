<script setup lang="ts">
import { ref, shallowRef, onMounted, computed } from "vue";
import { ChevronsUpDown, ChevronRight, Check, ScanSearch, Loader2, Sparkles } from "lucide-vue-next";
import { isOpen as chatOpen, toggleOpen as toggleChat, available as chatAvailable, refreshAvailability as refreshChatAvailability } from "@/chat";
import { fetchState, getFile, listFiles, setFile, type FileInfo, type ActiveFile } from "./api.js";
import type { State } from "./types.js";
import EditorView from "./components/editor/EditorView.vue";
import ChatDock from "./components/chat/ChatDock.vue";
import AnalyticsView from "./components/analytics/AnalyticsView.vue";
import GlossaryView from "./components/glossary/GlossaryView.vue";
import SettingsView from "./components/settings/SettingsView.vue";
import ScreenshotsView from "./components/screenshots/ScreenshotsView.vue";
import ActivityView from "./components/activity/ActivityView.vue";
import DocsView from "./components/docs/DocsView.vue";
import ImportWizard from "./components/import/ImportWizard.vue";
import NavRail from "./components/NavRail.vue";
import ShortcutsDialog from "./components/ShortcutsDialog.vue";
import { useNavHotkeys, shortcutsOpen } from "@/useNavHotkeys";
import { Toaster, toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { useRoute, navigate } from "@/router";
import { startLiveReload, onExternalChange, refreshing } from "@/liveReload";
import { scanLabel, scanDetail, scanPending, refreshScanSummary } from "@/scanStatus.js";
import { syncKnownKeys, syncKnownLocales } from "@/keyIndex.js";

const route = useRoute();
// One global keydown listener for the g-chord view switching + ? overlay.
useNavHotkeys();
// shallowRef: the full state tree is only read here (header locale context) and
// replaced wholesale on reload — deep reactivity would Proxy-wrap 55k values for nothing.
const state = shallowRef<State | null>(null);
const currentFile = ref<ActiveFile | null>(null);
const files = ref<FileInfo[]>([]);
const sortedFiles = computed(() =>
  [...files.value].sort((a, b) => {
    const ka = a.relDir ? `${a.relDir}/${a.name}` : a.name;
    const kb = b.relDir ? `${b.relDir}/${b.name}` : b.name;
    return ka.localeCompare(kb);
  }),
);
const showImportWizard = ref(false);
const wizardRef = ref<InstanceType<typeof ImportWizard> | null>(null);

// The header still shows the project's locale context; the editor owns its own state.
async function reload() {
  state.value = await fetchState();
  // Keep the chat-link vocab current so Lingo's mentions of keys, review states,
  // and locales render as clickable editor filters.
  syncKnownKeys(state.value);
  syncKnownLocales(state.value);
}
// Refresh the header's locale context when the file changes on disk out of band;
// each view subscribes its own refresh too.
onExternalChange(reload);
onMounted(async () => {
  await reload();
  // Show the Assistant toggle only when the active provider supports chat.
  void refreshChatAvailability();
  // Surface the most recent scan (incl. the boot scan) in the header chip.
  void refreshScanSummary();
  // Open the live-reload channel once the app is up.
  startLiveReload();
  try {
    [currentFile.value, files.value] = await Promise.all([getFile(), listFiles()]);
    // Name the tab/window after the project so many open Glotfiles are
    // distinguishable in the browser tab bar and OS window switcher.
    document.title = currentFile.value.project ? `${currentFile.value.project} — Glotfile` : "Glotfile";
  } catch (e) {
    toast.error((e as Error).message);
  }
  // Offer the import wizard on an empty project — its init() runs detection and
  // self-dismisses when there's nothing to import.
  if (state.value && Object.keys(state.value.keys).length === 0) {
    showImportWizard.value = true;
  }
});

// Import populated the project — reload so every view picks up the new file.
function onImported() {
  location.reload();
}

async function switchFile(path: string) {
  if (path === currentFile.value?.path) return;
  try {
    await setFile(path);
    // Reload the whole app so every view reads the newly active file.
    location.reload();
  } catch (e) {
    toast.error((e as Error).message);
  }
}

const sectionTitle = computed(
  () =>
    ({
      editor: "Editor",
      analytics: "Analytics",
      glossary: "Glossary",
      screenshots: "Screenshots",
      settings: "Settings",
      activity: "Activity",
      docs: "Docs",
    })[route.value],
);

const localeSummary = computed(() => {
  if (!state.value) return null;
  const { sourceLocale, locales } = state.value.config;
  const targets = locales.filter((l) => l !== sourceLocale);
  return { source: sourceLocale, targets };
});
</script>

<template>
  <TooltipProvider :delay-duration="300">
  <div class="flex h-screen bg-background text-foreground">
    <NavRail />
    <div class="flex min-w-0 flex-1 flex-col">
      <header class="flex h-12 shrink-0 items-center justify-between border-b px-4">
        <div class="flex min-w-0 items-center gap-3">
          <div v-if="currentFile" class="flex min-w-0 items-center gap-1.5">
            <Tooltip>
              <TooltipTrigger as-child>
                <span class="max-w-[12rem] shrink-0 truncate font-mono text-sm font-medium">{{ currentFile.project }}</span>
              </TooltipTrigger>
              <TooltipContent side="bottom" class="font-mono">{{ currentFile.dir }}</TooltipContent>
            </Tooltip>
            <ChevronRight class="size-3.5 shrink-0 text-muted-foreground" />
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <Button variant="outline" size="sm" class="max-w-[16rem] gap-1.5 font-mono">
                  <span class="truncate">{{ currentFile.name }}</span>
                  <ChevronsUpDown class="size-3.5 shrink-0 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" class="w-max">
                <DropdownMenuItem
                  v-for="f in sortedFiles"
                  :key="f.path"
                  class="font-mono"
                  @select="switchFile(f.path)"
                >
                  <Check :class="['size-4 shrink-0', f.path === currentFile.path ? 'opacity-100' : 'opacity-0']" />
                  <span><span v-if="f.relDir" class="text-muted-foreground">{{ f.relDir }}/</span>{{ f.name }}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <h1 class="text-sm font-semibold">{{ sectionTitle }}</h1>
          <Transition
            enter-active-class="transition-all duration-200"
            enter-from-class="opacity-0 scale-90"
            leave-active-class="transition-opacity duration-500"
            leave-to-class="opacity-0"
          >
            <span
              v-if="refreshing"
              class="flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
              role="status"
            >
              <Loader2 class="size-3.5 animate-spin" />
              Updated
            </span>
          </Transition>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <Tooltip v-if="localeSummary">
            <TooltipTrigger as-child>
              <button
                type="button"
                class="shrink-0 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
                @click="navigate('settings')"
              >
                {{ localeSummary.source }} → {{ localeSummary.targets.length }}
                {{ localeSummary.targets.length === 1 ? "locale" : "locales" }}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" class="max-w-[28rem] leading-relaxed">
              <div class="font-mono">{{ localeSummary.targets.join(", ") || "—" }}</div>
              <div class="mt-1 text-background/60">Click to manage in Settings</div>
            </TooltipContent>
          </Tooltip>
          <span v-if="localeSummary" aria-hidden="true" class="text-xs text-muted-foreground/50">·</span>
          <Tooltip>
            <TooltipTrigger as-child>
              <button
                type="button"
                class="flex shrink-0 items-center gap-1 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
                @click="navigate('settings', 'section=scan')"
              >
                <Loader2 v-if="scanPending" class="size-3 animate-spin" />
                <ScanSearch v-else class="size-3" />
                {{ scanLabel }}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" class="max-w-[24rem] leading-relaxed">
              <div>Finds where each key is used in your code — powers the <span class="font-medium">Unused</span> filter and per-key usage.</div>
              <div class="mt-1 text-background/60">Runs automatically when the server starts. Click to open Scan settings.</div>
              <div class="mt-1 font-mono">{{ scanDetail }}</div>
            </TooltipContent>
          </Tooltip>
          <template v-if="chatAvailable">
          <span aria-hidden="true" class="text-xs text-muted-foreground/50">·</span>
          <Tooltip>
            <TooltipTrigger as-child>
              <button
                type="button"
                :aria-label="chatOpen ? 'Close Lingo' : 'Open Lingo'"
                :class="[
                  'flex size-8 items-center justify-center rounded-md transition-colors',
                  chatOpen
                    ? 'bg-accent text-primary shadow-[inset_0_1px_2px_rgb(0_0_0/0.25)] hover:bg-accent'
                    : 'text-primary hover:bg-accent',
                ]"
                @click="toggleChat"
              >
                <Sparkles class="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Lingo · ⌘/Ctrl + J</TooltipContent>
          </Tooltip>
          </template>
        </div>
      </header>

      <main class="flex min-h-0 flex-1 flex-col overflow-hidden">
        <EditorView v-if="route === 'editor'" />
        <AnalyticsView v-else-if="route === 'analytics'" />

        <GlossaryView v-else-if="route === 'glossary'" />
        <ScreenshotsView v-else-if="route === 'screenshots'" />
        <SettingsView v-else-if="route === 'settings'" />
        <ActivityView v-else-if="route === 'activity'" />
        <DocsView v-else-if="route === 'docs'" />
      </main>
    </div>
    <ChatDock />
    <Toaster />
    <ShortcutsDialog v-model:open="shortcutsOpen" />
    <ImportWizard
      v-if="showImportWizard"
      ref="wizardRef"
      @vue:mounted="wizardRef?.init()"
      @dismiss="showImportWizard = false"
      @imported="onImported"
    />
  </div>
  </TooltipProvider>
</template>
