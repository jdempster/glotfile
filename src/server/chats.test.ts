import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadChat, saveChat, clearChat, emptyTranscript } from "./chats.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "glot-chats-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe("chats persistence", () => {
  it("returns an empty transcript when none exists", () => {
    const t = loadChat(root);
    expect(t).toEqual(emptyTranscript());
    expect(t.messages).toEqual([]);
  });

  it("round-trips a saved transcript", () => {
    const t = {
      messages: [{ role: "user" as const, content: [{ type: "text" as const, text: "feed my plant?" }] }],
      model: "claude-test",
      createdAt: "2026-06-19T00:00:00.000Z",
      cumulativeUsage: { inputTokens: 10, outputTokens: 5, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
    };
    saveChat(root, t);
    expect(loadChat(root)).toEqual(t);
  });

  it("self-ignores: the transcript lives under .glotfile (auto-gitignored)", () => {
    saveChat(root, emptyTranscript());
    expect(existsSync(join(root, ".glotfile", "chats", "current.json"))).toBe(true);
    expect(existsSync(join(root, ".glotfile", ".gitignore"))).toBe(true);
  });

  it("clearChat removes the transcript", () => {
    saveChat(root, { ...emptyTranscript(), model: "x" });
    clearChat(root);
    expect(loadChat(root)).toEqual(emptyTranscript());
  });

  it("a corrupt file reads back as an empty transcript", () => {
    saveChat(root, emptyTranscript());
    // overwrite with garbage
    const { writeFileSync } = require("node:fs");
    writeFileSync(join(root, ".glotfile", "chats", "current.json"), "{not json");
    expect(loadChat(root)).toEqual(emptyTranscript());
  });
});
