<script setup lang="ts">
import { ref } from "vue";
import { X, Plus, AlertTriangle } from "lucide-vue-next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const props = defineProps<{
  label: string;
  items: string[];
  placeholder?: string;
  mono?: boolean;
  addLabel?: string;
  // Return an error string to reject the value, or null to accept it.
  validate?: (value: string) => string | null;
}>();
const emit = defineEmits<{ "update:items": [string[]] }>();

const entry = ref("");
const error = ref("");

function add() {
  const v = entry.value.trim();
  if (!v) return;
  if (props.items.includes(v)) { error.value = `"${v}" is already listed`; return; }
  const err = props.validate?.(v) ?? null;
  if (err) { error.value = err; return; }
  error.value = "";
  emit("update:items", [...props.items, v]);
  entry.value = "";
}

function remove(value: string) {
  emit("update:items", props.items.filter((x) => x !== value));
}
</script>

<template>
  <div class="grid gap-1.5">
    <Label>{{ label }}</Label>
    <slot name="help" />

    <div class="flex flex-wrap gap-2">
      <span
        v-for="it in items"
        :key="it"
        :class="['inline-flex items-center gap-1.5 rounded-lg border bg-accent px-2.5 py-1.5 text-sm', mono && 'font-mono']"
      >
        {{ it }}
        <button
          type="button"
          class="flex size-[18px] items-center justify-center rounded text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          :aria-label="`Remove ${it}`"
          @click="remove(it)"
        ><X class="size-3" /></button>
      </span>
      <p v-if="items.length === 0" class="text-sm text-muted-foreground">None — auto-detect.</p>
    </div>

    <div class="flex max-w-sm gap-2">
      <Input
        v-model="entry"
        :class="mono ? 'font-mono' : undefined"
        :placeholder="placeholder"
        @keydown.enter.prevent="add"
        @input="error = ''"
      />
      <Button variant="outline" @click="add"><Plus class="size-4" /> {{ addLabel ?? "Add" }}</Button>
    </div>

    <p v-if="error" class="flex items-center gap-1.5 text-xs text-destructive">
      <AlertTriangle class="size-3.5" /> {{ error }}
    </p>
  </div>
</template>
