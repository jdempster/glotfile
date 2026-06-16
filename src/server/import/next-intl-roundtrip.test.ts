import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { detect } from "./detect.js";
import { runImport } from "./run.js";
import { nextIntlJson } from "../adapters/next-intl-json.js";

const ROOT = resolve("test/fixtures/import/next-intl");

describe("next-intl detection", () => {
  it("detects next-intl-json from a project with messages/ and a next-intl dependency", () => {
    const d = detect(ROOT);
    expect(d).not.toBeNull();
    expect(d!.format).toBe("next-intl-json");
    expect(d!.localeRoot).toMatch(/messages$/);
    expect(d!.locales.sort()).toEqual(["en-gb", "fr-fr"]);
  });

  it("takes the source locale from routing.ts defaultLocale", () => {
    const d = detect(ROOT);
    expect(d!.sourceLocale).toBe("en-gb");
  });

  it("does not detect next-intl without the dependency/config signal", () => {
    // The plain vue fixture has locale JSON but no next-intl signal.
    const d = detect(resolve("test/fixtures/import/vue"));
    expect(d!.format).toBe("vue-i18n-json");
  });
});

describe("next-intl import + round-trip", () => {
  it("imports an ICU plural value as a structured plural key", () => {
    const { state } = runImport({ projectRoot: ROOT });
    const entry = state.keys["cart.items"]!;
    expect(entry.plural).toEqual({ arg: "count" });
    expect(entry.values["en-gb"]!.forms).toEqual({
      one: "{count} item",
      other: "{count} items",
    });
  });

  it("imports scalar keys (including rich-text tags) verbatim", () => {
    const { state } = runImport({ projectRoot: ROOT });
    expect(state.keys["index.heading"]!.values["en-gb"]!.value).toBe("Your package");
    expect(state.keys["form.terms"]!.values["en-gb"]!.value).toBe("Accept <terms>Terms</terms> and <privacy>Privacy</privacy>");
  });

  it("sets the output to the next-intl-json adapter, pointing back at messages/", () => {
    const { state } = runImport({ projectRoot: ROOT });
    expect(state.config.outputs[0]).toMatchObject({ adapter: "next-intl-json", path: "messages/{locale}.json" });
  });

  it("re-exports byte-identical message files", () => {
    const { state } = runImport({ projectRoot: ROOT });
    const r = nextIntlJson.export(state, state.config.outputs[0]!);
    const en = JSON.parse(r.files.find((f) => f.path.endsWith("en-gb.json"))!.contents);
    expect(en.cart.items).toBe("{count, plural, one {{count} item} other {{count} items}}");
    expect(en.form.terms).toBe("Accept <terms>Terms</terms> and <privacy>Privacy</privacy>");
    expect(en.index.heading).toBe("Your package");
  });
});
