import { resolve, dirname, join, basename } from "node:path";
import { readFileSync, existsSync, mkdirSync, cpSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  loadState, saveState, findEmptySourceKeys, canonLocale, createKey,
  setSourceValue, setTargetValue, setKeyState, clearValue, mergeGlossarySuggestions,
} from "./state.js";
import { computeStats, type Stats } from "./stats.js";
import { runGet, applyOps, parseOps } from "./agent-cli.js";
import { EFFECTIVE_STATES, type EffectiveState } from "./cell-state.js";
import { globToRegExp } from "./glob.js";
import { STATES, type LocaleState, type State } from "./schema.js";
import { exportToDisk } from "./export-run.js";
import { detectFormat, splitDirFor } from "./storage.js";
import { makeProvider } from "./ai/index.js";
import { loadLocalSettings } from "./local-settings.js";
import { selectRequests, applyResults, attachScreenshotsForProvider, runLocaleParallel } from "./ai/run.js";
import { buildSystemPrompt, supportsBatchTranslate, supportsBatchComplete, type BatchTranslationProvider, type TranslationProvider } from "./ai/provider.js";
import { submitBatchTranslation, applyBatchResults } from "./ai/batch-run.js";
import { loadPendingBatch, clearPendingBatch, type PendingBatch } from "./ai/pending-batch.js";
import { submitContextBatch, applyContextBatchResults } from "./ai/context-batch-run.js";
import { loadPendingContextBatch, clearPendingContextBatch, type PendingContextBatch } from "./ai/pending-context-batch.js";
import type { AiConfig } from "./schema.js";
import { estimateTranslation, estimateContext, estimateGlossarySuggest } from "./ai/estimate.js";
import { selectGlossarySources, knownTermList, buildGlossarySuggestSystemPrompt, buildGlossarySuggestBatchPrompt, GLOSSARY_SUGGEST_SCHEMA, dedupeTerms, type SuggestedTerm } from "./ai/glossary-suggest.js";
import { usageCostUsd, resolvePricing } from "./ai/pricing.js";
import { refreshPrices } from "./ai/price-fetch.js";
import { loadPriceCache, defaultPriceCachePath, invalidatePriceCache } from "./ai/price-cache.js";
import { appendLog } from "./log.js";
import { loadUsageCache, computeUsedKeys } from "./scan.js";
import { runScan } from "./scanner.js";
import { refreshLocationUsage, isLocationScannedState, usageCounts } from "./import/usage.js";
import {
  selectContextTargets, attachUsageSnippets, applyContext,
  buildContextSystemPrompt, buildContextBatchPrompt, CONTEXT_BATCH_SCHEMA,
} from "./ai/context.js";
import { runLint, sortFindings, countSeverities } from "./lint/run.js";
import { RULE_IDS, unknownRuleIds, suggestRuleId } from "./lint/registry.js";
import { checkOutputs } from "./lint/outputs.js";
import { formatText, formatJson, formatSarif, type SarifContext } from "./lint/report.js";
import type { LintReport } from "./lint/types.js";

export interface ParsedArgs {
  command: "serve" | "export" | "translate" | "lint" | "check" | "import" | "sync" | "build-context" | "suggest-glossary" | "scan" | "prune" | "split" | "skill" | "batch" | "prices" | "get" | "stats" | "set" | "set-state" | "clear" | "apply" | "help" | "version";
  help?: boolean;
  unknownCommand?: string;
  dev?: boolean;
  adapter?: string;
  locales?: string[];
  onlyMissing?: boolean;
  keyGlob?: string;
  format?: "text" | "json" | "sarif" | "ndjson";
  // get/stats/set/set-state/clear/apply
  positionals?: string[];
  states?: string[];
  fields?: string[];
  keysOnly?: boolean;
  value?: string;
  create?: boolean;
  continueOnError?: boolean;
  ruleIds?: string[];
  maxWarnings?: number;
  includeSuppressed?: boolean;
  accept?: boolean;
  statePath: string;
  watch?: boolean;
  // serve: skip auto-opening the browser
  noOpen?: boolean;
  // import-specific
  importSource?: string;
  importFormat?: string;
  importSourceLocale?: string;
  importCldr?: boolean;
  importForce?: boolean;
  // sync-specific
  prune?: boolean;
  dryRun?: boolean;
  // build-context-specific
  all?: boolean;
  limit?: number;
  since?: string;
  // prune-specific
  emptySource?: boolean;
  unused?: boolean;
  write?: boolean;
  // translate-specific
  estimate?: boolean;
  batch?: boolean;
  wait?: boolean;
  // batch-specific
  batchAction?: "status" | "apply" | "cancel";
  // skill-specific
  print?: boolean;
  // prices-specific
  refresh?: boolean;
}

const COMMANDS = ["serve", "export", "translate", "lint", "check", "import", "sync", "build-context", "suggest-glossary", "scan", "prune", "split", "skill", "batch", "prices", "get", "stats", "set", "set-state", "clear", "apply"] as const;
const isCommand = (s: string | undefined): s is ParsedArgs["command"] =>
  s != null && (COMMANDS as readonly string[]).includes(s);

export function parseArgs(argv: string[]): ParsedArgs {
  const statePath = resolve(process.cwd(), "glotfile.json");
  const first = argv[0];
  // `glotfile help [cmd]`, `glotfile --help [cmd]`, `glotfile -h [cmd]`: a help
  // request. With a known command following, show that command's help;
  // otherwise show the top-level overview.
  if (first === "help" || first === "--help" || first === "-h") {
    return isCommand(argv[1]) ? { command: argv[1], statePath, help: true } : { command: "help", statePath };
  }
  if (first === "version" || first === "--version" || first === "-v") {
    return { command: "version", statePath };
  }
  // A bare first token that isn't a known command is a typo, not a flag — flag it
  // so main() can error instead of silently falling through to `serve`.
  if (first !== undefined && !first.startsWith("-") && !isCommand(first)) {
    return { command: "serve", statePath, unknownCommand: first };
  }
  // Known command, or a leading flag (=> default to `serve` and parse it), or
  // nothing at all (=> `serve`).
  const hasCommand = isCommand(first);
  const command = (hasCommand ? first : "serve") as ParsedArgs["command"];
  const rest = hasCommand ? argv.slice(1) : argv;
  const args: ParsedArgs = { command, statePath };
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    const next = rest[i + 1];
    if (flag === "--help" || flag === "-h") args.help = true;
    else if (flag === "--dev") args.dev = true;
    else if (flag === "--no-open") args.noOpen = true;
    else if ((flag === "--file" || flag === "-f") && next) { args.statePath = resolve(process.cwd(), next); i++; }
    else if (flag === "--adapter" && next) { args.adapter = next; i++; }
    else if ((flag === "--locale" || flag === "--locales") && next) { args.locales = next.split(","); i++; }
    else if (flag === "--only" && next) { args.onlyMissing = next === "missing"; i++; }
    else if (flag === "--key" && next) { args.keyGlob = next; i++; }
    else if (flag === "--watch") args.watch = true;
    else if (flag === "--format" && next) {
      // import/sync use --format to name the source layout; lint/check use it for the report style.
      if (args.command === "import" || args.command === "sync") args.importFormat = next;
      else args.format = next as ParsedArgs["format"];
      i++;
    }
    else if (flag === "--source" && next) { args.importSource = next; i++; }
    else if (flag === "--source-locale" && next) { args.importSourceLocale = next; i++; }
    else if (flag === "--force") args.importForce = true;
    else if (flag === "--cldr") args.importCldr = true;
    else if (flag === "--prune") args.prune = true;
    else if (flag === "--dry-run") args.dryRun = true;
    else if (flag === "--rule" && next) { args.ruleIds = next.split(","); i++; }
    else if (flag === "--max-warnings" && next) { args.maxWarnings = Number(next); i++; }
    else if (flag === "--include-suppressed") args.includeSuppressed = true;
    else if (flag === "--accept") args.accept = true;
    else if (flag === "--all") args.all = true;
    else if (flag === "--limit" && next) { args.limit = Number(next); i++; }
    else if (flag === "--since" && next) { args.since = next; i++; }
    else if (flag === "--empty-source") args.emptySource = true;
    else if (flag === "--unused") args.unused = true;
    else if (flag === "--write") args.write = true;
    else if (flag === "--estimate") args.estimate = true;
    else if (flag === "--batch") args.batch = true;
    else if (flag === "--wait") args.wait = true;
    else if (flag === "--print") args.print = true;
    else if (flag === "--refresh") args.refresh = true;
    else if (flag === "--state" && next) { args.states = next.split(","); i++; }
    else if (flag === "--fields" && next) { args.fields = next.split(","); i++; }
    else if (flag === "--keys-only") args.keysOnly = true;
    else if (flag === "--value" && next) { args.value = next; i++; }
    else if (flag === "--create") args.create = true;
    else if (flag === "--continue-on-error") args.continueOnError = true;
    // `glotfile batch [status|apply|cancel]` — capture the bare action positional
    else if (args.command === "batch" && (flag === "status" || flag === "apply" || flag === "cancel")) {
      args.batchAction = flag;
    }
    // Anything else that isn't a flag is a positional (key/value/state for the
    // get/set/set-state/clear commands).
    else if (!flag!.startsWith("-")) (args.positionals ??= []).push(flag!);
  }
  return args;
}

