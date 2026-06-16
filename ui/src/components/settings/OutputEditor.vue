<script setup lang="ts">
import { ref, computed, type Component } from "vue";
import { ChevronRight, Trash2, Plus, X, ArrowRight, FileCode, FileJson, Smartphone, FileText } from "lucide-vue-next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import {
  Select, SelectTrigger, SelectContent, SelectItem, SelectValue,
} from "@/components/ui/select";
import type { OutputForm } from "./config-form.js";

const props = defineProps<{
  output: OutputForm;
  formatIndent: number;
  formatFinalNewline: boolean;
  locales: string[];
  adapters: string[];
}>();
const emit = defineEmits<{ "update:output": [OutputForm]; remove: [] }>();

const open = ref(false);
const aliasDraft = ref<Record<string, string>>({});

// Which options each adapter exposes (mirrors the export-fidelity spec).
const CAPS: Record<string, string[]> = {
  "laravel-php": ["emptyAs", "indent", "finalNewline"],
  "vue-i18n-json": ["emptyAs", "style", "indent", "finalNewline"],
  "next-intl-json": ["emptyAs", "style", "indent", "finalNewline"],
  "flutter-arb": ["emptyAs", "indent", "finalNewline", "includeLocale"],
  "angular-xliff": ["emptyAs"],
  "rails-yaml": ["emptyAs", "indent", "finalNewline"],
  "apple-strings": ["emptyAs"],
};
function caps(adapter: string): string[] {
  return CAPS[adapter] ?? ["emptyAs", "indent", "finalNewline"];
}
function supports(opt: string): boolean {
  return caps(props.output.adapter).includes(opt);
}

const EMPTY_OPTS = [
  { value: "source", label: "Fill source" },
  { value: "empty", label: "Leave empty" },
  { value: "omit", label: "Omit" },
] as const;

const LOCALE_CASE_OPTS = [
  { value: "lower-hyphen", label: "lower-hyphen", example: "en-us" },
  { value: "lower-underscore", label: "lower-underscore", example: "en_us" },
  { value: "bcp47-hyphen", label: "bcp47-hyphen", example: "en-US" },
  { value: "bcp47-underscore", label: "bcp47-underscore", example: "en_US" },
] as const;

// The Default option's label shows what each adapter renders when localeCase is
// unset (ARB and Laravel default to bcp47-underscore; the rest to lower-hyphen).
function defaultCaseLabel(adapter: string): string {
  if (adapter === "flutter-arb") return "Default (Flutter: en_US)";
  if (adapter === "laravel-php") return "Default (Laravel: en_US)";
  if (adapter === "angular-xliff") return "Default (Angular: en-US)";
  if (adapter === "rails-yaml") return "Default (Rails: en-US)";
  if (adapter === "apple-strings") return "Default (Apple: en-US)";
  return "Default (en-us)";
}

// A "default" sentinel represents "unset" (reka-ui Select doesn't take an empty
// string item value cleanly).
const localeCaseModel = computed(() => props.output.localeCase ?? "default");
function setLocaleCase(v: string) {
  patch({ localeCase: v === "default" ? undefined : (v as OutputForm["localeCase"]) });
}

const ADAPTER_LABELS: Record<string, string> = {
  "laravel-php": "Laravel PHP",
  "vue-i18n-json": "Vue i18n JSON",
  "next-intl-json": "Next.js (next-intl)",
  "flutter-arb": "Flutter ARB",
  "angular-xliff": "Angular XLIFF",
  "rails-yaml": "Rails YAML",
  "apple-strings": "Apple .strings",
};
function adapterLabel(a: string): string {
  return ADAPTER_LABELS[a] ?? a;
}

// Present export types alphabetically by their displayed label, rather than in
// the registration order the parent happens to pass them in.
const sortedAdapters = computed(() =>
  [...props.adapters].sort((a, b) => adapterLabel(a).localeCompare(adapterLabel(b))),
);

// A distinct, format-appropriate icon per export type (lucide has no brand logos).
const ADAPTER_ICONS: Record<string, Component> = {
  "laravel-php": FileCode,   // PHP code file
  "vue-i18n-json": FileJson, // JSON file
  "next-intl-json": FileJson, // JSON file
  "flutter-arb": Smartphone, // mobile app
  "angular-xliff": FileCode, // XML translation file
  "rails-yaml": FileCode,    // YAML locale file
  "apple-strings": Smartphone, // Apple platform
};
function adapterIcon(a: string): Component {
  return ADAPTER_ICONS[a] ?? FileText;
}

