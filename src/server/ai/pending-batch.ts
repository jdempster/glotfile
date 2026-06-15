import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
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
export function pendingBatchPath(projectRoot: string): string {
  return join(projectRoot, ".glotfile", "batch.json");
}

export function loadPendingBatch(projectRoot: string): PendingBatch | undefined {
  const path = pendingBatchPath(projectRoot);
  if (!existsSync(path)) return undefined;
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

export function savePendingBatch(projectRoot: string, pending: PendingBatch): void {
  const dir = join(projectRoot, ".glotfile");
  mkdirSync(dir, { recursive: true });
  const gitignore = join(dir, ".gitignore");
  if (!existsSync(gitignore)) writeFileSync(gitignore, "*\n");
  writeFileSync(pendingBatchPath(projectRoot), JSON.stringify(pending, null, 2) + "\n");
}

export function clearPendingBatch(projectRoot: string): void {
  rmSync(pendingBatchPath(projectRoot), { force: true });
}
