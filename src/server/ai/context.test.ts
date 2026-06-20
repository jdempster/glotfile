import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  selectContextTargets, extractSnippets, applyContext,
  buildContextSystemPrompt, buildContextBatchPrompt,
} from "./context.js";
import { defaultState } from "../schema.js";
import { createKey } from "../state.js";
import type { UsageCacheFile, Reference } from "../scan.js";
import type { ContextRequest } from "./context.js";

function tmpDir() {
  return mkdtempSync(join(tmpdir(), "glot-ctx-"));
}

function makeState(keys: Record<string, { context?: string; contextSource?: "ai"; createdAt?: string; source?: string }>) {
  const s = defaultState();
  for (const [k, opts] of Object.entries(keys)) {
    createKey(s, k, opts.source ?? "Hello");
    if (opts.context) s.keys[k]!.context = opts.context;
    if (opts.contextSource) s.keys[k]!.contextSource = opts.contextSource;
    if ("createdAt" in opts) {
      s.keys[k]!.createdAt = opts.createdAt;
    } else {
      delete s.keys[k]!.createdAt;
    }
  }
  return s;
}

const EMPTY_CACHE: UsageCacheFile = { version: 1, scannedAt: "2026-06-08T10:00:00.000Z", files: {} };

function cacheWithRefs(refs: Record<string, Reference[]>): UsageCacheFile {
  const files: UsageCacheFile["files"] = {};
  for (const [key, keyRefs] of Object.entries(refs)) {
    for (const ref of keyRefs) {
      const existing = files[ref.file] ?? { mtime: 1000, size: 200, refs: [], prefixes: [] };
      existing.refs.push({ key, ...ref });
      files[ref.file] = existing;
    }
  }
  return { version: 1, scannedAt: "2026-06-08T10:00:00.000Z", files };
}

// --- selectContextTargets ---

describe("selectContextTargets", () => {
  it("returns keys with no context", () => {
    const s = makeState({ "a.key": {}, "b.key": { context: "exists" } });
    const targets = selectContextTargets(s, {}, EMPTY_CACHE);
    expect(targets.map((t) => t.key)).toEqual(["a.key"]);
  });

  it("skips keys with human-authored context (no contextSource)", () => {
    const s = makeState({ k: { context: "Human wrote this" } });
    expect(selectContextTargets(s, {}, EMPTY_CACHE)).toHaveLength(0);
  });

  it("skips keys with prior AI-generated context", () => {
    const s = makeState({ k: { context: "AI wrote this", contextSource: "ai" } });
    expect(selectContextTargets(s, {}, EMPTY_CACHE)).toHaveLength(0);
  });

  it("force includes keys that already have context", () => {
    const s = makeState({ "a.key": {}, "b.key": { context: "exists" } });
    const targets = selectContextTargets(s, { all: true, force: true }, EMPTY_CACHE);
    expect(targets.map((t) => t.key)).toEqual(["a.key", "b.key"]);
  });

  it("applies keyGlob filter", () => {
    const s = makeState({ "auth.a": {}, "auth.b": {}, "checkout.x": {} });
    const targets = selectContextTargets(s, { keyGlob: "auth.*" }, EMPTY_CACHE);
    expect(targets.map((t) => t.key).sort()).toEqual(["auth.a", "auth.b"]);
  });

  it("restricts to an explicit keys set, still skipping keys that already have context", () => {
    const s = makeState({ "a.key": {}, "b.key": {}, "c.key": { context: "exists" } });
    const targets = selectContextTargets(s, { keys: ["a.key", "c.key"] }, EMPTY_CACHE);
    expect(targets.map((t) => t.key)).toEqual(["a.key"]);
  });

  it("applies limit, newest-first by createdAt", () => {
    const s = makeState({
      "k1": { createdAt: "2026-06-01T00:00:00Z" },
      "k2": { createdAt: "2026-06-03T00:00:00Z" },
      "k3": { createdAt: "2026-06-02T00:00:00Z" },
    });
    const targets = selectContextTargets(s, { limit: 2 }, EMPTY_CACHE);
    expect(targets.map((t) => t.key)).toEqual(["k2", "k3"]);
  });

  it("--all includes keys with no createdAt", () => {
    const s = makeState({ "k": {} });
    expect(selectContextTargets(s, { all: true }, EMPTY_CACHE)).toHaveLength(1);
  });

  it("without --all, keys with no createdAt are excluded when a cutoff applies", () => {
    const s = makeState({ "k": {} });
    const targets = selectContextTargets(s, {}, EMPTY_CACHE, "2026-06-01T00:00:00Z");
    expect(targets).toHaveLength(0);
  });

  it("applies since cutoff", () => {
    const s = makeState({
      "new": { createdAt: "2026-06-05T00:00:00Z" },
      "old": { createdAt: "2026-06-01T00:00:00Z" },
    });
    const targets = selectContextTargets(s, { since: "2026-06-04T00:00:00Z" }, EMPTY_CACHE);
    expect(targets.map((t) => t.key)).toEqual(["new"]);
  });
});

