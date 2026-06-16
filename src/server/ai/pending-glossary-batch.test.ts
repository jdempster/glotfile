import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { savePendingGlossaryBatch, loadPendingGlossaryBatch, clearPendingGlossaryBatch, type PendingGlossaryBatch } from "./pending-glossary-batch.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "glotfile-gbatch-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const sample: PendingGlossaryBatch = {
  version: 1, provider: "anthropic", model: "claude-x", batchId: "msgbatch_g", createdAt: "2026-01-01T00:00:00Z",
  total: 2, jobs: [{ customId: "gloss_0", requests: [{ key: "a", source: "Sign in to Acme" }] }],
  knownTerms: ["Widget"],
};

describe("pending glossary batch", () => {
  it("round-trips save/load/clear", () => {
    expect(loadPendingGlossaryBatch(root)).toBeUndefined();
    savePendingGlossaryBatch(root, sample);
    expect(loadPendingGlossaryBatch(root)).toEqual(sample);
    clearPendingGlossaryBatch(root);
    expect(loadPendingGlossaryBatch(root)).toBeUndefined();
  });
  it("ignores a wrong version", () => {
    savePendingGlossaryBatch(root, { ...sample, version: 2 as 1 });
    expect(loadPendingGlossaryBatch(root)).toBeUndefined();
  });
});
