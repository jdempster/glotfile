import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPendingBatch, savePendingBatch, clearPendingBatch, listPendingBatches, pendingBatchPath, type PendingBatch } from "./pending-batch.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "glotfile-batch-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const pending: PendingBatch = {
  version: 1, provider: "anthropic", model: "claude-opus-4-8",
  batchId: "msgbatch_123", createdAt: "2026-06-11T00:00:00.000Z", total: 1,
  jobs: [{
    customId: "de#0", locale: "de",
    requests: [{ id: "0", key: "greeting", source: "Hello", sourceLocale: "en", targetLocale: "de", placeholders: [], sourceHash: "abc123abc123" }],
  }],
};

const second: PendingBatch = {
  ...pending,
  batchId: "msgbatch_456", createdAt: "2026-06-12T00:00:00.000Z",
  jobs: [{
    customId: "fr#0", locale: "fr",
    requests: [{ id: "0", key: "greeting", source: "Hello", sourceLocale: "en", targetLocale: "fr", placeholders: [], sourceHash: "abc123abc123" }],
  }],
};

describe("pending-batch", () => {
  it("round-trips through ./.glotfile/batches/<batchId>.json", () => {
    savePendingBatch(root, pending);
    expect(loadPendingBatch(root, pending.batchId)).toEqual(pending);
  });

  it("returns undefined when no batch is pending", () => {
    expect(loadPendingBatch(root, "msgbatch_123")).toBeUndefined();
    expect(listPendingBatches(root)).toEqual([]);
  });

  it("holds several batches at once, listed oldest first", () => {
    // Save newest first to prove the ordering comes from createdAt, not the dir.
    savePendingBatch(root, second);
    savePendingBatch(root, pending);
    expect(listPendingBatches(root).map((p) => p.batchId)).toEqual(["msgbatch_123", "msgbatch_456"]);
    expect(loadPendingBatch(root, second.batchId)).toEqual(second);
  });

  it("writes a self-ignoring .gitignore alongside", () => {
    savePendingBatch(root, pending);
    expect(readFileSync(join(root, ".glotfile", ".gitignore"), "utf8")).toBe("*\n");
  });

  it("clear removes only the named batch and is idempotent", () => {
    savePendingBatch(root, pending);
    savePendingBatch(root, second);
    clearPendingBatch(root, pending.batchId);
    expect(existsSync(pendingBatchPath(root, pending.batchId))).toBe(false);
    expect(listPendingBatches(root).map((p) => p.batchId)).toEqual([second.batchId]);
    clearPendingBatch(root, pending.batchId);
  });

  it("sanitizes provider batch ids for use as filenames", () => {
    const odd: PendingBatch = { ...pending, batchId: "msgbatch/../../evil?x" };
    savePendingBatch(root, odd);
    expect(existsSync(join(root, ".glotfile", "batches", "msgbatch-------evil-x.json"))).toBe(true);
    expect(loadPendingBatch(root, odd.batchId)).toEqual(odd);
  });

  it("skips a corrupt/truncated handle", () => {
    savePendingBatch(root, pending);
    writeFileSync(pendingBatchPath(root, second.batchId), "not valid json {{{");
    expect(loadPendingBatch(root, second.batchId)).toBeUndefined();
    expect(listPendingBatches(root).map((p) => p.batchId)).toEqual([pending.batchId]);
  });

  it("skips a wrong-version handle", () => {
    savePendingBatch(root, pending);
    writeFileSync(pendingBatchPath(root, pending.batchId), JSON.stringify({ version: 2 }) + "\n");
    expect(loadPendingBatch(root, pending.batchId)).toBeUndefined();
    expect(listPendingBatches(root)).toEqual([]);
  });

  it("ignores non-json files in the batches dir", () => {
    mkdirSync(join(root, ".glotfile", "batches"), { recursive: true });
    writeFileSync(join(root, ".glotfile", "batches", "README"), "hi");
    expect(listPendingBatches(root)).toEqual([]);
  });
});
