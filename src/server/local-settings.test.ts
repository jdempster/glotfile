import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  loadLocalSettings, saveLocalSettings, defaultLocalSettings,
  aiConfigError, isEditorId, multilingualLocalesError,
} from "./local-settings.js";

let dir: string;
const settingsFile = () => resolve(dir, ".glotfile", "settings.json");
function writeSettings(raw: unknown): void {
  mkdirSync(resolve(dir, ".glotfile"), { recursive: true });
  writeFileSync(settingsFile(), JSON.stringify(raw));
}

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "glot-ls-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("loadLocalSettings", () => {
  it("returns defaults when the file is absent", () => {
    expect(loadLocalSettings(dir)).toEqual(defaultLocalSettings());
  });

  it("coerces promptStyle when valid", () => {
    writeSettings({ ai: { provider: "anthropic", model: "claude-haiku-4-5-20251001", endpoint: null, batchSize: 25, promptStyle: "translategemma" } });
    const s = loadLocalSettings(dir);
    expect(s.ai.promptStyle).toBe("translategemma");
  });

  it("drops promptStyle when unrecognised, falling back to undefined", () => {
    writeSettings({ ai: { provider: "anthropic", model: "claude-haiku-4-5-20251001", endpoint: null, batchSize: 25, promptStyle: "bogus" } });
    const s = loadLocalSettings(dir);
    expect(s.ai.promptStyle).toBeUndefined();
  });

  it("reads a valid ai block and editor", () => {
    writeSettings({
      ai: { provider: "openai", model: "gpt-4o-mini", endpoint: "https://x", region: null, batchSize: 10 },
      editor: "phpstorm",
    });
    const s = loadLocalSettings(dir);
    expect(s.ai).toEqual({ provider: "openai", model: "gpt-4o-mini", endpoint: "https://x", region: null, batchSize: 10 });
    expect(s.editor).toBe("phpstorm");
  });

  it("falls back per-field on invalid values", () => {
    writeSettings({ ai: { provider: "cohere", model: 5, batchSize: "nope" }, editor: "emacs" });
    const s = loadLocalSettings(dir);
    expect(s.ai.provider).toBe(defaultLocalSettings().ai.provider);
    expect(s.ai.model).toBe(defaultLocalSettings().ai.model);
    expect(s.ai.batchSize).toBe(defaultLocalSettings().ai.batchSize);
    expect(s.editor).toBe("vscode");
  });

  it("returns defaults on malformed JSON", () => {
    mkdirSync(resolve(dir, ".glotfile"), { recursive: true });
    writeFileSync(settingsFile(), "{ not json");
    expect(loadLocalSettings(dir)).toEqual(defaultLocalSettings());
  });

  it("defaults multilingualLocales to null (= show all)", () => {
    expect(defaultLocalSettings().multilingualLocales).toBeNull();
  });

  it("coerces a multilingualLocales array, lowercasing and dropping non-strings", () => {
    writeSettings({ multilingualLocales: ["FR", "de-DE", 5, "", " es "] });
    expect(loadLocalSettings(dir).multilingualLocales).toEqual(["fr", "de-de", "es"]);
  });

  it("treats a non-array multilingualLocales as null", () => {
    writeSettings({ multilingualLocales: "fr" });
    expect(loadLocalSettings(dir).multilingualLocales).toBeNull();
  });
});

describe("saveLocalSettings", () => {
  it("creates .glotfile with a self-ignoring .gitignore", () => {
    saveLocalSettings(dir, { editor: "zed" });
    expect(existsSync(settingsFile())).toBe(true);
    expect(readFileSync(resolve(dir, ".glotfile", ".gitignore"), "utf8")).toBe("*\n");
  });

  it("round-trips through load", () => {
    const ai = { provider: "bedrock" as const, model: "amazon.nova-pro-v1:0", endpoint: null, region: "us-east-1", batchSize: 5 };
    saveLocalSettings(dir, { ai, editor: "zed" });
    const s = loadLocalSettings(dir);
    expect(s.ai).toEqual(ai);
    expect(s.editor).toBe("zed");
  });

  it("patches one key without disturbing the other or unknown keys", () => {
    writeSettings({ ai: { provider: "openai", model: "gpt-4o", endpoint: null, batchSize: 7 }, editor: "vscode", future: { keep: true } });
    saveLocalSettings(dir, { editor: "phpstorm" });
    const raw = JSON.parse(readFileSync(settingsFile(), "utf8"));
    expect(raw.editor).toBe("phpstorm");
    expect(raw.ai.model).toBe("gpt-4o");
    expect(raw.future).toEqual({ keep: true });
  });

  it("round-trips multilingualLocales (array and null)", () => {
    saveLocalSettings(dir, { multilingualLocales: ["fr", "de"] });
    expect(loadLocalSettings(dir).multilingualLocales).toEqual(["fr", "de"]);
    saveLocalSettings(dir, { multilingualLocales: null });
    expect(loadLocalSettings(dir).multilingualLocales).toBeNull();
  });
});

describe("multilingualLocalesError", () => {
  it("accepts null and a string array", () => {
    expect(multilingualLocalesError(null)).toBeNull();
    expect(multilingualLocalesError(["fr", "de"])).toBeNull();
    expect(multilingualLocalesError([])).toBeNull();
  });
  it("rejects non-array, non-null values", () => {
    expect(multilingualLocalesError("fr")).toMatch(/array or null/);
  });
  it("rejects an array with a non-string entry", () => {
    expect(multilingualLocalesError(["fr", 5])).toMatch(/strings/);
  });
});

describe("aiConfigError", () => {
  it("accepts a valid config", () => {
    expect(aiConfigError({ provider: "anthropic", model: "m", endpoint: null, region: null, batchSize: 25 })).toBeNull();
  });
  it("rejects an unknown provider", () => {
    expect(aiConfigError({ provider: "cohere", model: "m", endpoint: null, batchSize: 25 })).toMatch(/provider must be one of/);
  });
  it("rejects a non-number batchSize", () => {
    expect(aiConfigError({ provider: "anthropic", model: "m", endpoint: null, batchSize: "25" })).toMatch(/batchSize must be a number/);
  });
});

describe("isEditorId", () => {
  it("accepts the three supported editors and rejects others", () => {
    expect(isEditorId("vscode")).toBe(true);
    expect(isEditorId("zed")).toBe(true);
    expect(isEditorId("phpstorm")).toBe(true);
    expect(isEditorId("emacs")).toBe(false);
    expect(isEditorId(5)).toBe(false);
  });
});