function loadDotEnv(): void {
  // Pick up ANTHROPIC_API_KEY from a local .env if present. No-op if absent.
  try {
    process.loadEnvFile();
  } catch {
    /* no .env in cwd, or unsupported runtime — fine */
  }
}

// What `export --watch` should watch: the single catalog file, or — in split mode,
// where that file doesn't exist — the catalog directory, recursively (so edits to
// any config/keys/locale shard trigger a re-export).
export function watchTargetFor(statePath: string): { path: string; recursive: boolean } {
  return detectFormat(statePath) === "split"
    ? { path: splitDirFor(statePath), recursive: true }
    : { path: statePath, recursive: false };
}

async function runExport(args: ParsedArgs): Promise<void> {
  const root = dirname(resolve(args.statePath));
  const runOnce = () => {
    const state = loadState(args.statePath);
    const result = exportToDisk(state, root, args.adapter ? { adapter: args.adapter } : undefined);
    for (const w of result.warnings) {
      const at = w.locale ? `${w.key} @ ${w.locale}` : w.key;
      console.warn(`warning [${w.code}] ${at}: ${w.message}`);
    }
    return result;
  };

  if (!args.watch) {
    const { written, skipped, deleted } = runOnce();
    const extras = [skipped ? `${skipped} unchanged` : "", deleted ? `${deleted} stale removed` : ""].filter(Boolean);
    console.log(`Exported ${written} file(s)${extras.length ? ` (${extras.join(", ")})` : ""}.`);
    return;
  }

  // Watch mode: re-export (debounced) whenever the catalog changes on disk.
  const { watch } = await import("node:fs");
  const first = runOnce();
  const { path: watchPath, recursive } = watchTargetFor(args.statePath);
  console.log(`Exported ${first.written} file(s). Watching ${watchPath} — Ctrl-C to stop.`);
  let timer: ReturnType<typeof setTimeout> | undefined;
  watch(watchPath, { recursive }, () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        const { written, deleted } = runOnce();
        if (written || deleted) {
          console.log(`Re-exported ${written} file(s)${deleted ? ` (${deleted} stale removed)` : ""}.`);
        }
      } catch (e) {
        console.error((e as Error).message);
      }
    }, 150);
  });
  await new Promise<void>(() => {});
}


// Returns null after reporting the error; callers just return.
function makeProviderOrExit(ai: AiConfig): TranslationProvider | null {
  try {
    return makeProvider(ai);
  } catch (e) {
    console.error((e as Error).message);
    process.exitCode = 1;
    return null;
  }
}

// Reject a bogus --state value early with a clear message rather than silently
// matching nothing. `allowSource` is false for translate (the source isn't a
// translatable target) and true for `get` (you can extract source values).
function parseStates(args: ParsedArgs, allowSource: boolean): EffectiveState[] | undefined {
  if (!args.states?.length) return undefined;
  const allowed = allowSource ? EFFECTIVE_STATES : EFFECTIVE_STATES.filter((s) => s !== "source");
  for (const s of args.states) {
    if (!(allowed as readonly string[]).includes(s)) {
      console.error(`Unknown --state '${s}'. Expected one of: ${allowed.join(", ")}.`);
      process.exit(1);
    }
  }
  return args.states as EffectiveState[];
}

// The selection used by both translate and its estimate: an explicit --state set
// wins, else the legacy missing-only/--all behaviour.
function translateSelection(args: ParsedArgs) {
  const states = parseStates(args, false);
  return {
    locales: args.locales,
    keyGlob: args.keyGlob,
    ...(states ? { states } : { onlyMissing: args.all ? false : (args.onlyMissing ?? true) }),
  };
}

