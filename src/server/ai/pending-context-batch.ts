import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { ContextRequest, ContextGuidance } from "./context.js";

// A submitted context request, persisted for the apply step. Screenshots are
// never sent for context builds, so only the prompt-bearing fields are kept;
// usageSnippets stay so a sync-fallback retry can rebuild the same prompt.
export type StoredContextRequest = Omit<ContextRequest, "image">;

export interface PendingContextBatchJob {
  customId: string;
  requests: StoredContextRequest[];
}

export interface PendingContextBatch {
  version: 1;
  provider: string;
  model: string;
  batchId: string;
  createdAt: string;
  // total number of keys across all jobs
  total: number;
  // Whether existing context should be overwritten at apply time.
  force: boolean;
  // Source-language + project guidance the batch was submitted with, reused so a
  // sync-fallback retry renders the identical system prompt.
  guidance?: ContextGuidance;
  jobs: PendingContextBatchJob[];
}

// Project-specific but machine/account-bound transient state: lives beside the
// project in ./.glotfile/, kept out of git by the self-ignoring .gitignore.
// Separate from the translation batch handle — one of each can be in flight.
export function pendingContextBatchPath(projectRoot: string): string {
  return join(projectRoot, ".glotfile", "context-batch.json");
}

export function loadPendingContextBatch(projectRoot: string): PendingContextBatch | undefined {
  const path = pendingContextBatchPath(projectRoot);
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    // a corrupt or wrong-version handle is unrecoverable — treat as absent
    if (parsed?.version !== 1) return undefined;
    return parsed as PendingContextBatch;
  } catch {
    // a corrupt or wrong-version handle is unrecoverable — treat as absent
    return undefined;
  }
}

export function savePendingContextBatch(projectRoot: string, pending: PendingContextBatch): void {
  const dir = join(projectRoot, ".glotfile");
  mkdirSync(dir, { recursive: true });
  const gitignore = join(dir, ".gitignore");
  if (!existsSync(gitignore)) writeFileSync(gitignore, "*\n");
  writeFileSync(pendingContextBatchPath(projectRoot), JSON.stringify(pending, null, 2) + "\n");
}

export function clearPendingContextBatch(projectRoot: string): void {
  rmSync(pendingContextBatchPath(projectRoot), { force: true });
}
