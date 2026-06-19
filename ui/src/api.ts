import type { State, Config, LocalSettings, GlossaryEntry, GlossarySuggestion, ExportPreview, ExportResult, TranslateResult, TranslateEstimate, ContextEstimate, TranslateStart, TranslateLocaleStart, TranslateProgress, TranslateLocaleDone, TranslateDone, LogEntry, Note, CheckId, ChecksResponse, LintReport, Stats, BatchStatusResponse, BatchApplyResult, ContextBatchApplyResult, GlossarySuggestEstimate, GlossarySuggestBatchApplyResult, Features, ChatStreamEvent, ChatTranscript } from "./types.js";

type TranslateEvent = TranslateStart | TranslateLocaleStart | TranslateProgress | TranslateLocaleDone | TranslateDone;

export interface ContextBuildDone { type: "done"; requested: number; written: number; errors: { key: string; error: string }[] }
export interface ContextBuildStart { type: "start"; total: number }
export interface ContextBuildProgress { type: "progress"; done: number; total: number; written: number }
export type ContextBuildEvent = ContextBuildStart | ContextBuildProgress | ContextBuildDone;

export interface GlossarySuggestStart { type: "start"; total: number }
export interface GlossarySuggestProgress { type: "progress"; done: number; total: number }
export interface GlossarySuggestDone { type: "done"; added: number; terms: GlossarySuggestion[] }
export type GlossarySuggestEvent = GlossarySuggestStart | GlossarySuggestProgress | GlossarySuggestDone;

export interface PricesStatus {
  source: string | null;
  fetchedAt: string | null;
  modelCount: number;
  path: string;
  resolved: { provider: string; model: string; source: string; inputPerMTok: number; outputPerMTok: number } | null;
}
export interface PricesRefreshResult { ok: true; source: string; fetchedAt: string; modelCount: number; path: string }
export interface PriceRow { id: string; inputPerMTok: number; outputPerMTok: number; cacheReadPerMTok?: number; cacheWritePerMTok?: number }
export interface PricesList { source: string | null; fetchedAt: string | null; models: PriceRow[] }

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? res.statusText);
  return res.json() as Promise<T>;
}

export const fetchState = () => fetch("/api/state").then((r) => json<State>(r));
export const getFeatures = () => fetch("/api/features").then((r) => json<Features>(r));
export const getPrices = () => fetch("/api/prices").then((r) => json<PricesStatus>(r));
export const refreshPrices = () =>
  fetch("/api/prices/refresh", { method: "POST" }).then((r) => json<PricesRefreshResult>(r));
export const getPricesList = () => fetch("/api/prices/list").then((r) => json<PricesList>(r));
export const createKey = (key: string, value: string, plural?: { arg: string }) =>
  fetch("/api/keys", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key, value, ...(plural ? { plural } : {}) }) }).then(json);
export const deleteKey = (key: string) =>
  fetch(`/api/keys/${encodeURIComponent(key)}`, { method: "DELETE" }).then(json);
export const bulkClear = (keys: string[], locales: string[]) =>
  fetch("/api/keys/bulk-clear", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ keys, locales }) }).then(json);
export const bulkDelete = (keys: string[]) =>
  fetch("/api/keys/bulk-delete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ keys }) }).then(json);
export const bulkState = (keys: string[], locales: string[], state: string) =>
  fetch("/api/keys/bulk-state", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ keys, locales, state }) }).then(json);
export const bulkMeta = (keys: string[], body: { addTags?: string[]; removeTags?: string[]; skipTranslate?: boolean; clearContext?: boolean }) =>
  fetch("/api/keys/bulk-meta", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ keys, ...body }) }).then(json);
export const patchKey = (key: string, body: unknown) =>
  fetch(`/api/keys/${encodeURIComponent(key)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(json);
export const setValue = (key: string, locale: string, value: string) =>
  fetch(`/api/keys/${encodeURIComponent(key)}/values/${encodeURIComponent(locale)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ value }) }).then(json);
export const setState = (key: string, locale: string, state: string) =>
  fetch(`/api/keys/${encodeURIComponent(key)}/values/${encodeURIComponent(locale)}/state`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ state }) }).then(json);
