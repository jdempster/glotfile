import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codebaseTools } from "./read-codebase.js";
import { defaultState } from "../../schema.js";
import type { ChatTool, ToolContext } from "../chat-types.js";

const tool = (name: string): ChatTool => {
  const t = codebaseTools.find((x) => x.def.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
};

let root: string;
let ctx: ToolContext;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "glot-cb-"));
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "a.ts"), "// remember to feed the plant\nconst x = 1;\n");
  writeFileSync(join(root, "README.md"), "# Sprout\nA houseplant-care app.\n");
  mkdirSync(join(root, "node_modules", "pkg"), { recursive: true });
  writeFileSync(join(root, "node_modules", "pkg", "x.js"), "feed feed feed\n");
  ctx = { projectRoot: root, statePath: "", load: () => defaultState(), persist: () => {}, provider: null as never };
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("codebase read tools", () => {
  it("find_files matches a glob and skips node_modules", async () => {
    const res = (await tool("find_files").run({ glob: "**/*.ts" }, ctx)) as { files: string[] };
    expect(res.files).toContain("src/a.ts");
    expect(res.files.some((f) => f.includes("node_modules"))).toBe(false);
  });

  it("grep_codebase finds matches in source but not node_modules", async () => {
    const res = (await tool("grep_codebase").run({ pattern: "feed" }, ctx)) as { matches: { file: string; line: number; text: string }[] };
    expect(res.matches.some((m) => m.file === "src/a.ts" && m.line === 1)).toBe(true);
    expect(res.matches.some((m) => m.file.includes("node_modules"))).toBe(false);
  });

  it("read_file returns file content", async () => {
    const res = (await tool("read_file").run({ path: "README.md" }, ctx)) as { path: string; content: string };
    expect(res.content).toContain("houseplant-care");
  });

  it("read_file rejects path traversal outside the project root", async () => {
    await expect(tool("read_file").run({ path: "../secret.txt" }, ctx)).rejects.toThrow();
    await expect(tool("read_file").run({ path: "/etc/hosts" }, ctx)).rejects.toThrow();
  });

  it("honors config.scan.exclude globs", async () => {
    const state = defaultState();
    state.config.scan = { exclude: ["src/**"] };
    ctx.load = () => state;
    const res = (await tool("find_files").run({ glob: "**/*.ts" }, ctx)) as { files: string[] };
    expect(res.files).not.toContain("src/a.ts");
  });
});
