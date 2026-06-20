import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { usageReadTools } from "./read-usage.js";
import { saveUsageCache } from "../../scan.js";
import type { UsageCacheFile } from "../../scan.js";
import { defaultState } from "../../schema.js";
import type { ChatTool, ToolContext } from "../chat-types.js";

const tool = (name: string): ChatTool => {
  const t = usageReadTools.find((x) => x.def.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
};

type Result = {
  indexed: boolean;
  key: string;
  count: number;
  refs: { file: string; line: number; col: number; scanner: string }[];
  refsTruncated: boolean;
  snippets: { file: string; startLine: number; lines: string; scanner: string }[];
  prefixCount: number;
  prefixRefs: { file: string; prefix: string }[];
  literalCount: number;
  literalRefs: { file: string; literal: string }[];
};

let root: string;
let ctx: ToolContext;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "glot-usage-"));
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(
    join(root, "src", "Plant.vue"),
    Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n") + "\n",
  );
  ctx = { projectRoot: root, statePath: "", load: () => defaultState(), persist: () => {}, provider: null as never };
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const seed = (cache: Omit<UsageCacheFile, "version" | "scannedAt">) =>
  saveUsageCache(root, { version: 1, scannedAt: "2026-06-20T00:00:00.000Z", ...cache });

describe("read_key_usage", () => {
  it("returns indexed:false when no scan cache exists", async () => {
    const res = (await tool("read_key_usage").run({ key: "plant.feed" }, ctx)) as Result;
    expect(res.indexed).toBe(false);
    expect(res.count).toBe(0);
    expect(res.refs).toEqual([]);
    expect(res.snippets).toEqual([]);
  });

  it("returns direct refs with a code snippet around the call site", async () => {
    seed({
      files: {
        "src/Plant.vue": {
          mtime: 1, size: 1,
          refs: [{ key: "plant.feed", line: 15, col: 4, scanner: "vue-i18n" }],
          prefixes: [],
        },
      },
    });
    const res = (await tool("read_key_usage").run({ key: "plant.feed" }, ctx)) as Result;
    expect(res.indexed).toBe(true);
    expect(res.count).toBe(1);
    expect(res.refs).toEqual([{ file: "src/Plant.vue", line: 15, col: 4, scanner: "vue-i18n" }]);
    expect(res.snippets).toHaveLength(1);
    // ±15-line window around line 15, clamped to file bounds.
    expect(res.snippets[0]!.file).toBe("src/Plant.vue");
    expect(res.snippets[0]!.lines).toContain("line 15");
  });

  it("does not match a different key", async () => {
    seed({
      files: {
        "src/Plant.vue": {
          mtime: 1, size: 1,
          refs: [{ key: "plant.water", line: 15, col: 4, scanner: "vue-i18n" }],
          prefixes: [],
        },
      },
    });
    const res = (await tool("read_key_usage").run({ key: "plant.feed" }, ctx)) as Result;
    expect(res.count).toBe(0);
    expect(res.snippets).toEqual([]);
  });

  it("reports dynamic-prefix matches as indirect evidence", async () => {
    seed({
      files: {
        "src/Plant.vue": {
          mtime: 1, size: 1,
          refs: [],
          prefixes: [{ prefix: "plant.", line: 8, col: 2, scanner: "vue-i18n" }],
        },
      },
    });
    const res = (await tool("read_key_usage").run({ key: "plant.feed" }, ctx)) as Result;
    expect(res.count).toBe(0);
    expect(res.prefixCount).toBe(1);
    expect(res.prefixRefs[0]).toMatchObject({ file: "src/Plant.vue", prefix: "plant." });
  });

  it("reports key-shaped literals but drops one already on a direct-ref line", async () => {
    seed({
      files: {
        "src/Plant.vue": {
          mtime: 1, size: 1,
          refs: [{ key: "plant.feed", line: 15, col: 4, scanner: "vue-i18n" }],
          prefixes: [],
          literals: [
            { literal: "plant.feed", line: 15, col: 4 },
            { literal: "plant.feed", line: 22, col: 6 },
          ],
        },
      },
    });
    const res = (await tool("read_key_usage").run({ key: "plant.feed" }, ctx)) as Result;
    expect(res.count).toBe(1);
    expect(res.literalCount).toBe(1);
    expect(res.literalRefs[0]).toMatchObject({ line: 22, literal: "plant.feed" });
  });

  it("caps the flat refs list at 50 and flags truncation (snippets stay capped)", async () => {
    const refs = Array.from({ length: 60 }, (_, i) => ({ key: "plant.feed", line: i + 1, col: 1, scanner: "vue-i18n" }));
    seed({ files: { "src/Plant.vue": { mtime: 1, size: 1, refs, prefixes: [] } } });
    const res = (await tool("read_key_usage").run({ key: "plant.feed" }, ctx)) as Result;
    expect(res.count).toBe(60);
    expect(res.refs).toHaveLength(50);
    expect(res.refsTruncated).toBe(true);
    // extractSnippets caps independently at 3.
    expect(res.snippets.length).toBeLessThanOrEqual(3);
  });
});