export const clearValue = (key: string, locale: string) =>
  fetch(`/api/keys/${encodeURIComponent(key)}/values/${encodeURIComponent(locale)}`, { method: "DELETE" }).then(json);
export const setPluralForms = (key: string, locale: string, forms: Record<string, string>) =>
  fetch(`/api/keys/${encodeURIComponent(key)}/plural/${encodeURIComponent(locale)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ forms }) }).then(json);
export const convertToPlural = (key: string, arg: string) =>
  fetch(`/api/keys/${encodeURIComponent(key)}/plural`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ arg }) }).then(json);
export const convertToScalar = (key: string) =>
  fetch(`/api/keys/${encodeURIComponent(key)}/plural`, { method: "DELETE" }).then(json);
export const translate = (body: unknown) =>
  fetch("/api/translate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => json<TranslateResult>(r));
export const translateEstimate = (body: { keys?: string[]; locales?: string[] }) =>
  fetch("/api/translate/estimate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => json<TranslateEstimate>(r));
export const suggestProjectContext = () =>
  fetch("/api/guidance/suggest/context", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).then((r) => json<{ projectContext: string }>(r));
export const suggestLocaleInstruction = (body: { locale: string; projectContext?: string }) =>
  fetch("/api/guidance/suggest/locale", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => json<{ instruction: string }>(r));
export const batchStatus = () =>
  fetch("/api/batch/status").then((r) => json<BatchStatusResponse>(r));
export const batchSubmit = (body: { keys?: string[]; locales?: string[] }) =>
  fetch("/api/batch/translate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => json<{ batchId: string; total: number }>(r));
export const batchApply = () =>
  fetch("/api/batch/apply", { method: "POST" }).then((r) => json<BatchApplyResult>(r));
export const batchCancel = () =>
  fetch("/api/batch/cancel", { method: "POST" }).then((r) => json<{ canceled: string }>(r));
export const contextEstimate = (body: { keys?: string[]; force?: boolean }) =>
  fetch("/api/context/estimate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => json<ContextEstimate>(r));
export const contextBatchStatus = () =>
  fetch("/api/context/batch/status").then((r) => json<BatchStatusResponse>(r));
export const contextBatchSubmit = (body: { keys?: string[]; force?: boolean }) =>
  fetch("/api/context/batch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => json<{ batchId: string; total: number }>(r));
export const contextBatchApply = () =>
  fetch("/api/context/batch/apply", { method: "POST" }).then((r) => json<ContextBatchApplyResult>(r));
export const contextBatchCancel = () =>
  fetch("/api/context/batch/cancel", { method: "POST" }).then((r) => json<{ canceled: string }>(r));
export const glossarySuggestEstimate = (body: { keyGlob?: string; limit?: number; since?: string } = {}) =>
  fetch("/api/glossary/suggest/estimate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => json<GlossarySuggestEstimate>(r));
export const glossarySuggestBatchStatus = () =>
  fetch("/api/glossary/suggest/batch/status").then((r) => json<BatchStatusResponse>(r));
export const glossarySuggestBatchSubmit = (body: { keyGlob?: string; limit?: number; since?: string } = {}) =>
  fetch("/api/glossary/suggest/batch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => json<{ batchId: string; total: number }>(r));
export const glossarySuggestBatchApply = () =>
  fetch("/api/glossary/suggest/batch/apply", { method: "POST" }).then((r) => json<GlossarySuggestBatchApplyResult>(r));
export const glossarySuggestBatchCancel = () =>
  fetch("/api/glossary/suggest/batch/cancel", { method: "POST" }).then((r) => json<{ canceled: string }>(r));

// --- Translation Assistant chat ---

export const getChat = () => fetch("/api/chat").then((r) => json<ChatTranscript>(r));
export const clearChat = () => fetch("/api/chat", { method: "DELETE" }).then(json);
export const confirmChatTool = (toolUseId: string, approved: boolean) =>
  fetch("/api/chat/confirm", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ toolUseId, approved }),
  }).then(json);

// Stream one assistant turn. Unlike translateStream, an "error" event is yielded
// (not thrown) so the store can render it inline as part of the conversation.
export async function* chatStream(message: string, signal?: AbortSignal): AsyncGenerator<ChatStreamEvent> {
  let res: Response;
  try {
    res = await fetch("/api/chat/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message }),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
    throw e;
  }
  if (!res.ok || !res.body) throw new Error(res.statusText);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let currentEvent = "message";
  try {
    while (true) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        throw e;
      }
      if (chunk.done) break;
      buf += decoder.decode(chunk.value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith("event:")) { currentEvent = line.slice(6).trim(); continue; }
        if (line.startsWith("data:")) {
          const data = JSON.parse(line.slice(5).trim());
          yield { ...data, type: currentEvent } as ChatStreamEvent;
          currentEvent = "message";
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

export async function* translateStream(signal?: AbortSignal, keys?: string[], locales?: string[]): AsyncGenerator<TranslateEvent> {
  let res: Response;
  // Scope goes in the POST body, never the URL: a large filtered key set pushed
  // the GET request line past Node's 16KB header limit → HTTP 431.
  const body: { keys?: string[]; locales?: string[] } = {};
  if (keys?.length) body.keys = keys;
  if (locales?.length) body.locales = locales;
  try {
    res = await fetch("/api/translate/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
    throw e;
  }
  if (!res.ok || !res.body) throw new Error(res.statusText);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let currentEvent = "message";
  try {
    while (true) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        throw e;
      }
      if (chunk.done) break;
      buf += decoder.decode(chunk.value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith("event:")) { currentEvent = line.slice(6).trim(); continue; }
        if (line.startsWith("data:")) {
          const data = JSON.parse(line.slice(5).trim());
          // A provider failure (bad credentials, missing permission, unknown
          // model) arrives as an error event — surface it instead of ending
          // the run silently. Callers catch and display the message.
          if (currentEvent === "error") throw new Error(data.error ?? "Translation failed");
          yield { ...data, type: currentEvent } as TranslateEvent;
          currentEvent = "message";
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

export async function* buildContextStream(body: { all?: boolean; keyGlob?: string; limit?: number; since?: string; lastRunAt?: string; keys?: string[]; force?: boolean }, signal?: AbortSignal): AsyncGenerator<ContextBuildEvent> {
  let res: Response;
  try {
    res = await fetch("/api/context/build", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
    throw e;
  }
  if (!res.ok || !res.body) throw new Error(res.statusText);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let currentEvent = "message";
  try {
    while (true) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        throw e;
      }
      if (chunk.done) break;
      buf += decoder.decode(chunk.value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith("event:")) { currentEvent = line.slice(6).trim(); continue; }
        if (line.startsWith("data:")) {
          const data = JSON.parse(line.slice(5).trim());
          if (currentEvent === "error") throw new Error(data.error ?? "Unknown error");
          yield { ...data, type: currentEvent } as ContextBuildEvent;
          currentEvent = "message";
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

export interface ScanResult { files: number; refs: number; scannedAt: string }
export const triggerScan = () =>
  fetch("/api/scan", { method: "POST" }).then((r) => json<ScanResult>(r));

export interface ScanSummary { indexed: boolean; scannedAt?: string; files: number; refs: number }
export const scanSummary = () => fetch("/api/scan").then((r) => json<ScanSummary>(r));

export interface KeyUsageRef { file: string; abs: string; line: number; col: number; scanner: string }
export interface KeyUsagePrefixRef extends KeyUsageRef { prefix: string }
export interface KeyUsageLiteralRef { file: string; abs: string; line: number; col: number; literal: string }
export interface KeyUsage {
  indexed: boolean;
  scannedAt?: string;
  project?: string;
  count: number;
  refs: KeyUsageRef[];
  prefixCount?: number;
  prefixRefs?: KeyUsagePrefixRef[];
  literalCount?: number;
  literalRefs?: KeyUsageLiteralRef[];
}
export const keyUsage = (key: string) =>
  fetch(`/api/scan/usage?key=${encodeURIComponent(key)}`).then((r) => json<KeyUsage>(r));

export interface UsedKeys { indexed: boolean; scannedAt?: string; used: string[] }
export const usedKeys = () => fetch("/api/scan/used").then((r) => json<UsedKeys>(r));

export const putConfig = (config: Config) =>
  fetch("/api/config", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(config) }).then(json);

export interface UiPrefs {
  theme: "system" | "light" | "dark";
  keyColumnWidth?: number;
  detailPanelWidth?: number;
  chatPanelWidth?: number;
}
export const getUiPrefs = () => fetch("/api/ui-prefs").then((r) => json<UiPrefs>(r));
export const putUiPrefs = (patch: Partial<UiPrefs>) =>
  fetch("/api/ui-prefs", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) }).then(json);

// Per-project, per-developer settings (AI provider/model, editor). Stored in the
// project's gitignored .glotfile/, never committed — a partial patch is fine.
export const getLocalSettings = () => fetch("/api/local-settings").then((r) => json<LocalSettings>(r));
export const putLocalSettings = (patch: Partial<LocalSettings>) =>
  fetch("/api/local-settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) }).then(json);

export interface AiProfilesResponse { profiles: Record<string, AiSettings>; activeProfile: string | null }
export const getAiProfiles = () => fetch("/api/ai-profiles").then((r) => json<AiProfilesResponse>(r));
export const putAiProfile = (name: string, ai: AiSettings) =>
  fetch(`/api/ai-profiles/${encodeURIComponent(name)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(ai) }).then(json);
