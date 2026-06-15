import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildLocationUsageCache, refreshLocationUsage, isLocationScannedState, usageCounts } from "./usage.js";
import { CACHE_VERSION } from "../scanner.js";
import type { ParseResult } from "./types.js";
import type { State } from "../schema.js";

const tmp = () => mkdtempSync(join(tmpdir(), "glot-usage-"));

function stateWith(adapter: string): State {
  return {
    version: 1,
    config: { sourceLocale: "en", locales: ["en"], outputs: [{ adapter, path: "x" }] },
    glossary: [],
    keys: {},
  } as unknown as State;
}

describe("isLocationScannedState", () => {
  it("is true when an output uses angular-xliff", () => {
    expect(isLocationScannedState(stateWith("angular-xliff"))).toBe(true);
  });
  it("is false for other adapters", () => {
    expect(isLocationScannedState(stateWith("laravel-php"))).toBe(false);
  });
});

describe("buildLocationUsageCache", () => {
  const parsed: ParseResult = {
    locales: ["en"],
    warnings: [],
    keys: {
      a: { values: { en: "A" }, locations: [{ file: "src/a.html", line: 3 }, { file: "src/b.html", line: 9 }] },
      b: { values: { en: "B" }, locations: [{ file: "src/a.html", line: 12 }] },
      c: { values: { en: "C" } },
    },
  };

  it("groups refs by file with the angular-xliff scanner tag", () => {
    const cache = buildLocationUsageCache(parsed);
    expect(cache.version).toBe(CACHE_VERSION);
    expect(Object.keys(cache.files).sort()).toEqual(["src/a.html", "src/b.html"]);
    expect(cache.files["src/a.html"]!.refs).toEqual([
      { key: "a", line: 3, col: 1, scanner: "angular-xliff" },
      { key: "b", line: 12, col: 1, scanner: "angular-xliff" },
    ]);
    expect(cache.files["src/b.html"]!.refs).toEqual([
      { key: "a", line: 9, col: 1, scanner: "angular-xliff" },
    ]);
  });

  it("omits keys with no locations", () => {
    const cache = buildLocationUsageCache(parsed);
    const allKeys = Object.values(cache.files).flatMap((f) => f.refs.map((r) => r.key));
    expect(allKeys).not.toContain("c");
  });
});

describe("refreshLocationUsage", () => {
  it("writes .glotfile/usage.json from a detected Angular catalog", () => {
    const root = tmp();
    mkdirSync(join(root, "src", "locale"), { recursive: true });
    writeFileSync(
      join(root, "src", "locale", "messages.xlf"),
      `<?xml version="1.0" encoding="UTF-8" ?>
<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">
  <file source-language="en" datatype="plaintext" original="ng2.template">
    <body>
      <trans-unit id="k1" datatype="html">
        <source>Hello</source>
        <context-group purpose="location">
          <context context-type="sourcefile">src/app/x.component.html</context>
          <context context-type="linenumber">7</context>
        </context-group>
      </trans-unit>
    </body>
  </file>
</xliff>
`,
    );
    const result = refreshLocationUsage(root);
    expect(result).not.toBeNull();
    expect(usageCounts(result!).refs).toBe(1);
    const cachePath = join(root, ".glotfile", "usage.json");
    expect(existsSync(cachePath)).toBe(true);
    const cache = JSON.parse(readFileSync(cachePath, "utf8"));
    expect(cache.files["src/app/x.component.html"].refs[0]).toMatchObject({ key: "k1", line: 7, scanner: "angular-xliff" });
  });

  it("returns null when nothing is detected", () => {
    expect(refreshLocationUsage(tmp())).toBeNull();
  });

  it("usageCounts totals files and refs", () => {
    const cache = buildLocationUsageCache({
      locales: ["en"],
      warnings: [],
      keys: {
        a: { values: { en: "A" }, locations: [{ file: "x", line: 1 }, { file: "y", line: 2 }] },
        b: { values: { en: "B" }, locations: [{ file: "x", line: 5 }] },
      },
    });
    expect(usageCounts(cache)).toEqual({ files: 2, refs: 3 });
  });
});
