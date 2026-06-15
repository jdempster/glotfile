import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { writeFileAtomic } from "./atomic-write.js";
import { ensureGlotfileDir } from "./glotfile-dir.js";
import { PROVIDERS, PROMPT_STYLES, type AiConfig } from "./schema.js";

// Editor deep-link target for a key's code usage. The canonical labelled list
// lives in the UI (ui/src/editor.ts); the server only stores and validates the id.
export type EditorId = "vscode" | "zed" | "phpstorm";
const EDITOR_IDS: readonly EditorId[] = ["vscode", "zed", "phpstorm"];
export const isEditorId = (v: unknown): v is EditorId => EDITOR_IDS.includes(v as EditorId);

// Settings that are local to a checkout, not committed: which AI provider/model a
// developer uses, and which editor opens their code usages. Persisted per-project
// in <project>/.glotfile/settings.json (gitignored) so each developer — and each
// project — can differ. Deliberately NOT part of the shared, committed config.
export interface LocalSettings {
  ai: AiConfig;
  editor: EditorId;
  profiles: Record<string, AiConfig>;
  activeProfile: string | null;
}

const DEFAULT_AI: AiConfig = {
  provider: "anthropic",
  model: "claude-sonnet-4-6",
  endpoint: null,
  region: null,
  batchSize: 25,
};
const DEFAULT_EDITOR: EditorId = "vscode";

export function defaultLocalSettings(): LocalSettings {
  return { ai: { ...DEFAULT_AI }, editor: DEFAULT_EDITOR, profiles: {}, activeProfile: null };
}

const settingsPath = (projectRoot: string): string => resolve(projectRoot, ".glotfile", "settings.json");

function readJson(path: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// Lenient read: every field falls back to its default independently, so a corrupt
// or partially-hand-edited file still yields a usable, complete settings object.
function coerceAi(raw: unknown): AiConfig {
  const a = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    provider: (PROVIDERS as readonly string[]).includes(a.provider as string) ? (a.provider as AiConfig["provider"]) : DEFAULT_AI.provider,
    model: typeof a.model === "string" && a.model ? a.model : DEFAULT_AI.model,
    endpoint: typeof a.endpoint === "string" ? a.endpoint : null,
    region: typeof a.region === "string" ? a.region : null,
    batchSize: typeof a.batchSize === "number" && a.batchSize > 0 ? a.batchSize : DEFAULT_AI.batchSize,
    concurrency: typeof a.concurrency === "number" && a.concurrency > 0 ? a.concurrency : undefined,
    contextBatchSize: typeof a.contextBatchSize === "number" && a.contextBatchSize > 0 ? a.contextBatchSize : undefined,
    contextConcurrency: typeof a.contextConcurrency === "number" && a.contextConcurrency > 0 ? a.contextConcurrency : undefined,
    vision: typeof a.vision === "boolean" ? a.vision : undefined,
    promptStyle: (PROMPT_STYLES as readonly string[]).includes(a.promptStyle as string)
      ? (a.promptStyle as AiConfig["promptStyle"])
      : undefined,
    inputPricePerMTok: typeof a.inputPricePerMTok === "number" && a.inputPricePerMTok >= 0 ? a.inputPricePerMTok : undefined,
    outputPricePerMTok: typeof a.outputPricePerMTok === "number" && a.outputPricePerMTok >= 0 ? a.outputPricePerMTok : undefined,
  };
}

function coerceProfiles(raw: unknown): Record<string, AiConfig> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const result: Record<string, AiConfig> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k === "string" && k.trim()) result[k] = coerceAi(v);
  }
  return result;
}

export function loadLocalSettings(projectRoot: string): LocalSettings {
  const raw = readJson(settingsPath(projectRoot));
  const profiles = coerceProfiles(raw.profiles);
  const activeProfile = typeof raw.activeProfile === "string" && raw.activeProfile in profiles
    ? raw.activeProfile : null;
  const baseAi = coerceAi(raw.ai);
  const ai = activeProfile ? profiles[activeProfile]! : baseAi;
  return { ai, editor: isEditorId(raw.editor) ? raw.editor : DEFAULT_EDITOR, profiles, activeProfile };
}

// Read-modify-write so a partial patch (only `ai` or only `editor`) leaves the
// other half — and any future keys we don't model — untouched on disk.
export function saveLocalSettings(projectRoot: string, patch: Partial<LocalSettings>): void {
  const path = settingsPath(projectRoot);
  const merged: Record<string, unknown> = { ...readJson(path) };
  if (patch.ai !== undefined) merged.ai = patch.ai;
  if (patch.editor !== undefined) merged.editor = patch.editor;
  if (patch.profiles !== undefined) merged.profiles = patch.profiles;
  if (patch.activeProfile !== undefined) merged.activeProfile = patch.activeProfile;
  ensureGlotfileDir(projectRoot);
  writeFileAtomic(path, JSON.stringify(merged, null, 2) + "\n");
}

// Strict validation for the PUT boundary (unvalidated client JSON). Returns an
// error message, or null when the input is a well-formed AiConfig. Mirrors the
// checks the committed-config schema used to apply before AI moved local.
export function aiConfigError(ai: unknown): string | null {
  if (!ai || typeof ai !== "object") return "ai must be an object";
  const a = ai as Record<string, unknown>;
  if (typeof a.provider !== "string" || !(PROVIDERS as readonly string[]).includes(a.provider)) {
    return `ai.provider must be one of: ${PROVIDERS.join(", ")}`;
  }
  if (typeof a.model !== "string") return "ai.model must be a string";
  if (!(a.endpoint === null || a.endpoint === undefined || typeof a.endpoint === "string")) return "ai.endpoint must be a string or null";
  if (!(a.region === undefined || a.region === null || typeof a.region === "string")) return "ai.region must be a string or null";
  if (typeof a.batchSize !== "number") return "ai.batchSize must be a number";
  for (const f of ["inputPricePerMTok", "outputPricePerMTok"] as const) {
    const v = a[f];
    if (!(v === undefined || v === null || (typeof v === "number" && v >= 0))) return `ai.${f} must be a non-negative number`;
  }
  return null;
}
