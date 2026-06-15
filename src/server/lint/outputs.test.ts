import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { checkOutputs } from "./outputs.js";
import { getAdapter } from "../adapters/index.js";
import type { State } from "../schema.js";

function state(): State {
  return {
    version: 1,
    config: {
      sourceLocale: "en", locales: ["en"],
      outputs: [{ adapter: "flutter-arb", path: "app_{locale}.arb" }],
      format: { indent: 2, sortKeys: true, finalNewline: true },
    },
    glossary: [],
    keys: { "a": { values: { en: { value: "Hi", state: "source" } } } },
  };
}

let root: string;
beforeEach(() => { root = mkdtempSync(resolve(tmpdir(), "glot-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe("checkOutputs", () => {
  it("flags a missing output file", () => {
    const f = checkOutputs(state(), root);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ ruleId: "output-stale", severity: "error" });
    expect(f[0]!.message).toMatch(/missing/);
  });
  it("passes when the on-disk file matches a fresh export", () => {
    const s = state();
    for (const out of getAdapter("flutter-arb").export(s, s.config.outputs[0]!).files) {
      const abs = resolve(root, out.path);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, out.contents, "utf8");
    }
    expect(checkOutputs(s, root)).toEqual([]);
  });
  it("flags a stale file", () => {
    const s = state();
    const out = getAdapter("flutter-arb").export(s, s.config.outputs[0]!).files[0]!;
    writeFileSync(resolve(root, out.path), "stale contents", "utf8");
    const f = checkOutputs(s, root);
    expect(f[0]!.message).toMatch(/out of date/);
  });
});