// Read all of stdin synchronously (piped JSON / multi-line values).
function readStdin(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

// Keys matching a glob (an exact key matches itself), sorted.
function matchKeys(state: State, glob: string): string[] {
  const re = globToRegExp(glob);
  return Object.keys(state.keys).filter((k) => re.test(k)).sort();
}

async function runTranslate(args: ParsedArgs): Promise<void> {
  const state = loadState(args.statePath);
  const projectRoot = dirname(resolve(args.statePath));
  if (args.estimate) {
    const ai = loadLocalSettings(projectRoot).ai;
    const est = estimateTranslation(state, ai, translateSelection(args));
    if (!est.requests) { console.log("Nothing to translate."); return; }
    const fmt = (n: number) => n.toLocaleString("en-US");
    console.log(`Estimate for ${fmt(est.requests)} request(s) in ${fmt(est.batches)} batch(es) — ${ai.provider} · ${ai.model}`);
    for (const l of est.perLocale) {
      console.log(`  ${l.locale.padEnd(8)} ${fmt(l.requests).padStart(7)} req  ${fmt(l.batches).padStart(5)} batch(es)  ~${fmt(l.inputTokens)} in / ~${fmt(l.outputTokens)} out tokens`);
    }
    console.log(`Totals: ~${fmt(est.inputTokens)} input / ~${fmt(est.outputTokens)} output tokens`);
    if (est.pricing) {
      const cost = est.estimatedCost!;
      console.log(`Estimated cost: ~$${cost >= 0.1 ? cost.toFixed(2) : cost.toFixed(4)} (±20%, ${est.pricing.source} pricing $${est.pricing.inputPerMTok}/$${est.pricing.outputPerMTok} per MTok)`);
    } else {
      console.log("No pricing known for this model — set inputPricePerMTok/outputPricePerMTok in your AI settings for a dollar estimate.");
    }
    return;
  }
  // Default to translating only empty values; --all forces a full re-translate
  // (overwriting existing). --state <list> re-translates exactly the targets in
  // those states (e.g. --state needs-review, the strings a source edit invalidated).
  const reqs = selectRequests(state, translateSelection(args));

  const toTranslate = [...reqs];

  if (args.batch) {
    if (!toTranslate.length) { console.log("Nothing to translate."); return; }
    const ai = loadLocalSettings(projectRoot).ai;
    const provider = makeProviderOrExit(ai);
    if (!provider) return;
    if (!supportsBatchTranslate(provider)) {
      console.error(`Provider "${ai.provider}" does not support batch mode. Currently anthropic only.`);
      process.exitCode = 1;
      return;
    }
    const { skipped } = attachScreenshotsForProvider(toTranslate, state, projectRoot, provider.supportsVision());
    if (skipped) console.warn(`Model "${ai.model}" has no vision support; ${skipped} screenshot(s) ignored.`);
    let pending;
    try {
      pending = await submitBatchTranslation(state, provider, toTranslate, ai.batchSize, ai.model, projectRoot);
    } catch (e) {
      console.error((e as Error).message);
      process.exitCode = 1;
      return;
    }
    // Egress log mirrors the sync path: record what was SENT, never image bytes.
    appendLog(projectRoot, {
      at: new Date().toISOString(),
      kind: "translate",
      summary: `Submitted batch ${pending.batchId} (${pending.total} items)`,
      model: ai.model,
      system: buildSystemPrompt(toTranslate.some((r) => r.plural !== undefined)),
      items: toTranslate.map((r) => ({ id: r.id, key: r.key, source: r.source, targetLocale: r.targetLocale, context: r.context, glossary: r.glossary, screenshot: state.keys[r.key]?.screenshot })),
    });
    console.log(`Submitted batch ${pending.batchId} — ${pending.total} string(s) at 50% batch pricing.`);
    if (!args.wait) {
      console.log("Check progress with `glotfile batch`; it applies results automatically when finished.");
      return;
    }
    await waitAndApply(args, provider, pending, ai);
    return;
  }

  let written = 0;
  let errors: Array<{ key: string; locale: string; error: string }> = [];
  if (toTranslate.length) {
    const ai = loadLocalSettings(projectRoot).ai;
    const provider = makeProviderOrExit(ai);
    if (!provider) return;
    const { skipped } = attachScreenshotsForProvider(toTranslate, state, projectRoot, provider.supportsVision());
    if (skipped) console.warn(`Model "${ai.model}" has no vision support; ${skipped} screenshot(s) ignored.`);
    console.log(`Translating ${toTranslate.length} string(s)…`);
    let batchCallbackFired = false;
    const results = await runLocaleParallel(toTranslate, provider, {
      onBatchComplete: (done, total, batchResults) => {
        batchCallbackFired = true;
        const batchApplied = applyResults(state, toTranslate, batchResults);
        written += batchApplied.written;
        errors.push(...batchApplied.errors);
        saveState(args.statePath, state);
        process.stdout.write(`\r  ${done}/${total} translated`);
      },
      // Record the raw reply so an unparseable model response is diagnosable
      // from the activity log instead of vanishing into per-item errors.
      onMalformedReply: (raw, batchSize, locale) => {
        console.error(`\n  malformed model reply (${locale}, batch of ${batchSize})${batchSize > 1 ? " — splitting batch and retrying" : ""}`);
        appendLog(projectRoot, {
          at: new Date().toISOString(),
          kind: "translate",
          summary: `Malformed model reply (${locale}, batch of ${batchSize})`,
          model: ai.model,
          locale,
          raw,
        });
      },
    }, ai.concurrency, undefined, ai.batchSize);
    process.stdout.write("\n");
    // Fallback for provider stubs that don't fire onBatchComplete.
    if (!batchCallbackFired) {
      ({ written, errors } = applyResults(state, toTranslate, results));
    }
    const usage = provider.takeUsage?.();
    // The AI log records only what was SENT to the provider (egress-only).
    appendLog(projectRoot, {
      at: new Date().toISOString(),
      kind: "translate",
      summary: `Translated ${toTranslate.length} item(s)`,
      model: ai.model,
      usage,
      estimatedCostUsd: usageCostUsd(usage, ai),
      system: buildSystemPrompt(toTranslate.some((r) => r.plural !== undefined)),
      items: toTranslate.map((r) => ({
        id: r.id,
        key: r.key,
        source: r.source,
        targetLocale: r.targetLocale,
        context: r.context,
        glossary: r.glossary,
        screenshot: state.keys[r.key]?.screenshot,
      })),
      results,
    });
  } else {
    console.log("Nothing to translate.");
  }

  saveState(args.statePath, state);
  console.log(`Wrote ${written} machine translation(s).`);
  for (const e of errors) console.warn(`skip ${e.key} @ ${e.locale}: ${e.error}`);
}

function reportApply(outcome: { written: number; errors: Array<{ key: string; locale: string; error: string }>; staleSkipped: number; retried: number; screenshotsSkipped: number }): void {
  console.log(`Wrote ${outcome.written} machine translation(s).`);
  if (outcome.retried) console.log(`${outcome.retried} item(s) re-run synchronously (batch entries failed or were malformed).`);
  if (outcome.staleSkipped) console.log(`${outcome.staleSkipped} result(s) skipped — source changed since submission.`);
  if (outcome.screenshotsSkipped) console.log(`${outcome.screenshotsSkipped} screenshot(s) ignored on retry (model has no vision support).`);
  for (const e of outcome.errors) console.warn(`skip ${e.key} @ ${e.locale}: ${e.error}`);
}

async function applyPending(args: ParsedArgs, provider: BatchTranslationProvider, pending: PendingBatch, ai: AiConfig): Promise<void> {
  const projectRoot = dirname(resolve(args.statePath));
  const outcome = await applyBatchResults(
    () => loadState(args.statePath),
    (s) => saveState(args.statePath, s),
    provider, pending, projectRoot,
    ai,
  );
  reportApply(outcome);
}

async function waitAndApply(args: ParsedArgs, provider: BatchTranslationProvider, pending: PendingBatch, ai: AiConfig): Promise<void> {
  // Poll once a minute — batches typically finish well within the hour and the
  // status endpoint is cheap.
  for (;;) {
    const status = await provider.translationBatchStatus(pending.batchId);
    const c = status.counts;
    process.stdout.write(`\r  ${c.succeeded + c.errored + c.expired + c.canceled}/${pending.jobs.length} entries done (${c.processing} processing)`);
    if (status.status === "ended") break;
    await new Promise((r) => setTimeout(r, 60_000));
  }
  process.stdout.write("\n");
  await applyPending(args, provider, pending, ai);
}

async function runBatch(args: ParsedArgs): Promise<void> {
  const projectRoot = dirname(resolve(args.statePath));
  const pending = loadPendingBatch(projectRoot);
  const ctxPending = loadPendingContextBatch(projectRoot);
  if (!pending && !ctxPending) {
    console.log("No pending batch. Start one with `glotfile translate --batch` or `glotfile build-context --batch`.");
    return;
  }
  const action = args.batchAction ?? "status";
  if (pending) await runTranslationBatchAction(args, pending, action, projectRoot);
  if (ctxPending) await runContextBatchAction(args, ctxPending, action, projectRoot);
}

async function runTranslationBatchAction(args: ParsedArgs, pending: PendingBatch, action: "status" | "apply" | "cancel", projectRoot: string): Promise<void> {
  if (action === "cancel") {
    // Best-effort remote cancel: build the provider and call it when possible, but
    // clearing the local handle must work even when the provider is unreachable
    // (the remote batch simply expires server-side).
    let remoteFailed = false;
    try {
      const ai = loadLocalSettings(projectRoot).ai;
      const provider = makeProvider(ai);
      if (supportsBatchTranslate(provider)) {
        await provider.cancelTranslationBatch(pending.batchId);
      } else {
        remoteFailed = true;
      }
    } catch {
      remoteFailed = true;
    }
    clearPendingBatch(projectRoot);
    const suffix = remoteFailed ? " (remote cancel failed — it will expire server-side)" : "";
    console.log(`Canceled batch ${pending.batchId}.${suffix}`);
    return;
  }
  const ai = loadLocalSettings(projectRoot).ai;
  const provider = makeProviderOrExit(ai);
  if (!provider) return;
  if (!supportsBatchTranslate(provider)) {
    console.error(`Pending batch was submitted via anthropic, but the configured provider "${ai.provider}" has no batch support.`);
    process.exitCode = 1;
    return;
  }
  const status = await provider.translationBatchStatus(pending.batchId);
  const c = status.counts;
  console.log(`Batch ${pending.batchId} (${pending.total} string(s), submitted ${pending.createdAt})`);
  console.log(`  ${status.status} — ${c.succeeded} succeeded, ${c.processing} processing, ${c.errored} errored, ${c.expired} expired, ${c.canceled} canceled`);
  if (status.status !== "ended") {
    if (action === "apply") console.log("Not finished yet — try again later.");
    return;
  }
  // Finished: bare `glotfile batch` and `glotfile batch apply` both apply.
  await applyPending(args, provider, pending, ai);
}

async function runContextBatchAction(args: ParsedArgs, pending: PendingContextBatch, action: "status" | "apply" | "cancel", projectRoot: string): Promise<void> {
  if (action === "cancel") {
    // Best-effort remote cancel, same semantics as the translation batch:
    // clearing the local handle must work even when the provider is unreachable.
    let remoteFailed = false;
    try {
      const ai = loadLocalSettings(projectRoot).ai;
      const provider = makeProvider(ai);
      if (supportsBatchComplete(provider)) {
        await provider.cancelTranslationBatch(pending.batchId);
      } else {
        remoteFailed = true;
      }
    } catch {
      remoteFailed = true;
    }
    clearPendingContextBatch(projectRoot);
    const suffix = remoteFailed ? " (remote cancel failed — it will expire server-side)" : "";
    console.log(`Canceled context batch ${pending.batchId}.${suffix}`);
    return;
  }
  const ai = loadLocalSettings(projectRoot).ai;
  const provider = makeProviderOrExit(ai);
  if (!provider) return;
  if (!supportsBatchComplete(provider)) {
    console.error(`Pending context batch was submitted via anthropic, but the configured provider "${ai.provider}" has no batch support.`);
    process.exitCode = 1;
    return;
  }
  const status = await provider.translationBatchStatus(pending.batchId);
  const c = status.counts;
  console.log(`Context batch ${pending.batchId} (${pending.total} key(s), submitted ${pending.createdAt})`);
  console.log(`  ${status.status} — ${c.succeeded} succeeded, ${c.processing} processing, ${c.errored} errored, ${c.expired} expired, ${c.canceled} canceled`);
  if (status.status !== "ended") {
    if (action === "apply") console.log("Not finished yet — try again later.");
    return;
  }
  // Finished: bare `glotfile batch` and `glotfile batch apply` both apply.
  const outcome = await applyContextBatchResults(
    () => loadState(args.statePath),
    (s) => saveState(args.statePath, s),
    provider, pending, projectRoot, ai,
  );
  console.log(`Wrote context for ${outcome.written} key(s).`);
  if (outcome.retried) console.log(`${outcome.retried} job(s) re-run synchronously (batch entries failed or were malformed).`);
  for (const e of outcome.errors) console.warn(`skip ${e.key}: ${e.error}`);
}

// The on-disk file holding catalog keys (single glotfile.json, or split
// keys.json), plus its contents, so SARIF locations point at the real file.
function sarifContextFor(statePath: string): SarifContext {
  if (detectFormat(statePath) === "split") {
    const dir = splitDirFor(statePath);
    const keysPath = join(dir, "keys.json");
    return {
      keysUri: `${basename(dir)}/keys.json`,
      keysRawText: existsSync(keysPath) ? readFileSync(keysPath, "utf8") : "",
    };
  }
  return {
    keysUri: basename(statePath),
    keysRawText: existsSync(statePath) ? readFileSync(statePath, "utf8") : "",
  };
}

function printReport(report: LintReport, format: ParsedArgs["format"], statePath: string): void {
  if (format === "json") console.log(formatJson(report).trimEnd());
  else if (format === "sarif") console.log(formatSarif(report, sarifContextFor(statePath)).trimEnd());
  else console.log(formatText(report).trimEnd());
}

async function runLintCmd(args: ParsedArgs): Promise<void> {
  // Reject an unknown --rule loudly: filtering to a non-existent id would match
  // no rules and report a misleading "no problems".
  if (args.ruleIds) {
    const unknown = unknownRuleIds(args.ruleIds);
    if (unknown.length > 0) {
      for (const id of unknown) {
        const hint = suggestRuleId(id);
        console.error(`Unknown --rule '${id}'.${hint ? ` Did you mean '${hint}'?` : ""}`);
      }
      console.error(`Valid rules: ${RULE_IDS.join(", ")}.`);
      process.exitCode = 1;
      return;
    }
  }
  const state = loadState(args.statePath);
  if (args.accept) {
    const { acceptFindings } = await import("./lint/accept.js");
    const report = await runLint(state, { locales: args.locales });
    const result = acceptFindings(state, report.findings, { rules: args.ruleIds, locales: args.locales });
    if (result.accepted > 0) saveState(args.statePath, state);
    console.log(`Suppressed ${result.accepted} warning(s).`);
    for (const [rule, n] of Object.entries(result.byRule)) console.log(`  ${rule}: ${n}`);
    if (result.accepted > 0) {
      console.log("Each suppression expires automatically when its key's source text changes.");
    }
    return;
  }
  const report = await runLint(state, {
    locales: args.locales, ruleIds: args.ruleIds, includeSuppressed: args.includeSuppressed,
  });
  printReport(report, args.format, args.statePath);
  const tooManyWarnings = args.maxWarnings != null && report.counts.warn > args.maxWarnings;
  if (!report.ok || tooManyWarnings) process.exitCode = 1;
}

async function runCheck(args: ParsedArgs): Promise<void> {
  let state;
  try {
    state = loadState(args.statePath);
  } catch (e) {
    const report: LintReport = {
      findings: [{ ruleId: "load-error", key: "", locale: "", severity: "error", message: (e as Error).message }],
      counts: { error: 1, warn: 0, suppressed: 0 }, ok: false,
    };
    printReport(report, args.format, args.statePath);
    process.exitCode = 1;
    return;
  }
  const root = dirname(resolve(args.statePath));
  const lint = await runLint(state, {});
  const findings = sortFindings([...lint.findings, ...checkOutputs(state, root)]);
  const counts = { ...countSeverities(findings), suppressed: lint.counts.suppressed };
  const report: LintReport = { findings, counts, ok: counts.error === 0 };
  printReport(report, args.format, args.statePath);
  if (!report.ok) process.exitCode = 1;
}

async function runImportCmd(args: ParsedArgs): Promise<void> {
  const { runImport } = await import("./import/run.js");

  const projectRoot = args.importSource
    ? resolve(args.importSource)
    : dirname(resolve(args.statePath));

  const out = resolve(projectRoot, "glotfile.json");
  if (existsSync(out) && !args.importForce) {
    console.error(`${out} already exists; pass --force to overwrite`);
    process.exitCode = 1;
    return;
  }

  let result;
  try {
    result = runImport({
      projectRoot,
      format: args.importFormat,
      sourceLocale: args.importSourceLocale,
      locales: args.locales,
      cldr: args.importCldr,
    });
  } catch (e) {
    console.error((e as Error).message);
    process.exitCode = 1;
    return;
  }

  for (const w of result.warnings) console.error(`warning: ${w}`);
  saveState(out, result.state);
  console.log(`Imported ${result.keyCount} keys across ${result.localeCount} locales → ${out}`);
}

async function runSyncCmd(args: ParsedArgs): Promise<void> {
  const { runSync } = await import("./import/run.js");

  const projectRoot = args.importSource
    ? resolve(args.importSource)
    : dirname(resolve(args.statePath));

  if (detectFormat(args.statePath) === "none") {
    console.error(`No glotfile.json found at ${args.statePath}; run 'glotfile import' first.`);
    process.exitCode = 1;
    return;
  }

  let result;
  try {
    result = runSync({
      projectRoot,
      statePath: args.statePath,
      format: args.importFormat,
      sourceLocale: args.importSourceLocale,
      locales: args.locales,
      cldr: args.importCldr,
      prune: args.prune,
    });
  } catch (e) {
    console.error((e as Error).message);
    process.exitCode = 1;
    return;
  }

  for (const w of result.warnings) console.error(`warning: ${w}`);
  const { plan } = result;
  console.log(
    `+${plan.added.length} added, ~${plan.sourceChanged.length} source-changed, ` +
    `✓${plan.adopted.length} adopted, -${plan.removed.length} removed` +
    `${plan.removed.length && !args.prune ? " (pass --prune to delete)" : ""}.`,
  );

  if (args.dryRun) {
    const list = (label: string, keys: string[]) => {
      if (keys.length) console.log(`\n${label}:\n  ${keys.join("\n  ")}`);
    };
    list("Added", plan.added);
    list("Source changed", plan.sourceChanged);
    list("Adopted", plan.adopted.map((a) => `${a.key} [${a.locale}]`));
    list("Removed", plan.removed);
    console.log("\nDry run — nothing written.");
    return;
  }

  saveState(args.statePath, result.state);
  if (isLocationScannedState(result.state)) {
    const cache = refreshLocationUsage(projectRoot, args.importFormat);
    const refs = cache ? usageCounts(cache).refs : 0;
    console.log(`Synced → ${args.statePath} (${result.keyCount} keys); usage index rebuilt from ${refs} location(s).`);
  } else {
    console.log(`Synced → ${args.statePath} (${result.keyCount} keys).`);
  }
}

async function runBuildContext(args: ParsedArgs): Promise<void> {
  const state = loadState(args.statePath);
  const projectRoot = dirname(resolve(args.statePath));
  const cache = loadUsageCache(projectRoot);
  if (!cache) {
    console.error("No usage index found. Run 'glotfile scan' first.");
    process.exitCode = 1;
    return;
  }
  const targets = selectContextTargets(state, {
    all: args.all,
    keyGlob: args.keyGlob,
    limit: args.limit,
    since: args.since,
  }, cache);
  if (!targets.length) {
    console.log("No keys need context.");
    return;
  }
  const aiCfg = loadLocalSettings(projectRoot).ai;
  // Snippets dominate the input-token count, so attach them before estimating.
  attachUsageSnippets(targets, cache, projectRoot);

  if (args.estimate) {
    const est = estimateContext(targets, aiCfg);
    const fmt = (n: number) => n.toLocaleString("en-US");
    console.log(`Estimate for ${fmt(est.keys)} key(s) in ${fmt(est.batches)} batch(es) — ${aiCfg.provider} · ${aiCfg.model}`);
    console.log(`Totals: ~${fmt(est.inputTokens)} input / ~${fmt(est.outputTokens)} output tokens`);
    if (est.pricing) {
      const cost = est.estimatedCost!;
      console.log(`Estimated cost: ~$${cost >= 0.1 ? cost.toFixed(2) : cost.toFixed(4)} (±20%, ${est.pricing.source} pricing $${est.pricing.inputPerMTok}/$${est.pricing.outputPerMTok} per MTok)`);
    } else {
      console.log("No pricing known for this model — set inputPricePerMTok/outputPricePerMTok in your AI settings for a dollar estimate.");
    }
    return;
  }

  let provider: TranslationProvider;
  try {
    provider = makeProvider(aiCfg);
  } catch (e) {
    console.error((e as Error).message);
    process.exitCode = 1;
    return;
  }
  const system = buildContextSystemPrompt();
  const batchSize = aiCfg.contextBatchSize ?? aiCfg.batchSize ?? 10;
  const concurrency = aiCfg.contextConcurrency ?? aiCfg.concurrency ?? 3;

  if (args.batch) {
    if (!supportsBatchComplete(provider)) {
      console.error(`Provider "${aiCfg.provider}" does not support batch mode. Currently anthropic only.`);
      process.exitCode = 1;
      return;
    }
    let pending;
    try {
      pending = await submitContextBatch(provider, targets, batchSize, aiCfg.model, projectRoot, false);
    } catch (e) {
      console.error((e as Error).message);
      process.exitCode = 1;
      return;
    }
    // The AI log records only what was SENT to the provider (egress-only).
    appendLog(projectRoot, {
      at: new Date().toISOString(),
      kind: "context",
      summary: `Submitted context batch ${pending.batchId} (${pending.total} keys)`,
      model: aiCfg.model,
      system,
      items: targets.map((t) => ({ id: t.id, key: t.key, source: t.source })),
    });
    console.log(`Submitted context batch ${pending.batchId} — ${pending.total} key(s) at 50% batch pricing.`);
    console.log("Check progress with `glotfile batch`; it applies results automatically when finished.");
    return;
  }
  const chunks: typeof targets[] = [];
  for (let i = 0; i < targets.length; i += batchSize) chunks.push(targets.slice(i, i + batchSize));

  let written = 0;
  const errors: Array<{ key: string; error: string }> = [];
  let next = 0;

  async function worker() {
    while (next < chunks.length) {
      const chunk = chunks[next++]!;
      let raw: unknown;
      try {
        raw = await provider.complete({ system, content: [{ type: "text", text: buildContextBatchPrompt(chunk) }], schema: CONTEXT_BATCH_SCHEMA });
      } catch (e) {
        errors.push(...chunk.map((t) => ({ key: t.key, error: (e as Error).message })));
        continue;
      }
      const batch = raw as { items: Array<{ id: string; context?: string; error?: string }> };
      const { written: w, errors: e } = applyContext(state, chunk, batch.items ?? []);
      written += w;
      errors.push(...e);
      console.log(`[${next * batchSize}/${targets.length}] wrote ${w}`);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, chunks.length) }, worker));
  saveState(args.statePath, state);
  console.log(`Wrote context for ${written} key(s).`);
  for (const e of errors) console.warn(`skip ${e.key}: ${e.error}`);
}