export const deleteAiProfile = (name: string) =>
  fetch(`/api/ai-profiles/${encodeURIComponent(name)}`, { method: "DELETE" }).then(json);
export const setActiveAiProfile = (name: string | null) =>
  fetch("/api/ai-profiles/active", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) }).then(json);

// Probe the active AI config: builds the provider and runs one throwaway
// translation. Always resolves (200) — `ok` and `error` carry the result.
export interface AiTestResult { ok: boolean; provider: string; model: string; error?: string }
export const aiTest = () => fetch("/api/ai-test", { method: "POST" }).then((r) => json<AiTestResult>(r));

export const addToDictionary = (word: string) =>
  fetch("/api/dictionary", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ word }) }).then(json);

export const removeFromDictionary = (word: string) =>
  fetch(`/api/dictionary/${encodeURIComponent(word)}`, { method: "DELETE" }).then(json);

export const getGlossary = () => fetch("/api/glossary").then((r) => json<GlossaryEntry[]>(r));
export const putGlossaryEntry = (entry: GlossaryEntry) =>
  fetch("/api/glossary", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(entry) }).then(json);
export const deleteGlossaryEntry = (term: string) =>
  fetch(`/api/glossary/${encodeURIComponent(term)}`, { method: "DELETE" }).then(json);

