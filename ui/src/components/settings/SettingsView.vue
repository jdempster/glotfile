<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, onUnmounted } from "vue";
import {
  Globe, FileText, Cpu, BookOpen, Code2, ScanSearch, ShieldCheck,
  Plus, X, AlertTriangle, Check, Undo2, Save, Lock, Zap, Languages, RefreshCw, Search,
} from "lucide-vue-next";
import { fetchState, putConfig, getLocalSettings, putLocalSettings, getAiProfiles, putAiProfile, deleteAiProfile, setActiveAiProfile, getPrices, refreshPrices as refreshPricesApi, getPricesList } from "@/api.js";
import type { PricesStatus, PriceRow } from "@/api.js";
import type { Config, AiSettings } from "@/types.js";
import { toast } from "@/components/ui/toast";
import { currentEditor, setEditor, EDITORS, type EditorId } from "@/editor.js";
import { configToForm, formToConfig, type ConfigForm } from "./config-form.js";
import { LINT_RULES, RULE_DEFAULTS } from "@/lint-rules.js";
import { settingsDirtyCount } from "./save-state.js";
import { setLeaveGuard, navigate, getHashSearch, type Route } from "@/router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectTrigger, SelectContent, SelectItem, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import LanguageLabel from "@/components/lang/LanguageLabel.vue";
import OutputEditor from "./OutputEditor.vue";
import ScanListField from "./ScanListField.vue";
import SyncWizard from "@/components/sync/SyncWizard.vue";

const SECTION_IDS = ["languages", "outputs", "ai", "scan", "quality", "dictionary", "editor"] as const;
type SectionId = (typeof SECTION_IDS)[number];

const ADAPTERS = ["flutter-arb", "laravel-php", "vue-i18n-json", "next-intl-json", "angular-xliff", "rails-yaml", "apple-strings"];

const AI_PROVIDERS = [
  { value: "anthropic",  label: "Anthropic" },
  { value: "bedrock",    label: "AWS Bedrock" },
  { value: "claude-code", label: "Claude Code" },
  { value: "ollama",     label: "Ollama" },
  { value: "openai",     label: "OpenAI" },
  { value: "openrouter", label: "OpenRouter" },
];

const MODEL_SUGGESTIONS: Record<string, string[]> = {
  anthropic: ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
  openai: ["gpt-4o-mini", "gpt-4o", "gpt-4.1"],
  bedrock: ["amazon.nova-pro-v1:0", "anthropic.claude-3-5-sonnet-20241022-v2:0", "meta.llama3-1-70b-instruct-v1:0"],
  openrouter: ["anthropic/claude-3.5-haiku", "openai/gpt-4o-mini", "google/gemini-2.0-flash-001"],
  ollama: ["translategemma:4b", "translategemma:12b", "qwen3.5:9b"],
  "claude-code": ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
};

const CREDENTIAL_HINTS: Record<string, string> = {
  anthropic: "Set ANTHROPIC_API_KEY in your environment (or a .env file).",
  openai:    "Set OPENAI_API_KEY in your environment (or a .env file).",
  bedrock:   "Uses your AWS credentials (env vars, AWS_PROFILE, or an instance/SSO role).",
  openrouter: "Set OPENROUTER_API_KEY in your environment (or a .env file).",
  ollama:    "Runs locally — no API key needed. Set OLLAMA_API_KEY only for a secured/remote server.",
  "claude-code": "Uses your local Claude Code session — no separate API key needed. Requires the claude CLI to be installed.",
};

// ── Store: saved snapshot vs working draft ───────────────────────────────────

const saved = ref<ConfigForm | null>(null);
// The raw loaded config, kept so a save preserves sections the form doesn't model (lint).
const original = ref<Config | null>(null);
const draft = reactive<ConfigForm>({
  sourceLocale: "", locales: [], outputs: [],
  indent: 2, sortKeys: true, finalNewline: true,
  autoExport: true,
  exportLocales: [],
  customWords: [],
  lintRules: {}, lintIgnore: [],
  scanAccessors: [], scanPatterns: [], scanInclude: [], scanExclude: [], scanKeep: [],
});

const loaded = ref(false);
const saving = ref(false);
// The active subtab lives in the URL (#settings?section=<id>) so it survives a
// reload/deep-link and joins browser history — back/forward steps through subtabs.
const activeSection = ref<SectionId>(sectionFromHash());
const showDiscard = ref(false);

function sectionFromHash(): SectionId {
  const s = getHashSearch().get("section") ?? "";
  return (SECTION_IDS as readonly string[]).includes(s) ? (s as SectionId) : "languages";
}

function selectSection(id: SectionId) {
  activeSection.value = id;
  // Assigning the hash (rather than replaceState) pushes a history entry, so the
  // back button returns to the previously viewed subtab.
  location.hash = `settings?section=${id}`;
}

// Keep the view in step with the URL when the user navigates history (back/forward)
// or edits the hash directly.
function onHashChange() {
  activeSection.value = sectionFromHash();
}
// Set to the route the user tried to reach while the draft was dirty; drives the
// "leave with unsaved changes?" warning and is the destination we resume on confirm.
const pendingRoute = ref<Route | null>(null);
const showToast = ref(false);
let toastTimer: ReturnType<typeof setTimeout> | null = null;

function applyForm(f: ConfigForm) {
  draft.sourceLocale = f.sourceLocale;
  draft.locales      = [...f.locales];
  draft.outputs      = f.outputs.map((o) => ({ ...o }));
  draft.indent       = f.indent;
  draft.sortKeys     = f.sortKeys;
  draft.finalNewline = f.finalNewline;
  draft.autoExport   = f.autoExport;
  draft.exportLocales = [...f.exportLocales];
  draft.customWords  = [...f.customWords];
  draft.lintRules    = { ...f.lintRules };
  draft.lintIgnore   = [...f.lintIgnore];
  draft.scanAccessors = [...f.scanAccessors];
  draft.scanPatterns = [...f.scanPatterns];
  draft.scanInclude  = [...f.scanInclude];
  draft.scanExclude  = [...f.scanExclude];
  draft.scanKeep     = [...f.scanKeep];
}

function snapSaved() {
  saved.value = {
    sourceLocale: draft.sourceLocale,
    locales:      [...draft.locales],
    outputs:      draft.outputs.map((o) => ({ ...o })),
    indent:       draft.indent,
    sortKeys:     draft.sortKeys,
    finalNewline: draft.finalNewline,
    autoExport:   draft.autoExport,
    exportLocales: [...draft.exportLocales],
    customWords:  [...draft.customWords],
    lintRules:    { ...draft.lintRules },
    lintIgnore:   [...draft.lintIgnore],
    scanAccessors: [...draft.scanAccessors],
    scanPatterns: [...draft.scanPatterns],
    scanInclude:  [...draft.scanInclude],
    scanExclude:  [...draft.scanExclude],
    scanKeep:     [...draft.scanKeep],
  };
}

async function load() {
  const state = await fetchState();
  original.value = state.config;
  applyForm(configToForm(state.config));
  snapSaved();
  await loadLocal();
  loaded.value = true;
  loadPrices();
}
load();

// ── Local (not committed) settings: AI provider/model + editor ───────────────
// Stored per-project in .glotfile/settings.json, never committed. Edits autosave
// straight to that file, so they stay out of the committed-config Save/dirty flow.

// Profile management
const profiles = ref<Record<string, AiSettings>>({});
const profileNames = computed(() => Object.keys(profiles.value).sort((a, b) => a.localeCompare(b)));
const activeProfile = ref<string | null>(null);
const profileNameDraft = ref(""); // editable name for selected profile

// The AI config being edited — either the active profile or the bare ai fallback
const aiDraft = reactive({
  provider: "anthropic", model: "", endpoint: "", region: "",
  batchSize: 25 as number | string,
  concurrency: "" as number | string,
  contextBatchSize: "" as number | string,
  contextConcurrency: "" as number | string,
  vision: false,
  promptStyle: "" as string,
  inputPricePerMTok: "" as number | string,
  outputPricePerMTok: "" as number | string,
});
const aiJustSaved = ref(false);
let aiSavedTimer: ReturnType<typeof setTimeout> | null = null;
let aiSaveTimer: ReturnType<typeof setTimeout> | null = null;
let savedAiJson = "";

