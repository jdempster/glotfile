import { describe, it, expect } from "vitest";
import { resolve, join, dirname } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { appleStrings } from "./apple-strings.js";
import { appleStrings as adapter } from "../../adapters/apple-strings.js";
import { defaultState } from "../../schema.js";
import { createKey } from "../../state.js";

const FIXTURE = resolve("test/fixtures/import/apple");

describe("appleStrings parser", () => {
  it("reads every <locale>.lproj/Localizable.strings table", () => {
    const r = appleStrings.parse(FIXTURE);
    expect(r.locales.sort()).toEqual(["en", "fr", "zh-Hans"]);
    expect(r.keys["Tap to start"]?.values["en"]).toBe("Tap to start");
    expect(r.keys["Tap to start"]?.values["fr"]).toBe("Appuyez pour commencer");
    expect(r.keys["Tap to start"]?.values["zh-Hans"]).toBe("点击开始");
  });

  it("strips comments and unescapes quotes and \\n", () => {
    const r = appleStrings.parse(FIXTURE);
    expect(r.keys['Quotes "here"']?.values["en"]).toBe('Quotes "here"');
    expect(r.keys["Multi line"]?.values["en"]).toBe("Line one\nLine two");
  });

  it("filters locales when opts.locales is given", () => {
    const r = appleStrings.parse(FIXTURE, { locales: ["en"] });
    expect(r.locales).toEqual(["en"]);
    expect(r.keys["Tap to start"]?.values["fr"]).toBeUndefined();
  });

  it("round-trips a literal brace span and a literal % through export/import", () => {
    const s = defaultState();
    s.config.locales = ["en"];
    createKey(s, "promo", "See '{site}' for 50% off");

    const exported = adapter.export(s, { adapter: "apple-strings", path: "{locale}.lproj/Localizable.strings" });
    const tmp = mkdtempSync(join(tmpdir(), "glotfile-apple-lit-"));
    try {
      for (const f of exported.files) {
        mkdirSync(dirname(join(tmp, f.path)), { recursive: true });
        writeFileSync(join(tmp, f.path), f.contents);
      }
      const r = appleStrings.parse(tmp);
      // %% is restored to a literal %; the literal {site} returns as plain text
      // (apple .strings never interpreted the braces).
      expect(r.keys["promo"]?.values["en"]).toBe("See {site} for 50% off");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("skips a malformed entry and keeps reading valid pairs after it", () => {
    const tmp = mkdtempSync(join(tmpdir(), "glotfile-apple-"));
    try {
      mkdirSync(join(tmp, "en.lproj"));
      // The middle entry is missing its '='; the entry after it must still parse.
      writeFileSync(
        join(tmp, "en.lproj", "Localizable.strings"),
        '"a" = "A";\n"b" "B";\n"c" = "C";\n',
      );
      const r = appleStrings.parse(tmp);
      expect(r.keys["a"]?.values["en"]).toBe("A");
      expect(r.keys["c"]?.values["en"]).toBe("C");
      expect(r.warnings.length).toBeGreaterThan(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
