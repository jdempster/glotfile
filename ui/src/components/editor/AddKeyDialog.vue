<script setup lang="ts">
import { ref, watch } from "vue";
import { createKey } from "@/api.js";
import { toast } from "@/components/ui/toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

const open = defineModel<boolean>("open", { required: true });
const emit = defineEmits<{ (e: "created", key: string): void }>();

const keyName = ref("");
const value = ref("");
const error = ref("");
const saving = ref(false);
const plural = ref(false);
const pluralArg = ref("count");

watch(open, (v) => {
  if (v) {
    keyName.value = "";
    value.value = "";
    error.value = "";
    plural.value = false;
    pluralArg.value = "count";
  }
});

async function submit() {
  const k = keyName.value.trim();
  if (!k) {
    error.value = "Key is required.";
    return;
  }
  if (!value.value.trim()) {
    error.value = "Source value is required.";
    return;
  }
  saving.value = true;
  error.value = "";
  try {
    if (plural.value) {
      // For a plural key the entered value seeds the `other` form.
      await createKey(k, value.value, { arg: pluralArg.value.trim() || "count" });
    } else {
      await createKey(k, value.value);
    }
    toast.success(`Added ${k}`);
    open.value = false;
    emit("created", k);
  } catch (e) {
    // Duplicate-key and other 400s surface here.
    error.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="max-w-md">
      <DialogHeader>
        <DialogTitle>Add key</DialogTitle>
        <DialogDescription>Create a new translation key using dot notation.</DialogDescription>
      </DialogHeader>

      <div class="grid gap-3">
        <div class="grid gap-1.5">
          <Label for="add-key">Key <span class="text-destructive">*</span></Label>
          <Input
            id="add-key"
            v-model="keyName"
            class="font-mono"
            placeholder="home.title"
            @keydown.enter.prevent="submit"
          />
        </div>
        <div class="grid gap-1.5">
          <Label for="add-value">
            {{ plural ? "Source value (other form)" : "Source value" }} <span class="text-destructive">*</span>
          </Label>
          <Input
            id="add-value"
            v-model="value"
            :placeholder="plural ? '{count} items' : 'Welcome home'"
            @keydown.enter.prevent="submit"
          />
        </div>

        <div class="flex items-center justify-between gap-2 rounded-md border p-2.5">
          <div class="flex flex-col">
            <Label for="add-plural" class="cursor-pointer">Plural</Label>
            <span class="text-xs text-muted-foreground">One form per CLDR category, by locale.</span>
          </div>
          <Switch id="add-plural" v-model="plural" />
        </div>

        <div v-if="plural" class="grid gap-1.5">
          <Label for="add-plural-arg">Count argument</Label>
          <Input
            id="add-plural-arg"
            v-model="pluralArg"
            class="font-mono"
            placeholder="count"
            @keydown.enter.prevent="submit"
          />
        </div>

        <p v-if="error" class="text-sm text-destructive">{{ error }}</p>
      </div>

      <DialogFooter>
        <Button variant="outline" :disabled="saving" @click="open = false">Cancel</Button>
        <Button :disabled="saving || !keyName.trim() || !value.trim()" @click="submit">Add key</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
