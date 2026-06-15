import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { angularXliff } from "./angular-xliff.js";

const ROOT = resolve("test/fixtures/import/angular-xliff/src/locale");

describe("angular-xliff parser", () => {
  const result = angularXliff.parse(ROOT);

  it("reads the source locale from the source-language attribute and targets from filenames", () => {
    expect(result.locales).toContain("en-US");
    expect(result.locales).toContain("es");
  });

  it("imports plain source strings and their targets", () => {
    const key = result.keys["01d37830d7001a7739c544c7570df79399d1dc31"]!;
    expect(key.values["en-US"]).toBe("Your apps");
    expect(key.values["es"]).toBe("Tus aplicaciones");
  });

  it("converts simple {{ name }} interpolations to {name} tokens without metadata", () => {
    const key = result.keys["welcomehash00000000000000000000000000000"]!;
    expect(key.values["en-US"]).toBe("Welcome {name}!");
    expect(key.values["es"]).toBe("¡Bienvenido {name}!");
    expect(key.placeholders).toBeUndefined();
  });

  it("converts markup placeholders to id-named tokens and records ctype/equiv-text", () => {
    const key = result.keys["boldhash00000000000000000000000000000000"]!;
    expect(key.values["en-US"]).toBe("{START_TAG_STRONG}Bold{CLOSE_TAG_STRONG} move");
    expect(key.placeholders).toEqual({
      START_TAG_STRONG: { type: "x-strong", example: "<strong>" },
      CLOSE_TAG_STRONG: { type: "x-strong", example: "</strong>" },
    });
  });

  it("keeps expression interpolations as id-named tokens with the expression as example", () => {
    const key = result.keys["exprhash00000000000000000000000000000000"]!;
    expect(key.values["en-US"]).toBe("Made by {INTERPOLATION}");
    expect(key.placeholders).toEqual({ INTERPOLATION: { example: "APP_TITLE" } });
  });

  it("marks a lowercase named <x/> placeholder with origin so export reproduces its id", () => {
    // A user-named $localize placeholder (`${only.displayName}:displayName:`) has
    // a lowercase id that escapes the SCREAMING_SNAKE convention. It must be tagged
    // origin:"x" or export can't tell it from an ARB {displayName} and emits the
    // wrong (INTERPOLATION) id — the placeholder mismatch that breaks ng build.
    const dir = mkdtempSync(join(tmpdir(), "glotfile-ngx-"));
    writeFileSync(
      join(dir, "messages.xlf"),
      `<?xml version="1.0" encoding="UTF-8" ?>
<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">
  <file source-language="en-US" datatype="plaintext" original="ng2.template">
    <body>
      <trans-unit id="addBtn" datatype="html">
        <source>Add <x id="displayName" equiv-text="only.displayName"/></source>
      </trans-unit>
    </body>
  </file>
</xliff>`,
    );
    const { keys } = angularXliff.parse(dir);
    expect(keys["addBtn"]!.values["en-US"]).toBe("Add {displayName}");
    expect(keys["addBtn"]!.placeholders).toEqual({ displayName: { origin: "x", example: "only.displayName" } });
  });

  it("decodes XML entities in text", () => {
    const key = result.keys["entityhash0000000000000000000000000000000"]!;
    expect(key.values["en-US"]).toBe("Fish & chips <tasty>");
  });

  it("handles attribute-less placeholders like <x id=\"PH\" />", () => {
    const key = result.keys["bareph0000000000000000000000000000000000"]!;
    expect(key.values["en-US"]).toBe("Count: {PH}");
    expect(key.placeholders).toEqual({ PH: {} });
  });

  it("passes ICU plural text through with inner placeholders converted", () => {
    const key = result.keys["pluralhash000000000000000000000000000000"]!;
    expect(key.values["en-US"]).toBe(
      "{VAR_PLURAL, plural, =0 {no items} one {one item} other {{count} items}}",
    );
    expect(key.values["es"]).toBe(
      "{VAR_PLURAL, plural, =0 {ningún elemento} one {un elemento} other {{count} elementos}}",
    );
  });

  it("keeps units that only exist in a translation file, using its <source> for the source locale", () => {
    const key = result.keys["staleonlyines000000000000000000000000000"]!;
    expect(key.values["en-US"]).toBe("Old string no longer extracted");
    expect(key.values["es"]).toBe("Cadena antigua");
  });

  it("ignores state=\"new\" targets — they're untranslated pre-fill, not translations", () => {
    const key = result.keys["statenewtarget00000000000000000000000000"]!;
    expect(key.values["en-US"]).toBe("Pending translation");
    expect(key.values["es"]).toBeUndefined();
  });

  it("skips empty targets so the locale stays missing (translatable later)", () => {
    const key = result.keys["emptytarget00000000000000000000000000000"]!;
    expect(key.values["en-US"]).toBe("Untranslated yet");
    expect(key.values["es"]).toBeUndefined();
  });

  it("harvests a single source location from the context-group", () => {
    const key = result.keys["01d37830d7001a7739c544c7570df79399d1dc31"]!;
    expect(key.locations).toEqual([
      { file: "src/app/components/app-switcher/app-switcher.component.html", line: 14 },
    ]);
  });

  it("harvests multiple locations per unit", () => {
    const key = result.keys["multiloc0000000000000000000000000000000"]!;
    expect(key.locations).toEqual([
      { file: "src/app/a.component.html", line: 3 },
      { file: "src/app/b.component.html", line: 9 },
    ]);
  });

  it("leaves locations undefined for units without a location context-group", () => {
    expect(result.keys["welcomehash00000000000000000000000000000"]!.locations).toBeUndefined();
  });

  it("honours the locales filter", () => {
    const onlySource = angularXliff.parse(ROOT, { locales: ["en-US"] });
    expect(onlySource.locales).toEqual(["en-US"]);
    expect(onlySource.keys["01d37830d7001a7739c544c7570df79399d1dc31"]!.values["es"]).toBeUndefined();
  });
});
