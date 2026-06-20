import { Hono, type Context, type Next } from "hono";
import { streamSSE } from "hono/streaming";
import {
  loadState, saveState, createKey, renameKey, deleteKey,
  setSourceValue, setTargetValue, setKeyState, setMetadata, clearValue,
  setPluralForms, setSourcePluralForms, convertToPlural, convertToScalar, setPluralArg,
  upsertGlossaryEntry, deleteGlossaryEntry,
  addNote, editNote, deleteNote, addCustomWord, removeCustomWord,
  addSuppression, removeSuppression,
  mergeGlossarySuggestions, dismissGlossarySuggestion, removeGlossarySuggestion,
} from "./state.js";
import { selectGlossarySources, knownTermList, buildGlossarySuggestSystemPrompt, buildGlossarySuggestBatchPrompt, GLOSSARY_SUGGEST_SCHEMA, dedupeTerms, type SuggestedTerm } from "./ai/glossary-suggest.js";
import { buildProjectContextSystemPrompt, buildProjectContextUserPrompt, PROJECT_CONTEXT_SCHEMA, buildLocaleInstructionSystemPrompt, buildLocaleInstructionUserPrompt, LOCALE_INSTRUCTION_SCHEMA } from "./ai/guidance-suggest.js";
import { sourceKeysForTerm } from "./glossary.js";
import { acceptFindings } from "./lint/accept.js";
import { findMissing, loadUsageCache, computeUsedKeys, literalMatcher } from "./scan.js";
import { runScan, scanOptions } from "./scanner.js";
import {
  selectContextTargets, attachUsageSnippets, applyContext,
  buildContextSystemPrompt, buildContextBatchPrompt, CONTEXT_BATCH_SCHEMA,
} from "./ai/context.js";
import { computeStats } from "./stats.js";
import { runChecks, CHECK_IDS, type CheckId } from "./checks.js";
import { runLint, sortFindings, countSeverities } from "./lint/run.js";
import { checkOutputs } from "./lint/outputs.js";
import { defaultLoader } from "./lint/spelling.js";
import type { Speller } from "./lint/types.js";
import { getAdapter, type ExportedFile, type ExportWarning } from "./adapters/index.js";
import { readFileSync, existsSync, readdirSync, statSync, rmSync } from "node:fs";
import { dirname, resolve, basename, relative, sep } from "node:path";
import { makeProvider } from "./ai/index.js";
import { betaFeatures, glossarySuggestEnabled } from "./beta.js";
import { selectRequests, applyResults, attachScreenshotsForProvider, runLocaleParallel } from "./ai/run.js";
import { buildSystemPrompt, supportsBatchTranslate, supportsBatchComplete, supportsChat, type TranslationProvider, type TranslationRequest } from "./ai/provider.js";
import { runChatTurn } from "./ai/chat.js";
import { buildToolRegistry } from "./ai/chat-tools/index.js";
import { buildChatSystemPrompt, projectSnapshot } from "./ai/chat-prompt.js";
import { loadChat, saveChat, clearChat } from "./chats.js";
import type { ToolContext } from "./ai/chat-types.js";
import { explainProviderError } from "./ai/explain-error.js";
import { submitBatchTranslation, applyBatchResults } from "./ai/batch-run.js";
import { loadPendingBatch, clearPendingBatch } from "./ai/pending-batch.js";
import { submitContextBatch, applyContextBatchResults } from "./ai/context-batch-run.js";
import { loadPendingContextBatch, clearPendingContextBatch } from "./ai/pending-context-batch.js";
import { submitGlossarySuggestBatch, applyGlossarySuggestBatchResults } from "./ai/glossary-batch-run.js";
import { loadPendingGlossaryBatch, clearPendingGlossaryBatch } from "./ai/pending-glossary-batch.js";
import { estimateTranslation, estimateContext, estimateGlossarySuggest } from "./ai/estimate.js";
import { usageCostUsd, resolvePricing, addUsage } from "./ai/pricing.js";
import { refreshPrices } from "./ai/price-fetch.js";
import { loadPriceCache, defaultPriceCachePath, invalidatePriceCache } from "./ai/price-cache.js";
import { appendLog, readLog, type LogEntry } from "./log.js";
import { GlotfileError, validate, type Config, type State } from "./schema.js";
import { previewImport, runImport, runSync } from "./import/run.js";
import { refreshLocationUsage, isLocationScannedState, usageCounts } from "./import/usage.js";
import { exportToDisk, narrowForExport } from "./export-run.js";
import { loadUiPrefs, saveUiPrefs, isThemeMode, isPanelWidth, defaultUiPrefsPath, type UiPrefs } from "./ui-prefs.js";
import { loadLocalSettings, saveLocalSettings, aiConfigError, multilingualLocalesError, isEditorId, type LocalSettings } from "./local-settings.js";
import { writeFileAtomic } from "./atomic-write.js";
import { createEventHub, type EventHub, type EventSender } from "./events.js";
import { createStateWatcher, type StateWatcher } from "./watch.js";

const sanitize = (s: string) => s.replace(/[^\w.\-]+/g, "_");

// Screenshots live in a folder named after the source file, so a file and its
// images move together: glotfile.json -> glotfile-screenshots/, foo.json -> foo-screenshots/.
const screenshotDirName = (statePath: string) =>
  basename(statePath).replace(/\.[^.]+$/, "") + "-screenshots";

// The project name JetBrains IDEs use for `jetbrains://…` deep links: .idea/.name
// if the user set one, otherwise the project directory name (JetBrains' own default).
function projectName(root: string): string {
  const nameFile = resolve(root, ".idea", ".name");
  if (existsSync(nameFile)) {
    try {
      const name = readFileSync(nameFile, "utf8").trim();
      if (name) return name;
    } catch { /* fall back to the directory name */ }
  }
  return basename(root);
}

export interface ApiDeps {
  statePath: string;
  // Override the AI provider (tests inject a fake so no real API is called). The
  // real provider is built from the project's local AI settings, not committed config.
  makeProvider?: () => TranslationProvider;
  // Serve mode passes this so edits auto-export to disk (gated by config.autoExport).
  // Tests/headless callers omit it, leaving the filesystem untouched.
  autoExport?: boolean;
  // Per-machine UI prefs file. Global by default so the theme follows the user
  // across every instance; overridable so tests can point at a tmp file.
  uiPrefsPath?: string;
  // Start the filesystem poll loop that detects out-of-band changes (CLI, git,
  // hand edits) and pushes them to connected UIs over /events. Serve turns this
  // on; tests/headless callers leave it off so no background timer runs.
  watch?: boolean;
  // Poll cadence for the watcher; defaults inside createStateWatcher. Tests lower
  // it for speed.
  watchIntervalMs?: number;
  // Injectable SSE fan-out so a test can drive broadcasts deterministically; a
  // private hub is created when omitted.
  eventHub?: EventHub;
  // Hands back the watcher so serve can stop it on close (and tests can clean up).
  onWatcher?: (watcher: StateWatcher) => void;
}

