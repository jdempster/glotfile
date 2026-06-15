<script setup lang="ts">
import { ref } from "vue";
import { Pencil, Trash2, StickyNote } from "lucide-vue-next";
import type { Note } from "@/types.js";
import { addNote, editNote, deleteNote } from "@/api.js";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const props = defineProps<{ keyName: string; notes: Note[] }>();
const emit = defineEmits<{ (e: "changed"): void }>();

const fmtDate = (iso: string) => new Date(iso).toLocaleString();

const draft = ref("");
const adding = ref(false);

async function add() {
  const text = draft.value.trim();
  if (!text) return;
  adding.value = true;
  try {
    await addNote(props.keyName, text);
    draft.value = "";
    emit("changed");
  } catch (e) {
    toast.error(`Could not add note: ${(e as Error).message}`);
  } finally {
    adding.value = false;
  }
}

const editingId = ref<string | null>(null);
const editText = ref("");
const savingEdit = ref(false);

function startEdit(note: Note) {
  editingId.value = note.id;
  editText.value = note.text;
}

function cancelEdit() {
  editingId.value = null;
  editText.value = "";
}

async function saveEdit(id: string) {
  const text = editText.value.trim();
  if (!text) return;
  savingEdit.value = true;
  try {
    await editNote(props.keyName, id, text);
    cancelEdit();
    emit("changed");
  } catch (e) {
    toast.error(`Could not save note: ${(e as Error).message}`);
  } finally {
    savingEdit.value = false;
  }
}

async function remove(id: string) {
  try {
    await deleteNote(props.keyName, id);
    emit("changed");
  } catch (e) {
    toast.error(`Could not delete note: ${(e as Error).message}`);
  }
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex items-center gap-1.5">
      <StickyNote class="size-3.5 text-muted-foreground" />
      <p class="text-[13px] font-semibold">Notes</p>
    </div>
    <p class="-mt-1 text-[11.5px] text-muted-foreground">Internal notes — never sent to the AI or exported.</p>

    <ul v-if="notes.length" class="flex flex-col gap-2">
      <li
        v-for="note in notes"
        :key="note.id"
        class="flex flex-col gap-1 rounded-lg border border-border-soft bg-background p-2.5 text-sm"
      >
        <template v-if="editingId === note.id">
          <Textarea v-model="editText" rows="2" @keydown.escape.prevent="cancelEdit" />
          <div class="mt-1 flex gap-2">
            <Button size="sm" :disabled="savingEdit || !editText.trim()" @click="saveEdit(note.id)">Save</Button>
            <Button size="sm" variant="ghost" @click="cancelEdit">Cancel</Button>
          </div>
        </template>
        <template v-else>
          <div class="flex items-center justify-between">
            <span class="font-mono text-[10px] text-muted-foreground">{{ fmtDate(note.at) }}</span>
            <span class="flex gap-1.5">
              <button type="button" aria-label="Edit note" class="text-muted-foreground hover:text-foreground" @click="startEdit(note)">
                <Pencil class="size-3.5" />
              </button>
              <button type="button" aria-label="Delete note" class="text-muted-foreground hover:text-destructive" @click="remove(note.id)">
                <Trash2 class="size-3.5" />
              </button>
            </span>
          </div>
          <p class="whitespace-pre-wrap break-words text-[12.5px] leading-snug">{{ note.text }}</p>
        </template>
      </li>
    </ul>

    <Textarea data-testid="new-note" v-model="draft" rows="2" placeholder="Add an internal note…" />
    <Button data-testid="add-note" variant="outline" class="w-full text-muted-foreground" :disabled="adding || !draft.trim()" @click="add">
      Add note
    </Button>
  </div>
</template>
