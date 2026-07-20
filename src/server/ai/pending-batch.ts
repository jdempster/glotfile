import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { TranslationRequest } from "./provider.js";

// A submitted request, persisted for the apply step. Screenshots are dropped
// (base64 would bloat the file; a sync-fallback retry re-attaches them from
// state) and a source hash is added so apply can skip results whose source
// text changed between submit and apply.
export type StoredRequest = Omit<TranslationRequest, "image"> & { sourceHash: string };

export interface PendingBatchJob {
  customId: string;
  locale: string;
  requests: StoredRequest[];
}

export interface PendingBatch {
  version: 1;
  provider: string;
  model: string;
  batchId: string;
  createdAt: string;
  // total number of translation requests across all jobs
  total: number;
  jobs: PendingBatchJob[];
}

// Project-specific but machine/account-bound transient state: lives beside the
// project in ./.glotfile/, kept out of git by the self-ignoring .gitignore.
// One file per batch, so several batches (e.g. one per target locale) can be
// in flight at once and each applies the moment it finishes.
export function pendingBatchesDir(projectRoot: string): string {
  return join(projectRoot, ".glotfile", "batches");
}

// batchId comes from the provider — sanitize it for use as a filename.
export function pendingBatchPath(projectRoot: string, batchId: string): string {
  return join(pendingBatchesDir(projectRoot), batchId.replace(/[^a-zA-Z0-9_-]/g, "-") + ".json");
}

function parsePendingBatch(path: string): PendingBatch | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    // a corrupt or wrong-version handle is unrecoverable — treat as absent
    if (parsed?.version !== 1) return undefined;
    return parsed as PendingBatch;
  } catch {
    // a corrupt or wrong-version handle is unrecoverable — treat as absent
    return undefined;
  }
}

// All in-flight batches, oldest first (submission order).
export function listPendingBatches(projectRoot: string): PendingBatch[] {
  const dir = pendingBatchesDir(projectRoot);
  if (!existsSync(dir)) return [];
  const out: PendingBatch[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const pending = parsePendingBatch(join(dir, name));
    if (pending) out.push(pending);
  }
  out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return out;
}

export function loadPendingBatch(projectRoot: string, batchId: string): PendingBatch | undefined {
  const path = pendingBatchPath(projectRoot, batchId);
  if (!existsSync(path)) return undefined;
  return parsePendingBatch(path);
}

export function savePendingBatch(projectRoot: string, pending: PendingBatch): void {
  mkdirSync(pendingBatchesDir(projectRoot), { recursive: true });
  const gitignore = join(projectRoot, ".glotfile", ".gitignore");
  if (!existsSync(gitignore)) writeFileSync(gitignore, "*\n");
  writeFileSync(pendingBatchPath(projectRoot, pending.batchId), JSON.stringify(pending, null, 2) + "\n");
}

export function clearPendingBatch(projectRoot: string, batchId: string): void {
  rmSync(pendingBatchPath(projectRoot, batchId), { force: true });
}