// Fill each target's usageSnippets from the scan index — shared by the
// streaming context build and the context batch submit.
export function createApi(deps: ApiDeps): Hono {
  const app = new Hono();
  const load = () => loadState(deps.statePath);

  // The project root never changes; only the active file within it does. Capture
  // it once so the file switcher can only ever point at files inside this dir.
  const projectRoot = dirname(resolve(deps.statePath));

  // Live reload: the watcher polls the active file and, when it changes out of
  // band (CLI, git restore, a hand edit) rather than through persist(), tells the
  // hub to push a "state-changed" event to every connected UI. persist() records
  // each of our own writes so they don't echo back as a reload.
  const hub = deps.eventHub ?? createEventHub();
  const watcher = createStateWatcher({
    statePath: deps.statePath,
    intervalMs: deps.watchIntervalMs,
    onChange: () => hub.broadcast("state-changed", JSON.stringify({ at: new Date().toISOString() })),
  });
  deps.onWatcher?.(watcher);
  if (deps.watch) watcher.start();

  // Serialize all translate operations so concurrent per-locale requests don't
  // race on the load→mutate→persist cycle (last writer wins otherwise).
  let translateQueue: Promise<void> = Promise.resolve();
  const withTranslateLock = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = translateQueue.then(fn, fn);
    translateQueue = next.then(() => {}, () => {});
    return next;
  };

  // Confirm-gated chat tools suspend the orchestrator until the UI approves the
  // action via POST /chat/confirm. The in-flight turn registers a resolver here
  // keyed by the tool-use id; the confirm route resolves it.
  const pendingConfirms = new Map<string, (approved: boolean) => void>();

  // Debounced auto-export: editing in the UI rewrites only the changed locale files
  // so a running app dev server reflects the change immediately. Off unless serve
  // enabled it AND the project's config.autoExport isn't false.
  let autoExportTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleAutoExport = (s: State) => {
    if (!deps.autoExport || s.config.autoExport === false) return;
    clearTimeout(autoExportTimer);
    autoExportTimer = setTimeout(() => {
      try {
        exportToDisk(s, projectRoot);
      } catch {
        /* best-effort: a broken adapter/output shouldn't crash the editor */
      }
    }, 200);
  };
  const persist = (s: State) => {
    saveState(deps.statePath, s);
    // Record our own write so the watcher recognizes it and doesn't tell the UI
    // to reload its own edit back in.
    watcher.noteWrite(s);
    scheduleAutoExport(s);
  };

  // Append a general activity-log entry. Routes call this after persist so every
  // catalog change is recorded alongside AI operations in the same log.
  const logChange = (entry: Omit<LogEntry, "at">) =>
    appendLog(projectRoot, { ...entry, at: new Date().toISOString() });
  const valueText = (s: State, key: string, locale: string): string | undefined =>
    s.keys[key]?.values[locale]?.value;

  const uiPrefsPath = deps.uiPrefsPath ?? defaultUiPrefsPath();

  app.get("/state", (c) => c.json(load()));

  // Beta-feature flags. The UI fetches this on load to decide whether to render
  // affordances that are still behind an env-var gate (see ./beta.ts).
  app.get("/features", (c) => c.json(betaFeatures()));

  // Server-sent events: the UI opens this once and re-fetches whenever an external
  // change to the state lands on disk. Held open until the client disconnects; a
  // periodic heartbeat lets a dead connection be noticed and cleaned up.
  app.get("/events", (c) =>
    streamSSE(c, async (stream) => {
      const send: EventSender = (event, data) => { void stream.writeSSE({ event, data }); };
      const unsubscribe = hub.subscribe(send);
      stream.onAbort(unsubscribe);
      // Flush headers immediately so the client knows the stream is live.
      await stream.writeSSE({ event: "ready", data: "" });
      try {
        while (!stream.aborted) {
          await stream.sleep(30000);
          if (stream.aborted) break;
          await stream.writeSSE({ event: "ping", data: "" });
        }
      } finally {
        unsubscribe();
      }
    }));

  // UI preferences are per-machine and global (not project config), so the theme
  // follows the user across every instance regardless of port or host.
  app.get("/ui-prefs", (c) => c.json(loadUiPrefs(uiPrefsPath)));

  app.put("/ui-prefs", async (c) => {
    const body = await c.req.json();
    const patch: Partial<UiPrefs> = {};
    if ("theme" in body) {
      if (!isThemeMode(body.theme)) return c.json({ error: "theme must be system, light, or dark" }, 400);
      patch.theme = body.theme;
    }
    for (const field of ["keyColumnWidth", "detailPanelWidth"] as const) {
      if (field in body) {
        if (!isPanelWidth(body[field])) return c.json({ error: `${field} must be a number between 120 and 1200` }, 400);
        patch[field] = Math.round(body[field]);
      }
    }
    if ("detailPanelOpen" in body) {
      if (typeof body.detailPanelOpen !== "boolean") return c.json({ error: "detailPanelOpen must be a boolean" }, 400);
      patch.detailPanelOpen = body.detailPanelOpen;
    }
    if (Object.keys(patch).length === 0) return c.json({ error: "no recognized preferences in body" }, 400);
    saveUiPrefs(uiPrefsPath, patch);
    return c.json({ ok: true });
  });

  // Per-project, per-developer settings stored in <project>/.glotfile/settings.json
  // (gitignored): the AI provider/model and the editor opened for code usages. Kept
  // out of the committed config so each developer — and each project — can differ.
  app.get("/local-settings", (c) => c.json(loadLocalSettings(projectRoot)));

  app.put("/local-settings", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const patch: Partial<LocalSettings> = {};
    if (body.ai !== undefined) {
      const err = aiConfigError(body.ai);
      if (err) return c.json({ error: err }, 400);
      patch.ai = body.ai;
    }
    if (body.editor !== undefined) {
      if (!isEditorId(body.editor)) return c.json({ error: "editor must be one of: vscode, zed, phpstorm" }, 400);
      patch.editor = body.editor;
    }
    if (body.multilingualLocales !== undefined) {
      const err = multilingualLocalesError(body.multilingualLocales);
      if (err) return c.json({ error: err }, 400);
      patch.multilingualLocales = body.multilingualLocales;
    }
    if (patch.ai === undefined && patch.editor === undefined && patch.multilingualLocales === undefined) {
      return c.json({ error: "provide ai, editor and/or multilingualLocales" }, 400);
    }
    saveLocalSettings(projectRoot, patch);
    return c.json({ ok: true });
  });

  // List profiles + active
  app.get("/ai-profiles", (c) => {
    const ls = loadLocalSettings(projectRoot);
    return c.json({ profiles: ls.profiles, activeProfile: ls.activeProfile });
  });

  // Create or update a profile
  app.put("/ai-profiles/:name", async (c) => {
    const name = c.req.param("name").trim();
    if (!name) return c.json({ error: "name required" }, 400);
    const body = await c.req.json().catch(() => ({}));
    const err = aiConfigError(body);
    if (err) return c.json({ error: err }, 400);
    const ls = loadLocalSettings(projectRoot);
    saveLocalSettings(projectRoot, { profiles: { ...ls.profiles, [name]: body } });
    return c.json({ ok: true });
  });

  // Delete a profile
  app.delete("/ai-profiles/:name", (c) => {
    const name = c.req.param("name");
    const ls = loadLocalSettings(projectRoot);
    if (!(name in ls.profiles)) return c.json({ error: "profile not found" }, 404);
    const profiles = { ...ls.profiles };
    delete profiles[name];
    const patch: Partial<typeof ls> = { profiles };
    if (ls.activeProfile === name) patch.activeProfile = null;
    saveLocalSettings(projectRoot, patch);
    return c.json({ ok: true });
  });

  // Set active profile (null to clear)
  app.post("/ai-profiles/active", async (c) => {
    const { name } = await c.req.json().catch(() => ({}));
    if (name !== null && name !== undefined) {
      if (typeof name !== "string") return c.json({ error: "name must be a string or null" }, 400);
      const ls = loadLocalSettings(projectRoot);
      if (name !== "" && !(name in ls.profiles)) return c.json({ error: "profile not found" }, 404);
      saveLocalSettings(projectRoot, { activeProfile: name || null });
    } else {
      saveLocalSettings(projectRoot, { activeProfile: null });
    }
    return c.json({ ok: true });
  });

  // Connection probe for the active AI config: build the provider and run one
  // throwaway translation, so a misconfiguration (missing credentials, wrong
  // model id, missing IAM permission) surfaces here — with an actionable
  // message — instead of mid-run. Always 200; the body carries ok/error.
  app.post("/ai-test", async (c) => {
    const aiCfg = loadLocalSettings(projectRoot).ai;
    const meta = { provider: aiCfg.provider, model: aiCfg.model };
    let provider: TranslationProvider;
    try {
      provider = deps.makeProvider ? deps.makeProvider() : makeProvider(aiCfg);
    } catch (e) {
      return c.json({ ok: false, ...meta, error: explainProviderError(aiCfg.provider, e) });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const probe: TranslationRequest = {
        id: "probe", key: "glotfile.connection-test", source: "Hello",
        sourceLocale: "en", targetLocale: "es", placeholders: [],
      };
      // A resolved call — even one with a per-item validation error — means the
      // provider was reachable and authorized; that's all the test checks.
      await provider.translate([probe], undefined, controller.signal);
      return c.json({ ok: true, ...meta });
    } catch (e) {
      const error = controller.signal.aborted
        ? "Connection test timed out after 30s — the provider didn't respond."
        : explainProviderError(aiCfg.provider, e);
      return c.json({ ok: false, ...meta, error });
    } finally {
      clearTimeout(timer);
    }
  });

  // Model price cache (models.dev): status + the price resolved for the active
  // AI config. Reads the cache off disk; never touches the network.
  app.get("/prices", (c) => {
    const cache = loadPriceCache();
    const ai = loadLocalSettings(projectRoot).ai;
    const pricing = resolvePricing(ai, cache);
    return c.json({
      source: cache?.source ?? null,
      fetchedAt: cache?.fetchedAt ?? null,
      modelCount: cache ? Object.keys(cache.models).length : 0,
      path: defaultPriceCachePath(),
      resolved: pricing ? { provider: ai.provider, model: ai.model, ...pricing } : null,
    });
  });

  // The full cached price table, sorted by model id, for the browse/search UI.
  app.get("/prices/list", (c) => {
    const cache = loadPriceCache();
    const models = cache
      ? Object.entries(cache.models)
          .map(([id, p]) => ({ id, ...p }))
          .sort((a, b) => a.id.localeCompare(b.id))
      : [];
    return c.json({ source: cache?.source ?? null, fetchedAt: cache?.fetchedAt ?? null, models });
  });

  // The one network path: fetch the latest prices from models.dev and rewrite
  // the cache. Invalidate the in-process memo so this running server resolves
  // against the new prices without a restart.
  app.post("/prices/refresh", async (c) => {
    try {
      const res = await refreshPrices();
      invalidatePriceCache();
      return c.json({ ok: true, ...res });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  });

  app.get("/file", (c) =>
    c.json({ path: deps.statePath, name: basename(deps.statePath), dir: projectRoot, project: basename(projectRoot) }));

  app.get("/files", (c) => {
    const found = new Map<string, { name: string; path: string; relDir?: string }>();
    // Always include the active file, even if it doesn't exist yet.
    const activeRel = relative(projectRoot, deps.statePath);
    found.set(deps.statePath, {
      name: basename(deps.statePath),
      path: deps.statePath,
      relDir: activeRel !== basename(activeRel) ? dirname(activeRel) : undefined,
    });

    function walk(dir: string, depth: number) {
      if (depth > 4) return;
      let entries: string[] = [];
      try {
        entries = readdirSync(dir);
      } catch {
        return;
      }
      for (const name of entries) {
        // Skip hidden dirs, node_modules, and the .glotfile metadata dir.
        if (name.startsWith(".") || name === "node_modules") continue;
        const abs = resolve(dir, name);
        let filePath: string | null = null;
        // A split catalog is a `glotfile/` or `*.glotfile/` directory holding config.json;
        // present it under its logical <dir>.json path so loadState detects it.
        if ((name === "glotfile" || name.endsWith(".glotfile")) && existsSync(resolve(abs, "config.json"))) {
          filePath = resolve(dir, `${name}.json`);
        } else if (name === "glotfile.json" || name.endsWith(".glotfile.json")) {
          filePath = abs;
        } else {
          // Recurse into subdirectories.
          try {
            if (statSync(abs).isDirectory()) walk(abs, depth + 1);
          } catch { /* unreadable — skip */ }
          continue;
        }
        if (found.has(filePath)) continue;
        try {
          loadState(filePath);
          const rel = relative(projectRoot, filePath);
          found.set(filePath, { name: basename(filePath), path: filePath, relDir: rel !== basename(filePath) ? dirname(rel) : undefined });
        } catch {
          /* not a valid glotfile — skip it */
        }
      }
    }

    walk(projectRoot, 0);
    const files = [...found.values()].sort((a, b) => {
      const ka = a.relDir ? `${a.relDir}/${a.name}` : a.name;
      const kb = b.relDir ? `${b.relDir}/${b.name}` : b.name;
      return ka.localeCompare(kb);
    });
    return c.json(files);
  });

  app.post("/file", async (c) => {
    const { path } = await c.req.json();
    if (typeof path !== "string") return c.json({ error: "path must be a string" }, 400);
    const resolved = resolve(projectRoot, path);
    const inside = resolved === projectRoot || resolved.startsWith(projectRoot + sep);
    if (!inside) return c.json({ error: "file is outside the project" }, 400);
    if (!existsSync(resolved)) return c.json({ error: "file not found" }, 400);
    // Throws GlotfileError → 400 via onError if it isn't a valid glotfile.
    loadState(resolved);
    deps.statePath = resolved;
    // Follow the active file so changes to the newly-selected one are detected
    // (and changes to the old one no longer trigger reloads).
    watcher.retarget(resolved);
    return c.json({ ok: true, path: resolved, name: basename(resolved), dir: projectRoot, project: basename(projectRoot) });
  });

  app.post("/keys", async (c) => {
    const { key, value, plural } = await c.req.json();
    if (typeof key !== "string" || !key.trim()) return c.json({ error: "key is required" }, 400);
    if (typeof value !== "string" || !value.trim()) return c.json({ error: "source value is required" }, 400);
    if (plural !== undefined && (typeof plural?.arg !== "string" || !plural.arg.trim())) {
      return c.json({ error: "plural.arg must be a non-empty string" }, 400);
    }
    const s = load();
    // For a plural key the entered value seeds the required "other" form.
    createKey(s, key, value, undefined, plural ? { plural: { arg: plural.arg } } : {});
    persist(s);
    logChange({ kind: "key", summary: `Created key ${key}`, key, after: value });
    console.log(`[key] created ${key}`);
    return c.json({ ok: true });
  });

  app.post("/dictionary", async (c) => {
    const { word } = await c.req.json();
    if (typeof word !== "string" || !word.trim()) return c.json({ error: "word is required" }, 400);
    const s = load();
    addCustomWord(s, word);
    persist(s);
    logChange({ kind: "dictionary", summary: `Added "${word}" to dictionary`, after: word });
    return c.json({ ok: true });
  });

  app.delete("/dictionary/:word", (c) => {
    const s = load();
    const word = c.req.param("word");
    removeCustomWord(s, word);
    persist(s);
    logChange({ kind: "dictionary", summary: `Removed "${word}" from dictionary`, before: word });
    return c.json({ ok: true });
  });

  app.patch("/keys/:key", async (c) => {
    const key = c.req.param("key");
    const body = await c.req.json();
    const s = load();
    const beforeSource = typeof body.source === "string" ? valueText(s, key, s.config.sourceLocale) : undefined;
    if (typeof body.rename === "string") renameKey(s, key, body.rename);
    const target = typeof body.rename === "string" ? body.rename : key;
    if (body.metadata) setMetadata(s, target, body.metadata);
    if (typeof body.source === "string") setSourceValue(s, target, body.source);
    if (typeof body.pluralArg === "string" && body.pluralArg.trim()) setPluralArg(s, target, body.pluralArg.trim());
    persist(s);
    if (typeof body.rename === "string") logChange({ kind: "key", summary: `Renamed ${key} → ${body.rename}`, key: target, before: key, after: body.rename });
    if (body.metadata) logChange({ kind: "metadata", summary: `Updated metadata of ${target}`, key: target, after: body.metadata });
    if (typeof body.source === "string") logChange({ kind: "translation", summary: `Set source value of ${target}`, key: target, locale: s.config.sourceLocale, before: beforeSource, after: body.source });
    if (typeof body.pluralArg === "string" && body.pluralArg.trim()) logChange({ kind: "key", summary: `Changed plural arg of ${target}`, key: target, after: body.pluralArg.trim() });
    if (typeof body.rename === "string") console.log(`[key] renamed ${key} → ${body.rename}`);
    return c.json({ ok: true });
  });

  // Delete an uploaded screenshot file from disk once nothing references it.
  // Guarded to the screenshots dir so a crafted path can never escape it.
  function removeOrphanScreenshot(s: State, screenshot: string | undefined): void {
    if (!screenshot) return;
    for (const e of Object.values(s.keys)) if (e.screenshot === screenshot) return;
    const root = dirname(resolve(deps.statePath));
    const abs = resolve(root, screenshot);
    // Only delete files inside a "*-screenshots" folder directly under the root.
    const rel = relative(root, abs);
    const seg0 = rel.split(sep)[0] ?? "";
    if (!rel.startsWith("..") && seg0.endsWith("-screenshots") && existsSync(abs)) {
      try {
        rmSync(abs);
      } catch {
        /* best-effort cleanup */
      }
    }
  }

  app.delete("/keys/:key", (c) => {
    const s = load();
    const key = c.req.param("key");
    const shot = s.keys[key]?.screenshot;
    const before = valueText(s, key, s.config.sourceLocale);
    deleteKey(s, key);
    removeOrphanScreenshot(s, shot);
    persist(s);
    logChange({ kind: "key", summary: `Deleted key ${key}`, key, before });
    console.log(`[key] deleted ${key}`);
    return c.json({ ok: true });
  });

  app.post("/keys/bulk-clear", async (c) => {
    const { keys, locales } = await c.req.json();
    if (!Array.isArray(keys) || keys.length === 0) return c.json({ error: "keys must be a non-empty array" }, 400);
    if (!Array.isArray(locales)) return c.json({ error: "locales must be an array" }, 400);
    const s = load();
    const known = new Set(s.config.locales);
    for (const l of locales) if (!known.has(l)) return c.json({ error: `Unknown locale: ${l}` }, 400);
    let cleared = 0;
    for (const key of keys) {
      const entry = s.keys[key];
      if (!entry) continue;
      for (const locale of locales) {
        if (locale === s.config.sourceLocale) continue; // source is never cleared
        if (entry.values[locale]) {
          clearValue(s, key, locale);
          cleared++;
        }
      }
    }
    persist(s);
    if (cleared) logChange({ kind: "translation", summary: `Cleared ${cleared} value(s) across ${keys.length} key(s)`, after: { locales } });
    console.log(`[bulk] cleared ${cleared} value(s)`);
    return c.json({ cleared });
  });

  app.post("/keys/bulk-delete", async (c) => {
    const { keys } = await c.req.json();
    if (!Array.isArray(keys) || keys.length === 0) return c.json({ error: "keys must be a non-empty array" }, 400);
    const s = load();
    const removed: string[] = [];
    const shots: (string | undefined)[] = [];
    for (const key of keys) {
      if (!s.keys[key]) continue;
      // Capture the screenshot before deleting so the orphan check sees a state
      // that no longer references it — same order the single-key delete uses.
      shots.push(s.keys[key]!.screenshot);
      deleteKey(s, key);
      removed.push(key);
    }
    for (const shot of shots) removeOrphanScreenshot(s, shot);
    persist(s);
    if (removed.length) logChange({ kind: "key", summary: `Deleted ${removed.length} key(s)`, before: removed });
    console.log(`[bulk] deleted ${removed.length} key(s)`);
    return c.json({ removed });
  });

  app.post("/keys/bulk-meta", async (c) => {
    const { keys, addTags, removeTags, skipTranslate, clearContext } = await c.req.json();
    if (!Array.isArray(keys) || keys.length === 0) return c.json({ error: "keys must be a non-empty array" }, 400);
    const s = load();
    let updated = 0;
    for (const key of keys) {
      const entry = s.keys[key];
      if (!entry) continue;
      if (Array.isArray(addTags) || Array.isArray(removeTags)) {
        const tags = new Set(entry.tags ?? []);
        for (const t of addTags ?? []) if (typeof t === "string" && t.trim()) tags.add(t.trim());
        for (const t of removeTags ?? []) tags.delete(t);
        if (tags.size) setMetadata(s, key, { tags: [...tags].sort() });
        else delete entry.tags;
      }
      if (typeof skipTranslate === "boolean") {
        if (skipTranslate) setMetadata(s, key, { skipTranslate: true });
        else delete entry.skipTranslate;
      }
      if (clearContext === true) {
        delete entry.context;
        delete entry.contextSource;
      }
      updated++;
    }
    persist(s);
    if (updated) logChange({ kind: "metadata", summary: `Updated metadata on ${updated} key(s)` });
    console.log(`[bulk] updated metadata on ${updated} key(s)`);
    return c.json({ updated });
  });

  app.post("/keys/bulk-state", async (c) => {
    const { keys, locales, state: next } = await c.req.json();
    if (!Array.isArray(keys) || keys.length === 0) return c.json({ error: "keys must be a non-empty array" }, 400);
    if (!Array.isArray(locales)) return c.json({ error: "locales must be an array" }, 400);
    if (next !== "reviewed" && next !== "needs-review") return c.json({ error: "state must be reviewed or needs-review" }, 400);
    const s = load();
    const known = new Set(s.config.locales);
    for (const l of locales) if (!known.has(l)) return c.json({ error: `Unknown locale: ${l}` }, 400);
    let updated = 0;
    for (const key of keys) {
      const entry = s.keys[key];
      if (!entry) continue;
      for (const locale of locales) {
        if (locale === s.config.sourceLocale) continue; // source state stays "source"
        if (!entry.values[locale]) continue; // can't review a missing translation
        setKeyState(s, key, locale, next);
        updated++;
      }
    }
    persist(s);
    if (updated) logChange({ kind: "translation", summary: `Marked ${updated} value(s) as ${next}`, after: next });
    console.log(`[bulk] set state ${next} on ${updated} value(s)`);
    return c.json({ updated });
  });

  app.put("/keys/:key/values/:locale", async (c) => {
    const { value } = await c.req.json();
    if (typeof value !== "string") return c.json({ error: "value must be a string" }, 400);
    const s = load();
    const key = c.req.param("key");
    const locale = c.req.param("locale");
    // Editing the source locale must keep state `source`; only target locales
    // go through setTargetValue (→ reviewed).
    const before = valueText(s, key, locale);
    if (locale === s.config.sourceLocale) setSourceValue(s, key, value);
    else setTargetValue(s, key, locale, value);
    persist(s);
    logChange({ kind: "translation", summary: `Set ${locale} value of ${key}`, key, locale, before, after: value });
    return c.json({ ok: true });
  });

  app.delete("/keys/:key/values/:locale", (c) => {
    const s = load();
    const key = c.req.param("key");
    const locale = c.req.param("locale");
    const before = valueText(s, key, locale);
    clearValue(s, key, locale);
    persist(s);
    logChange({ kind: "translation", summary: `Cleared ${locale} value of ${key}`, key, locale, before });
    return c.json({ ok: true });
  });

  // Plural forms for one locale. The source locale stays `source`; targets go
  // through setPluralForms (→ reviewed). The setters validate/trim the forms and
  // reject a scalar key (GlotfileError → 400 via onError).
  app.put("/keys/:key/plural/:locale", async (c) => {
    const { forms } = await c.req.json();
    if (!forms || typeof forms !== "object") return c.json({ error: "forms object is required" }, 400);
    const s = load();
    const key = c.req.param("key");
    const locale = c.req.param("locale");
    const before = s.keys[key]?.values[locale]?.forms;
    if (locale === s.config.sourceLocale) setSourcePluralForms(s, key, forms);
    else setPluralForms(s, key, locale, forms);
    persist(s);
    logChange({ kind: "translation", summary: `Set ${locale} plural forms of ${key}`, key, locale, before, after: forms });
    return c.json({ ok: true });
  });

  app.post("/keys/:key/plural", async (c) => {
    const { arg } = await c.req.json();
    if (typeof arg !== "string" || !arg.trim()) return c.json({ error: "arg is required" }, 400);
    const s = load();
    const key = c.req.param("key");
    convertToPlural(s, key, arg);
    persist(s);
    logChange({ kind: "key", summary: `Converted ${key} to plural`, key, after: arg });
    return c.json({ ok: true });
  });

  app.delete("/keys/:key/plural", (c) => {
    const s = load();
    const key = c.req.param("key");
    convertToScalar(s, key);
    persist(s);
    logChange({ kind: "key", summary: `Converted ${key} to scalar`, key });
    return c.json({ ok: true });
  });

  app.put("/keys/:key/values/:locale/state", async (c) => {
    const { state } = await c.req.json();
    const s = load();
    const key = c.req.param("key");
    const locale = c.req.param("locale");
    const before = s.keys[key]?.values[locale]?.state;
    setKeyState(s, key, locale, state);
    persist(s);
    logChange({ kind: "translation", summary: `Marked ${key} ${locale} as ${state}`, key, locale, before, after: state });
    return c.json({ ok: true });
  });

  app.post("/keys/:key/notes", async (c) => {
    const { text } = await c.req.json();
    if (typeof text !== "string" || !text.trim()) return c.json({ error: "note text is required" }, 400);
    const s = load();
    const key = c.req.param("key");
    const note = addNote(s, key, text);
    persist(s);
    logChange({ kind: "note", summary: `Added note to ${key}`, key, after: text });
    return c.json(note);
  });

  app.put("/keys/:key/notes/:id", async (c) => {
    const { text } = await c.req.json();
    if (typeof text !== "string" || !text.trim()) return c.json({ error: "note text is required" }, 400);
    const s = load();
    const key = c.req.param("key");
    editNote(s, key, c.req.param("id"), text);
    persist(s);
    logChange({ kind: "note", summary: `Edited note on ${key}`, key, after: text });
    return c.json({ ok: true });
  });

  app.delete("/keys/:key/notes/:id", (c) => {
    const s = load();
    const key = c.req.param("key");
    deleteNote(s, key, c.req.param("id"));
    persist(s);
    logChange({ kind: "note", summary: `Deleted note on ${key}`, key });
    return c.json({ ok: true });
  });

  app.put("/config", async (c) => {
    const newConfig = (await c.req.json()) as Config;
    if (!newConfig || !Array.isArray(newConfig.locales)) {
      return c.json({ error: "config.locales must be an array" }, 400);
    }
    const s = load();
    const beforeCfg = { locales: s.config.locales };
    const removed = s.config.locales.filter((l) => !newConfig.locales.includes(l));
    for (const l of removed) {
      for (const e of Object.values(s.keys)) delete e.values[l];
    }
    s.config = newConfig;
    validate(s);
    persist(s);
    logChange({ kind: "config", summary: `Saved config (${newConfig.locales.length} locale(s))`, before: beforeCfg, after: { locales: newConfig.locales } });
    console.log(`[config] saved — ${newConfig.locales.length} locale(s)`);
    return c.json({ ok: true });
  });

  app.get("/glossary", (c) => c.json(load().glossary));

  app.put("/glossary", async (c) => {
    const entry = await c.req.json();
    if (typeof entry?.term !== "string") return c.json({ error: "term must be a string" }, 400);
    const s = load();
    const before = s.glossary.find((g) => g.term === entry.term);
    upsertGlossaryEntry(s, entry);
    persist(s);
    logChange({ kind: "glossary", summary: `${before ? "Updated" : "Added"} glossary term "${entry.term}"`, before, after: entry });
    return c.json({ ok: true });
  });

  app.delete("/glossary/:term", (c) => {
    const s = load();
    const term = decodeURIComponent(c.req.param("term"));
    const before = s.glossary.find((g) => g.term === term);
    deleteGlossaryEntry(s, term);
    persist(s);
    logChange({ kind: "glossary", summary: `Deleted glossary term "${term}"`, before });
    return c.json({ ok: true });
  });

  // Glossary AI suggestions are a beta feature (see ./beta.ts). Gate every
  // suggest route — registered before the handlers below so it runs first — so
  // a hidden UI can't be driven via the API either. 404 keeps the surface area
  // invisible rather than advertising a disabled feature.
  const requireGlossarySuggest = async (c: Context, next: Next) => {
    if (!glossarySuggestEnabled()) {
      return c.json({ error: "Glossary AI suggestions are in beta. Set GLOTFILE_BETA_GLOSSARY_SUGGEST=1 to enable them." }, 404);
    }
    await next();
  };
  app.use("/glossary/suggest", requireGlossarySuggest);
  app.use("/glossary/suggest/*", requireGlossarySuggest);
  app.use("/glossary/suggestions", requireGlossarySuggest);
  app.use("/glossary/suggestions/*", requireGlossarySuggest);

  app.get("/glossary/suggestions", (c) => {
    const s = load();
    const pending = s.glossarySuggestions.filter((x) => x.status === "pending");
    return c.json(pending.map((x) => ({
      ...x,
      occurrences: sourceKeysForTerm(s, x.term).length,
    })));
  });

  app.post("/glossary/suggestions/dismiss", async (c) => {
    const { term } = await c.req.json();
    if (typeof term !== "string") return c.json({ error: "term must be a string" }, 400);
    const s = load();
    dismissGlossarySuggestion(s, term);
    persist(s);
    logChange({ kind: "glossary", summary: `Dismissed suggested term "${term}"` });
    return c.json({ ok: true });
  });

  app.delete("/glossary/suggestions/:term", (c) => {
    const s = load();
    const term = decodeURIComponent(c.req.param("term"));
    removeGlossarySuggestion(s, term);
    persist(s);
    return c.json({ ok: true });
  });

  app.post("/glossary/suggest", async (c) => {
    const signal = c.req.raw.signal;
    const body = await c.req.json().catch(() => ({}));
    return streamSSE(c, async (stream) => {
      const s0 = load();
      const sources = selectGlossarySources(s0, { keyGlob: body.keyGlob, limit: body.limit, since: body.since });
      if (!sources.length) {
        await stream.writeSSE({ event: "done", data: JSON.stringify({ added: 0, terms: [] }) });
        return;
      }
      const aiCfg = loadLocalSettings(projectRoot).ai;
      let provider: TranslationProvider;
      try {
        provider = deps.makeProvider ? deps.makeProvider() : makeProvider(aiCfg);
      } catch (e) {
        await stream.writeSSE({ event: "error", data: JSON.stringify({ error: (e as Error).message }) });
        return;
      }
      const known = knownTermList(s0);
      await stream.writeSSE({ event: "start", data: JSON.stringify({ total: sources.length }) });

      const system = buildGlossarySuggestSystemPrompt();
      const batchSize = aiCfg.contextBatchSize ?? aiCfg.batchSize ?? 10;
      const concurrency = aiCfg.contextConcurrency ?? aiCfg.concurrency ?? 3;
      const chunks: typeof sources[] = [];
      for (let i = 0; i < sources.length; i += batchSize) chunks.push(sources.slice(i, i + batchSize));

      const all: SuggestedTerm[] = [];
      let done = 0;
      let next = 0;
      async function worker() {
        while (next < chunks.length) {
          if (signal?.aborted) break;
          const chunkRows = chunks[next++]!;
          try {
            const raw = await provider.complete({ system, content: [{ type: "text", text: buildGlossarySuggestBatchPrompt(chunkRows, known) }], schema: GLOSSARY_SUGGEST_SCHEMA });
            all.push(...((raw as { terms?: SuggestedTerm[] }).terms ?? []));
          } catch (e) {
            void stream.writeSSE({ event: "warn", data: JSON.stringify({ error: (e as Error).message }) });
          }
          done += chunkRows.length;
          void stream.writeSSE({ event: "progress", data: JSON.stringify({ done, total: sources.length }) });
        }
      }
      await Promise.all(Array.from({ length: Math.min(concurrency, chunks.length) }, worker));
      if (signal?.aborted) return;

      const fresh = load();
      const added = mergeGlossarySuggestions(fresh, dedupeTerms(all));
      const usage = provider.takeUsage?.();
      persist(fresh);
      appendLog(projectRoot, {
        at: new Date().toISOString(),
        kind: "glossary",
        summary: `Suggested ${added.length} glossary term(s)`,
        model: aiCfg.model,
        system,
        usage,
        estimatedCostUsd: usageCostUsd(usage, aiCfg),
      });
      await stream.writeSSE({ event: "done", data: JSON.stringify({ added: added.length, terms: added }) });
    });
  });

  app.post("/glossary/suggest/estimate", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const s = load();
    const sources = selectGlossarySources(s, { keyGlob: body.keyGlob, limit: body.limit, since: body.since });
    const aiCfg = loadLocalSettings(projectRoot).ai;
    return c.json(estimateGlossarySuggest(sources, knownTermList(s), aiCfg));
  });

  // Pending glossary-suggestion-batch status. Independent from translation batch
  // and context batch — one of each kind can be in flight simultaneously.
  app.get("/glossary/suggest/batch/status", async (c) => {
    const aiCfg = loadLocalSettings(projectRoot).ai;
    let supported = false;
    let provider;
    try {
      provider = deps.makeProvider ? deps.makeProvider() : makeProvider(aiCfg);
      supported = supportsBatchComplete(provider);
    } catch {
      // No usable provider (e.g. missing API key) — report unsupported rather than erroring.
    }
    const pending = loadPendingGlossaryBatch(projectRoot);
    if (!pending) return c.json({ supported, pending: null });
    const base = { batchId: pending.batchId, createdAt: pending.createdAt, model: pending.model, total: pending.total };
    if (!provider || !supportsBatchComplete(provider)) {
      return c.json({ supported, pending: { ...base, status: "unknown", counts: null } });
    }
    try {
      const status = await provider.translationBatchStatus(pending.batchId);
      return c.json({ supported, pending: { ...base, status: status.status, counts: status.counts } });
    } catch (e) {
      return c.json({ supported, pending: { ...base, status: "unknown", counts: null, error: (e as Error).message } });
    }
  });

  app.post("/glossary/suggest/batch", (c) => withTranslateLock(async () => {
    const body = await c.req.json().catch(() => ({}));
    const s = load();
    const sources = selectGlossarySources(s, { keyGlob: body.keyGlob, limit: body.limit, since: body.since });
    if (!sources.length) return c.json({ error: "No source strings to scan." }, 400);
    const aiCfg = loadLocalSettings(projectRoot).ai;
    let provider;
    try {
      provider = deps.makeProvider ? deps.makeProvider() : makeProvider(aiCfg);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
    if (!supportsBatchComplete(provider)) {
      return c.json({ error: `Provider "${aiCfg.provider}" does not support batch mode.` }, 400);
    }
    const batchSize = aiCfg.contextBatchSize ?? aiCfg.batchSize ?? 10;
    let pending;
    try {
      pending = await submitGlossarySuggestBatch(provider, sources, knownTermList(s), batchSize, aiCfg.model, projectRoot);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 409);
    }
    appendLog(projectRoot, {
      at: new Date().toISOString(),
      kind: "glossary",
      summary: `Submitted glossary suggestion batch ${pending.batchId} (${pending.total} sources)`,
      model: aiCfg.model,
    });
    return c.json({ batchId: pending.batchId, total: pending.total });
  }));

  app.post("/glossary/suggest/batch/apply", (c) => withTranslateLock(async () => {
    const pending = loadPendingGlossaryBatch(projectRoot);
    if (!pending) return c.json({ error: "No pending glossary suggestion batch." }, 404);
    const aiCfg = loadLocalSettings(projectRoot).ai;
    let provider;
    try {
      provider = deps.makeProvider ? deps.makeProvider() : makeProvider(aiCfg);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
    if (!supportsBatchComplete(provider)) {
      return c.json({ error: `Provider "${aiCfg.provider}" does not support batch mode.` }, 400);
    }
    // applyGlossarySuggestBatchResults writes the activity-log entry and clears the handle.
    const outcome = await applyGlossarySuggestBatchResults(load, persist, provider, pending, projectRoot, aiCfg);
    return c.json(outcome);
  }));

  app.post("/glossary/suggest/batch/cancel", async (c) => {
    const pending = loadPendingGlossaryBatch(projectRoot);
    if (!pending) return c.json({ error: "No pending glossary suggestion batch." }, 404);
    const aiCfg = loadLocalSettings(projectRoot).ai;
    try {
      const provider = deps.makeProvider ? deps.makeProvider() : makeProvider(aiCfg);
      if (supportsBatchComplete(provider)) await provider.cancelTranslationBatch(pending.batchId);
    } catch {
      // Cancel best-effort: clearing the local handle must work even when the
      // provider is unreachable (the remote batch simply expires server-side).
    }
    clearPendingGlossaryBatch(projectRoot);
    return c.json({ canceled: pending.batchId });
  });

  app.post("/keys/:key/screenshot", async (c) => {
    const key = c.req.param("key");
    const body = await c.req.parseBody();
    const file = body["file"];
    if (!file || typeof file === "string") return c.json({ error: "no file uploaded" }, 400);
    const root = dirname(resolve(deps.statePath));
    const dirName = screenshotDirName(deps.statePath);
    const dir = resolve(root, dirName);
    const filename = `${sanitize(key)}__${sanitize(file.name)}`;
    writeFileAtomic(resolve(dir, filename), Buffer.from(await file.arrayBuffer()));
    const path = `${dirName}/${filename}`;
    const s = load();
    const prev = s.keys[key]?.screenshot;
    setMetadata(s, key, { screenshot: path });
    // A re-upload replaces the old file — clean it up once unreferenced.
    if (prev && prev !== path) removeOrphanScreenshot(s, prev);
    persist(s);
    logChange({ kind: "metadata", summary: `${prev ? "Replaced" : "Added"} screenshot on ${key}`, key, before: prev, after: path });
    return c.json({ path });
  });

  app.delete("/keys/:key/screenshot", (c) => {
    const s = load();
    const key = c.req.param("key");
    const shot = s.keys[key]?.screenshot;
    setMetadata(s, key, { screenshot: undefined });
    removeOrphanScreenshot(s, shot);
    persist(s);
    logChange({ kind: "metadata", summary: `Removed screenshot from ${key}`, key, before: shot });
    return c.json({ ok: true });
  });

  app.get("/export/preview", (c) => {
    const s = narrowForExport(load());
    const files: ExportedFile[] = [];
    const warnings: ExportWarning[] = [];
    for (const output of s.config.outputs) {
      const result = getAdapter(output.adapter).export(s, output);
      files.push(...result.files);
      warnings.push(...result.warnings);
    }
    return c.json({ files, warnings });
  });

  app.get("/scan/missing", (c) => c.json(findMissing(load())));

  // The release gate: the exact report `glotfile check` produces (lint rules over
  // the state plus output-drift), so the UI's "ready to ship" and the CLI can
  // never disagree. Rules are skipped via config.lint.rules ("off") for both.
  // Dictionaries are cached across requests so spelling doesn't reload per call.
  const spellerCache = new Map<string, Promise<Speller | null>>();
  const cachedLoader = (dictId: string): Promise<Speller | null> => {
    let p = spellerCache.get(dictId);
    if (!p) { p = defaultLoader(dictId); spellerCache.set(dictId, p); }
    return p;
  };
  app.get("/lint", async (c) => {
    const state = load();
    const includeSuppressed = c.req.query("includeSuppressed") === "1";
    const lint = await runLint(state, { loadSpeller: cachedLoader, warn: () => {}, includeSuppressed });
    const findings = sortFindings([...lint.findings, ...checkOutputs(state, projectRoot)]);
    const counts = { ...countSeverities(findings), suppressed: lint.counts.suppressed };
    return c.json({ findings, counts, ok: counts.error === 0 });
  });

  // Dismiss one finding: hide (rule, locale) on this key until its source changes.
  app.post("/keys/:key/suppressions", async (c) => {
    const key = c.req.param("key");
    const { rule, locale } = await c.req.json();
    if (typeof rule !== "string" || !rule) return c.json({ error: "rule is required" }, 400);
    if (typeof locale !== "string" || !locale) return c.json({ error: "locale is required" }, 400);
    const s = load();
    addSuppression(s, key, rule, locale);
    persist(s);
    logChange({ kind: "suppression", summary: `Suppressed ${rule} for ${key} [${locale}]`, key, locale, after: rule });
    return c.json({ ok: true });
  });

  app.delete("/keys/:key/suppressions", (c) => {
    const key = c.req.param("key");
    const rule = c.req.query("rule") ?? "";
    const locale = c.req.query("locale") ?? "";
    if (!rule || !locale) return c.json({ error: "rule and locale are required" }, 400);
    const s = load();
    removeSuppression(s, key, rule, locale);
    persist(s);
    logChange({ kind: "suppression", summary: `Unsuppressed ${rule} for ${key} [${locale}]`, key, locale, before: rule });
    return c.json({ ok: true });
  });

  // Bulk-dismiss current warning findings (the UI's "dismiss all" actions).
  app.post("/lint/accept", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { rules?: string[]; locales?: string[] };
    const s = load();
    const lint = await runLint(s, { loadSpeller: cachedLoader, warn: () => {} });
    const result = acceptFindings(s, lint.findings, { rules: body.rules, locales: body.locales });
    if (result.accepted > 0) {
      persist(s);
      logChange({ kind: "suppression", summary: `Suppressed ${result.accepted} finding(s)`, after: result.byRule });
    }
    return c.json({ ok: true, ...result });
  });

  app.get("/checks", (c) => {
    const param = c.req.query("checks");
    const only = param
      ? (param.split(",").map((s) => s.trim()).filter((s): s is CheckId =>
          (CHECK_IDS as readonly string[]).includes(s)))
      : undefined;
    return c.json(runChecks(load(), { only }));
  });

  app.get("/stats", (c) => c.json(computeStats(load())));

  app.get("/import/detect", (c) => {
    const preview = previewImport(projectRoot);
    if (!preview) return c.json({ found: false });
    return c.json({ found: true, ...preview });
  });

  app.post("/import", async (c) => {
    const state = load();
    if (Object.keys(state.keys).length > 0) {
      return c.json({ error: "cannot import into a non-empty project" }, 400);
    }
    const body = (await c.req.json()) as { format?: string; sourceLocale?: string; locales?: string[]; cldr?: boolean };
    let result;
    try {
      result = runImport({
        projectRoot,
        format: body.format,
        sourceLocale: body.sourceLocale,
        locales: body.locales,
        cldr: body.cldr,
      });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
    persist(result.state);
    logChange({ kind: "import", summary: `Imported ${result.keyCount} key(s) across ${result.localeCount} locale(s)` });
    console.log(`[import] ${result.keyCount} key(s) across ${result.localeCount} locale(s)${result.warnings.length ? `, ${result.warnings.length} warning(s)` : ""}`);
    return c.json({ keyCount: result.keyCount, localeCount: result.localeCount, warnings: result.warnings });
  });

  // Merge re-extracted locale files into the existing catalog. Without apply:true
  // this is a dry run that returns the SyncPlan only (the UI's confirm step);
  // with apply:true it persists and rebuilds the usage index for Angular.
  app.post("/sync", async (c) => {
    if (Object.keys(load().keys).length === 0) {
      return c.json({ error: "nothing to sync into; import first" }, 400);
    }
    const body = (await c.req.json().catch(() => ({}))) as {
      apply?: boolean; prune?: boolean; format?: string; sourceLocale?: string; locales?: string[]; cldr?: boolean;
    };
    let result;
    try {
      result = runSync({
        projectRoot,
        statePath: deps.statePath,
        format: body.format,
        sourceLocale: body.sourceLocale,
        locales: body.locales,
        cldr: body.cldr,
        prune: body.prune,
      });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
    if (body.apply !== true) {
      return c.json({ plan: result.plan, warnings: result.warnings });
    }
    persist(result.state);
    const usageCache = isLocationScannedState(result.state)
      ? refreshLocationUsage(projectRoot, body.format)
      : null;
    const usageRefs = usageCache ? usageCounts(usageCache).refs : undefined;
    const p = result.plan;
    logChange({
      kind: "import",
      summary: `Synced: +${p.added.length} added, ~${p.sourceChanged.length} changed, -${p.removed.length} removed${body.prune ? " (pruned)" : ""}`,
    });
    console.log(`[sync] +${p.added.length} ~${p.sourceChanged.length} -${p.removed.length}${body.prune ? " pruned" : ""}`);
    return c.json({ applied: true, plan: result.plan, warnings: result.warnings, usageRefs });
  });

  app.post("/export", (c) => {
    const root = dirname(resolve(deps.statePath));
    const { written, skipped, deleted, warnings } = exportToDisk(load(), root);
    console.log(
      `[export] ${written + skipped} file(s)` +
        `${deleted ? `, ${deleted} removed` : ""}${warnings.length ? `, ${warnings.length} warning(s)` : ""}`,
    );
    return c.json({ files: written + skipped, warnings });
  });

  app.post("/translate/stream", async (c) => {
    const signal = c.req.raw.signal;
    // Scope arrives in the JSON body (not the query string): a large filtered key
    // set overflowed Node's request-line/header size limit → HTTP 431.
    const body = await c.req.json().catch(() => ({}));
    const keys = Array.isArray(body.keys) && body.keys.length ? (body.keys as string[]).filter(Boolean) : undefined;
    const locales = Array.isArray(body.locales) && body.locales.length ? (body.locales as string[]).filter(Boolean) : undefined;
    // Default to filling only missing targets; force=true (with onlyMissing=false)
    // re-translates and overwrites existing values — the inline "re-translate
    // stale" path mirrors the blocking /translate endpoint's force semantics.
    const onlyMissing = body.onlyMissing !== false;
    const force = body.force === true;
    return streamSSE(c, (stream) => withTranslateLock(async () => {
      const s = load();
      const reqs = selectRequests(s, { onlyMissing, keys, locales });

      if (!reqs.length) {
        await stream.writeSSE({ event: "done", data: JSON.stringify({ written: 0, errors: [] }) });
        return;
      }

      const aiCfg = loadLocalSettings(projectRoot).ai;
      let provider: TranslationProvider;
      try {
        provider = deps.makeProvider ? deps.makeProvider() : makeProvider(aiCfg);
      } catch (e) {
        await stream.writeSSE({ event: "error", data: JSON.stringify({ error: explainProviderError(aiCfg.provider, e) }) });
        return;
      }

      // Screenshot paths are relative to the ACTIVE glotfile's dir, not the project root.
      const { skipped } = attachScreenshotsForProvider(reqs, s, dirname(resolve(deps.statePath)), provider.supportsVision());
      if (skipped) console.warn(`Model "${aiCfg.model}" has no vision support; ${skipped} screenshot(s) ignored.`);

      console.log(`[translate] ${reqs.length} string(s) → ${aiCfg.model}`);

      let totalWritten = 0;
      const allErrors: Array<{ key: string; locale: string; error: string }> = [];
      const system = buildSystemPrompt(reqs);
      const reqById = new Map(reqs.map((r) => [r.id, r]));

      // The plan: every target locale and how many strings it needs, so the UI
      // can render all languages as "queued" up front and track each one's count.
      const localeTotals = new Map<string, number>();
      for (const r of reqs) localeTotals.set(r.targetLocale, (localeTotals.get(r.targetLocale) ?? 0) + 1);
      const localeDone = new Map<string, number>();
      await stream.writeSSE({
        event: "start",
        data: JSON.stringify({ total: reqs.length, locales: [...localeTotals].map(([locale, total]) => ({ locale, total })) }),
      });

      try {
      await runLocaleParallel(reqs, provider, {
        // Announce a language the moment a worker picks it up — this is the
        // signal that "something is happening" during the long first LLM call.
        onLocaleStart: (locale) => {
          void stream.writeSSE({ event: "locale-start", data: JSON.stringify({ locale }) });
        },
        onBatchComplete: (done, total, batchResults, locale) => {
          // Re-load from disk so any user edits made during the translation
          // (value changes, context updates, saves) are not overwritten.
          const fresh = load();
          const { written, errors } = applyResults(fresh, reqs, batchResults, force);
          persist(fresh);
          totalWritten += written;
          allErrors.push(...errors);
          // Usage accrued since the last drain. With concurrent batches in
          // flight, attribution to THIS batch is approximate, but every token
          // is counted exactly once across the run's entries.
          const usage = provider.takeUsage?.();
          appendLog(projectRoot, {
            at: new Date().toISOString(),
            kind: "translate",
            summary: `Translated ${batchResults.length} item(s)`,
            model: aiCfg.model,
            system,
            items: batchResults.map((r) => {
              const req = reqById.get(r.id);
              return { id: r.id, key: req?.key ?? "", source: req?.source ?? "", targetLocale: req?.targetLocale, context: req?.context, glossary: req?.glossary, screenshot: req ? fresh.keys[req.key]?.screenshot : undefined };
            }),
            results: batchResults,
            usage,
            estimatedCostUsd: usageCostUsd(usage, aiCfg),
          });
          const ld = (localeDone.get(locale) ?? 0) + batchResults.length;
          localeDone.set(locale, ld);
          console.log(`[translate] ${done}/${total}`);
          void stream.writeSSE({
            event: "progress",
            data: JSON.stringify({ done, total, written: totalWritten, errors, locale, localeDone: ld, localeTotal: localeTotals.get(locale) ?? 0 }),
          });
        },
        onLocaleDone: (locale) => {
          void stream.writeSSE({ event: "locale-done", data: JSON.stringify({ locale }) });
        },
        // Record the raw reply so an unparseable model response is diagnosable
        // from the activity log instead of vanishing into per-item errors.
        onMalformedReply: (raw, batchSize, locale) => {
          console.error(`[translate] malformed model reply (${locale}, batch of ${batchSize})${batchSize > 1 ? " — splitting batch and retrying" : ""}`);
          appendLog(projectRoot, {
            at: new Date().toISOString(),
            kind: "translate",
            summary: `Malformed model reply (${locale}, batch of ${batchSize})`,
            model: aiCfg.model,
            locale,
            raw,
          });
        },
      }, aiCfg.concurrency, signal, aiCfg.batchSize);
      } catch (e) {
        // A provider failure mid-run (on Bedrock, credentials only resolve at
        // send time) would otherwise end the stream with no signal to the UI.
        if (!signal?.aborted) {
          await stream.writeSSE({ event: "error", data: JSON.stringify({ error: explainProviderError(aiCfg.provider, e) }) });
        }
        return;
      }

      if (!signal?.aborted) {
        console.log(`[translate] done — wrote ${totalWritten}, ${allErrors.length} error(s)`);
        await stream.writeSSE({ event: "done", data: JSON.stringify({ written: totalWritten, errors: allErrors }) });
      } else {
        console.log(`[translate] cancelled — wrote ${totalWritten} so far`);
      }
    }));
  });

  app.post("/translate", (c) => withTranslateLock(async () => {
    const body = await c.req.json().catch(() => ({}));
    const s = load();
    const reqs = selectRequests(s, {
      onlyMissing: body.onlyMissing ?? true,
      locales: body.locales,
      keyGlob: body.keyGlob,
    });

    const force = body.force === true;
    const toTranslate = [...reqs];

    let written = 0;
    let errors: Array<{ key: string; locale: string; error: string }> = [];
    if (toTranslate.length) {
      const aiCfg = loadLocalSettings(projectRoot).ai;
      let provider;
      try {
        provider = deps.makeProvider ? deps.makeProvider() : makeProvider(aiCfg);
      } catch (e) {
        return c.json({ error: explainProviderError(aiCfg.provider, e) }, 400);
      }
      // Screenshot paths are relative to the ACTIVE glotfile's dir, not the project root.
      const { skipped } = attachScreenshotsForProvider(toTranslate, s, dirname(resolve(deps.statePath)), provider.supportsVision());
      if (skipped) console.warn(`Model "${aiCfg.model}" has no vision support; ${skipped} screenshot(s) ignored.`);
      let results: Awaited<ReturnType<typeof runLocaleParallel>>;
      try {
        results = await runLocaleParallel(toTranslate, provider, {
          onMalformedReply: (raw, batchSize, locale) => {
            console.error(`[translate] malformed model reply (${locale}, batch of ${batchSize})${batchSize > 1 ? " — splitting batch and retrying" : ""}`);
            appendLog(projectRoot, {
              at: new Date().toISOString(),
              kind: "translate",
              summary: `Malformed model reply (${locale}, batch of ${batchSize})`,
              model: aiCfg.model,
              locale,
              raw,
            });
          },
        }, aiCfg.concurrency, undefined, aiCfg.batchSize);
      } catch (e) {
        // A provider failure (bad credentials, missing IAM permission, unknown
        // model id) aborts the whole run — surface an actionable message rather
        // than an opaque 500 from onError.
        return c.json({ error: explainProviderError(aiCfg.provider, e) }, 502);
      }
      // Re-load before applying so user edits made during the AI call are not overwritten.
      const latest = load();
      ({ written, errors } = applyResults(latest, toTranslate, results, force));
      const usage = provider.takeUsage?.();
      // The AI log records only what was SENT to the provider (egress-only).
      const entry: LogEntry = {
        at: new Date().toISOString(),
        kind: "translate",
        summary: `Translated ${toTranslate.length} item(s)`,
        model: aiCfg.model,
        usage,
        estimatedCostUsd: usageCostUsd(usage, aiCfg),
        system: buildSystemPrompt(toTranslate),
        // Log the screenshot PATH only — never the image bytes.
        items: toTranslate.map((r) => ({
          id: r.id,
          key: r.key,
          source: r.source,
          targetLocale: r.targetLocale,
          context: r.context,
          glossary: r.glossary,
          screenshot: latest.keys[r.key]?.screenshot,
        })),
        results,
      };
      appendLog(projectRoot, entry);
      persist(latest);
    }
    return c.json({ requested: reqs.length, written, errors });
  }));

  // Pre-flight cost preview. Read-only — no translate lock, no provider, no
  // writes — so the UI can call it freely while the user decides.
  app.post("/translate/estimate", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const keys = Array.isArray(body.keys) && body.keys.length ? (body.keys as string[]).filter(Boolean) : undefined;
    const locales = Array.isArray(body.locales) && body.locales.length ? (body.locales as string[]).filter(Boolean) : undefined;
    const ai = loadLocalSettings(projectRoot).ai;
    return c.json(estimateTranslation(load(), ai, { onlyMissing: body.onlyMissing ?? true, keys, locales }));
  });

  // Pending-batch status. Cheap when nothing is pending (no provider, no
  // network); polls the provider for live counts when a batch is in flight.
  app.get("/batch/status", async (c) => {
    const aiCfg = loadLocalSettings(projectRoot).ai;
    let supported = false;
    let provider;
    try {
      provider = deps.makeProvider ? deps.makeProvider() : makeProvider(aiCfg);
      supported = supportsBatchTranslate(provider);
    } catch {
      // No usable provider (e.g. missing API key) — report unsupported rather than erroring.
    }
    const pending = loadPendingBatch(projectRoot);
    if (!pending) return c.json({ supported, pending: null });
    const base = { batchId: pending.batchId, createdAt: pending.createdAt, model: pending.model, total: pending.total };
    if (!provider || !supportsBatchTranslate(provider)) {
      return c.json({ supported, pending: { ...base, status: "unknown", counts: null } });
    }
    try {
      const status = await provider.translationBatchStatus(pending.batchId);
      return c.json({ supported, pending: { ...base, status: status.status, counts: status.counts } });
    } catch (e) {
      return c.json({ supported, pending: { ...base, status: "unknown", counts: null, error: (e as Error).message } });
    }
  });

  app.post("/batch/translate", (c) => withTranslateLock(async () => {
    const body = await c.req.json().catch(() => ({}));
    const s = load();
    const reqs = selectRequests(s, {
      onlyMissing: body.onlyMissing ?? true,
      keys: Array.isArray(body.keys) && body.keys.length ? (body.keys as string[]).filter(Boolean) : undefined,
      locales: Array.isArray(body.locales) && body.locales.length ? (body.locales as string[]).filter(Boolean) : undefined,
    });
    if (!reqs.length) return c.json({ error: "Nothing to translate." }, 400);
    const aiCfg = loadLocalSettings(projectRoot).ai;
    let provider;
    try {
      provider = deps.makeProvider ? deps.makeProvider() : makeProvider(aiCfg);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
    if (!supportsBatchTranslate(provider)) {
      return c.json({ error: `Provider "${aiCfg.provider}" does not support batch mode.` }, 400);
    }
    // Screenshot paths are relative to the ACTIVE glotfile's dir, not the project root.
    attachScreenshotsForProvider(reqs, s, dirname(resolve(deps.statePath)), provider.supportsVision());
    let pending;
    try {
      pending = await submitBatchTranslation(s, provider, reqs, aiCfg.batchSize, aiCfg.model, projectRoot);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 409);
    }
    // The AI log records only what was SENT to the provider (egress-only).
    appendLog(projectRoot, {
      at: new Date().toISOString(),
      kind: "translate",
      summary: `Submitted batch ${pending.batchId} (${pending.total} items)`,
      model: aiCfg.model,
      system: buildSystemPrompt(reqs),
      items: reqs.map((r) => ({ id: r.id, key: r.key, source: r.source, targetLocale: r.targetLocale, context: r.context, glossary: r.glossary, screenshot: s.keys[r.key]?.screenshot })),
    });
    console.log(`[batch] submitted ${pending.batchId} — ${pending.total} string(s)`);
    return c.json({ batchId: pending.batchId, total: pending.total });
  }));

  app.post("/batch/apply", (c) => withTranslateLock(async () => {
    const pending = loadPendingBatch(projectRoot);
    if (!pending) return c.json({ error: "No pending batch." }, 404);
    const aiCfg = loadLocalSettings(projectRoot).ai;
    let provider;
    try {
      provider = deps.makeProvider ? deps.makeProvider() : makeProvider(aiCfg);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
    if (!supportsBatchTranslate(provider)) {
      return c.json({ error: `Provider "${aiCfg.provider}" does not support batch mode.` }, 400);
    }
    // applyBatchResults writes the detailed activity-log entry itself.
    const outcome = await applyBatchResults(load, persist, provider, pending, projectRoot, aiCfg);
    console.log(`[batch] applied ${pending.batchId} — wrote ${outcome.written}, ${outcome.errors.length} error(s)`);
    return c.json(outcome);
  }));

  app.post("/batch/cancel", async (c) => {
    const pending = loadPendingBatch(projectRoot);
    if (!pending) return c.json({ error: "No pending batch." }, 404);
    const aiCfg = loadLocalSettings(projectRoot).ai;
    try {
      const provider = deps.makeProvider ? deps.makeProvider() : makeProvider(aiCfg);
      if (supportsBatchTranslate(provider)) await provider.cancelTranslationBatch(pending.batchId);
    } catch {
      // Cancel best-effort: clearing the local handle must work even when the
      // provider is unreachable (the remote batch simply expires server-side).
    }
    clearPendingBatch(projectRoot);
    return c.json({ canceled: pending.batchId });
  });

  app.get("/log", (c) => c.json(readLog(projectRoot, 100)));

  app.post("/scan", async (c) => {
    const s = load();
    // Location-scanned formats (Angular) index from the catalog, not a code walk.
    const result = isLocationScannedState(s)
      ? refreshLocationUsage(projectRoot)
      : runScan(projectRoot, scanOptions(s.config), loadUsageCache(projectRoot));
    if (!result) return c.json({ files: 0, refs: 0, scannedAt: new Date().toISOString() });
    const { files, refs } = usageCounts(result);
    console.log(`[scan] ${files} file(s), ${refs} reference(s)`);
    return c.json({ files, refs, scannedAt: result.scannedAt });
  });

  // Summary of the last persisted scan (incl. the boot scan), so the UI can show
  // that a scan happened without re-running it.
  app.get("/scan", (c) => {
    const cache = loadUsageCache(projectRoot);
    if (!cache) return c.json({ indexed: false, files: 0, refs: 0 });
    const files = Object.keys(cache.files).length;
    const refs = Object.values(cache.files).reduce((n, f) => n + f.refs.length, 0);
    return c.json({ indexed: true, scannedAt: cache.scannedAt, files, refs });
  });

  // Where a single key is referenced in the scanned codebase. Key passed as a query
  // param so keys containing "/" or "." aren't split as path segments.
  app.get("/scan/usage", (c) => {
    const key = c.req.query("key") ?? "";
    const cache = loadUsageCache(projectRoot);
    if (!cache) return c.json({ indexed: false, count: 0, refs: [], prefixCount: 0, prefixRefs: [], literalCount: 0, literalRefs: [] });

    // abs paths let the UI build editor deep links (vscode://file/…); prefixRefs are
    // indirect matches: a dynamically-built key (prefix) the queried key falls under.
    // literalRefs are key-shaped string literals outside a call site that match
    // this key — shown separately as lower-confidence evidence.
    const refs: { file: string; abs: string; line: number; col: number; scanner: string }[] = [];
    const prefixRefs: { file: string; abs: string; line: number; col: number; scanner: string; prefix: string }[] = [];
    const literalRefs: { file: string; abs: string; line: number; col: number; literal: string }[] = [];
    for (const [file, entry] of Object.entries(cache.files)) {
      const abs = resolve(projectRoot, file);
      const refLines = new Set<number>();
      for (const r of entry.refs) {
        if (r.key === key) {
          refs.push({ file, abs, line: r.line, col: r.col, scanner: r.scanner });
          refLines.add(r.line);
        }
      }
      for (const p of entry.prefixes) {
        if (key.startsWith(p.prefix)) {
          prefixRefs.push({ file, abs, line: p.line, col: p.col, scanner: p.scanner, prefix: p.prefix });
        }
      }
      for (const l of entry.literals ?? []) {
        // A literal inside an actual call is already listed as a direct ref on
        // the same line — don't repeat it as weaker evidence.
        if (literalMatcher(l.literal)(key) && !refLines.has(l.line)) {
          literalRefs.push({ file, abs, line: l.line, col: l.col, literal: l.literal });
        }
      }
    }
    const byFileLine = (a: { file: string; line: number }, b: { file: string; line: number }) =>
      a.file.localeCompare(b.file) || a.line - b.line;
    refs.sort(byFileLine);
    prefixRefs.sort(byFileLine);
    literalRefs.sort(byFileLine);
    return c.json({
      indexed: true,
      scannedAt: cache.scannedAt,
      project: projectName(projectRoot),
      count: refs.length,
      refs,
      prefixCount: prefixRefs.length,
      prefixRefs,
      literalCount: literalRefs.length,
      literalRefs,
    });
  });

  // The set of keys with at least one code reference (exact or dynamic prefix),
  // so the editor can filter to keys that have NONE. `indexed:false` lets the UI
  // disable the "Unused" filter when no scan has run.
  app.get("/scan/used", (c) => {
    const cache = loadUsageCache(projectRoot);
    if (!cache) return c.json({ indexed: false, used: [] });
    return c.json({ indexed: true, scannedAt: cache.scannedAt, used: computeUsedKeys(load(), cache) });
  });

  // Translation-guidance AI suggestions: one-shot completions backing the
  // "Suggest" buttons in Settings → Translation guidance. They never mutate
  // state — the UI fills the field and the user saves (or discards).
  const GUIDANCE_SAMPLE_LIMIT = 200;

  app.post("/guidance/suggest/context", async (c) => {
    const s0 = load();
    const sources = selectGlossarySources(s0, { limit: GUIDANCE_SAMPLE_LIMIT });
    if (!sources.length) return c.json({ error: "No source strings to learn from yet — add some keys first." }, 400);
    const aiCfg = loadLocalSettings(projectRoot).ai;
    let provider: TranslationProvider;
    try {
      provider = deps.makeProvider ? deps.makeProvider() : makeProvider(aiCfg);
    } catch (e) {
      return c.json({ error: explainProviderError(aiCfg.provider, e) }, 400);
    }
    try {
      const raw = await provider.complete({
        system: buildProjectContextSystemPrompt(),
        content: [{ type: "text", text: buildProjectContextUserPrompt(sources, knownTermList(s0)) }],
        schema: PROJECT_CONTEXT_SCHEMA,
      });
      const projectContext = String((raw as { projectContext?: string }).projectContext ?? "").trim();
      return c.json({ projectContext });
    } catch (e) {
      return c.json({ error: explainProviderError(aiCfg.provider, e) }, 502);
    }
  });

  app.post("/guidance/suggest/locale", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const locale = typeof body.locale === "string" ? body.locale.trim() : "";
    if (!locale) return c.json({ error: "locale is required" }, 400);
    const projectContext = typeof body.projectContext === "string" ? body.projectContext : "";
    const s0 = load();
    const sources = selectGlossarySources(s0, { limit: GUIDANCE_SAMPLE_LIMIT });
    if (!sources.length) return c.json({ error: "No source strings to learn from yet — add some keys first." }, 400);
    const aiCfg = loadLocalSettings(projectRoot).ai;
    let provider: TranslationProvider;
    try {
      provider = deps.makeProvider ? deps.makeProvider() : makeProvider(aiCfg);
    } catch (e) {
      return c.json({ error: explainProviderError(aiCfg.provider, e) }, 400);
    }
    try {
      const raw = await provider.complete({
        system: buildLocaleInstructionSystemPrompt(),
        content: [{ type: "text", text: buildLocaleInstructionUserPrompt(locale, projectContext, sources, knownTermList(s0)) }],
        schema: LOCALE_INSTRUCTION_SCHEMA,
      });
      const instruction = String((raw as { instruction?: string }).instruction ?? "").trim();
      return c.json({ instruction });
    } catch (e) {
      return c.json({ error: explainProviderError(aiCfg.provider, e) }, 502);
    }
  });

  // ---- Translation Assistant chat ----

  app.get("/chat", (c) => c.json(loadChat(projectRoot)));

  app.delete("/chat", (c) => {
    clearChat(projectRoot);
    return c.json({ ok: true });
  });

  // Resolve a pending confirm-gated tool (the UI's Apply/Skip card posts here).
  app.post("/chat/confirm", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const toolUseId = typeof body.toolUseId === "string" ? body.toolUseId : "";
    const resolver = pendingConfirms.get(toolUseId);
    if (!resolver) return c.json({ error: "No pending confirmation for that action." }, 404);
    resolver(!!body.approved);
    return c.json({ ok: true });
  });

  // Stream one assistant turn over SSE: forwards text deltas, tool action rows,
  // and confirm prompts; runs the tool loop; persists the transcript + usage.
  app.post("/chat/stream", async (c) => {
    const signal = c.req.raw.signal;
    const body = await c.req.json().catch(() => ({}));
    const message = typeof body.message === "string" ? body.message : "";
    return streamSSE(c, (stream) => withTranslateLock(async () => {
      if (!message.trim()) {
        await stream.writeSSE({ event: "error", data: JSON.stringify({ error: "message is required" }) });
        return;
      }
      const aiCfg = loadLocalSettings(projectRoot).ai;
      let provider: TranslationProvider;
      try {
        provider = deps.makeProvider ? deps.makeProvider() : makeProvider(aiCfg);
      } catch (e) {
        await stream.writeSSE({ event: "error", data: JSON.stringify({ error: explainProviderError(aiCfg.provider, e) }) });
        return;
      }
      if (!supportsChat(provider)) {
        await stream.writeSSE({ event: "error", data: JSON.stringify({ error: "The Translation Assistant requires an Anthropic provider. Switch your AI provider to Anthropic in Settings." }) });
        return;
      }

      const transcript = loadChat(projectRoot);
      // Chat tools mutate state server-side, so — unlike a REST edit the browser
      // made itself — no connected UI knows anything moved, and persist()'s
      // noteWrite() keeps the watcher silent for our own writes. Flag when a tool
      // writes and broadcast state-changed once the turn ends so the editor/glossary
      // views reload (see finally).
      let stateChanged = false;
      const persistAndFlag = (s: State) => { persist(s); stateChanged = true; };
      const ctx: ToolContext = { projectRoot, statePath: deps.statePath, load, persist: persistAndFlag, provider, signal };
      const turnConfirmIds = new Set<string>();
      // Volatile per-turn context: the project snapshot, plus the key the user has
      // open in the editor (so "this key"/"this string" resolves to it).
      const st = load();
      const selKey = typeof body.selectedKey === "string" && st.keys[body.selectedKey] ? body.selectedKey : "";
      let context = projectSnapshot(st);
      if (selKey) {
        const lv = st.keys[selKey]!.values[st.config.sourceLocale];
        const src = (lv?.value ?? lv?.forms?.other ?? "").trim().slice(0, 200);
        context += `\n\nThe user currently has this key OPEN in the editor: ${selKey}${src ? ` — "${src}"` : ""}. When they say "this key", "this string", or "the selected key", they mean ${selKey}.`;
      }
      try {
        const updated = await runChatTurn(transcript.messages, message, {
          provider,
          tools: buildToolRegistry(),
          ctx,
          system: buildChatSystemPrompt(),
          context,
          onEvent: (e) => { void stream.writeSSE({ event: e.type, data: JSON.stringify(e) }); },
          confirm: (req) => new Promise<boolean>((resolve) => {
            turnConfirmIds.add(req.toolUseId);
            pendingConfirms.set(req.toolUseId, (approved) => { pendingConfirms.delete(req.toolUseId); resolve(approved); });
            signal?.addEventListener("abort", () => {
              if (pendingConfirms.delete(req.toolUseId)) resolve(false);
            }, { once: true });
          }),
          signal,
        });

        const usage = provider.takeUsage?.();
        transcript.messages = updated;
        transcript.model = aiCfg.model;
        if (!transcript.createdAt) transcript.createdAt = new Date().toISOString();
        if (usage) addUsage(transcript.cumulativeUsage, usage);
        saveChat(projectRoot, transcript);
        appendLog(projectRoot, {
          at: new Date().toISOString(),
          kind: "chat",
          summary: `Assistant turn (${updated.length} message(s))`,
          model: aiCfg.model,
          usage,
          estimatedCostUsd: usageCostUsd(usage, aiCfg),
        });
      } catch (e) {
        if (!signal?.aborted) {
          await stream.writeSSE({ event: "error", data: JSON.stringify({ error: explainProviderError(aiCfg.provider, e) }) });
        }
      } finally {
        for (const id of turnConfirmIds) pendingConfirms.delete(id);
        if (stateChanged) hub.broadcast("state-changed", JSON.stringify({ at: new Date().toISOString() }));
      }
    }));
  });

  app.post("/context/build", async (c) => {
    const signal = c.req.raw.signal;
    const body = await c.req.json().catch(() => ({}));
    return streamSSE(c, async (stream) => {
      const s = load();
      const cache = loadUsageCache(projectRoot);
      if (!cache) {
        await stream.writeSSE({ event: "error", data: JSON.stringify({ error: "No usage index found. Run 'glotfile scan' first." }) });
        return;
      }
      const targets = selectContextTargets(s, {
        all: body.all,
        keyGlob: body.keyGlob,
        limit: body.limit,
        since: body.since,
        keys: body.keys,
        force: body.force,
      }, cache, body.lastRunAt);
      if (!targets.length) {
        await stream.writeSSE({ event: "done", data: JSON.stringify({ requested: 0, written: 0, errors: [] }) });
        return;
      }
      const aiCfg = loadLocalSettings(projectRoot).ai;
      let provider: TranslationProvider;
      try {
        provider = deps.makeProvider ? deps.makeProvider() : makeProvider(aiCfg);
      } catch (e) {
        await stream.writeSSE({ event: "error", data: JSON.stringify({ error: (e as Error).message }) });
        return;
      }
      await stream.writeSSE({ event: "start", data: JSON.stringify({ total: targets.length }) });
      attachUsageSnippets(targets, cache, projectRoot);

      const system = buildContextSystemPrompt();
      const batchSize = aiCfg.contextBatchSize ?? aiCfg.batchSize ?? 10;
      const concurrency = aiCfg.contextConcurrency ?? aiCfg.concurrency ?? 3;
      const chunks: typeof targets[] = [];
      for (let i = 0; i < targets.length; i += batchSize) chunks.push(targets.slice(i, i + batchSize));

      let totalWritten = 0;
      let totalDone = 0;
      const allErrors: Array<{ key: string; error: string }> = [];
      let next = 0;

      async function worker() {
        while (next < chunks.length) {
          if (signal?.aborted) break;
          const chunk = chunks[next++]!;
          let raw: unknown;
          try {
            raw = await provider.complete({ system, content: [{ type: "text", text: buildContextBatchPrompt(chunk) }], schema: CONTEXT_BATCH_SCHEMA });
          } catch (e) {
            totalDone += chunk.length;
            allErrors.push(...chunk.map((t) => ({ key: t.key, error: (e as Error).message })));
            void stream.writeSSE({ event: "progress", data: JSON.stringify({ done: totalDone, total: targets.length, written: totalWritten }) });
            continue;
          }
          if (signal?.aborted) break;
          const batch = raw as { items: Array<{ id: string; context?: string; error?: string }> };
          const fresh = load();
          const { written, errors } = applyContext(fresh, chunk, batch.items ?? [], body.force === true);
          // Usage accrued since the last drain — approximate per-chunk
          // attribution under concurrency, exact in total across the run.
          const usage = provider.takeUsage?.();
          appendLog(projectRoot, {
            at: new Date().toISOString(),
            kind: "context",
            summary: `Generated context for ${chunk.length} key(s)`,
            model: aiCfg.model,
            system,
            items: chunk.map((t) => ({ id: t.id, key: t.key, source: t.source })),
            results: (batch.items ?? []).map((r) => ({ id: r.id, value: r.context, error: r.error })),
            usage,
            estimatedCostUsd: usageCostUsd(usage, aiCfg),
          });
          persist(fresh);
          totalWritten += written;
          totalDone += chunk.length;
          allErrors.push(...errors);
          void stream.writeSSE({ event: "progress", data: JSON.stringify({ done: totalDone, total: targets.length, written: totalWritten }) });
        }
      }

      await Promise.all(Array.from({ length: Math.min(concurrency, chunks.length) }, worker));

      if (signal?.aborted) return;
      console.log(`[context] ${totalWritten} context(s) written${allErrors.length ? `, ${allErrors.length} error(s)` : ""}`);
      await stream.writeSSE({ event: "done", data: JSON.stringify({ requested: targets.length, written: totalWritten, errors: allErrors }) });
    });
  });

  // Pre-flight cost preview for a context build. Advisory only — a failed
  // estimate must never block building (the dialog just hides its preview line).
  app.post("/context/estimate", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const cache = loadUsageCache(projectRoot);
    if (!cache) return c.json({ error: "No usage index found. Run 'glotfile scan' first." }, 400);
    const targets = selectContextTargets(load(), {
      all: body.all,
      keyGlob: body.keyGlob,
      limit: body.limit,
      since: body.since,
      keys: body.keys,
      force: body.force,
    }, cache, body.lastRunAt);
    const aiCfg = loadLocalSettings(projectRoot).ai;
    attachUsageSnippets(targets, cache, projectRoot);
    return c.json(estimateContext(targets, aiCfg));
  });

  // Pending context-batch status. Same shape as /batch/status; the two batch
  // kinds have independent handles, so one of each can be in flight.
  app.get("/context/batch/status", async (c) => {
    const aiCfg = loadLocalSettings(projectRoot).ai;
    let supported = false;
    let provider;
    try {
      provider = deps.makeProvider ? deps.makeProvider() : makeProvider(aiCfg);
      supported = supportsBatchComplete(provider);
    } catch {
      // No usable provider (e.g. missing API key) — report unsupported rather than erroring.
    }
    const pending = loadPendingContextBatch(projectRoot);
    if (!pending) return c.json({ supported, pending: null });
    const base = { batchId: pending.batchId, createdAt: pending.createdAt, model: pending.model, total: pending.total };
    if (!provider || !supportsBatchComplete(provider)) {
      return c.json({ supported, pending: { ...base, status: "unknown", counts: null } });
    }
    try {
      const status = await provider.translationBatchStatus(pending.batchId);
      return c.json({ supported, pending: { ...base, status: status.status, counts: status.counts } });
    } catch (e) {
      return c.json({ supported, pending: { ...base, status: "unknown", counts: null, error: (e as Error).message } });
    }
  });

  app.post("/context/batch", (c) => withTranslateLock(async () => {
    const body = await c.req.json().catch(() => ({}));
    const s = load();
    const cache = loadUsageCache(projectRoot);
    if (!cache) return c.json({ error: "No usage index found. Run 'glotfile scan' first." }, 400);
    const targets = selectContextTargets(s, {
      all: body.all,
      keyGlob: body.keyGlob,
      limit: body.limit,
      since: body.since,
      keys: body.keys,
      force: body.force,
    }, cache, body.lastRunAt);
    if (!targets.length) return c.json({ error: "Nothing to build." }, 400);
    const aiCfg = loadLocalSettings(projectRoot).ai;
    let provider;
    try {
      provider = deps.makeProvider ? deps.makeProvider() : makeProvider(aiCfg);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
    if (!supportsBatchComplete(provider)) {
      return c.json({ error: `Provider "${aiCfg.provider}" does not support batch mode.` }, 400);
    }
    attachUsageSnippets(targets, cache, projectRoot);
    const batchSize = aiCfg.contextBatchSize ?? aiCfg.batchSize ?? 10;
    let pending;
    try {
      pending = await submitContextBatch(provider, targets, batchSize, aiCfg.model, projectRoot, body.force === true);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 409);
    }
    // The AI log records only what was SENT to the provider (egress-only).
    appendLog(projectRoot, {
      at: new Date().toISOString(),
      kind: "context",
      summary: `Submitted context batch ${pending.batchId} (${pending.total} keys)`,
      model: aiCfg.model,
      system: buildContextSystemPrompt(),
      items: targets.map((t) => ({ id: t.id, key: t.key, source: t.source })),
    });
    console.log(`[context-batch] submitted ${pending.batchId} — ${pending.total} key(s)`);
    return c.json({ batchId: pending.batchId, total: pending.total });
  }));

  app.post("/context/batch/apply", (c) => withTranslateLock(async () => {
    const pending = loadPendingContextBatch(projectRoot);
    if (!pending) return c.json({ error: "No pending context batch." }, 404);
    const aiCfg = loadLocalSettings(projectRoot).ai;
    let provider;
    try {
      provider = deps.makeProvider ? deps.makeProvider() : makeProvider(aiCfg);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
    if (!supportsBatchComplete(provider)) {
      return c.json({ error: `Provider "${aiCfg.provider}" does not support batch mode.` }, 400);
    }
    // applyContextBatchResults writes the detailed activity-log entry itself.
    const outcome = await applyContextBatchResults(load, persist, provider, pending, projectRoot, aiCfg);
    console.log(`[context-batch] applied ${pending.batchId} — wrote ${outcome.written}, ${outcome.errors.length} error(s)`);
    return c.json(outcome);
  }));

  app.post("/context/batch/cancel", async (c) => {
    const pending = loadPendingContextBatch(projectRoot);
    if (!pending) return c.json({ error: "No pending context batch." }, 404);
    const aiCfg = loadLocalSettings(projectRoot).ai;
    try {
      const provider = deps.makeProvider ? deps.makeProvider() : makeProvider(aiCfg);
      if (supportsBatchComplete(provider)) await provider.cancelTranslationBatch(pending.batchId);
    } catch {
      // Cancel best-effort: clearing the local handle must work even when the
      // provider is unreachable (the remote batch simply expires server-side).
    }
    clearPendingContextBatch(projectRoot);
    return c.json({ canceled: pending.batchId });
  });

  // Turn expected state errors (duplicate key, missing key, …) into actionable
  // 400s instead of opaque 500s; anything else is a genuine server fault.
  app.onError((err, c) =>
    c.json({ error: err.message }, err instanceof GlotfileError ? 400 : 500),
  );

  return app;
}
