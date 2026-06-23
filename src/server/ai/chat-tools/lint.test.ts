import { describe, it, expect, beforeEach } from "vitest";
import { lintTools } from "./lint.js";
import { defaultState, type State } from "../../schema.js";
import type { ChatTool, ToolContext } from "../chat-types.js";

const tool = (name: string): ChatTool => {
  const t = lintTools.find((x) => x.def.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
};

let state: State;
let ctx: ToolContext;
beforeEach(() => {
  state = defaultState();
  state.config.locales = ["en", "fr", "en-gb"];
  state.keys = {
    "a.same": { values: { en: { value: "Open", state: "source" }, fr: { value: "Open", state: "reviewed" }, "en-gb": { value: "Open", state: "reviewed" } } },
    "b.ph": { values: { en: { value: "Hi {n}", state: "source" }, fr: { value: "Salut", state: "reviewed" } } },
  };
  ctx = { projectRoot: "/x", statePath: "", load: () => state, persist: (s) => { state = s; }, provider: null as never };
});

describe("lint chat tools", () => {
  it("lint_check returns findings and counts", async () => {
    const r = await tool("lint_check").run({}, ctx) as { ok: boolean; counts: { error: number }; findings: { key: string; rule: string }[] };
    expect(r.findings.some((f) => f.key === "b.ph" && f.rule === "placeholder-mismatch")).toBe(true);
    expect(r.findings.some((f) => f.rule === "identical-to-source")).toBe(true);
    expect(r.counts.error).toBeGreaterThanOrEqual(1);
  });

  it("lint_check narrows by key and severity", async () => {
    const r = await tool("lint_check").run({ key: "b.ph", severity: "error" }, ctx) as { findings: { key: string; severity: string }[] };
    expect(r.findings.length).toBeGreaterThan(0);
    expect(r.findings.every((f) => f.key === "b.ph" && f.severity === "error")).toBe(true);
  });

  it("set_lint_ignore / remove_lint_ignore manage config.lint.ignore", async () => {
    await tool("set_lint_ignore").run({ glob: "a.*" }, ctx);
    expect(state.config.lint?.ignore).toEqual(["a.*"]);
    await tool("remove_lint_ignore").run({ glob: "a.*" }, ctx);
    expect(state.config.lint?.ignore).toBeUndefined();
  });

  it("set_locale_lint_rule turns a rule off for one locale and clears with default", async () => {
    await tool("set_locale_lint_rule").run({ locale: "en-gb", rule: "identical-to-source", severity: "off" }, ctx);
    expect(state.config.lint?.localeRules).toEqual({ "en-gb": { "identical-to-source": "off" } });
    await tool("set_locale_lint_rule").run({ locale: "en-gb", rule: "identical-to-source", severity: "default" }, ctx);
    expect(state.config.lint?.localeRules).toBeUndefined();
  });

  it("dismiss_finding records a per-key suppression", async () => {
    await tool("dismiss_finding").run({ key: "a.same", rule: "identical-to-source", locale: "fr" }, ctx);
    expect(state.keys["a.same"]!.suppressions).toEqual([
      expect.objectContaining({ rule: "identical-to-source", locale: "fr" }),
    ]);
  });

  it("write tools are confirm-gated; lint_check is not", () => {
    expect(tool("lint_check").confirm).toBeFalsy();
    for (const name of ["set_lint_ignore", "remove_lint_ignore", "set_locale_lint_rule", "dismiss_finding"]) {
      expect(tool(name).confirm).toBe(true);
    }
  });
});
