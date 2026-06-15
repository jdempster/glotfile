import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runImport } from "./run.js";
import { getAdapter } from "../adapters/index.js";

describe("import -> export locale round-trip", () => {
  it("reproduces underscore-region ARB filenames", () => {
    const root = mkdtempSync(join(tmpdir(), "glot-rt-"));
    try {
      const l10n = join(root, "lib", "l10n");
      mkdirSync(l10n, { recursive: true });
      writeFileSync(join(l10n, "app_en_US.arb"), JSON.stringify({ "@@locale": "en_US", greeting: "Hello" }, null, 2));
      writeFileSync(join(l10n, "app_pt_BR.arb"), JSON.stringify({ "@@locale": "pt_BR", greeting: "Olá" }, null, 2));

      const { state } = runImport({ projectRoot: root, sourceLocale: "en_US" });
      const output = state.config.outputs[0]!;
      const r = getAdapter(output.adapter).export(state, output);
      const names = r.files.map((f) => f.path).sort();
      expect(names).toContain("lib/l10n/app_en_US.arb");
      expect(names).toContain("lib/l10n/app_pt_BR.arb");
      expect(r.warnings.filter((w) => w.code === "locale-collision")).toEqual([]);

      const enUs = JSON.parse(r.files.find((f) => f.path === "lib/l10n/app_en_US.arb")!.contents);
      expect(enUs.greeting).toBe("Hello");
      const ptBr = JSON.parse(r.files.find((f) => f.path === "lib/l10n/app_pt_BR.arb")!.contents);
      expect(ptBr.greeting).toBe("Olá");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reproduces underscore-region vue-i18n filenames (inferred localeCase)", () => {
    const root = mkdtempSync(join(tmpdir(), "glot-rt-"));
    try {
      const locale = join(root, "src", "locale");
      mkdirSync(locale, { recursive: true });
      writeFileSync(join(locale, "en_US.json"), JSON.stringify({ greeting: "Hello" }, null, 2));
      writeFileSync(join(locale, "pt_BR.json"), JSON.stringify({ greeting: "Olá" }, null, 2));

      const { state } = runImport({ projectRoot: root, sourceLocale: "en_US" });
      const output = state.config.outputs[0]!;
      expect(output.localeCase).toBe("bcp47-underscore");

      const r = getAdapter(output.adapter).export(state, output);
      const names = r.files.map((f) => f.path).sort();
      expect(names).toContain("src/locale/en_US.json");
      expect(names).toContain("src/locale/pt_BR.json");

      const enUs = JSON.parse(r.files.find((f) => f.path === "src/locale/en_US.json")!.contents);
      expect(enUs.greeting).toBe("Hello");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
