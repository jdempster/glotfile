import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { nextIntlJson } from "./next-intl-json.js";

function tmpDir() {
  return mkdtempSync(join(tmpdir(), "glot-next-intl-"));
}

describe("next-intl-json parser", () => {
  it("flattens nested messages into dotted keys, preserving {name} verbatim", () => {
    const dir = tmpDir();
    writeFileSync(join(dir, "en.json"), JSON.stringify({ index: { heading: "Your package" }, form: { labels: { email: "Email {name}" } } }));
    const r = nextIntlJson.parse(dir);
    expect(r.locales).toEqual(["en"]);
    expect(r.keys["index.heading"]!.values.en).toBe("Your package");
    expect(r.keys["form.labels.email"]!.values.en).toBe("Email {name}");
  });

  it("preserves an ICU plural string verbatim (plural detection happens in assemble)", () => {
    const dir = tmpDir();
    writeFileSync(join(dir, "en.json"), JSON.stringify({ cart: { items: "{count, plural, one {{count} item} other {{count} items}}" } }));
    const r = nextIntlJson.parse(dir);
    expect(r.keys["cart.items"]!.values.en).toBe("{count, plural, one {{count} item} other {{count} items}}");
  });

  it("preserves rich-text <tag> markup verbatim", () => {
    const dir = tmpDir();
    writeFileSync(join(dir, "en.json"), JSON.stringify({ terms: "Accept <terms>Terms</terms>" }));
    const r = nextIntlJson.parse(dir);
    expect(r.keys["terms"]!.values.en).toBe("Accept <terms>Terms</terms>");
  });

  it("reads several locales and ignores non-locale json files", () => {
    const dir = tmpDir();
    writeFileSync(join(dir, "en-gb.json"), JSON.stringify({ a: "A" }));
    writeFileSync(join(dir, "fr-fr.json"), JSON.stringify({ a: "A-fr" }));
    writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: {} }));
    const r = nextIntlJson.parse(dir);
    expect(r.locales.sort()).toEqual(["en-gb", "fr-fr"]);
    expect(r.keys["a"]!.values["en-gb"]).toBe("A");
    expect(r.keys["a"]!.values["fr-fr"]).toBe("A-fr");
  });
});