async function runSuggestGlossary(args: ParsedArgs): Promise<void> {
  const state = loadState(args.statePath);
  const projectRoot = dirname(resolve(args.statePath));
  const sources = selectGlossarySources(state, { keyGlob: args.keyGlob, limit: args.limit, since: args.since });
  if (!sources.length) {
    console.log("No source strings to scan.");
    return;
  }
  const aiCfg = loadLocalSettings(projectRoot).ai;
  const known = knownTermList(state);

  if (args.estimate) {
    const est = estimateGlossarySuggest(sources, known, aiCfg);
    const fmt = (n: number) => n.toLocaleString("en-US");
    console.log(`Estimate for ${fmt(est.sources)} source string(s) in ${fmt(est.batches)} batch(es) — ${aiCfg.provider} · ${aiCfg.model}`);
    console.log(`Totals: ~${fmt(est.inputTokens)} input / ~${fmt(est.outputTokens)} output tokens`);
    if (est.pricing) {
      const cost = est.estimatedCost!;
      console.log(`Estimated cost: ~$${cost >= 0.1 ? cost.toFixed(2) : cost.toFixed(4)} (±20%, ${est.pricing.source} pricing $${est.pricing.inputPerMTok}/$${est.pricing.outputPerMTok} per MTok)`);
    } else {
      console.log("No pricing known for this model — set inputPricePerMTok/outputPricePerMTok in your AI settings for a dollar estimate.");
    }
    return;
  }

  let provider: TranslationProvider;
  try {
    provider = makeProvider(aiCfg);
  } catch (e) {
    console.error((e as Error).message);
    process.exitCode = 1;
    return;
  }
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
      const chunkRows = chunks[next++]!;
      try {
        const raw = await provider.complete({ system, content: [{ type: "text", text: buildGlossarySuggestBatchPrompt(chunkRows, known) }], schema: GLOSSARY_SUGGEST_SCHEMA });
        const batch = raw as { terms?: SuggestedTerm[] };
        all.push(...(batch.terms ?? []));
      } catch (e) {
        console.warn(`batch failed: ${(e as Error).message}`);
      }
      done += chunkRows.length;
      console.log(`[${done}/${sources.length}] scanned`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, chunks.length) }, worker));

  const added = mergeGlossarySuggestions(state, dedupeTerms(all));
  saveState(args.statePath, state);
  appendLog(projectRoot, {
    at: new Date().toISOString(),
    kind: "glossary",
    summary: `Suggested ${added.length} glossary term(s)`,
    model: aiCfg.model,
  });
  console.log(`Found ${added.length} new candidate term(s). Review them in the glossary UI.`);
  for (const s of added) console.log(`  • ${s.term}${s.note ? ` — ${s.note}` : ""}`);
}

