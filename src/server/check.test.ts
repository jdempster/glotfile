import { describe, it, expect } from "vitest";
import { computeCheck } from "./check.js";
import { defaultState } from "./schema.js";
import { createKey } from "./state.js";
import { getAdapter } from "./adapters/index.js";

describe("computeCheck", () => {
  it("reports drift when on-disk output is missing", () => {
    const s = defaultState();
    s.config.outputs = [{ adapter: "flutter-arb", path: "lib/l10n/app_{locale}.arb" }];
    createKey(s, "welcome", "Welcome");
    const summary = computeCheck(s, () => null, false);
    expect(summary.ok).toBe(false);
    expect(summary.drift.length).toBeGreaterThan(0);
  });

  it("is ok when on-disk content matches generated output", () => {
    const s = defaultState();
    s.config.outputs = [{ adapter: "flutter-arb", path: "lib/l10n/app_{locale}.arb" }];
    createKey(s, "welcome", "Welcome");
    const r = getAdapter("flutter-arb").export(s, s.config.outputs[0]!);
    const onDisk = new Map(r.files.map((f) => [f.path, f.contents]));
    const summary = computeCheck(s, (rel) => onDisk.get(rel) ?? null, false);
    expect(summary.ok).toBe(true);
    expect(summary.drift).toEqual([]);
  });

  it("strict mode fails on a lossy warning even without drift", () => {
    const s = defaultState();
    s.config.outputs = [{ adapter: "laravel-php", path: "lang/{locale}/{namespace}.php" }];
    createKey(s, "items.count", "{count, plural, one {# item} other {# items}}");
    const r = getAdapter("laravel-php").export(s, s.config.outputs[0]!);
    const onDisk = new Map(r.files.map((f) => [f.path, f.contents]));
    const summary = computeCheck(s, (rel) => onDisk.get(rel) ?? null, true);
    expect(summary.ok).toBe(false);
    expect(summary.warnings.some((w) => w.code === "lossy-plural")).toBe(true);
  });

  it("non-strict mode tolerates a lossy warning when there is no drift", () => {
    const s = defaultState();
    s.config.outputs = [{ adapter: "laravel-php", path: "lang/{locale}/{namespace}.php" }];
    createKey(s, "items.count", "{count, plural, one {# item} other {# items}}");
    const r = getAdapter("laravel-php").export(s, s.config.outputs[0]!);
    const onDisk = new Map(r.files.map((f) => [f.path, f.contents]));
    const summary = computeCheck(s, (rel) => onDisk.get(rel) ?? null, false);
    expect(summary.ok).toBe(true);
  });
});