function patch(p: Partial<OutputForm>) {
  emit("update:output", { ...props.output, ...p });
}

// Adapter defaults so a fresh output (or one without emptyAs) shows the right value.
function adapterEmptyDefault(adapter: string): "source" | "empty" | "omit" {
  return adapter === "flutter-arb" ? "omit" : "source";
}
function changeAdapter(adapter: string) {
  patch({
    adapter,
    emptyAs: adapterEmptyDefault(adapter),
    style: adapter === "vue-i18n-json" || adapter === "next-intl-json" ? "nested" : props.output.style,
    includeLocale: true,
  });
}

const emptyAs = computed(() => props.output.emptyAs ?? adapterEmptyDefault(props.output.adapter));
const effNewline = computed(() => props.output.finalNewline ?? props.formatFinalNewline);
const indentOverridden = computed(() => props.output.indent != null);
const newlineOverridden = computed(() => props.output.finalNewline != null);

// ── locale aliases ────────────────────────────────────────────────────────────
const aliases = computed(() => props.output.localeAliases ?? {});
const aliasUsed = computed(() => Object.keys(aliases.value));
const aliasAvailable = computed(() => props.locales.filter((l) => !aliasUsed.value.includes(l)));

function setAliases(next: Record<string, string[]>) {
  patch({ localeAliases: next });
}
function addAliasLocale(code: string) {
  setAliases({ ...aliases.value, [code]: [] });
}
function removeAliasLocale(code: string) {
  const next = { ...aliases.value };
  delete next[code];
  setAliases(next);
}
function addAliasCode(code: string) {
  const val = (aliasDraft.value[code] ?? "").trim();
  if (!val) return;
  const list = aliases.value[code] ?? [];
  if (list.includes(val)) return;
  setAliases({ ...aliases.value, [code]: [...list, val] });
  aliasDraft.value = { ...aliasDraft.value, [code]: "" };
}
function removeAliasCode(code: string, val: string) {
  setAliases({ ...aliases.value, [code]: (aliases.value[code] ?? []).filter((c) => c !== val) });
}

// ── locale overrides (localeMap) ────────────────────────────────────────────────
const localeMap = computed(() => props.output.localeMap ?? {});
const localeMapUsed = computed(() => Object.keys(localeMap.value));
const localeMapAvailable = computed(() => props.locales.filter((l) => !localeMapUsed.value.includes(l)));

function setLocaleMap(next: Record<string, string>) {
  patch({ localeMap: next });
}
function addLocaleMapKey(code: string) {
  setLocaleMap({ ...localeMap.value, [code]: code });
}
function removeLocaleMapKey(code: string) {
  const next = { ...localeMap.value };
  delete next[code];
  setLocaleMap(next);
}
function updateLocaleMapValue(code: string, val: string) {
  setLocaleMap({ ...localeMap.value, [code]: val });
}
</script>