async function loadLocal() {
  const [ls, prof] = await Promise.all([getLocalSettings(), getAiProfiles()]);
  profiles.value = prof.profiles;
  activeProfile.value = prof.activeProfile;
  profileNameDraft.value = prof.activeProfile ?? "";
  const ai = activeProfile.value ? (prof.profiles[activeProfile.value] ?? ls.ai) : ls.ai;
  applyAiDraft(ai);
  savedAiJson = JSON.stringify(aiToSettings());
}

function applyAiDraft(ai: AiSettings) {
  aiDraft.provider = ai.provider;
  aiDraft.model = ai.model;
  aiDraft.endpoint = ai.endpoint ?? "";
  aiDraft.region = ai.region ?? "";
  aiDraft.batchSize = ai.batchSize;
  aiDraft.concurrency = ai.concurrency ?? "";
  aiDraft.contextBatchSize = ai.contextBatchSize ?? "";
  aiDraft.contextConcurrency = ai.contextConcurrency ?? "";
  aiDraft.vision = ai.vision ?? false;
  aiDraft.promptStyle = ai.promptStyle ?? "";
  aiDraft.inputPricePerMTok = ai.inputPricePerMTok ?? "";
  aiDraft.outputPricePerMTok = ai.outputPricePerMTok ?? "";
  savedAiJson = JSON.stringify(aiToSettings());
}

function aiToSettings(): AiSettings {
  const endpoint = String(aiDraft.endpoint).trim();
  const region = String(aiDraft.region).trim();
  const n = Number(aiDraft.batchSize);
  const c = Number(aiDraft.concurrency);
  const cb = Number(aiDraft.contextBatchSize);
  const cc = Number(aiDraft.contextConcurrency);
  const pin = Number(aiDraft.inputPricePerMTok);
  const pout = Number(aiDraft.outputPricePerMTok);
  return {
    provider: aiDraft.provider.trim(),
    model: aiDraft.model.trim(),
    endpoint: endpoint === "" ? null : endpoint,
    region: region === "" ? null : region,
    batchSize: Number.isFinite(n) && n > 0 ? n : 25,
    concurrency: Number.isFinite(c) && c > 0 ? c : undefined,
    contextBatchSize: Number.isFinite(cb) && cb > 0 ? cb : undefined,
    contextConcurrency: Number.isFinite(cc) && cc > 0 ? cc : undefined,
    vision: aiDraft.vision || undefined,
    promptStyle: aiDraft.promptStyle || undefined,
    // Unlike the count fields, 0 is a meaningful price (free model) — only an
    // empty input means "unset, use the built-in table".
    inputPricePerMTok: aiDraft.inputPricePerMTok !== "" && Number.isFinite(pin) && pin >= 0 ? pin : undefined,
    outputPricePerMTok: aiDraft.outputPricePerMTok !== "" && Number.isFinite(pout) && pout >= 0 ? pout : undefined,
  };
}