export const getGlossarySuggestions = () => fetch("/api/glossary/suggestions").then((r) => json<GlossarySuggestion[]>(r));
export const dismissGlossarySuggestion = (term: string) =>
  fetch("/api/glossary/suggestions/dismiss", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ term }) }).then(json);
export const removeGlossarySuggestion = (term: string) =>
  fetch(`/api/glossary/suggestions/${encodeURIComponent(term)}`, { method: "DELETE" }).then(json);

export async function* suggestGlossaryStream(body: { keyGlob?: string; limit?: number; since?: string }, signal?: AbortSignal): AsyncGenerator<GlossarySuggestEvent> {
  let res: Response;
  try {
    res = await fetch("/api/glossary/suggest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
    throw e;
  }
  if (!res.ok || !res.body) throw new Error(res.statusText);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let currentEvent = "message";
  try {
    while (true) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        throw e;
      }
      if (chunk.done) break;
      buf += decoder.decode(chunk.value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith("event:")) { currentEvent = line.slice(6).trim(); continue; }
        if (line.startsWith("data:")) {
          const data = JSON.parse(line.slice(5).trim());
          if (currentEvent === "error") throw new Error(data.error ?? "Unknown error");
          yield { ...data, type: currentEvent } as GlossarySuggestEvent;
          currentEvent = "message";
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

export const uploadScreenshot = (key: string, file: File) => {
  const body = new FormData();
  body.append("file", file);
  return fetch(`/api/keys/${encodeURIComponent(key)}/screenshot`, { method: "POST", body }).then(json);
};
export const deleteScreenshot = (key: string) =>
  fetch(`/api/keys/${encodeURIComponent(key)}/screenshot`, { method: "DELETE" }).then(json);

export const addNote = (key: string, text: string) =>
  fetch(`/api/keys/${encodeURIComponent(key)}/notes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) }).then((r) => json<Note>(r));
export const editNote = (key: string, id: string, text: string) =>
  fetch(`/api/keys/${encodeURIComponent(key)}/notes/${encodeURIComponent(id)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) }).then(json);
export const deleteNote = (key: string, id: string) =>
  fetch(`/api/keys/${encodeURIComponent(key)}/notes/${encodeURIComponent(id)}`, { method: "DELETE" }).then(json);

export const getLog = () => fetch("/api/log").then((r) => json<LogEntry[]>(r));

export const exportPreview = () => fetch("/api/export/preview").then((r) => json<ExportPreview>(r));
export const runExport = () => fetch("/api/export", { method: "POST" }).then((r) => json<ExportResult>(r));

export interface FileInfo { name: string; path: string; relDir?: string }
// The active file also carries its project directory: `dir` is the absolute path,
// `project` the folder name shown in the header and tab title.
export interface ActiveFile extends FileInfo { dir: string; project: string }
export const getFile = () => fetch("/api/file").then((r) => json<ActiveFile>(r));
export const listFiles = () => fetch("/api/files").then((r) => json<FileInfo[]>(r));
export const setFile = (path: string) =>
  fetch("/api/file", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path }) }).then((r) => json<{ ok: boolean } & ActiveFile>(r));