<template>
  <div class="rounded-lg border" :class="open ? 'border-input' : 'border-border'">
    <!-- collapsed row -->
    <div class="flex items-center gap-2 p-2">
      <Tooltip>
        <TooltipTrigger as-child>
          <button
            type="button"
            class="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            :aria-label="open ? 'Collapse' : 'Expand options'"
            @click="open = !open"
          >
            <ChevronRight class="size-4 transition-transform" :class="open ? 'rotate-90' : ''" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{{ open ? "Collapse" : "Expand options" }}</TooltipContent>
      </Tooltip>

      <Select :model-value="output.adapter" @update:model-value="changeAdapter">
        <SelectTrigger class="w-44 shrink-0">
          <!-- !flex: SelectTrigger's [&>span]:line-clamp-1 forces display:-webkit-box,
               which would stack the icon above the label. -->
          <span class="!flex items-center gap-2">
            <component :is="adapterIcon(output.adapter)" class="size-3.5 shrink-0 text-primary" />
            <span class="truncate font-medium">{{ adapterLabel(output.adapter) }}</span>
          </span>
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="a in sortedAdapters" :key="a" :value="a">
            <span class="flex items-center gap-2">
              <component :is="adapterIcon(a)" class="size-3.5 text-primary" />
              {{ adapterLabel(a) }}
            </span>
          </SelectItem>
          <SelectItem v-if="output.adapter && !adapters.includes(output.adapter)" :value="output.adapter">{{ output.adapter }}</SelectItem>
        </SelectContent>
      </Select>

      <Input
        :model-value="output.path"
        class="flex-1 font-mono text-sm"
        placeholder="lib/l10n/app_{locale}.arb"
        spellcheck="false"
        aria-label="Output path"
        @update:model-value="(v: string | number) => patch({ path: String(v) })"
      />

      <Button
        variant="ghost" size="icon"
        class="shrink-0 text-muted-foreground hover:text-destructive"
        aria-label="Remove output"
        @click="emit('remove')"
      ><Trash2 class="size-4" /></Button>
    </div>

    <!-- expanded panel -->
    <div v-if="open" class="grid gap-5 border-t border-border p-4">
      <!-- Empty keys -->
      <div v-if="supports('emptyAs')" class="grid gap-1.5">
        <Label>Empty keys</Label>
        <p class="text-xs text-muted-foreground">What to write when a translation is missing.</p>
        <div class="mt-1 inline-flex w-fit rounded-md border border-input p-0.5">
          <button
            v-for="opt in EMPTY_OPTS" :key="opt.value" type="button"
            class="rounded-[5px] px-2.5 py-1 text-xs font-medium transition-colors"
            :class="emptyAs === opt.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'"
            @click="patch({ emptyAs: opt.value })"
          >{{ opt.label }}</button>
        </div>
      </div>

      <!-- Nesting -->
      <div v-if="supports('style')" class="grid gap-1.5">
        <Label>Nesting</Label>
        <p class="text-xs text-muted-foreground">Expand dotted keys into nested objects.</p>
        <div class="mt-1 inline-flex w-fit rounded-md border border-input p-0.5">
          <button
            v-for="opt in (['nested', 'flat'] as const)" :key="opt" type="button"
            class="rounded-[5px] px-2.5 py-1 text-xs font-medium capitalize transition-colors"
            :class="(output.style ?? 'nested') === opt ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'"
            @click="patch({ style: opt })"
          >{{ opt }}</button>
        </div>
      </div>

      <!-- Indent (inherit/override) -->
      <div v-if="supports('indent')" class="grid gap-1.5">
        <div class="flex items-center gap-2">
          <Label>Indent</Label>
          <span v-if="!indentOverridden" class="text-xs text-muted-foreground">Inherited · {{ formatIndent }}</span>
          <button v-else type="button" class="text-xs text-primary hover:underline" @click="patch({ indent: null })">Reset</button>
        </div>
        <div class="flex items-center gap-2">
          <Input
            type="number" min="0" max="8" class="w-20"
            :class="indentOverridden ? 'border-primary' : ''"
            :model-value="output.indent ?? ''"
            :placeholder="String(formatIndent)"
            @update:model-value="(v: string | number) => patch({ indent: v === '' ? null : Math.max(0, parseInt(String(v), 10) || 0) })"
          />
          <span class="text-xs text-muted-foreground">spaces</span>
        </div>
      </div>

      <!-- Final newline (inherit/override) -->
      <div v-if="supports('finalNewline')" class="grid gap-1.5">
        <div class="flex items-center gap-2">
          <Label>Final newline</Label>
          <span v-if="!newlineOverridden" class="text-xs text-muted-foreground">Inherited · {{ formatFinalNewline ? "on" : "off" }}</span>
          <button v-else type="button" class="text-xs text-primary hover:underline" @click="patch({ finalNewline: null })">Reset</button>
        </div>
        <div class="flex items-center gap-2">
          <Switch :model-value="effNewline" @update:model-value="(v: boolean) => patch({ finalNewline: v })" />
          <span class="text-xs text-muted-foreground">{{ effNewline ? "Enabled" : "Disabled" }}</span>
        </div>
      </div>

      <!-- include @@locale (ARB) -->
      <div v-if="supports('includeLocale')" class="grid gap-1.5">
        <Label class="flex items-center gap-1.5">Include <code class="font-mono text-xs">@@locale</code></Label>
        <p class="text-xs text-muted-foreground">Write the locale marker into each file. Standard for Flutter.</p>
        <div class="flex items-center gap-2">
          <Switch :model-value="output.includeLocale ?? true" @update:model-value="(v: boolean) => patch({ includeLocale: v })" />
          <span class="text-xs text-muted-foreground">{{ (output.includeLocale ?? true) ? "Enabled" : "Disabled" }}</span>
        </div>
      </div>

      <!-- Locale code format -->
      <div class="grid gap-1.5">
        <Label>Locale code format</Label>
        <p class="text-xs text-muted-foreground">How the <code class="font-mono text-xs">{locale}</code> token is rendered in file names (and the in-file marker for ARB).</p>
        <Select :model-value="localeCaseModel" @update:model-value="setLocaleCase">
          <SelectTrigger class="w-72" aria-label="Locale code format">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">{{ defaultCaseLabel(output.adapter) }}</SelectItem>
            <SelectItem v-for="opt in LOCALE_CASE_OPTS" :key="opt.value" :value="opt.value">
              <span class="flex w-full items-center justify-between gap-4">
                <span>{{ opt.label }}</span>
                <span class="font-mono text-xs text-muted-foreground">{{ opt.example }}</span>
              </span>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <!-- Locale overrides (localeMap) -->
      <div class="grid gap-1.5">
        <Label>Locale overrides</Label>
        <p class="text-xs text-muted-foreground">Force a specific export code for one locale — wins over the format above.</p>
        <div class="mt-1 grid gap-2">
          <p v-if="localeMapUsed.length === 0" class="text-xs text-muted-foreground">No overrides.</p>
          <div v-for="code in localeMapUsed" :key="code" class="flex items-center gap-2">
            <span class="w-24 shrink-0 font-mono text-xs font-semibold">{{ code }}</span>
            <ArrowRight class="size-3 shrink-0 text-muted-foreground" />
            <Input
              class="h-8 flex-1 font-mono text-xs"
              :aria-label="'Export code for ' + code"
              placeholder="export code"
              :model-value="localeMap[code] ?? ''"
              @update:model-value="(v: string | number) => updateLocaleMapValue(code, String(v))"
            />
            <Button
              variant="ghost" size="icon"
              class="size-8 shrink-0 text-muted-foreground hover:text-destructive"
              :aria-label="'Remove override ' + code"
              @click="removeLocaleMapKey(code)"
            ><Trash2 class="size-3.5" /></Button>
          </div>
          <div v-if="localeMapAvailable.length > 0">
            <Select model-value="" @update:model-value="addLocaleMapKey">
              <SelectTrigger class="w-56 text-muted-foreground" aria-label="Add locale override">
                <span class="!flex items-center gap-1.5"><Plus class="size-3.5" /> Add override…</span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="l in localeMapAvailable" :key="l" :value="l">{{ l }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <!-- Advanced: locale aliases -->
      <div class="border-t border-border pt-4">
        <div class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Advanced · Locale aliases</div>
        <p class="mt-1.5 text-xs text-muted-foreground">
          Write one catalog locale to additional file codes — e.g. <span class="font-mono">zh-Hans</span> also as <span class="font-mono">zh, zh_CN</span>.
        </p>
        <div class="mt-2 grid gap-2">
          <p v-if="aliasUsed.length === 0" class="text-xs text-muted-foreground">No aliases. The locale's own code is used as the file name.</p>
          <div v-for="code in aliasUsed" :key="code" class="flex items-start gap-2">
            <div class="flex h-8 shrink-0 items-center gap-1.5">
              <span class="font-mono text-xs font-semibold">{{ code }}</span>
              <ArrowRight class="size-3 text-muted-foreground" />
            </div>
            <div class="flex flex-1 flex-wrap items-center gap-1.5">
              <span v-for="c in (aliases[code] ?? [])" :key="c" class="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">
                {{ c }}
                <Tooltip>
                  <TooltipTrigger as-child>
                    <button type="button" class="text-muted-foreground hover:text-destructive" aria-label="Remove" @click="removeAliasCode(code, c)"><X class="size-3" /></button>
                  </TooltipTrigger>
                  <TooltipContent>Remove</TooltipContent>
                </Tooltip>
              </span>
              <Input
                class="h-8 w-28 font-mono text-xs"
                placeholder="add code…"
                :model-value="aliasDraft[code] ?? ''"
                @update:model-value="(v: string | number) => aliasDraft = { ...aliasDraft, [code]: String(v) }"
                @keydown.enter.prevent="addAliasCode(code)"
              />
            </div>
            <Tooltip>
              <TooltipTrigger as-child>
                <Button variant="ghost" size="icon" class="size-8 shrink-0 text-muted-foreground hover:text-destructive" aria-label="Remove alias" @click="removeAliasLocale(code)">
                  <Trash2 class="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Remove alias</TooltipContent>
            </Tooltip>
          </div>
          <div v-if="aliasAvailable.length > 0">
            <Select model-value="" @update:model-value="addAliasLocale">
              <SelectTrigger class="w-56 text-muted-foreground">
                <span class="!flex items-center gap-1.5"><Plus class="size-3.5" /> Add locale alias…</span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="l in aliasAvailable" :key="l" :value="l">{{ l }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
