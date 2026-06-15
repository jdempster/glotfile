import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPendingBatch, savePendingBatch, clearPendingBatch, pendingBatchPath, type PendingBatch } from "./pending-batch.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "glotfile-batch-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const pending: PendingBatch = {
  version: 1, provider: "anthropic", model: "claude-sonnet-4-6",
  batchId: "msgbatch_123", createdAt: "2026-06-11T00:00:00.000Z", total: 1,
  jobs: [{
    customId: "de#0", locale: "de",
    requests: [{ id: "0", key: "greeting", source: "Hello", sourceLocale: "en", targetLocale: "de", placeholders: [], sourceHash: "abc123abc123" }],
  }],
};

describe("pending-batch", () => {
  it("round-trips through ./.glotfile/batch.json", () => {
    savePendingBatch(root, pending);
    expect(loadPendingBatch(root)).toEqual(pending);
  });

  it("returns undefined when no batch is pending", () => {
    expect(loadPendingBatch(root)).toBeUndefined();
  });

  it("writes a self-ignoring .gitignore alongside", () => {
    savePendingBatch(root, pending);
    expect(readFileSync(join(root, ".glotfile", ".gitignore"), "utf8")).toBe("*\n");
  });

  it("clear removes the file and is idempotent", () => {
    savePendingBatch(root, pending);
    clearPendingBatch(root);
    expect(existsSync(join(root, ".glotfile", "batch.json"))).toBe(false);
    clearPendingBatch(root);
  });

  it("returns undefined when batch.json is corrupt/truncated", () => {
    mkdirSync(join(root, ".glotfile"), { recursive: true });
    writeFileSync(pendingBatchPath(root), "not valid json {{{");
    expect(loadPendingBatch(root)).toBeUndefined();
  });

  it("returns undefined when batch.json has wrong version", () => {
    savePendingBatch(root, pending);
    writeFileSync(pendingBatchPath(root), JSON.stringify({ version: 2 }) + "\n");
    expect(loadPendingBatch(root)).toBeUndefined();
  });
});
