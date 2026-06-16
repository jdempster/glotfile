import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { GlossarySource } from "./glossary-suggest.js";

export interface PendingGlossaryBatchJob {
  customId: string;
  requests: GlossarySource[];
}

export interface PendingGlossaryBatch {
  version: 1;
  provider: string;
  model: string;
  batchId: string;
  createdAt: string;
  // total number of keys across all jobs
  total: number;
  // Known-term skip list captured at submit time, replayed into each job's
  // prompt so the model still skips existing/dismissed terms when the batch runs.
  knownTerms: string[];
  jobs: PendingGlossaryBatchJob[];
}

// Project-specific but machine/account-bound transient state: lives beside the
// project in ./.glotfile/, kept out of git by the self-ignoring .gitignore.
// Separate from the translation batch and context batch handles — one of each can be in flight.
export function pendingGlossaryBatchPath(projectRoot: string): string {
  return join(projectRoot, ".glotfile", "glossary-suggest-batch.json");
}

export function loadPendingGlossaryBatch(projectRoot: string): PendingGlossaryBatch | undefined {
  const path = pendingGlossaryBatchPath(projectRoot);
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    // a corrupt or wrong-version handle is unrecoverable — treat as absent
    if (parsed?.version !== 1) return undefined;
    return parsed as PendingGlossaryBatch;
  } catch {
    // a corrupt or wrong-version handle is unrecoverable — treat as absent
    return undefined;
  }
}

export function savePendingGlossaryBatch(projectRoot: string, pending: PendingGlossaryBatch): void {
  const dir = join(projectRoot, ".glotfile");
  mkdirSync(dir, { recursive: true });
  const gitignore = join(dir, ".gitignore");
  if (!existsSync(gitignore)) writeFileSync(gitignore, "*\n");
  writeFileSync(pendingGlossaryBatchPath(projectRoot), JSON.stringify(pending, null, 2) + "\n");
}

export function clearPendingGlossaryBatch(projectRoot: string): void {
  rmSync(pendingGlossaryBatchPath(projectRoot), { force: true });
}