// --- extractSnippets ---

describe("extractSnippets", () => {
  it("extracts a ±15-line window around the call site", () => {
    const dir = tmpDir();
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`);
    writeFileSync(join(dir, "app.php"), lines.join("\n"));
    const refs: Reference[] = [{ key: "k", file: "app.php", line: 25, col: 1, scanner: "laravel" }];
    const cache = new Map<string, string[]>();
    const snippets = extractSnippets(refs, dir, cache);
    expect(snippets).toHaveLength(1);
    expect(snippets[0]!.startLine).toBe(10); // 25 - 15
    expect(snippets[0]!.lines).toContain("line 10");
    expect(snippets[0]!.lines).toContain("line 25");
    expect(snippets[0]!.lines).toContain("line 40");
  });

  it("clamps window to file bounds", () => {
    const dir = tmpDir();
    writeFileSync(join(dir, "app.php"), "only line");
    const refs: Reference[] = [{ key: "k", file: "app.php", line: 1, col: 1, scanner: "laravel" }];
    const cache = new Map<string, string[]>();
    const snippets = extractSnippets(refs, dir, cache);
    expect(snippets[0]!.startLine).toBe(1);
    expect(snippets[0]!.lines).toBe("only line");
  });

  it("caps at 3 call sites per key", () => {
    const dir = tmpDir();
    for (let i = 1; i <= 5; i++) {
      writeFileSync(join(dir, `file${i}.php`), Array.from({ length: 10 }, (_, j) => `f${i} line ${j + 1}`).join("\n"));
    }
    const refs: Reference[] = Array.from({ length: 5 }, (_, i) => ({
      key: "k", file: `file${i + 1}.php`, line: 5, col: 1, scanner: "laravel",
    }));
    const cache = new Map<string, string[]>();
    const snippets = extractSnippets(refs, dir, cache);
    expect(snippets).toHaveLength(3);
  });

  it("sorts refs by file path length (shortest first)", () => {
    const dir = tmpDir();
    mkdirSync(join(dir, "very", "deep", "nested"), { recursive: true });
    writeFileSync(join(dir, "a.php"), "short path line");
    writeFileSync(join(dir, "very", "deep", "nested", "b.php"), "deep path line");
    const refs: Reference[] = [
      { key: "k", file: "very/deep/nested/b.php", line: 1, col: 1, scanner: "laravel" },
      { key: "k", file: "a.php", line: 1, col: 1, scanner: "laravel" },
    ];
    const cache = new Map<string, string[]>();
    const snippets = extractSnippets(refs, dir, cache);
    expect(snippets[0]!.file).toBe("a.php");
  });

  it("skips files inside node_modules", () => {
    const dir = tmpDir();
    const refs: Reference[] = [{ key: "k", file: "node_modules/lib/foo.php", line: 1, col: 1, scanner: "laravel" }];
    const cache = new Map<string, string[]>();
    expect(extractSnippets(refs, dir, cache)).toHaveLength(0);
  });

  it("caches file reads — same file only read once across calls with the same map", () => {
    const dir = tmpDir();
    writeFileSync(join(dir, "a.php"), Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n"));
    const refs1: Reference[] = [{ key: "k1", file: "a.php", line: 10, col: 1, scanner: "laravel" }];
    const refs2: Reference[] = [{ key: "k2", file: "a.php", line: 20, col: 1, scanner: "laravel" }];
    const cache = new Map<string, string[]>();
    extractSnippets(refs1, dir, cache);
    extractSnippets(refs2, dir, cache);
    expect(cache.size).toBe(1);
  });

  it("returns empty array for refs with no matching files", () => {
    const dir = tmpDir();
    const refs: Reference[] = [{ key: "k", file: "nonexistent.php", line: 1, col: 1, scanner: "laravel" }];
    const cache = new Map<string, string[]>();
    expect(extractSnippets(refs, dir, cache)).toHaveLength(0);
  });

  it("records extraRefs count when more than 3 refs exist", () => {
    const dir = tmpDir();
    for (let i = 1; i <= 5; i++) writeFileSync(join(dir, `f${i}.php`), "line 1\nline 2\nline 3");
    const refs: Reference[] = Array.from({ length: 5 }, (_, i) => ({
      key: "k", file: `f${i + 1}.php`, line: 2, col: 1, scanner: "laravel",
    }));
    const cache = new Map<string, string[]>();
    const snippets = extractSnippets(refs, dir, cache);
    expect(snippets).toHaveLength(3);
    // The extraRefs field is on the first snippet to signal N more exist
    expect((snippets as (typeof snippets[0] & { extraRefs?: number })[]).some(s => s.extraRefs === 2)).toBe(true);
  });
});

// --- applyContext ---

describe("applyContext", () => {
  it("writes context and contextSource:'ai' when context is empty", () => {
    const s = makeState({ k: {} });
    const reqs: ContextRequest[] = [{ id: "0", key: "k", source: "Hello", usageSnippets: [] }];
    const results = [{ id: "0", context: "A greeting shown on the welcome screen." }];
    const { written } = applyContext(s, reqs, results);
    expect(written).toBe(1);
    expect(s.keys["k"]!.context).toBe("A greeting shown on the welcome screen.");
    expect(s.keys["k"]!.contextSource).toBe("ai");
  });

  it("does not overwrite human-authored context that appeared after selection", () => {
    const s = makeState({ k: { context: "Human wrote this after selection" } });
    const reqs: ContextRequest[] = [{ id: "0", key: "k", source: "Hello", usageSnippets: [] }];
    const results = [{ id: "0", context: "AI generated" }];
    const { written } = applyContext(s, reqs, results);
    expect(written).toBe(0);
    expect(s.keys["k"]!.context).toBe("Human wrote this after selection");
  });

  it("force overwrites existing context", () => {
    const s = makeState({ k: { context: "Old AI context", contextSource: "ai" } });
    const reqs: ContextRequest[] = [{ id: "0", key: "k", source: "Hello", usageSnippets: [] }];
    const results = [{ id: "0", context: "Fresh AI context" }];
    const { written } = applyContext(s, reqs, results, true);
    expect(written).toBe(1);
    expect(s.keys["k"]!.context).toBe("Fresh AI context");
    expect(s.keys["k"]!.contextSource).toBe("ai");
  });

  it("rejects an empty context string", () => {
    const s = makeState({ k: {} });
    const reqs: ContextRequest[] = [{ id: "0", key: "k", source: "Hello", usageSnippets: [] }];
    const { written, errors } = applyContext(s, reqs, [{ id: "0", context: "   " }]);
    expect(written).toBe(0);
    expect(errors[0]!.error).toMatch(/empty/i);
  });

  it("rejects a context string over 500 chars", () => {
    const s = makeState({ k: {} });
    const reqs: ContextRequest[] = [{ id: "0", key: "k", source: "Hello", usageSnippets: [] }];
    const { written, errors } = applyContext(s, reqs, [{ id: "0", context: "x".repeat(501) }]);
    expect(written).toBe(0);
    expect(errors[0]!.error).toMatch(/long/i);
  });

  it("returns an error for a missing model result", () => {
    const s = makeState({ k: {} });
    const reqs: ContextRequest[] = [{ id: "0", key: "k", source: "Hello", usageSnippets: [] }];
    const { errors } = applyContext(s, reqs, [{ id: "0", error: "model error" }]);
    expect(errors[0]!.error).toBe("model error");
  });
});

// --- buildContextSystemPrompt ---

describe("buildContextSystemPrompt", () => {
  it("mentions translator, UI, and code snippets", () => {
    const p = buildContextSystemPrompt();
    expect(p).toMatch(/translator/i);
    expect(p).toMatch(/code/i);
    expect(p).toMatch(/context/i);
  });

  it("guides the writer on literals: keep tokens verbatim, don't relabel or strip quotes", () => {
    const p = buildContextSystemPrompt();
    expect(p).toMatch(/literal/i);
    expect(p).toMatch(/exactly|verbatim/i);
    // the apostrophe-quoted form must be referenced so the writer doesn't strip it
    expect(p).toMatch(/'\{|apostrophe/i);
  });

  it("names the source language so the writer reasons about translation nuance", () => {
    const p = buildContextSystemPrompt({ sourceLocale: "en" });
    expect(p).toContain("en");
    // the note must flag distinctions the source omits but target languages need
    expect(p).toMatch(/formality|register|gender/i);
  });

  it("injects project context when provided", () => {
    const p = buildContextSystemPrompt({ projectContext: "Sprout is a houseplant-care app; 'feed' means fertilizer." });
    expect(p).toMatch(/project context/i);
    expect(p).toContain("'feed' means fertilizer");
  });
});

describe("buildContextBatchPrompt literals", () => {
  it("surfaces apostrophe-quoted literal tokens verbatim under a literals field", () => {
    const req = { id: "0", key: "tpl", source: "Dear '{{gardener}}', visit '{{site}}'.", usageSnippets: [] };
    const out = buildContextBatchPrompt([req]);
    expect(out).toMatch(/"literals"/);
    expect(out).toContain("'{{gardener}}'");
    expect(out).toContain("'{{site}}'");
  });

  it("omits the literals field when the source has no literal tokens", () => {
    const req = { id: "0", key: "btn", source: "Save {count} changes", usageSnippets: [] };
    const out = buildContextBatchPrompt([req]);
    expect(out).not.toMatch(/"literals"/);
  });
});