async function runScanCmd(args: ParsedArgs): Promise<void> {
  const state = loadState(args.statePath);
  const projectRoot = dirname(resolve(args.statePath));
  // Formats whose keys are content hashes (Angular) never appear literally in
  // code; their usage index comes from the catalog's source locations, not a
  // regex walk. Rebuild it from the catalog instead.
  if (isLocationScannedState(state)) {
    const cache = refreshLocationUsage(projectRoot);
    const refs = cache ? usageCounts(cache).refs : 0;
    console.log(`Rebuilt usage index from ${refs} catalog location(s) (code scan skipped for this format).`);
    return;
  }
  const existing = loadUsageCache(projectRoot);
  const result = runScan(projectRoot, state.config.scan ?? {}, existing);
  const fileCount = Object.keys(result.files).length;
  const refCount = Object.values(result.files).reduce((n, f) => n + f.refs.length, 0);
  console.log(`Scanned ${fileCount} file(s), found ${refCount} reference(s).`);
}

export async function runPrune(args: ParsedArgs): Promise<void> {
  if (!args.emptySource && !args.unused) {
    console.error("specify what to prune (--empty-source | --unused)");
    process.exitCode = 1;
    return;
  }
  const state = loadState(args.statePath);
  const toRemove = new Set<string>();
  // True when "unused" came from the heuristic regex scanner (not Angular's
  // authoritative re-import), so we can warn the list may have false positives.
  let heuristicUnused = false;
  if (args.emptySource) {
    for (const k of findEmptySourceKeys(state)) toRemove.add(k);
  }
  if (args.unused) {
    const projectRoot = dirname(resolve(args.statePath));
    if (isLocationScannedState(state)) {
      // The regex scanner can't see Angular's hashed keys. Re-extraction is the
      // authority on what's live, so "unused" = keys gone from a fresh import.
      const { runSync } = await import("./import/run.js");
      const { plan } = runSync({ projectRoot, statePath: args.statePath, prune: false });
      for (const k of plan.removed) toRemove.add(k);
    } else {
      // Scan first so "unused" is computed from current code, not a stale cache —
      // a stale cache could report a now-referenced key as dead. runScan is
      // incremental (reuses unchanged files) and re-persists .glotfile/usage.json.
      const cache = runScan(projectRoot, state.config.scan ?? {}, loadUsageCache(projectRoot));
      const used = new Set(computeUsedKeys(state, cache));
      for (const k of Object.keys(state.keys)) {
        if (!used.has(k)) toRemove.add(k);
      }
      heuristicUnused = true;
    }
  }
  const keys = [...toRemove].sort();
  if (!keys.length) {
    console.log("No keys to prune.");
    return;
  }
  // "unused" from the regex scanner is a heuristic: keys reached only through an
  // unrecognised translate wrapper or a fully dynamic key look like dead keys.
  if (heuristicUnused) {
    console.warn(
      "Note: --unused is heuristic — keys used via an unrecognised wrapper or a fully dynamic key " +
      "can appear here by mistake. Review the list and add a `scan.keep` glob for any false positive.",
    );
  }
  if (!args.write) {
    for (const k of keys) console.log(k);
    console.log(`${keys.length} key(s) to prune. Run with --write to remove them.`);
    return;
  }
  for (const k of keys) delete state.keys[k];
  saveState(args.statePath, state);
  console.log(`Removed ${keys.length} key(s).`);
}