// Debounced autosave: persist the AI block a beat after the last edit (so typing a
// model name is one write, not one per keystroke), then flash a "Saved" indicator.
watch(aiDraft, () => {
  if (JSON.stringify(aiToSettings()) === savedAiJson) return;
  if (aiSaveTimer) clearTimeout(aiSaveTimer);
  aiSaveTimer = setTimeout(async () => {
    const ai = aiToSettings();
    try {
      if (activeProfile.value) {
        await putAiProfile(activeProfile.value, ai);
        profiles.value = { ...profiles.value, [activeProfile.value]: ai };
      } else {
        await putLocalSettings({ ai });
      }
      savedAiJson = JSON.stringify(ai);
      aiJustSaved.value = true;
      if (aiSavedTimer) clearTimeout(aiSavedTimer);
      aiSavedTimer = setTimeout(() => { aiJustSaved.value = false; }, 1700);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, 500);
}, { deep: true });

// ── Model price cache (models.dev) ───────────────────────────────────────────
// Status of ~/.glotfile/model-prices.json plus an explicit refresh. The refresh
// is the only thing here that hits the network.
const pricesStatus = ref<PricesStatus | null>(null);
const refreshingPrices = ref(false);

async function loadPrices() {
  try {
    pricesStatus.value = await getPrices();
  } catch {
    // Best-effort status; the manual price fields work without it.
  }
}

async function refreshModelPrices() {
  refreshingPrices.value = true;
  try {
    const res = await refreshPricesApi();
    toast.success(`Updated ${res.modelCount} model prices from ${res.source}.`);
    priceRowsLoaded.value = false;
    await loadPrices();
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    refreshingPrices.value = false;
  }
}

const pricesFetchedLabel = computed(() => {
  const at = pricesStatus.value?.fetchedAt;
  if (!at) return null;
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString();
});

// Browse/search the full cached price table (loaded lazily on first open).
const pricesDialogOpen = ref(false);
const priceRows = ref<PriceRow[]>([]);
const priceRowsLoaded = ref(false);
const priceQuery = ref("");
const PRICE_LIST_CAP = 200;

async function openPricesList() {
  pricesDialogOpen.value = true;
  if (priceRowsLoaded.value) return;
  try {
    priceRows.value = (await getPricesList()).models;
    priceRowsLoaded.value = true;
  } catch (e) {
    toast.error((e as Error).message);
  }
}

// Forgiving search: lowercase, strip punctuation, and match each whitespace
// term independently — so "opus 4.8", "GPT4o mini", "haiku claude" all hit the
// models you'd expect regardless of separators, case, or word order.
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
const filteredPriceRows = computed(() => {
  const terms = priceQuery.value.trim().split(/\s+/).map(squash).filter(Boolean);
  if (!terms.length) return priceRows.value;
  return priceRows.value.filter((m) => {
    const id = squash(m.id);
    return terms.every((t) => id.includes(t));
  });
});
const visiblePriceRows = computed(() => filteredPriceRows.value.slice(0, PRICE_LIST_CAP));
const hiddenPriceCount = computed(() => Math.max(0, filteredPriceRows.value.length - PRICE_LIST_CAP));

// Pick a handful of models to compare side by side in a small bar graph.
const MAX_COMPARE = 8;
const comparedIds = ref<string[]>([]);
const isCompared = (id: string) => comparedIds.value.includes(id);

function toggleCompare(id: string) {
  const i = comparedIds.value.indexOf(id);
  if (i >= 0) comparedIds.value.splice(i, 1);
  else if (comparedIds.value.length >= MAX_COMPARE) toast.error(`Compare up to ${MAX_COMPARE} models at once.`);
  else comparedIds.value.push(id);
}

const comparedRows = computed(() => {
  const byId = new Map(priceRows.value.map((m) => [m.id, m]));
  return comparedIds.value.map((id) => byId.get(id)).filter((m): m is PriceRow => !!m);
});
// Bars are scaled to the largest price among the compared models (output is
// almost always the largest), with a 1 floor so an all-zero set doesn't divide
// by zero.
const maxComparedPrice = computed(() =>
  Math.max(1, ...comparedRows.value.flatMap((m) => [m.inputPerMTok, m.outputPerMTok])));
const compareBarWidth = (v: number) => `${Math.max(1.5, (v / maxComparedPrice.value) * 100)}%`;

// ── Dirty tracking ───────────────────────────────────────────────────────────

const NON_AUTOSAVE: SectionId[] = ["languages", "outputs", "scan", "quality", "dictionary"];
// AI + editor are per-developer local settings (autosaved to .glotfile), not committed config.
const LOCAL_SECTIONS: SectionId[] = ["ai", "editor"];

function sectionEq(id: SectionId): boolean {
  if (!saved.value) return true;
  const d = draft, s = saved.value;
  if (id === "languages") return JSON.stringify(d.locales) === JSON.stringify(s.locales) && d.sourceLocale === s.sourceLocale;
  // Outputs now also owns the global format defaults + auto-export + export-language limit (Format folded in).
  if (id === "outputs")   return JSON.stringify(d.outputs) === JSON.stringify(s.outputs)
    && String(d.indent) === String(s.indent) && d.finalNewline === s.finalNewline && d.autoExport === s.autoExport
    && JSON.stringify(d.exportLocales) === JSON.stringify(s.exportLocales);
  if (id === "scan") return JSON.stringify(d.scanAccessors) === JSON.stringify(s.scanAccessors)
    && JSON.stringify(d.scanPatterns) === JSON.stringify(s.scanPatterns)
    && JSON.stringify(d.scanInclude) === JSON.stringify(s.scanInclude)
    && JSON.stringify(d.scanExclude) === JSON.stringify(s.scanExclude)
    && JSON.stringify(d.scanKeep) === JSON.stringify(s.scanKeep);
  if (id === "quality") return JSON.stringify(d.lintRules) === JSON.stringify(s.lintRules)
    && JSON.stringify(d.lintIgnore) === JSON.stringify(s.lintIgnore);
  if (id === "dictionary") return JSON.stringify(d.customWords) === JSON.stringify(s.customWords);
  return true;
}

const dirtyIds    = computed(() => NON_AUTOSAVE.filter((id) => !sectionEq(id)));
const dirtyCount  = computed(() => dirtyIds.value.length);
const dirtyTitles = computed(() => dirtyIds.value.map((id) => SECTION_META[id].title));

watch(dirtyCount, (n) => { settingsDirtyCount.value = n; }, { immediate: true });
onUnmounted(() => { settingsDirtyCount.value = 0; });

// ── Editor preference (local, not committed — lives in .glotfile/settings.json) ──
// Backed by the app-wide editor store; changing it autosaves to the server, so it
// never touches the committed-config Save/dirty flow.
const editorLabel = computed(() => EDITORS.find((e) => e.id === currentEditor.value)?.label ?? "VS Code");
const editorJustSaved = ref(false);
let editorSavedTimer: ReturnType<typeof setTimeout> | null = null;
function onEditorChange(id: EditorId) {
  setEditor(id);
  editorJustSaved.value = true;
  if (editorSavedTimer) clearTimeout(editorSavedTimer);
  editorSavedTimer = setTimeout(() => { editorJustSaved.value = false; }, 1700);
}

// ── Section metadata ─────────────────────────────────────────────────────────

interface SectionDef { id: SectionId; title: string; autosave?: boolean }
const SECTION_META: Record<SectionId, { title: string; autosave?: boolean }> = {
  languages:  { title: "Languages" },
  outputs:    { title: "Export targets" },
  ai:         { title: "AI" },
  scan:       { title: "Scan" },
  quality:    { title: "Quality checks" },
  dictionary: { title: "Custom dictionary" },
  editor:     { title: "Editor" },
};
const SECTIONS: SectionDef[] = [
  { id: "languages",  title: "Languages" },
  { id: "outputs",    title: "Export targets" },
  { id: "scan",       title: "Scan" },
  { id: "quality",    title: "Quality checks" },
  { id: "dictionary", title: "Custom dictionary" },
];

function sectionSummary(id: SectionId): string {
  if (id === "languages")  return `${draft.locales.length} language${draft.locales.length === 1 ? "" : "s"}`;
  if (id === "outputs")    return `${draft.outputs.length} target${draft.outputs.length === 1 ? "" : "s"}${draft.autoExport ? " · auto" : ""}${draft.exportLocales.length ? " · limited" : ""}`;
  if (id === "ai") return activeProfile.value ? `${activeProfile.value} · ${aiDraft.model}` : `${aiDraft.provider} · ${aiDraft.model}`;
  if (id === "scan") {
    const a = draft.scanAccessors.length, p = draft.scanPatterns.length, k = draft.scanKeep.length;
    const parts = [
      a && `${a} accessor${a === 1 ? "" : "s"}`,
      p && `${p} pattern${p === 1 ? "" : "s"}`,
      k && `${k} kept`,
    ].filter(Boolean);
    return parts.length ? parts.join(" · ") : "Auto-detect";
  }
  if (id === "quality") {
    const off = Object.entries(draft.lintRules).filter(([, sev]) => sev === "off").length;
    const adjusted = Object.entries(draft.lintRules).filter(([rid, sev]) => RULE_DEFAULTS[rid] !== undefined && sev !== RULE_DEFAULTS[rid]).length;
    if (!adjusted && !draft.lintIgnore.length) return "Defaults";
    const parts = [adjusted && `${adjusted} adjusted${off ? ` (${off} off)` : ""}`, draft.lintIgnore.length && `${draft.lintIgnore.length} ignored`].filter(Boolean);
    return parts.join(" · ");
  }
  if (id === "dictionary") return draft.customWords.length ? `${draft.customWords.length} word${draft.customWords.length === 1 ? "" : "s"}` : "No custom words";
  return "";
}

// ── Save / discard ───────────────────────────────────────────────────────────

async function doSave() {
  if (dirtyCount.value === 0) return;
  saving.value = true;
  try {
    await putConfig(formToConfig(draft, original.value ?? undefined));
    snapSaved();
    showToast.value = true;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { showToast.value = false; }, 1700);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    saving.value = false;
  }
}

function discardAll() {
  if (saved.value) applyForm(saved.value);
  showDiscard.value = false;
}

// ── Guard against losing an unsaved draft ────────────────────────────────────
// In-app navigation funnels through router.navigate(), so a registered guard can
// intercept a move away from Settings. Returning false aborts the move and pops
// the warning; the warning's buttons resume (or abandon) the navigation.

function guardLeave(to: Route): boolean {
  // Re-selecting Settings, or a clean draft, has nothing to lose.
  if (to === "settings" || dirtyCount.value === 0) return true;
  pendingRoute.value = to;
  return false;
}

function leaveTo(to: Route) {
  pendingRoute.value = null;
  navigate(to);
}

function cancelLeave() {
  pendingRoute.value = null;
}

function discardAndLeave() {
  const to = pendingRoute.value;
  discardAll();
  if (to) leaveTo(to);
}

async function saveAndLeave() {
  const to = pendingRoute.value;
  await doSave();
  // A failed save toasts and leaves the draft dirty — only leave once it's clean.
  if (to && dirtyCount.value === 0) leaveTo(to);
}

// A full-page unload (tab close, reload, switching the active file) can't be
// intercepted by the router; the native prompt is the only guard available.
function onBeforeUnload(e: BeforeUnloadEvent) {
  if (dirtyCount.value > 0) {
    e.preventDefault();
    e.returnValue = "";
  }
}

function onKeydown(e: KeyboardEvent) {
  // Escape dismisses the leave warning (same as "Keep editing").
  if (e.key === "Escape" && pendingRoute.value) {
    e.preventDefault();
    cancelLeave();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    doSave();
  }
}
onMounted(() => {
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("beforeunload", onBeforeUnload);
  window.addEventListener("hashchange", onHashChange);
  setLeaveGuard(guardLeave);
});
onUnmounted(() => {
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("beforeunload", onBeforeUnload);
  window.removeEventListener("hashchange", onHashChange);
  setLeaveGuard(null);
});

// ── Languages ────────────────────────────────────────────────────────────────

const newLocale = ref("");

function addLocale() {
  const loc = newLocale.value.trim().toLowerCase();
  if (!loc) return;
  if (draft.locales.some((l) => l.toLowerCase() === loc)) {
    toast.error(`${loc} is already in the list`); return;
  }
  draft.locales.push(loc);
  newLocale.value = "";
}

function removeLocale(loc: string) {
  if (loc === draft.sourceLocale) return;
  draft.locales = draft.locales.filter((l) => l !== loc);
}

// ── Outputs ──────────────────────────────────────────────────────────────────

function addOutput()           { draft.outputs.push({ adapter: "flutter-arb", path: "", emptyAs: "omit", style: "nested", indent: null, finalNewline: null, includeLocale: true, localeAliases: {} }); }
function removeOutput(i: number) { draft.outputs.splice(i, 1); }

// Export-language limit (testing): empty list = no limit. Turning it on selects all
// languages as the starting point; the user then narrows to the subset they want.
const exportLimited = computed(() => draft.exportLocales.length > 0);
function toggleExportLimit(on: boolean) {
  draft.exportLocales = on ? [...draft.locales] : [];
}
function toggleExportLocale(loc: string) {
  draft.exportLocales = draft.exportLocales.includes(loc)
    ? draft.exportLocales.filter((l) => l !== loc)
    : [...draft.exportLocales, loc];
}

// ── AI ───────────────────────────────────────────────────────────────────────

const isBedrock        = computed(() => aiDraft.provider === "bedrock");
const isOllama         = computed(() => aiDraft.provider === "ollama");
const credentialHint   = computed(() => CREDENTIAL_HINTS[aiDraft.provider] ?? "");
const modelSuggestions = computed(() => MODEL_SUGGESTIONS[aiDraft.provider] ?? []);
const modelPlaceholder = computed(() => modelSuggestions.value[0] ?? "");

async function selectProfile(name: string | null) {
  activeProfile.value = name;
  profileNameDraft.value = name ?? "";
  await setActiveAiProfile(name);
  const ai = name ? (profiles.value[name] ?? aiToSettings()) : (await getLocalSettings()).ai;
  applyAiDraft(ai);
}

async function createProfile() {
  const name = `Profile ${Object.keys(profiles.value).length + 1}`;
  const ai = aiToSettings();
  await putAiProfile(name, ai);
  profiles.value = { ...profiles.value, [name]: ai };
  await selectProfile(name);
}

async function renameProfile(oldName: string, newName: string) {
  const trimmed = newName.trim();
  if (!trimmed || trimmed === oldName) { profileNameDraft.value = oldName; return; }
  if (trimmed in profiles.value) { toast.error("A profile with that name already exists"); profileNameDraft.value = oldName; return; }
  const ai = profiles.value[oldName]!;
  await putAiProfile(trimmed, ai);
  await deleteAiProfile(oldName);
  const updated = { ...profiles.value };
  delete updated[oldName];
  updated[trimmed] = ai;
  profiles.value = updated;
  await selectProfile(trimmed);
}

async function deleteProfile() {
  if (!activeProfile.value) return;
  const name = activeProfile.value;
  await deleteAiProfile(name);
  const updated = { ...profiles.value };
  delete updated[name];
  profiles.value = updated;
  await selectProfile(null);
}

// ── Dictionary ───────────────────────────────────────────────────────────────

const newWord = ref("");

function addWord() {
  const w = newWord.value.trim();
  if (!w) return;
  if (draft.customWords.includes(w)) { toast.error(`${w} is already in the dictionary`); return; }
  draft.customWords = [...draft.customWords, w].sort();
  newWord.value = "";
}

function removeWord(word: string) {
  draft.customWords = draft.customWords.filter((w) => w !== word);
}

// ── Scan ─────────────────────────────────────────────────────────────────────
// Reject a custom pattern the engine couldn't compile (mirrors schema.validate).
function validatePattern(value: string): string | null {
  try { new RegExp(value); return null; } catch (e) { return `Invalid regex: ${(e as Error).message}`; }
}

// ── Sync from files ──────────────────────────────────────────────────────────
const showSyncWizard = ref(false);
const syncWizardRef = ref<InstanceType<typeof SyncWizard> | null>(null);
// A sync rewrites the catalog wholesale; reload so every view reflects it.
function onSynced(): void {
  location.reload();
}
</script>

<template>
  <div v-if="!loaded" class="flex flex-1 items-center justify-center text-sm text-muted-foreground">
    Loading settings…
  </div>

  <div v-else class="flex min-h-0 flex-1 overflow-hidden">
    <!-- ── Sidebar ── -->
    <nav class="flex w-60 shrink-0 flex-col gap-1 overflow-y-auto border-r bg-muted p-3">
      <p class="px-2.5 pb-2 pt-1 text-[10.5px] font-bold uppercase tracking-widest text-muted-foreground">
        Settings
      </p>

      <button
        v-for="sec in SECTIONS"
        :key="sec.id"
        type="button"
        :class="[
          'flex w-full items-center gap-2.5 rounded-[10px] border px-2.5 py-2.5 text-left transition-colors',
          activeSection === sec.id
            ? 'border-border bg-card text-foreground shadow-sm'
            : 'border-transparent bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground',
        ]"
        @click="selectSection(sec.id)"
      >
        <span :class="[
          'flex size-[30px] shrink-0 items-center justify-center rounded-lg border',
          activeSection === sec.id
            ? 'border-primary/30 bg-primary/10 text-primary'
            : 'border-border/60 bg-background text-muted-foreground',
        ]">
          <Globe      v-if="sec.id === 'languages'"  class="size-4" />
          <FileText   v-else-if="sec.id === 'outputs'" class="size-4" />
          <Cpu        v-else-if="sec.id === 'ai'"      class="size-4" />
          <ScanSearch v-else-if="sec.id === 'scan'"    class="size-4" />
          <ShieldCheck v-else-if="sec.id === 'quality'" class="size-4" />
          <BookOpen   v-else                            class="size-4" />
        </span>

        <span class="min-w-0 flex-1">
          <span class="block text-[13px] font-[570] leading-tight">{{ sec.title }}</span>
          <span class="mt-0.5 block truncate text-[11px] opacity-70">{{ sectionSummary(sec.id) }}</span>
        </span>

        <span
          v-if="!sec.autosave && dirtyIds.includes(sec.id)"
          class="size-2 shrink-0 rounded-full bg-primary ring-2 ring-primary/25"
        />
        <span
          v-if="sec.autosave"
          class="shrink-0 rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400"
        >Auto</span>
      </button>

      <!-- Local, per-developer settings — stored in .glotfile/, never committed -->
      <p class="mt-4 border-t px-2.5 pb-2 pt-3 text-[10.5px] font-bold uppercase tracking-widest text-muted-foreground">
        Local (not committed)
      </p>
      <button
        v-for="sec in LOCAL_SECTIONS"
        :key="sec"
        type="button"
        :class="[
          'flex w-full items-center gap-2.5 rounded-[10px] border px-2.5 py-2.5 text-left transition-colors',
          activeSection === sec
            ? 'border-border bg-card text-foreground shadow-sm'
            : 'border-transparent bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground',
        ]"
        @click="selectSection(sec)"
      >
        <span :class="[
          'flex size-[30px] shrink-0 items-center justify-center rounded-lg border',
          activeSection === sec
            ? 'border-primary/30 bg-primary/10 text-primary'
            : 'border-border/60 bg-background text-muted-foreground',
        ]">
          <Cpu   v-if="sec === 'ai'" class="size-4" />
          <Code2 v-else              class="size-4" />
        </span>
        <span class="min-w-0 flex-1">
          <span class="block text-[13px] font-[570] leading-tight">{{ SECTION_META[sec].title }}</span>
          <span class="mt-0.5 block truncate text-[11px] opacity-70">{{ sec === 'editor' ? editorLabel : sectionSummary(sec) }}</span>
        </span>
      </button>
    </nav>

    <!-- ── Detail pane ── -->
    <div class="relative flex min-w-0 flex-1 flex-col">
      <div class="flex-1 overflow-y-auto px-8 pb-28 pt-7">
        <div class="max-w-[680px]">

          <!-- Section heading -->
          <div class="mb-6">
            <h2 class="flex items-center gap-2.5 text-[21px] font-bold tracking-tight">
              {{ SECTION_META[activeSection].title }}
              <span
                v-if="dirtyIds.includes(activeSection)"
                class="size-2 rounded-full bg-primary ring-2 ring-primary/25"
              />
            </h2>

            <p v-if="activeSection === 'languages'" class="mt-1.5 text-sm text-muted-foreground">
              The source language is translated into every other language.
            </p>
            <p v-else-if="activeSection === 'outputs'" class="mt-1.5 text-sm text-muted-foreground">
              Where compiled translation files are written. Use
              <code class="rounded border bg-muted px-1 py-0.5 font-mono text-xs">{locale}</code> and
              <code class="rounded border bg-muted px-1 py-0.5 font-mono text-xs">{namespace}</code>
              placeholders in the path.
            </p>
            <p v-else-if="activeSection === 'ai'" class="mt-1.5 text-sm text-muted-foreground">
              The provider and model used for machine translation. Stored locally in
              <code class="rounded border bg-muted px-1 py-0.5 font-mono text-xs">.glotfile/</code>, not shared with your team.
            </p>
            <p v-else-if="activeSection === 'scan'" class="mt-1.5 text-sm text-muted-foreground">
              How the usage scanner finds where keys are referenced in code. Auto-detection
              handles most projects — these settings are for the cases it can't infer.
            </p>
            <p v-else-if="activeSection === 'quality'" class="mt-1.5 text-sm text-muted-foreground">
              Which checks run and how severe they are — in the editor, the Analytics release
              gate, and <code class="rounded border bg-muted px-1 py-0.5 font-mono text-xs">glotfile lint</code> alike.
              Errors block a release; warnings don't.
            </p>
            <p v-else-if="activeSection === 'dictionary'" class="mt-1.5 text-sm text-muted-foreground">
              Words the spell checker should never flag. Added here or from a cell's warning.
            </p>
            <p v-else-if="activeSection === 'editor'" class="mt-1.5 text-sm text-muted-foreground">
              Which editor opens when you click a key's code usage. Stored locally in
              <code class="rounded border bg-muted px-1 py-0.5 font-mono text-xs">.glotfile/</code>, not shared with your team.
            </p>

            <p
              v-if="LOCAL_SECTIONS.includes(activeSection)"
              class="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground"
            >
              <Zap class="size-3.5" /> Changes here save automatically.
            </p>
          </div>

          <!-- ── Languages body ── -->
          <div v-if="activeSection === 'languages'" class="flex flex-col gap-5">
            <div class="grid max-w-sm gap-1.5">
              <Label for="source-locale">Source language</Label>
              <Select v-model="draft.sourceLocale">
                <SelectTrigger id="source-locale">
                  <span v-if="draft.sourceLocale">
                    <LanguageLabel :code="draft.sourceLocale" show-name :size="14" />
                  </span>
                  <SelectValue v-else placeholder="Select source" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="loc in draft.locales" :key="loc" :value="loc">
                    <LanguageLabel :code="loc" show-name :size="14" />
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div class="grid gap-1.5">
              <Label>
                Languages
                <span class="ml-1.5 font-normal text-muted-foreground">{{ draft.locales.length }}</span>
              </Label>
              <div class="flex flex-wrap gap-2">
                <span
                  v-for="loc in draft.locales"
                  :key="loc"
                  :class="[
                    'inline-flex items-center gap-1.5 rounded-[9px] border px-2.5 py-1.5 text-sm transition-colors',
                    loc === draft.sourceLocale ? 'border-border/60 bg-accent' : 'border-border bg-background',
                  ]"
                >
                  <LanguageLabel :code="loc" show-name :size="14" />
                  <span v-if="loc === draft.sourceLocale" class="font-mono text-[10px] italic text-muted-foreground">source</span>
                  <button
                    v-else
                    type="button"
                    class="ml-0.5 flex size-[18px] items-center justify-center rounded text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    :aria-label="`Remove ${loc}`"
                    @click="removeLocale(loc)"
                  >
                    <X class="size-3" />
                  </button>
                </span>
              </div>
              <p class="mt-1 flex items-center gap-1.5 text-xs text-destructive">
                <AlertTriangle class="size-3.5" /> Removing a language deletes its translations.
              </p>
            </div>

            <div class="grid max-w-sm gap-1.5">
              <Label for="add-locale">Add language</Label>
              <div class="flex gap-2">
                <Input id="add-locale" v-model="newLocale" class="font-mono" placeholder="es" @keydown.enter.prevent="addLocale" />
                <Button variant="outline" @click="addLocale"><Plus class="size-4" /> Add</Button>
              </div>
              <p v-if="newLocale.trim()" class="flex items-center gap-1.5 text-xs text-muted-foreground">
                Preview: <LanguageLabel :code="newLocale.trim()" show-name :size="14" />
              </p>
            </div>
          </div>

          <!-- ── Outputs body (auto-export + format defaults folded in) ── -->
          <div v-else-if="activeSection === 'outputs'" class="flex flex-col gap-6">
            <!-- Auto-export -->
            <div class="flex items-center justify-between gap-4 rounded-lg border p-3.5">
              <div class="flex items-start gap-2.5">
                <span class="grid size-8 shrink-0 place-items-center rounded-md border border-primary/25 bg-primary/10 text-primary"><Zap class="size-4" /></span>
                <div>
                  <div class="text-sm font-medium">Auto-export on save</div>
                  <div class="mt-0.5 text-xs text-muted-foreground">Write locale files to your project automatically as you edit, so your running app picks them up immediately.</div>
                </div>
              </div>
              <Switch v-model="draft.autoExport" />
            </div>

            <!-- Sync from files -->
            <div class="flex items-center justify-between gap-4 rounded-lg border p-3.5">
              <div class="flex items-start gap-2.5">
                <span class="grid size-8 shrink-0 place-items-center rounded-md border border-primary/25 bg-primary/10 text-primary"><RefreshCw class="size-4" /></span>
                <div>
                  <div class="text-sm font-medium">Sync from files</div>
                  <div class="mt-0.5 text-xs text-muted-foreground">Re-read the locale files on disk and merge changes into the catalog — keeping glossary, context and translations. For Angular, run this after <span class="font-mono">ng extract-i18n</span>.</div>
                </div>
              </div>
              <Button variant="outline" size="sm" data-testid="open-sync" class="shrink-0" @click="showSyncWizard = true">
                <RefreshCw class="size-4" /> Sync
              </Button>
            </div>

            <!-- Limit export languages -->
            <div class="rounded-lg border p-3.5">
              <div class="flex items-center justify-between gap-4">
                <div class="flex items-start gap-2.5">
                  <span class="grid size-8 shrink-0 place-items-center rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"><Languages class="size-4" /></span>
                  <div>
                    <div class="text-sm font-medium">Limit export languages</div>
                    <div class="mt-0.5 text-xs text-muted-foreground">Only the selected languages are written to disk, including auto-export. Off exports all languages.</div>
                  </div>
                </div>
                <Switch :model-value="exportLimited" @update:model-value="toggleExportLimit" />
              </div>

              <div v-if="exportLimited" class="mt-3 border-t pt-3">
                <div class="flex flex-wrap gap-2">
                  <button
                    v-for="loc in draft.locales"
                    :key="loc"
                    type="button"
                    role="checkbox"
                    :aria-checked="draft.exportLocales.includes(loc)"
                    :class="[
                      'inline-flex items-center gap-1.5 rounded-[9px] border px-2.5 py-1.5 text-sm transition-colors',
                      draft.exportLocales.includes(loc) ? 'border-primary/40 bg-primary/10' : 'border-border bg-background text-muted-foreground hover:bg-accent',
                    ]"
                    @click="toggleExportLocale(loc)"
                  >
                    <span class="flex size-4 items-center justify-center rounded border transition-colors" :class="draft.exportLocales.includes(loc) ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground hover:border-primary hover:bg-primary/10'">
                      <Check v-if="draft.exportLocales.includes(loc)" class="size-3" />
                    </span>
                    <LanguageLabel :code="loc" show-name :size="14" />
                  </button>
                </div>
                <p class="mt-2 flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                  <AlertTriangle class="size-3.5" />
                  Export limited to {{ draft.exportLocales.length }} of {{ draft.locales.length }} languages.
                </p>
              </div>
            </div>

            <!-- Format defaults -->
            <div>
              <div class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Format defaults</div>
              <p class="mt-1 text-xs text-muted-foreground">Export targets inherit these. Indent and Final newline can be overridden per target.</p>
              <div class="mt-2 divide-y rounded-lg border">
                <div class="flex items-center justify-between gap-4 p-3.5">
                  <div>
                    <div class="text-sm font-medium">Indent</div>
                    <div class="mt-0.5 text-xs text-muted-foreground">Spaces per nesting level.</div>
                  </div>
                  <div class="flex items-center gap-2">
                    <Input v-model.number="draft.indent" type="number" min="0" max="8" class="w-20" />
                    <span class="text-xs text-muted-foreground">spaces</span>
                  </div>
                </div>
                <div class="flex items-center justify-between gap-4 p-3.5">
                  <div>
                    <div class="flex items-center gap-2 text-sm font-medium">
                      Sort keys
                      <span class="inline-flex items-center gap-1 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"><Lock class="size-2.5" /> Locked</span>
                    </div>
                    <div class="mt-0.5 text-xs text-muted-foreground">Keys are always written alphabetically so output is deterministic and diffs stay clean.</div>
                  </div>
                  <span class="inline-flex shrink-0 items-center gap-1 rounded-md border border-primary/25 bg-primary/10 px-2 py-1 text-xs font-medium text-primary"><Check class="size-3" /> Always alphabetical</span>
                </div>
                <div class="flex items-center justify-between gap-4 p-3.5">
                  <div>
                    <div class="text-sm font-medium">Final newline</div>
                    <div class="mt-0.5 text-xs text-muted-foreground">Append a trailing newline at the end of every file.</div>
                  </div>
                  <Switch v-model="draft.finalNewline" />
                </div>
              </div>
            </div>

            <!-- Outputs list -->
            <div>
              <div class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Export targets</div>
              <div class="mt-2 flex flex-col gap-2.5">
                <OutputEditor
                  v-for="(output, index) in draft.outputs"
                  :key="index"
                  :output="output"
                  :format-indent="Number(draft.indent) || 0"
                  :format-final-newline="draft.finalNewline"
                  :locales="draft.locales"
                  :adapters="ADAPTERS"
                  @update:output="(o) => draft.outputs.splice(index, 1, o)"
                  @remove="removeOutput(index)"
                />
                <p v-if="draft.outputs.length === 0" class="text-sm text-muted-foreground">No export targets configured.</p>
                <div>
                  <Button variant="ghost" size="sm" class="mt-1 pl-2" @click="addOutput">
                    <Plus class="size-4" /> Add export target
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <!-- ── AI body (local, autosaved to .glotfile) ── -->
          <div v-else-if="activeSection === 'ai'" class="flex flex-col gap-4">

            <!-- Profile bar -->
            <div class="flex items-center gap-2 rounded-lg border p-3">
              <Select :model-value="activeProfile ?? '__none__'" @update:model-value="selectProfile($event === '__none__' ? null : $event)">
                <SelectTrigger class="w-44">
                  <SelectValue placeholder="No profile" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No profile</SelectItem>
                  <SelectItem v-for="name in profileNames" :key="name" :value="name">{{ name }}</SelectItem>
                </SelectContent>
              </Select>
              <Input
                v-if="activeProfile"
                v-model="profileNameDraft"
                class="flex-1 font-medium"
                placeholder="Profile name"
                @blur="renameProfile(activeProfile, profileNameDraft)"
                @keydown.enter.prevent="renameProfile(activeProfile, profileNameDraft)"
              />
              <span v-else class="flex-1 text-sm text-muted-foreground">Using default settings</span>
              <Button variant="outline" size="sm" class="shrink-0" @click="createProfile">
                <Plus class="size-4" /> New
              </Button>
              <Button variant="ghost" size="sm" class="shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive" :disabled="!activeProfile" @click="deleteProfile">
                <X class="size-4" />
              </Button>
            </div>

            <!-- AI config form -->
            <div class="grid max-w-sm gap-4">
              <div class="grid gap-1.5">
                <div class="flex items-center gap-2">
                  <Label for="ai-provider">Provider</Label>
                  <Transition
                    enter-active-class="transition duration-150 ease-out"
                    enter-from-class="opacity-0 translate-y-0.5"
                    enter-to-class="opacity-100 translate-y-0"
                    leave-active-class="transition duration-300 ease-in"
                    leave-from-class="opacity-100 translate-y-0"
                    leave-to-class="opacity-0"
                  >
                    <span v-if="aiJustSaved" class="flex items-center gap-1 text-xs leading-none text-emerald-600 dark:text-emerald-400">
                      <Check class="size-3" /> Saved
                    </span>
                  </Transition>
                </div>
                <Select v-model="aiDraft.provider">
                  <SelectTrigger id="ai-provider">
                    <SelectValue placeholder="Select provider" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="p in AI_PROVIDERS" :key="p.value" :value="p.value">{{ p.label }}</SelectItem>
                  </SelectContent>
                </Select>
                <p class="text-xs text-muted-foreground">{{ credentialHint }}</p>
              </div>

              <div class="grid gap-1.5">
                <Label for="ai-model">Model</Label>
                <Input id="ai-model" v-model="aiDraft.model" class="font-mono" :placeholder="modelPlaceholder" />
                <p v-if="modelSuggestions.length" class="text-xs text-muted-foreground">
                  Examples:
                  <template v-for="(m, i) in modelSuggestions" :key="m">
                    <button type="button" class="font-mono underline-offset-2 hover:text-foreground hover:underline" @click="aiDraft.model = m">{{ m }}</button><span v-if="i < modelSuggestions.length - 1"> · </span>
                  </template>
                </p>
              </div>

              <div v-if="isBedrock" class="grid gap-1.5">
                <Label for="ai-region">Region</Label>
                <Input id="ai-region" v-model="aiDraft.region" class="font-mono" placeholder="us-east-1" />
                <p class="text-xs text-muted-foreground">AWS region for Bedrock. Falls back to <code class="font-mono">AWS_REGION</code> if empty.</p>
              </div>
              <div v-else class="grid gap-1.5">
                <Label for="ai-endpoint">Endpoint</Label>
                <Input id="ai-endpoint" v-model="aiDraft.endpoint" class="font-mono" :placeholder="isOllama ? 'http://localhost:11434/v1' : 'Default (leave empty)'" />
                <p v-if="isOllama" class="text-xs text-muted-foreground">Defaults to the local Ollama server. Override only for a remote instance — include the <code class="font-mono">/v1</code> suffix.</p>
                <p v-else class="text-xs text-muted-foreground">Optional — for an in-region or self-hosted / OpenAI-compatible gateway.</p>
              </div>

              <div class="mt-1 border-t border-border pt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Translation</div>

              <div class="grid gap-1.5">
                <Label for="ai-batch">Batch size</Label>
                <Input id="ai-batch" v-model.number="aiDraft.batchSize" type="number" min="1" class="w-28" />
                <p class="text-xs text-muted-foreground">Strings sent per request.</p>
              </div>

              <div class="grid gap-1.5">
                <Label for="ai-concurrency">Parallel locales</Label>
                <Input id="ai-concurrency" v-model.number="aiDraft.concurrency" type="number" min="1" placeholder="3" class="w-28" />
                <p class="text-xs text-muted-foreground">How many locales to translate at once.</p>
              </div>

              <div class="mt-1 border-t border-border pt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Context build</div>

              <div class="grid gap-1.5">
                <Label for="ai-context-batch">Batch size</Label>
                <Input id="ai-context-batch" v-model.number="aiDraft.contextBatchSize" type="number" min="1" :placeholder="String(aiDraft.batchSize || 25)" class="w-28" />
                <p class="text-xs text-muted-foreground">Keys per request. Defaults to translation batch size.</p>
              </div>

              <div class="grid gap-1.5">
                <Label for="ai-context-concurrency">Concurrency</Label>
                <Input id="ai-context-concurrency" v-model.number="aiDraft.contextConcurrency" type="number" min="1" :placeholder="String(aiDraft.concurrency || 3)" class="w-28" />
                <p class="text-xs text-muted-foreground">Parallel context requests. Defaults to parallel locales.</p>
              </div>

              <div v-if="isOllama" class="flex items-center gap-3">
                <Switch id="ai-vision" v-model="aiDraft.vision" />
                <div class="grid gap-0.5">
                  <Label for="ai-vision">Vision</Label>
                  <p class="text-xs text-muted-foreground">Enable for models that support image input (e.g. translategemma, llava).</p>
                </div>
              </div>

              <div v-if="isOllama" class="grid gap-1.5">
                <Label for="ai-prompt-style">Prompt style</Label>
                <Select :model-value="aiDraft.promptStyle || '__default__'" @update:model-value="aiDraft.promptStyle = $event === '__default__' ? '' : $event">
                  <SelectTrigger id="ai-prompt-style">
                    <SelectValue placeholder="Default" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__default__">Default</SelectItem>
                    <SelectItem value="translategemma">TranslateGemma</SelectItem>
                  </SelectContent>
                </Select>
                <p class="text-xs text-muted-foreground">TranslateGemma uses a role-based system prompt and plain-text output instead of JSON batching.</p>
              </div>

              <div class="mt-1 border-t border-border pt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cost estimates</div>

              <div class="grid gap-1.5">
                <Label>Model prices</Label>
                <div class="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" size="sm" :disabled="refreshingPrices" @click="refreshModelPrices">
                    <RefreshCw class="size-3.5" :class="refreshingPrices ? 'animate-spin' : ''" />
                    {{ refreshingPrices ? "Updating…" : "Update prices" }}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" :disabled="!pricesStatus?.modelCount" @click="openPricesList">
                    <Search class="size-3.5" /> Browse
                  </Button>
                  <span v-if="pricesStatus?.source" class="text-xs text-muted-foreground">
                    {{ pricesStatus.modelCount.toLocaleString() }} models from {{ pricesStatus.source }}<template v-if="pricesFetchedLabel">, {{ pricesFetchedLabel }}</template>
                  </span>
                  <span v-else class="text-xs text-muted-foreground">No prices fetched yet</span>
                </div>
                <p class="text-xs text-muted-foreground">Fetches current per-model prices from models.dev for the cost estimate, covering models beyond the built-in Claude/GPT table. The manual overrides below always win.</p>
              </div>

              <Dialog v-model:open="pricesDialogOpen">
                <DialogContent class="flex max-h-[85vh] max-w-lg flex-col">
                  <DialogHeader>
                    <DialogTitle>Model prices</DialogTitle>
                    <DialogDescription>
                      Per-model $ / 1M tokens (input / output)<template v-if="pricesStatus?.source"> from {{ pricesStatus.source }}</template>. Click rows to compare.
                    </DialogDescription>
                  </DialogHeader>
                  <div class="relative">
                    <Search class="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input v-model="priceQuery" placeholder="Search models…" class="pl-8" />
                  </div>
                  <p class="text-xs text-muted-foreground">
                    <template v-if="hiddenPriceCount > 0">Showing {{ visiblePriceRows.length }} of {{ filteredPriceRows.length.toLocaleString() }} matches — refine to narrow.</template>
                    <template v-else>{{ filteredPriceRows.length.toLocaleString() }} model{{ filteredPriceRows.length === 1 ? "" : "s" }}</template>
                    · click a row to compare
                  </p>

                  <!-- Comparison graph for the picked models -->
                  <div v-if="comparedRows.length" class="space-y-2 rounded-lg border bg-muted/30 p-2.5">
                    <div class="flex items-center gap-3 text-[11px] text-muted-foreground">
                      <span class="flex items-center gap-1"><span class="size-2 rounded-sm bg-sky-500" /> Input</span>
                      <span class="flex items-center gap-1"><span class="size-2 rounded-sm bg-amber-500" /> Output</span>
                      <span>$ / 1M tokens</span>
                    </div>
                    <div v-for="m in comparedRows" :key="m.id" class="space-y-1">
                      <div class="flex items-center justify-between gap-2 text-[11px]">
                        <span class="truncate font-mono">{{ m.id }}</span>
                        <span class="flex shrink-0 items-center gap-1.5">
                          <span class="tabular-nums text-muted-foreground">${{ m.inputPerMTok }} / ${{ m.outputPerMTok }}</span>
                          <button type="button" class="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground" :aria-label="`Remove ${m.id}`" @click="toggleCompare(m.id)">
                            <X class="size-3" />
                          </button>
                        </span>
                      </div>
                      <div class="h-1.5 w-full rounded-sm bg-muted">
                        <div class="h-full rounded-sm bg-sky-500" :style="{ width: compareBarWidth(m.inputPerMTok) }" />
                      </div>
                      <div class="h-1.5 w-full rounded-sm bg-muted">
                        <div class="h-full rounded-sm bg-amber-500" :style="{ width: compareBarWidth(m.outputPerMTok) }" />
                      </div>
                    </div>
                  </div>

                  <div class="-mx-1 flex-1 overflow-y-auto">
                    <button
                      v-for="m in visiblePriceRows"
                      :key="m.id"
                      type="button"
                      class="flex w-full items-center justify-between gap-3 rounded px-1 py-1 text-left text-xs hover:bg-muted/60"
                      :class="isCompared(m.id) ? 'bg-muted' : ''"
                      @click="toggleCompare(m.id)"
                    >
                      <span class="flex min-w-0 items-center gap-1.5">
                        <Check v-if="isCompared(m.id)" class="size-3 shrink-0 text-sky-500" />
                        <span v-else class="size-3 shrink-0" />
                        <span class="truncate font-mono">{{ m.id }}</span>
                      </span>
                      <span class="shrink-0 tabular-nums text-muted-foreground">${{ m.inputPerMTok }} / ${{ m.outputPerMTok }}</span>
                    </button>
                    <p v-if="filteredPriceRows.length === 0" class="px-1 py-6 text-center text-sm text-muted-foreground">
                      {{ priceRowsLoaded ? "No models match." : "Loading…" }}
                    </p>
                  </div>
                </DialogContent>
              </Dialog>

              <div class="grid gap-1.5">
                <Label for="ai-price-in">Input price ($ / 1M tokens)</Label>
                <Input id="ai-price-in" v-model.number="aiDraft.inputPricePerMTok" type="number" min="0" step="0.01" placeholder="Auto for Claude models" class="w-44" />
              </div>

              <div class="grid gap-1.5">
                <Label for="ai-price-out">Output price ($ / 1M tokens)</Label>
                <Input id="ai-price-out" v-model.number="aiDraft.outputPricePerMTok" type="number" min="0" step="0.01" placeholder="Auto for Claude models" class="w-44" />
                <p class="text-xs text-muted-foreground">Set both to override the fetched/built-in prices or to price a model neither covers.</p>
              </div>
            </div>
          </div>

          <!-- ── Scan body ── -->
          <div v-else-if="activeSection === 'scan'" class="flex flex-col gap-6">
            <ScanListField
              label="Flutter accessors"
              :items="draft.scanAccessors"
              mono
              placeholder="translations"
              @update:items="draft.scanAccessors = $event"
            >
              <template #help>
                <p class="text-xs text-muted-foreground">
                  Accessors assigned from <code class="rounded border bg-muted px-1 py-0.5 font-mono text-[11px]">AppLocalizations.of(...)</code>
                  are detected automatically. Add a name only if yours isn't found.
                </p>
              </template>
            </ScanListField>

            <ScanListField
              label="Custom patterns"
              :items="draft.scanPatterns"
              mono
              placeholder="LocaleKeys\.(\w+)\.tr\(\)"
              :validate="validatePattern"
              @update:items="draft.scanPatterns = $event"
            >
              <template #help>
                <p class="text-xs text-muted-foreground">
                  Regex applied to every scanned file — capture group 1 is the key.
                </p>
              </template>
            </ScanListField>

            <ScanListField
              label="Include globs"
              :items="draft.scanInclude"
              mono
              placeholder="lib/**"
              @update:items="draft.scanInclude = $event"
            >
              <template #help>
                <p class="text-xs text-muted-foreground">Limit the scan to these globs. Empty scans everything.</p>
              </template>
            </ScanListField>

            <ScanListField
              label="Exclude globs"
              :items="draft.scanExclude"
              mono
              placeholder="**/*.g.dart"
              @update:items="draft.scanExclude = $event"
            >
              <template #help>
                <p class="text-xs text-muted-foreground">Skipped on top of always-excluded dirs (node_modules, build, …).</p>
              </template>
            </ScanListField>

            <ScanListField
              label="Keep keys"
              :items="draft.scanKeep"
              mono
              placeholder="validation.*"
              @update:items="draft.scanKeep = $event"
            >
              <template #help>
                <p class="text-xs text-muted-foreground">
                  Key globs always treated as used — for keys consumed by code the scan
                  can't see (framework internals, vendored packages). They never show as
                  unused and are safe from <code class="rounded border bg-muted px-1 py-0.5 font-mono text-[11px]">prune --unused</code>.
                </p>
              </template>
            </ScanListField>
          </div>

          <!-- ── Quality checks body ── -->
          <div v-else-if="activeSection === 'quality'" class="flex flex-col gap-6">
            <div>
              <div class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Rules</div>
              <div class="mt-2 divide-y rounded-lg border">
                <div v-for="rule in LINT_RULES" :key="rule.id" class="flex items-center justify-between gap-4 p-3.5">
                  <div class="min-w-0">
                    <div class="flex items-center gap-2 text-sm font-medium">
                      {{ rule.label }}
                      <code class="rounded border bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground">{{ rule.id }}</code>
                    </div>
                    <div class="mt-0.5 text-xs text-muted-foreground">{{ rule.description }}</div>
                  </div>
                  <Select
                    :model-value="draft.lintRules[rule.id] ?? rule.default"
                    @update:model-value="draft.lintRules = { ...draft.lintRules, [rule.id]: $event }"
                  >
                    <SelectTrigger
                      class="w-32 shrink-0"
                      :class="draft.lintRules[rule.id] === 'off' ? 'text-muted-foreground' : ''"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="error">Error{{ rule.default === "error" ? " ·" : "" }}</SelectItem>
                      <SelectItem value="warn">Warning{{ rule.default === "warn" ? " ·" : "" }}</SelectItem>
                      <SelectItem value="off">Off</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <p class="mt-2 text-xs text-muted-foreground">· marks the built-in default.</p>
            </div>

            <ScanListField
              label="Ignore keys"
              :items="draft.lintIgnore"
              mono
              placeholder="legacy.*"
              @update:items="draft.lintIgnore = $event"
            >
              <template #help>
                <p class="text-xs text-muted-foreground">
                  Key globs excluded from every check — for legacy or generated keys you don't maintain.
                </p>
              </template>
            </ScanListField>
          </div>

          <!-- ── Dictionary body ── -->
          <div v-else-if="activeSection === 'dictionary'" class="flex flex-col gap-4">
            <div class="flex flex-wrap gap-2">
              <span
                v-for="w in draft.customWords"
                :key="w"
                class="inline-flex items-center gap-1.5 rounded-lg border bg-accent px-2.5 py-1.5 font-mono text-sm"
              >
                {{ w }}
                <button
                  type="button"
                  class="flex size-[18px] items-center justify-center rounded text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  :aria-label="`Remove ${w}`"
                  @click="removeWord(w)"
                ><X class="size-3" /></button>
              </span>
              <p v-if="draft.customWords.length === 0" class="text-sm text-muted-foreground">No custom words yet.</p>
            </div>

            <div class="grid max-w-sm gap-1.5">
              <Label for="add-word">Add word</Label>
              <div class="flex gap-2">
                <Input id="add-word" v-model="newWord" class="font-mono" placeholder="Glotfile" @keydown.enter.prevent="addWord" />
                <Button variant="outline" @click="addWord"><Plus class="size-4" /> Add</Button>
              </div>
            </div>
          </div>

          <!-- ── Editor body (local, autosaved to .glotfile) ── -->
          <div v-else-if="activeSection === 'editor'" class="flex flex-col gap-4">
            <div class="grid max-w-sm gap-1.5">
              <div class="flex items-center gap-2">
                <Label for="editor-select">Editor</Label>
                <Transition
                  enter-active-class="transition duration-150 ease-out"
                  enter-from-class="opacity-0 translate-y-0.5"
                  enter-to-class="opacity-100 translate-y-0"
                  leave-active-class="transition duration-300 ease-in"
                  leave-from-class="opacity-100 translate-y-0"
                  leave-to-class="opacity-0"
                >
                  <span v-if="editorJustSaved" class="flex items-center gap-1 text-xs leading-none text-emerald-600 dark:text-emerald-400">
                    <Check class="size-3" /> Saved
                  </span>
                </Transition>
              </div>
              <Select :model-value="currentEditor" @update:model-value="onEditorChange">
                <SelectTrigger id="editor-select">
                  <SelectValue placeholder="Select editor" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="e in EDITORS" :key="e.id" :value="e.id">{{ e.label }}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p class="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Lock class="size-3.5" /> Stored locally in <code class="rounded border bg-muted px-1 py-0.5 font-mono text-xs">.glotfile/</code> — clicking a usage opens the file via its URL scheme.
            </p>
          </div>

        </div>
      </div>

      <!-- ── Floating save bar (committed config only; local sections autosave) ── -->
      <div
        v-if="!LOCAL_SECTIONS.includes(activeSection)"
        :class="[
          'absolute bottom-5 left-1/2 flex min-w-[400px] max-w-[calc(100%-3.5rem)] -translate-x-1/2 items-center gap-3 rounded-[14px] border bg-card px-4 py-2.5 shadow-lg transition-[border-color,box-shadow]',
          dirtyCount > 0 ? 'border-primary/40 shadow-primary/10' : 'border-border',
        ]"
      >
        <span
          :class="[
            'flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-ellipsis whitespace-nowrap text-[13px]',
            dirtyCount > 0 ? 'text-foreground' : 'text-muted-foreground',
          ]"
        >
          <template v-if="dirtyCount > 0">
            <span class="inline-grid h-5 min-w-[20px] shrink-0 place-items-center rounded-full bg-primary px-1.5 text-[11px] font-bold tabular-nums text-primary-foreground">
              {{ dirtyCount }}
            </span>
            Unsaved {{ dirtyCount === 1 ? "change" : "changes" }} in
            <strong class="font-semibold">{{ dirtyTitles.join(", ") }}</strong>
          </template>
          <template v-else>
            <Check class="size-3.5 shrink-0" /> All changes saved
          </template>
        </span>

        <!-- Discard with inline confirm -->
        <div class="relative">
          <Button variant="ghost" size="sm" :disabled="dirtyCount === 0" @click="showDiscard = !showDiscard">
            <Undo2 class="size-4" /> Discard
          </Button>

          <div
            v-if="showDiscard"
            class="absolute bottom-full left-1/2 z-50 mb-2.5 w-64 -translate-x-1/2 rounded-xl border bg-card p-3.5 shadow-lg"
          >
            <p class="text-[13px] font-semibold">Discard all changes?</p>
            <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
              Reverts every unsaved edit in {{ dirtyTitles.join(", ") }}.
            </p>
            <div class="mt-3 flex justify-end gap-2">
              <Button size="sm" variant="outline" @click="showDiscard = false">Keep editing</Button>
              <Button size="sm" variant="destructive" @click="discardAll">Discard</Button>
            </div>
          </div>
        </div>

        <Button size="sm" :disabled="dirtyCount === 0 || saving" @click="doSave">
          <Save class="size-4" /> Save changes
        </Button>
      </div>
    </div>
  </div>

  <!-- ── Unsaved-changes warning (blocks an in-app navigation away) ── -->
  <Transition
    enter-active-class="transition duration-150 ease-out"
    enter-from-class="opacity-0"
    enter-to-class="opacity-100"
    leave-active-class="transition duration-100 ease-in"
    leave-from-class="opacity-100"
    leave-to-class="opacity-0"
  >
    <div
      v-if="pendingRoute"
      class="fixed inset-0 z-[70] flex items-center justify-center bg-background/70 p-6 backdrop-blur-sm"
      @click.self="cancelLeave"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="leave-warning-title"
        class="w-full max-w-md rounded-2xl border bg-card p-5 shadow-xl"
      >
        <h3 id="leave-warning-title" class="flex items-center gap-2 text-[15px] font-semibold">
          <AlertTriangle class="size-4 text-amber-500" /> Unsaved changes
        </h3>
        <p class="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
          You have {{ dirtyCount }} unsaved {{ dirtyCount === 1 ? "change" : "changes" }} in
          <strong class="font-medium text-foreground">{{ dirtyTitles.join(", ") }}</strong>.
          <span class="block">Leaving now discards {{ dirtyCount === 1 ? "it" : "them" }}.</span>
        </p>
        <div class="mt-4 flex items-center gap-2">
          <Button size="sm" variant="outline" class="mr-auto" @click="cancelLeave">Keep editing</Button>
          <Button size="sm" variant="destructive" @click="discardAndLeave">
            <Undo2 class="size-4" /> Discard &amp; leave
          </Button>
          <Button size="sm" :disabled="saving" @click="saveAndLeave">
            <Save class="size-4" /> Save &amp; leave
          </Button>
        </div>
      </div>
    </div>
  </Transition>

  <!-- ── Toast ── -->
  <Transition
    enter-active-class="transition duration-200 ease-out"
    enter-from-class="opacity-0 -translate-y-1.5"
    enter-to-class="opacity-100 translate-y-0"
    leave-active-class="transition duration-150 ease-in"
    leave-from-class="opacity-100 translate-y-0"
    leave-to-class="opacity-0 -translate-y-1.5"
  >
    <div
      v-if="showToast"
      class="fixed left-1/2 top-4 z-[80] flex -translate-x-1/2 items-center gap-2 rounded-[11px] bg-foreground px-4 py-2.5 text-[12.5px] font-medium text-background shadow-lg"
    >
      <Check class="size-3.5" /> Settings saved
    </div>
  </Transition>

  <SyncWizard
    v-if="showSyncWizard"
    ref="syncWizardRef"
    @vue:mounted="syncWizardRef?.init()"
    @dismiss="showSyncWizard = false"
    @synced="onSynced"
  />
</template>
