<script setup lang="ts">
import { ref, watch } from "vue";
import { Sparkles, WandSparkles, Trash2, ChevronDown, Eraser } from "lucide-vue-next";
import { bulkClear, bulkDelete, bulkState, bulkMeta } from "@/api.js";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";

const props = defineProps<{
  keys: string[];
  locales: string[];
  scopeLabel: string;
  tagsOnSelection: string[];
}>();

const emit = defineEmits<{
  (e: "changed"): void;
  (e: "clear"): void;
  (e: "translate"): void;
  (e: "build-context"): void;
}>();

const busy = ref(false);
const confirmClear = ref(false);
const confirmDelete = ref(false);
const addTagOpen = ref(false);
const removeTagOpen = ref(false);
const tagDraft = ref("");
// Reset the draft on any close (Cancel, Esc, outside-click) so it doesn't persist across reopens.
watch(addTagOpen, (open) => { if (!open) tagDraft.value = ""; });

// Run a bulk mutation, then reload. The selection is preserved so the user can
// chain actions on it; only pass clear=true when the keys no longer exist (delete).
// Errors keep the selection so the user can retry.
async function run(fn: () => Promise<unknown>, ok: string, clear = false) {
  busy.value = true;
  try {
    await fn();
    toast.success(ok);
    emit("changed");
    if (clear) emit("clear");
    confirmClear.value = false;
    confirmDelete.value = false;
    addTagOpen.value = false;
    removeTagOpen.value = false;
  } catch (e) {
    toast.error((e as Error).message || "Bulk action failed");
  } finally {
    busy.value = false;
  }
}

const doClear = () => run(() => bulkClear(props.keys, props.locales), `Cleared translations for ${props.keys.length} key${props.keys.length === 1 ? "" : "s"}`);
const doDelete = () => run(() => bulkDelete(props.keys), `Deleted ${props.keys.length} key${props.keys.length === 1 ? "" : "s"}`, true);
const markState = (state: "reviewed" | "needs-review") => run(() => bulkState(props.keys, props.locales, state), `Marked ${props.keys.length} key${props.keys.length === 1 ? "" : "s"} ${state}`);
const setSkip = (skipTranslate: boolean) => run(() => bulkMeta(props.keys, { skipTranslate }), skipTranslate ? "Marked skip-translate" : "Cleared skip-translate");
const clearContext = () => run(() => bulkMeta(props.keys, { clearContext: true }), `Cleared context for ${props.keys.length} key${props.keys.length === 1 ? "" : "s"}`);
const addTag = () => {
  const t = tagDraft.value.trim();
  if (!t || busy.value) return;
  return run(() => bulkMeta(props.keys, { addTags: [t] }), `Added tag "${t}"`).then(() => (tagDraft.value = ""));
};
const removeTag = (t: string) => run(() => bulkMeta(props.keys, { removeTags: [t] }), `Removed tag "${t}"`);
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <Button variant="ghost" size="sm" class="h-8 gap-1.5" data-testid="bulk-clear-trigger" :disabled="busy || !keys.length" @click="confirmClear = true">
      <Eraser class="size-4" /> Clear translations
    </Button>
    <Button variant="ghost" size="sm" class="h-8 gap-1.5" data-testid="bulk-translate" :disabled="busy || !keys.length" @click="emit('translate')">
      <Sparkles class="size-4" /> Translate
    </Button>
    <Button variant="ghost" size="sm" class="h-8 gap-1.5" data-testid="bulk-build-context" :disabled="busy || !keys.length" @click="emit('build-context')">
      <WandSparkles class="size-4" /> Build context
    </Button>

    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <Button variant="ghost" size="sm" class="h-8 gap-1.5" data-testid="bulk-set-trigger" :disabled="busy || !keys.length">
          Set <ChevronDown class="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" class="w-52">
          <DropdownMenuLabel>Status · {{ scopeLabel }}</DropdownMenuLabel>
          <DropdownMenuItem data-testid="bulk-mark-reviewed" @select="markState('reviewed')">Mark reviewed</DropdownMenuItem>
          <DropdownMenuItem data-testid="bulk-mark-needs-review" @select="markState('needs-review')">Mark needs-review</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Tags · key</DropdownMenuLabel>
          <DropdownMenuItem @select="addTagOpen = true">Add tag…</DropdownMenuItem>
          <DropdownMenuItem :disabled="!tagsOnSelection.length" @select="removeTagOpen = true">Remove tag…</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Context · key</DropdownMenuLabel>
          <DropdownMenuItem @select="clearContext">Clear context</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Translation · key</DropdownMenuLabel>
          <DropdownMenuItem @select="setSkip(true)">Skip translate</DropdownMenuItem>
          <DropdownMenuItem @select="setSkip(false)">Don't skip</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

    <Button variant="ghost" size="sm" class="h-8 gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive" data-testid="bulk-delete-trigger" :disabled="busy || !keys.length" @click="confirmDelete = true">
      <Trash2 class="size-4" /> Delete
    </Button>

    <Dialog v-model:open="confirmClear">
      <DialogContent class="max-w-md">
        <DialogHeader>
          <DialogTitle>Clear translations</DialogTitle>
          <DialogDescription>
            Clear translations for {{ keys.length }} {{ keys.length === 1 ? "key" : "keys" }} in
            {{ scopeLabel }}? Source strings are kept. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" :disabled="busy" @click="confirmClear = false">Cancel</Button>
          <Button variant="destructive" :disabled="busy" data-testid="bulk-clear-confirm" @click="doClear">Clear translations</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="confirmDelete">
      <DialogContent class="max-w-md">
        <DialogHeader>
          <DialogTitle>Delete keys</DialogTitle>
          <DialogDescription>
            Delete {{ keys.length }} {{ keys.length === 1 ? "key" : "keys" }} and all their translations?
            This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" :disabled="busy" @click="confirmDelete = false">Cancel</Button>
          <Button variant="destructive" :disabled="busy" data-testid="bulk-delete-confirm" @click="doDelete">Delete</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="addTagOpen">
      <DialogContent class="max-w-md">
        <DialogHeader>
          <DialogTitle>Add tag</DialogTitle>
          <DialogDescription>Add a tag to {{ keys.length }} {{ keys.length === 1 ? "key" : "keys" }}.</DialogDescription>
        </DialogHeader>
        <div class="grid gap-2">
          <Label for="bulk-add-tag">Tag</Label>
          <Input id="bulk-add-tag" v-model="tagDraft" :disabled="busy" @keydown.enter.prevent="addTag" />
        </div>
        <DialogFooter>
          <Button variant="outline" :disabled="busy" @click="addTagOpen = false">Cancel</Button>
          <Button :disabled="busy || !tagDraft.trim()" @click="addTag">Add</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="removeTagOpen">
      <DialogContent class="max-w-md">
        <DialogHeader>
          <DialogTitle>Remove tag</DialogTitle>
          <DialogDescription>Remove a tag from the selected keys.</DialogDescription>
        </DialogHeader>
        <div class="flex flex-wrap gap-2">
          <Button v-for="t in tagsOnSelection" :key="t" variant="outline" size="sm" :disabled="busy" @click="removeTag(t)">{{ t }}</Button>
        </div>
        <DialogFooter>
          <Button variant="outline" :disabled="busy" @click="removeTagOpen = false">Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