function runSplit(args: ParsedArgs): void {
  if (detectFormat(args.statePath) === "split") {
    console.log("Already using split storage.");
    return;
  }
  const state = loadState(args.statePath);
  state.config.storage = "split";
  saveState(args.statePath, state);
  console.log(
    `Split catalog into ${splitDirFor(args.statePath)}/ (config.json, keys.json, ` +
    `locales/ — up to ${state.config.locales.length} locale files). Removed ${args.statePath}.`,
  );
}

// The skill assets ship in the package's top-level skill/ directory. Both
// src/server/cli.ts (dev/test) and dist/server/cli.js (published) sit two levels
// below the package root, so the same relative walk resolves in both.
const SKILL_SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "skill");

// Install (or print) the Claude Code skill that teaches an agent to drive glotfile.
export function runSkill(args: ParsedArgs): void {
  if (args.print) {
    console.log(readFileSync(join(SKILL_SRC, "SKILL.md"), "utf8").trimEnd());
    return;
  }
  const dest = resolve(process.cwd(), ".claude", "skills", "glotfile");
  if (existsSync(dest) && !args.importForce) {
    console.error(`${dest} already exists; pass --force to overwrite`);
    process.exitCode = 1;
    return;
  }
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(SKILL_SRC, dest, { recursive: true });
  console.log(`Installed the glotfile skill to ${dest}. Restart Claude Code to pick it up.`);
}

// --- agent-facing read/write commands ---------------------------------------

// get — filtered extraction so an agent works a large catalog without loading it.
function runGetCmd(args: ParsedArgs): void {
  const state = loadState(args.statePath);
  const keyGlobs = [...(args.positionals ?? []), ...(args.keyGlob ? [args.keyGlob] : [])];
  const out = runGet(state, {
    keyGlobs: keyGlobs.length ? keyGlobs : undefined,
    locales: args.locales,
    states: parseStates(args, true),
    fields: args.fields,
  });
  if (args.keysOnly) {
    for (const k of out.keys) console.log(k);
    return;
  }
  if (args.format === "ndjson") {
    for (const row of out.ndjson) console.log(JSON.stringify(row));
    return;
  }
  console.log(JSON.stringify(out.json, null, 2));
}

// stats — per-locale progress, so an agent can size up the work before acting.
function runStatsCmd(args: ParsedArgs): void {
  const state = loadState(args.statePath);
  const stats = computeStats(state);
  let locales = stats.locales;
  if (args.locales?.length) {
    const want = new Set(args.locales.map(canonLocale));
    locales = locales.filter((l) => want.has(l.locale));
  }
  if (args.format === "text") {
    console.log(`${stats.totals.keys} key(s) · ${stats.totals.locales} target locale(s) · ${stats.totals.translatedPct}% translated, ${stats.totals.reviewedPct}% reviewed`);
    for (const l of locales) {
      const c = l.counts;
      console.log(`  ${l.locale.padEnd(8)} ${String(l.translatedPct).padStart(5)}% translated  (reviewed ${c.reviewed}, machine ${c.machine}, needs-review ${c.needsReview}, missing ${c.missing})`);
    }
    return;
  }
  console.log(JSON.stringify({ totals: stats.totals, locales }, null, 2));
}

// How many target translations are currently flagged needs-review — snapshotted
// before/after a source edit to report how many it invalidated.
function countNeedsReview(state: State, key: string): number {
  const entry = state.keys[key];
  if (!entry) return 0;
  let n = 0;
  for (const [loc, lv] of Object.entries(entry.values)) {
    if (loc !== state.config.sourceLocale && lv.state === "needs-review") n++;
  }
  return n;
}

