import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runImport, runSync } from "./run.js";
import { saveState, createKey, setPluralForms, setSourcePluralForms } from "../state.js";
import type { KeyEntry, State } from "../schema.js";

function xlf(units: { id: string; source: string; loc?: string }[]): string {
  const body = units
    .map(
      (u) =>
        `      <trans-unit id="${u.id}" datatype="html">\n` +
        `        <source>${u.source}</source>` +
        (u.loc
          ? `\n        <context-group purpose="location">\n` +
            `          <context context-type="sourcefile">${u.loc}</context>\n` +
            `          <context context-type="linenumber">1</context>\n` +
            `        </context-group>`
          : "") +
        `\n      </trans-unit>`,
    )
    .join("\n");
  return (
    `<?xml version="1.0" encoding="UTF-8" ?>\n` +
    `<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">\n` +
    `  <file source-language="en" datatype="plaintext" original="ng2.template">\n` +
    `    <body>\n${body}\n    </body>\n  </file>\n</xliff>\n`
  );
}

function setup() {
  const root = mkdtempSync(join(tmpdir(), "glot-sync-"));
  const localeDir = join(root, "src", "locale");
  mkdirSync(localeDir, { recursive: true });
  return { root, msgs: join(localeDir, "messages.xlf"), statePath: join(root, "glotfile.json") };
}

describe("runSync", () => {
  it("merges new/changed/removed keys while preserving glotfile-owned data", () => {
    const { root, msgs, statePath } = setup();
    writeFileSync(
      msgs,
      xlf([
        { id: "keep", source: "Keep me", loc: "src/a.component.html" },
        { id: "change", source: "Original" },
        { id: "remove", source: "Delete me" },
      ]),
    );

    // Seed the existing catalog via import, then add glotfile-owned data.
    const imported = runImport({ projectRoot: root });
    imported.state.config.locales = ["en", "fr"];
    imported.state.glossary = [{ term: "Glotfile", doNotTranslate: true }] as unknown as typeof imported.state.glossary;
    imported.state.keys.keep!.context = "AI context";
    (imported.state.keys.change as KeyEntry).values.fr = { value: "Originale", state: "reviewed" };
    saveState(statePath, imported.state);

    // Re-extract: source of "change" edited, "added" appears, "remove" gone.
    writeFileSync(
      msgs,
      xlf([
        { id: "keep", source: "Keep me", loc: "src/a.component.html" },
        { id: "change", source: "Updated" },
        { id: "added", source: "New string" },
      ]),
    );

    const { state, plan } = runSync({ projectRoot: root, statePath, prune: false });

    expect(plan.added).toEqual(["added"]);
    expect(plan.sourceChanged).toEqual(["change"]);
    expect(plan.removed).toEqual(["remove"]);

    // Preserved glotfile-owned data.
    expect(state.glossary).toHaveLength(1);
    expect(state.keys.keep!.context).toBe("AI context");

    // Changed source bumped, translation kept but flagged.
    expect(state.keys.change!.values.en!.value).toBe("Updated");
    expect(state.keys.change!.values.fr).toMatchObject({ value: "Originale", state: "needs-review" });

    // Removed key retained without prune.
    expect(state.keys.remove).toBeDefined();
  });

  it("flags a source-deleted key as removed even though a stale es export still lists it", () => {
    const { root, msgs, statePath } = setup();
    const esFile = join(root, "src", "locale", "messages.es.xlf");
    const esXlf = (units: { id: string; source: string; target: string }[]) =>
      `<?xml version="1.0" encoding="UTF-8" ?>\n` +
      `<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">\n` +
      `  <file source-language="en" target-language="es" datatype="plaintext" original="ng2.template">\n` +
      `    <body>\n` +
      units
        .map(
          (u) =>
            `      <trans-unit id="${u.id}" datatype="html"><source>${u.source}</source>` +
            `<target>${u.target}</target></trans-unit>`,
        )
        .join("\n") +
      `\n    </body>\n  </file>\n</xliff>\n`;

    // Source + a glotfile-owned es export, both with "a" and "old".
    writeFileSync(msgs, xlf([{ id: "a", source: "A" }, { id: "old", source: "Old" }]));
    writeFileSync(esFile, esXlf([{ id: "a", source: "A", target: "Ae" }, { id: "old", source: "Old", target: "Olde" }]));
    saveState(statePath, runImport({ projectRoot: root }).state);

    // Re-extract drops "old" from the SOURCE, but the es export still lists it.
    writeFileSync(msgs, xlf([{ id: "a", source: "A" }]));

    const { state, plan } = runSync({ projectRoot: root, statePath, prune: true });
    expect(plan.removed).toEqual(["old"]);
    expect(state.keys.old).toBeUndefined();
    expect(state.keys.a).toBeDefined();
  });

  it("deletes removed keys when prune is set", () => {
    const { root, msgs, statePath } = setup();
    writeFileSync(msgs, xlf([{ id: "a", source: "A" }, { id: "old", source: "Old" }]));
    saveState(statePath, runImport({ projectRoot: root }).state);
    writeFileSync(msgs, xlf([{ id: "a", source: "A" }]));

    const { state, plan } = runSync({ projectRoot: root, statePath, prune: true });
    expect(plan.removed).toEqual(["old"]);
    expect(state.keys.old).toBeUndefined();
  });

  // vue-i18n serializes plural forms as a positional "a | b" string with no
  // in-file marker, so the parser reads them back as scalars. Resync must not let
  // that shape-flip a catalog plural into a scalar and drop its translations.
  it("keeps a vue-i18n plural on resync instead of collapsing it to a scalar", () => {
    const { root, statePath } = setup();
    const localeDir = join(root, "src", "locale");

    const state: State = {
      version: 1,
      config: {
        sourceLocale: "en",
        locales: ["en", "fr"],
        outputs: [{ adapter: "vue-i18n-json", path: "src/locale/{locale}.json" }],
        format: { indent: 2, sortKeys: true, finalNewline: true },
      },
      glossary: [],
      glossarySuggestions: [],
      keys: {},
    } as unknown as State;
    createKey(state, "greeting", "Hello");
    createKey(state, "cart.items", "{count} items", () => "2026-01-01T00:00:00.000Z", { plural: { arg: "count" } });
    setSourcePluralForms(state, "cart.items", { one: "{count} item", other: "{count} items" });
    setPluralForms(state, "cart.items", "fr", { one: "{count} article", other: "{count} articles" });
    saveState(statePath, state);

    // The on-disk vue files, exactly as the adapter serializes plurals.
    writeFileSync(
      join(localeDir, "en.json"),
      JSON.stringify({ greeting: "Hello", cart: { items: "{count} item | {count} items" } }, null, 2),
    );
    writeFileSync(
      join(localeDir, "fr.json"),
      JSON.stringify({ greeting: "Bonjour", cart: { items: "{count} article | {count} articles" } }, null, 2),
    );

    const { state: synced, plan } = runSync({ projectRoot: root, statePath, format: "vue-i18n-json" });

    expect(plan.removed).not.toContain("cart.items");
    expect(plan.sourceChanged).not.toContain("cart.items");
    expect(synced.keys["cart.items"]!.plural).toEqual({ arg: "count" });
    expect(synced.keys["cart.items"]!.values.en!.forms).toEqual({ one: "{count} item", other: "{count} items" });
    expect(synced.keys["cart.items"]!.values.en!.value).toBeUndefined();
    expect(synced.keys["cart.items"]!.values.fr!.forms).toEqual({ one: "{count} article", other: "{count} articles" });
  });
});