export const fetchChecks = (checks: CheckId[]): Promise<ChecksResponse> => {
  // No checks selected → nothing to run; avoid an empty `checks=` that the server
  // would read as "run all".
  if (checks.length === 0) return Promise.resolve({ issues: [], spellPending: false });
  return fetch(`/api/checks?checks=${checks.join(",")}`).then((r) => json<ChecksResponse>(r));
};

export const fetchLint = (opts: { includeSuppressed?: boolean } = {}) =>
  fetch(`/api/lint${opts.includeSuppressed ? "?includeSuppressed=1" : ""}`).then((r) => json<LintReport>(r));

// Per-finding suppression: hides (rule, locale) on the key until its source text changes.
export const suppressFinding = (key: string, rule: string, locale: string) =>
  fetch(`/api/keys/${encodeURIComponent(key)}/suppressions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rule, locale }) }).then(json);
export const unsuppressFinding = (key: string, rule: string, locale: string) =>
  fetch(`/api/keys/${encodeURIComponent(key)}/suppressions?rule=${encodeURIComponent(rule)}&locale=${encodeURIComponent(locale)}`, { method: "DELETE" }).then(json);
export const acceptLintFindings = (opts: { rules?: string[]; locales?: string[] } = {}) =>
  fetch("/api/lint/accept", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(opts) })
    .then((r) => json<{ ok: boolean; accepted: number; byRule: Record<string, number> }>(r));

export const getStats = () => fetch("/api/stats").then((r) => json<Stats>(r));

export interface ImportSampleKey { key: string; value: string }
export interface ImportNotFound { found: false }
export interface ImportDetected {
  found: true;
  format: string;
  localeRoot: string;
  locales: string[];
  sourceLocale: string;
  keyCount: number;
  sampleKeys: ImportSampleKey[];
}
export type DetectResult = ImportNotFound | ImportDetected;

export interface ImportResult {
  keyCount: number;
  localeCount: number;
  warnings: string[];
}

export const detectImport = () =>
  fetch("/api/import/detect").then((r) => json<DetectResult>(r));

export const runImportApi = (body: { format: string; sourceLocale: string; locales?: string[]; cldr?: boolean }) =>
  fetch("/api/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => json<ImportResult>(r));

export interface SyncPlan {
  added: string[];
  sourceChanged: string[];
  adopted: { key: string; locale: string }[];
  removed: string[];
  unchanged: number;
}
export interface SyncPreview { plan: SyncPlan; warnings: string[] }
export interface SyncApplied { applied: true; plan: SyncPlan; warnings: string[]; usageRefs?: number }

// Preview (no write) when apply is false; persist + rebuild usage when apply is true.
export const syncPreview = () =>
  fetch("/api/sync", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).then((r) => json<SyncPreview>(r));
export const syncApply = (body: { prune?: boolean }) =>
  fetch("/api/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ apply: true, ...body }) }).then((r) => json<SyncApplied>(r));
