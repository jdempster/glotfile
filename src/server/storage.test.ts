import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync as exists, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { splitDirFor, detectFormat, disassemble, assemble, loadSplit, saveSplit } from "./storage.js";
import { defaultState, validate } from "./schema.js";

describe("splitDirFor", () => {
  it("drops the trailing .json", () => {
    expect(splitDirFor("/x/glotfile.json")).toBe("/x/glotfile");
    expect(splitDirFor("/x/foo.glotfile.json")).toBe("/x/foo.glotfile");
  });
});

describe("detectFormat", () => {
  it("returns 'none' when nothing exists", () => {
    const p = join(mkdtempSync(join(tmpdir(), "glot-")), "glotfile.json");
    expect(detectFormat(p)).toBe("none");
  });
  it("returns 'single' when the file exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "glot-"));
    const p = join(dir, "glotfile.json");
    writeFileSync(p, "{}");
    expect(detectFormat(p)).toBe("single");
  });
  it("returns 'split' when the directory has config.json (even if the file also exists)", () => {
    const dir = mkdtempSync(join(tmpdir(), "glot-"));
    const p = join(dir, "glotfile.json");
    writeFileSync(p, "{}");
    mkdirSync(join(dir, "glotfile"));
    writeFileSync(join(dir, "glotfile", "config.json"), "{}");
    expect(detectFormat(p)).toBe("split");
  });
});

describe("disassemble/assemble", () => {
  function sample() {
    const s = defaultState();
    s.config.locales = ["en", "fr"];
    s.keys["a.key"] = {
      createdAt: "2026-01-01T00:00:00.000Z",
      tags: ["x"],
      values: {
        en: { value: "Hello", state: "source" },
        fr: { value: "Bonjour", state: "reviewed", source: "ai", updatedAt: "2026-01-02T00:00:00.000Z" },
      },
    };
    s.keys["b.only-en"] = { values: { en: { value: "Only", state: "source" } } };
    return s;
  }

  it("splits metadata into keys and values into per-locale buckets", () => {
    const parts = disassemble(sample());
    expect(parts.manifest).not.toHaveProperty("keys");
    expect(parts.keys["a.key"]).toEqual({ createdAt: "2026-01-01T00:00:00.000Z", tags: ["x"] });
    expect(parts.keys["a.key"]).not.toHaveProperty("values");
    expect(parts.locales["en"]["a.key"]).toEqual({ value: "Hello", state: "source" });
    expect(parts.locales["fr"]["a.key"].updatedAt).toBe("2026-01-02T00:00:00.000Z");
    // b.only-en has no fr value, so it never appears in the fr bucket.
    expect(parts.locales["fr"]["b.only-en"]).toBeUndefined();
  });

  it("round-trips through assemble (value-equivalent after validate)", () => {
    const s = sample();
    const rebuilt = validate(assemble(disassemble(s)));
    expect(rebuilt.keys).toEqual(s.keys);
    expect(rebuilt.config.locales).toEqual(s.config.locales);
  });
});

describe("saveSplit/loadSplit", () => {
  function sample() {
    const s = defaultState();
    s.config.locales = ["en", "fr"];
    s.config.storage = "split";
    s.keys["b.key"] = { values: { en: { value: "B", state: "source" }, fr: { value: "Bf", state: "reviewed" } } };
    s.keys["a.key"] = { values: { en: { value: "A", state: "source" } } };
    return s;
  }

  it("writes config.json, keys.json, and one file per locale with values present", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "glot-")), "glotfile");
    saveSplit(dir, sample());
    expect(exists(join(dir, "config.json"))).toBe(true);
    expect(exists(join(dir, "keys.json"))).toBe(true);
    expect(exists(join(dir, "locales", "en.json"))).toBe(true);
    expect(exists(join(dir, "locales", "fr.json"))).toBe(true);
    // keys.json holds metadata only; locale files hold values; keys are sorted.
    const en = readFileSync(join(dir, "locales", "en.json"), "utf8");
    expect(en.indexOf('"a.key"')).toBeLessThan(en.indexOf('"b.key"'));
    expect(JSON.parse(en)["a.key"]).toEqual({ value: "A", state: "source" });
  });

  it("round-trips: loadSplit(saveSplit(s)) validates back to s.keys", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "glot-")), "glotfile");
    const s = sample();
    saveSplit(dir, s);
    const rebuilt = validate(loadSplit(dir));
    expect(rebuilt.keys).toEqual(s.keys);
  });

  it("rewrites only the changed locale file (others byte-identical)", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "glot-")), "glotfile");
    const s = sample();
    saveSplit(dir, s);
    const enBefore = statSync(join(dir, "locales", "en.json")).mtimeMs;
    const enContent = readFileSync(join(dir, "locales", "en.json"), "utf8");
    // Change only the French value.
    s.keys["b.key"].values["fr"] = { value: "changed", state: "reviewed" };
    const res = saveSplit(dir, s);
    expect(readFileSync(join(dir, "locales", "en.json"), "utf8")).toBe(enContent);
    expect(statSync(join(dir, "locales", "en.json")).mtimeMs).toBe(enBefore);
    expect(res.written).toBe(1); // fr.json only
  });

  it("deletes an orphaned locale file when all its values are removed", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "glot-")), "glotfile");
    const s = sample();
    saveSplit(dir, s);
    expect(exists(join(dir, "locales", "fr.json"))).toBe(true);
    delete s.keys["b.key"].values["fr"]; // fr now has no values anywhere
    const res = saveSplit(dir, s);
    expect(exists(join(dir, "locales", "fr.json"))).toBe(false);
    expect(res.deleted).toBe(1);
  });
});