// set — write one source value (default; flips downstream to needs-review) or one
// target value (--locale). Value comes from a positional, --value, or stdin.
function runSet(args: ParsedArgs): void {
  const pos = args.positionals ?? [];
  const key = pos[0];
  if (!key) {
    console.error("Usage: glotfile set <key> [value] [--locale <code>] [--state <state>] [--create]");
    process.exitCode = 1;
    return;
  }
  let value = args.value ?? pos[1];
  if (value === undefined) {
    const piped = readStdin();
    value = piped.length ? piped.replace(/\r?\n$/, "") : undefined;
  }
  if (value === undefined) {
    console.error('set requires a value (positional, --value, or piped on stdin). Use --value "" to set an empty value.');
    process.exitCode = 1;
    return;
  }
  const state = loadState(args.statePath);
  const sl = state.config.sourceLocale;
  const locale = args.locales?.[0] ? canonLocale(args.locales[0]) : sl;
  try {
    if (locale === sl) {
      if (args.create && !state.keys[key]) createKey(state, key, value);
      const before = countNeedsReview(state, key);
      setSourceValue(state, key, value);
      saveState(args.statePath, state);
      const flipped = countNeedsReview(state, key) - before;
      console.log(`set ${key} (${sl})${flipped > 0 ? ` — ${flipped} translation(s) now need re-translation (run \`glotfile translate --state needs-review\`)` : ""}`);
    } else {
      setTargetValue(state, key, locale, value);
      const override = args.states?.[0] as LocaleState | undefined;
      if (override && override !== "reviewed") setKeyState(state, key, locale, override);
      saveState(args.statePath, state);
      console.log(`set ${key} (${locale})`);
    }
  } catch (e) {
    console.error((e as Error).message);
    process.exitCode = 1;
  }
}

// set-state — flip review state for one key, or many via a glob, across locales.
function runSetStateCmd(args: ParsedArgs): void {
  const pos = args.positionals ?? [];
  const sel = args.keyGlob ?? pos[0];
  const stateName = (args.keyGlob ? pos[0] : pos[1]) as LocaleState | undefined;
  if (!sel || !stateName) {
    console.error("Usage: glotfile set-state <key|glob> <state> [--locale <list>]  (state: machine | needs-review | reviewed)");
    process.exitCode = 1;
    return;
  }
  if (!STATES.includes(stateName)) {
    console.error(`Unknown state '${stateName}'. Expected one of: ${STATES.join(", ")}.`);
    process.exitCode = 1;
    return;
  }
  const state = loadState(args.statePath);
  const sl = state.config.sourceLocale;
  const locales = (args.locales?.length ? args.locales : state.config.locales.filter((l) => l !== sl)).map(canonLocale);
  const keys = matchKeys(state, sel);
  let n = 0;
  for (const key of keys) {
    for (const loc of locales) {
      if (state.keys[key]!.values[loc]) {
        setKeyState(state, key, loc, stateName);
        n++;
      }
    }
  }
  saveState(args.statePath, state);
  console.log(`Set ${n} cell(s) to ${stateName} across ${keys.length} key(s).`);
}

// clear — empty target value(s) so they read as untranslated (and get refilled by
// a plain `glotfile translate`).
function runClearCmd(args: ParsedArgs): void {
  const sel = args.keyGlob ?? args.positionals?.[0];
  if (!sel) {
    console.error("Usage: glotfile clear <key|glob> --locale <list>");
    process.exitCode = 1;
    return;
  }
  if (!args.locales?.length) {
    console.error("clear requires --locale <list> (the locale(s) to empty).");
    process.exitCode = 1;
    return;
  }
  const state = loadState(args.statePath);
  const sl = state.config.sourceLocale;
  const locales = args.locales.map(canonLocale);
  if (locales.includes(sl)) {
    console.error(`Cannot clear the source locale (${sl}); edit it with \`glotfile set\` instead.`);
    process.exitCode = 1;
    return;
  }
  const keys = matchKeys(state, sel);
  let n = 0;
  for (const key of keys) {
    for (const loc of locales) {
      if (state.keys[key]!.values[loc]) {
        clearValue(state, key, loc);
        n++;
      }
    }
  }
  saveState(args.statePath, state);
  console.log(`Cleared ${n} value(s) → untranslated.`);
}

// apply — a JSON batch of write ops from stdin, applied in one load → save.
function runApply(args: ParsedArgs): void {
  let ops;
  try {
    ops = parseOps(readStdin());
  } catch (e) {
    console.error((e as Error).message);
    process.exitCode = 1;
    return;
  }
  const state = loadState(args.statePath);
  const r = applyOps(state, ops, { continueOnError: args.continueOnError });
  // Atomic by default: any error and we never touch disk. --continue-on-error
  // applies the survivors and saves. --dry-run never saves.
  const saved = (args.continueOnError || r.errors.length === 0) && !args.dryRun;
  if (saved) saveState(args.statePath, state);
  console.log(JSON.stringify({ applied: r.applied, keysTouched: r.keysTouched, saved, dryRun: !!args.dryRun, errors: r.errors }, null, 2));
  if (r.errors.length) process.exitCode = 1;
}

// prices — show or refresh the machine-global model price cache (models.dev).
// Network happens only on --refresh; otherwise it reports the current cache and
// the price resolved for the configured model.
async function runPrices(args: ParsedArgs): Promise<void> {
  const projectRoot = dirname(resolve(args.statePath));
  if (args.refresh) {
    try {
      const res = await refreshPrices();
      invalidatePriceCache();
      console.log(`Updated ${res.modelCount} model price(s) from ${res.source}.`);
      console.log(`Fetched ${new Date(res.fetchedAt).toLocaleString()} → ${res.path}`);
    } catch (e) {
      console.error(`Could not refresh prices: ${(e as Error).message}`);
      console.error("Existing cached prices (if any) are unchanged.");
      process.exitCode = 1;
    }
    return;
  }
  const cache = loadPriceCache();
  if (cache) {
    const when = cache.fetchedAt ? new Date(cache.fetchedAt).toLocaleString() : "unknown time";
    console.log(`Price cache: ${Object.keys(cache.models).length} model(s) from ${cache.source}, fetched ${when}.`);
    console.log(`Location: ${defaultPriceCachePath()}`);
  } else {
    console.log("No price cache yet. Run `glotfile prices --refresh` to fetch the latest from models.dev.");
  }
  const aiCfg = loadLocalSettings(projectRoot).ai;
  const pricing = resolvePricing(aiCfg, cache);
  if (pricing) {
    console.log(`\n${aiCfg.provider} · ${aiCfg.model}: $${pricing.inputPerMTok}/$${pricing.outputPerMTok} per MTok (${pricing.source}).`);
  } else {
    console.log(`\nNo price known for ${aiCfg.provider} · ${aiCfg.model}. Set inputPricePerMTok/outputPricePerMTok in AI settings, or refresh.`);
  }
}

type Opt = [flags: string, desc: string];

// The flag surface of each command, kept beside parseArgs so help stays in sync.
// `-f, --file` is global and rendered separately for every command.
const GLOBAL_OPTS: Opt[] = [
  ["-f, --file <path>", "State file to use (default: ./glotfile.json)"],
  ["-h, --help", "Show this help"],
];
const COMMAND_HELP: Record<Exclude<ParsedArgs["command"], "help" | "version">, { summary: string; usage: string; options: Opt[] }> = {
  serve: {
    summary: "Start the local web UI (default command).",
    usage: "glotfile serve [--dev] [--no-open]",
    options: [
      ["--dev", "Run the UI from source with hot reload"],
      ["--no-open", "Don't open the browser automatically"],
    ],
  },
  export: {
    summary: "Write the locale files for every configured output.",
    usage: "glotfile export [--adapter <name>] [--watch]",
    options: [
      ["--adapter <name>", "Only export this adapter (e.g. flutter-arb, laravel-php)"],
      ["--watch", "Re-export whenever the state file changes"],
    ],
  },
  translate: {
    summary: "AI-translate missing strings into your target locales (writes back to the state file).",
    usage: "glotfile translate [--all] [--state <list>] [--estimate] [--locale <list>] [--key <glob>]",
    options: [
      ["--all", "Re-translate every string, not just empty values"],
      ["--state <list>", "Re-translate only targets in these states: missing|machine|needs-review|reviewed (e.g. needs-review = strings a source edit invalidated)"],
      ["--estimate", "Print batches, tokens and estimated cost without translating"],
      ["--locale <list>", "Comma-separated target locales (alias: --locales)"],
      ["--key <glob>", "Only keys matching this glob"],
      ["--batch", "Submit via the provider's batch API (50% cost, async; anthropic only)"],
      ["--wait", "With --batch: stay attached, poll until finished, then apply"],
    ],
  },
  lint: {
    summary: "Check the catalog for problems (placeholders, length, glossary, …).",
    usage: "glotfile lint [--format <text|json|sarif>] [--locale <list>] [--rule <list>] [--max-warnings <n>] [--include-suppressed] [--accept]",
    options: [
      ["--format <fmt>", "Output format: text (default), json, or sarif"],
      ["--locale <list>", "Restrict to these comma-separated locales"],
      ["--rule <list>", "Only run these comma-separated rule ids"],
      ["--max-warnings <n>", "Exit non-zero if warnings exceed n"],
      ["--include-suppressed", "Also show findings hidden by suppressions"],
      ["--accept", "Suppress all current warnings (narrow with --rule/--locale); each expires when its source changes"],
    ],
  },
  check: {
    summary: "Lint the catalog and verify the exported files are up to date.",
    usage: "glotfile check [--format <text|json|sarif>]",
    options: [["--format <fmt>", "Output format: text (default), json, or sarif"]],
  },
  import: {
    summary: "Create glotfile.json from existing locale files.",
    usage: "glotfile import --format <name> [--source <dir>] [--source-locale <code>] [--locales <list>] [--cldr] [--force]",
    options: [
      ["--format <name>", "Source layout adapter (e.g. laravel-php, flutter-arb)"],
      ["--source <dir>", "Directory to import from (default: the state file's directory)"],
      ["--source-locale <code>", "Locale to treat as the source"],
      ["--locales <list>", "Comma-separated locales to import"],
      ["--cldr", "Expand CLDR plural forms"],
      ["--force", "Overwrite an existing glotfile.json"],
    ],
  },
  sync: {
    summary: "Merge re-extracted locale files into the catalog, preserving glossary, context and translations.",
    usage: "glotfile sync [--format <name>] [--source <dir>] [--prune] [--dry-run]",
    options: [
      ["--format <name>", "Source layout adapter (auto-detected if omitted)"],
      ["--source <dir>", "Directory to read locale files from (default: the state file's directory)"],
      ["--source-locale <code>", "Locale to treat as the source"],
      ["--locales <list>", "Comma-separated locales to read"],
      ["--cldr", "Expand CLDR plural forms"],
      ["--prune", "Delete keys that are gone from the import (default: report only)"],
      ["--dry-run", "Show the changeset without writing anything"],
    ],
  },
  "build-context": {
    summary: "AI-generate per-key context to improve translation (requires a prior scan).",
    usage: "glotfile build-context [--all] [--key <glob>] [--limit <n>] [--since <date>] [--estimate] [--batch]",
    options: [
      ["--all", "(Re)build context for every key, not just those missing it"],
      ["--key <glob>", "Only keys matching this glob"],
      ["--limit <n>", "Process at most n keys"],
      ["--since <date>", "Only keys added or changed since this date"],
      ["--estimate", "Print batches, tokens and estimated cost without building"],
      ["--batch", "Submit via the provider's batch API (50% cost, async; anthropic only)"],
    ],
  },
  "suggest-glossary": {
    summary: "AI-scan source strings for candidate glossary terms (adds a review queue; existing terms are skipped).",
    usage: "glotfile suggest-glossary [--key <glob>] [--limit <n>] [--since <date>] [--estimate]",
    options: [
      ["--key <glob>", "Only scan keys matching this glob"],
      ["--limit <n>", "Scan at most n source strings"],
      ["--since <date>", "Only keys added since this date"],
      ["--estimate", "Print batches, tokens and estimated cost without scanning"],
    ],
  },
  scan: {
    summary: "Index code references to keys (writes .glotfile/usage.json).",
    usage: "glotfile scan",
    options: [],
  },
  prune: {
    summary: "Remove empty-source or unused keys. Dry-run unless --write is given.",
    usage: "glotfile prune (--empty-source | --unused) [--write]",
    options: [
      ["--empty-source", "Select keys whose source value is empty"],
      ["--unused", "Select keys with no code reference (runs a scan first)"],
      ["--write", "Remove the selected keys (default: list them only)"],
    ],
  },
  split: {
    summary: "Convert glotfile.json into a glotfile/ directory of per-locale files (faster, reviewable git diffs).",
    usage: "glotfile split",
    options: [],
  },
  skill: {
    summary: "Install the Claude Code skill for managing glotfile into ./.claude/skills/glotfile/.",
    usage: "glotfile skill [--print] [--force]",
    options: [
      ["--print", "Write SKILL.md to stdout instead of installing"],
      ["--force", "Overwrite an existing installed skill"],
    ],
  },
  batch: {
    summary: "Check, apply, or cancel a pending batch translation.",
    usage: "glotfile batch [status|apply|cancel]",
    options: [
      ["status", "Show the pending batch's progress (default)"],
      ["apply", "Fetch results and write translations (auto-runs when finished)"],
      ["cancel", "Cancel the pending batch and discard the handle"],
    ],
  },
  prices: {
    summary: "Show or refresh the model price cache used for cost estimates (models.dev).",
    usage: "glotfile prices [--refresh]",
    options: [
      ["--refresh", "Fetch the latest prices from models.dev into the cache (the only command that hits the network)"],
    ],
  },
  get: {
    summary: "Extract values from the catalog (filtered) without loading the whole file. Prints JSON.",
    usage: "glotfile get [<key-glob>…] [--key <glob>] [--locale <list>] [--state <list>] [--fields <list>] [--keys-only] [--format json|ndjson]",
    options: [
      ["<key-glob>…", "Key globs to include (e.g. auth.*); positional, repeatable. Default: all keys"],
      ["--key <glob>", "Additional key glob (merged with positionals)"],
      ["--locale <list>", "Locales to show (default: all configured locales, source included)"],
      ["--state <list>", "Only keys whose shown target locales are in these states: source|missing|machine|needs-review|reviewed"],
      ["--fields <list>", "Cell fields to project: value,state,updatedAt (default value,state); 'all' = the full key entry"],
      ["--keys-only", "Print just the matched key names, one per line"],
      ["--format <fmt>", "json (default, nested) or ndjson (one row per cell)"],
    ],
  },
  stats: {
    summary: "Per-locale progress counts (translated / reviewed / machine / needs-review / missing).",
    usage: "glotfile stats [--locale <list>] [--format json|text]",
    options: [
      ["--locale <list>", "Restrict to these comma-separated locales"],
      ["--format <fmt>", "json (default) or text"],
    ],
  },
  set: {
    summary: "Set one value: the source string (default — flips downstream translations to needs-review) or a target (--locale).",
    usage: "glotfile set <key> [value] [--locale <code>] [--state <state>] [--create]",
    options: [
      ["<key> [value]", "Key, then the value (or pass --value, or pipe it on stdin)"],
      ["--locale <code>", "Set this target locale instead of the source"],
      ["--value <v>", "The value (alternative to the positional / stdin)"],
      ["--state <state>", "Resulting state for a target write (default reviewed): machine|needs-review|reviewed"],
      ["--create", "Create the key (scalar) if it does not exist yet"],
    ],
  },
  "set-state": {
    summary: "Flip the review state of one key — or many via a glob — across locales.",
    usage: "glotfile set-state <key|glob> <state> [--locale <list>]",
    options: [
      ["<key|glob> <state>", "Key/glob, then machine | needs-review | reviewed"],
      ["--key <glob>", "Glob selecting keys (alternative to the positional key)"],
      ["--locale <list>", "Locales to affect (default: every target locale)"],
    ],
  },
  clear: {
    summary: "Empty target value(s) so they read as untranslated (and get refilled by a plain translate).",
    usage: "glotfile clear <key|glob> --locale <list>",
    options: [
      ["<key|glob>", "Key or glob to clear"],
      ["--key <glob>", "Glob selecting keys (alternative to the positional key)"],
      ["--locale <list>", "Required: the locale(s) to empty (cannot be the source)"],
    ],
  },
  apply: {
    summary: "Apply a JSON batch of write operations from stdin in one load → save (atomic by default).",
    usage: "glotfile apply [--dry-run] [--continue-on-error] < ops.json",
    options: [
      ["--dry-run", "Report what would change without writing"],
      ["--continue-on-error", "Apply the survivors past a failing op instead of stopping (and saving nothing)"],
    ],
  },
};

function formatOpts(opts: Opt[]): string {
  const width = Math.max(...opts.map(([f]) => f.length));
  return opts.map(([f, d]) => `  ${f.padEnd(width)}  ${d}`).join("\n");
}

function printHelp(command?: Exclude<ParsedArgs["command"], "help" | "version">): void {
  if (command) {
    const { summary, usage, options } = COMMAND_HELP[command];
    const lines = [summary, "", `Usage: ${usage}`, "", "Options:"];
    console.log(`${lines.join("\n")}\n${formatOpts([...options, ...GLOBAL_OPTS])}`);
    return;
  }
  const commands = COMMANDS.map((c) => [c, COMMAND_HELP[c].summary] as Opt);
  console.log(
    [
      "glotfile — a local-first translation catalog for your repo.",
      "",
      "Usage: glotfile <command> [options]",
      "",
      "Commands:",
      formatOpts(commands),
      "",
      "Global options:",
      formatOpts([...GLOBAL_OPTS, ["-v, --version", "Print the glotfile version"]]),
      "",
      "Run `glotfile <command> --help` for a command's options.",
    ].join("\n"),
  );
}

function printVersion(): void {
  // package.json sits at the package root, two levels above this module in both
  // src/server (dev/test) and dist/server (published) — same walk as SKILL_SRC.
  const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json");
  console.log(JSON.parse(readFileSync(pkgPath, "utf8")).version);
}

export async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  if (args.unknownCommand) {
    console.error(`Unknown command '${args.unknownCommand}'. Run \`glotfile --help\` to see available commands.`);
    process.exitCode = 1;
    return;
  }
  if (args.command === "help") return printHelp();
  if (args.command === "version") return printVersion();
  if (args.help) return printHelp(args.command);
  loadDotEnv();
  if (args.command === "export") return runExport(args);
  if (args.command === "translate") return runTranslate(args);
  if (args.command === "lint") return runLintCmd(args);
  if (args.command === "check") return runCheck(args);
  if (args.command === "import") return runImportCmd(args);
  if (args.command === "sync") return runSyncCmd(args);
  if (args.command === "build-context") return runBuildContext(args);
  if (args.command === "suggest-glossary") return runSuggestGlossary(args);
  if (args.command === "scan") return runScanCmd(args);
  if (args.command === "prune") return runPrune(args);
  if (args.command === "split") return runSplit(args);
  if (args.command === "skill") return runSkill(args);
  if (args.command === "batch") return runBatch(args);
  if (args.command === "prices") return runPrices(args);
  if (args.command === "get") return runGetCmd(args);
  if (args.command === "stats") return runStatsCmd(args);
  if (args.command === "set") return runSet(args);
  if (args.command === "set-state") return runSetStateCmd(args);
  if (args.command === "clear") return runClearCmd(args);
  if (args.command === "apply") return runApply(args);
  const { startServer } = await import("./server.js");
  const { url } = await startServer({ statePath: args.statePath, dev: args.dev, open: !args.noOpen });
  // In dev this is the API-only port; the UI lives on the Vite dev server. Say so,
  // so the Vite "Local:" URL — not this one — is the one to open.
  if (args.dev) console.log(`Glotfile dev API on ${url} — open the UI at the Vite "Local:" URL above`);
  else console.log(`Glotfile running at ${url}`);
}

if (resolve(process.argv[1] ?? "") === resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
