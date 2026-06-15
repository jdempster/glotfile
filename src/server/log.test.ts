import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, statSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendLog, readLog, readLastLines, trimLog, type LogEntry } from "./log.js";

const aiEntry = (at: string): LogEntry => ({
  at,
  kind: "translate",
  summary: "Translated 1 item to fr",
  model: "claude-opus-4-8",
  system: "You are a localization engine.",
  items: [{ id: "0", key: "k", source: "Hi", targetLocale: "fr" }],
  results: [{ id: "0", translation: "Salut" }],
});

const editEntry = (at: string): LogEntry => ({
  at,
  kind: "translation",
  summary: "Set fr value of auth.title",
  key: "auth.title",
  locale: "fr",
  before: "",
  after: "Bonjour",
});

describe("log", () => {
  it("appends entries and reads them back newest-first", () => {
    const root = mkdtempSync(join(tmpdir(), "glot-"));
    appendLog(root, aiEntry("2026-06-04T10:00:00.000Z"));
    appendLog(root, aiEntry("2026-06-04T11:00:00.000Z"));
    const log = readLog(root);
    expect(log).toHaveLength(2);
    expect(log[0]!.at).toBe("2026-06-04T11:00:00.000Z");
    expect(log[1]!.at).toBe("2026-06-04T10:00:00.000Z");
  });

  it("returns [] when the log file is missing", () => {
    expect(readLog(mkdtempSync(join(tmpdir(), "glot-")))).toEqual([]);
  });

  it("honors the limit, returning only the most recent entries", () => {
    const root = mkdtempSync(join(tmpdir(), "glot-"));
    for (let i = 0; i < 5; i++) appendLog(root, aiEntry(`2026-06-04T1${i}:00:00.000Z`));
    expect(readLog(root, 2).map((e) => e.at)).toEqual(["2026-06-04T14:00:00.000Z", "2026-06-04T13:00:00.000Z"]);
  });

  it("round-trips an AI translate entry with its rich fields", () => {
    const root = mkdtempSync(join(tmpdir(), "glot-"));
    appendLog(root, aiEntry("2026-06-08T10:00:00.000Z"));
    const [e] = readLog(root);
    expect(e!.kind).toBe("translate");
    expect(e!.model).toBe("claude-opus-4-8");
    expect(e!.items).toHaveLength(1);
    expect(e!.results![0]!.translation).toBe("Salut");
  });

  it("round-trips a general edit entry with before/after", () => {
    const root = mkdtempSync(join(tmpdir(), "glot-"));
    appendLog(root, editEntry("2026-06-08T10:00:00.000Z"));
    const [e] = readLog(root);
    expect(e!.kind).toBe("translation");
    expect(e!.summary).toBe("Set fr value of auth.title");
    expect(e!.key).toBe("auth.title");
    expect(e!.locale).toBe("fr");
    expect(e!.before).toBe("");
    expect(e!.after).toBe("Bonjour");
  });
});

describe("readLastLines", () => {
  const tmpFile = () => join(mkdtempSync(join(tmpdir(), "glot-tail-")), "log.jsonl");

  it("returns the last n lines in file order", () => {
    const f = tmpFile();
    writeFileSync(f, "a\nb\nc\nd\ne\n");
    expect(readLastLines(f, 2)).toEqual(["d", "e"]);
  });

  it("returns every line when fewer than n exist", () => {
    const f = tmpFile();
    writeFileSync(f, "a\nb\nc\n");
    expect(readLastLines(f, 10)).toEqual(["a", "b", "c"]);
  });

  it("returns exactly n when the file holds exactly n lines", () => {
    const f = tmpFile();
    writeFileSync(f, "a\nb\nc\n");
    expect(readLastLines(f, 3)).toEqual(["a", "b", "c"]);
  });

  it("includes the final line when there is no trailing newline", () => {
    const f = tmpFile();
    writeFileSync(f, "a\nb\nc");
    expect(readLastLines(f, 2)).toEqual(["b", "c"]);
  });

  it("returns [] for a missing file", () => {
    expect(readLastLines(join(tmpdir(), "glot-nope-zzz.jsonl"), 5)).toEqual([]);
  });

  it("returns [] for an empty file", () => {
    const f = tmpFile();
    writeFileSync(f, "");
    expect(readLastLines(f, 5)).toEqual([]);
  });

  it("skips blank lines when counting", () => {
    const f = tmpFile();
    writeFileSync(f, "a\n\nb\n\n\nc\n");
    expect(readLastLines(f, 2)).toEqual(["b", "c"]);
  });

  it("reassembles a line far longer than the chunk size", () => {
    const f = tmpFile();
    const long = "x".repeat(200);
    writeFileSync(f, `a\n${long}\n`);
    expect(readLastLines(f, 1, 8)).toEqual([long]);
  });

  it("reads the last n lines without loading the whole file (small chunks)", () => {
    const f = tmpFile();
    writeFileSync(f, Array.from({ length: 50 }, (_, i) => `line${i}`).join("\n") + "\n");
    expect(readLastLines(f, 3, 8)).toEqual(["line47", "line48", "line49"]);
  });

  it("decodes multi-byte UTF-8 split across a chunk boundary", () => {
    const f = tmpFile();
    writeFileSync(f, "café\nnaïve\n日本語\n", "utf8");
    expect(readLastLines(f, 3, 4)).toEqual(["café", "naïve", "日本語"]);
  });
});

describe("trimLog", () => {
  const tmpFile = () => join(mkdtempSync(join(tmpdir(), "glot-trim-")), "log.jsonl");
  // A JSON log line whose total byte size is roughly `bytes`, tagged by `at`.
  const line = (at: string, bytes = 60): string =>
    JSON.stringify({ at, kind: "key", summary: "x".repeat(Math.max(0, bytes)) });
  const write = (f: string, lines: string[]) => writeFileSync(f, lines.join("\n") + "\n");
  // Parse the trimmed file directly (it isn't under a .glotfile/ project root).
  const entries = (f: string) =>
    readFileSync(f, "utf8").split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l) as LogEntry);
  const ats = (f: string) => entries(f).map((e) => e.at);

  it("does nothing when the file is under the cap", () => {
    const f = tmpFile();
    const content = [line("t0"), line("t1"), line("t2")].join("\n") + "\n";
    writeFileSync(f, content);
    trimLog(f, 1_000_000, 800_000);
    expect(statSync(f).size).toBe(Buffer.byteLength(content));
  });

  it("trims to the most recent entries when over the cap", () => {
    const f = tmpFile();
    write(f, Array.from({ length: 20 }, (_, i) => line(`t${i}`, 100)));
    const before = statSync(f).size;
    trimLog(f, 600, 500);
    expect(statSync(f).size).toBeLessThanOrEqual(600);
    expect(statSync(f).size).toBeLessThan(before);
    const kept = ats(f);
    // Newest survives, oldest is evicted, and fewer remain than we started with.
    expect(kept).toContain("t19");
    expect(kept).not.toContain("t0");
    expect(kept.length).toBeLessThan(20);
  });

  it("keeps the newest entry intact even when it alone exceeds the target", () => {
    const f = tmpFile();
    write(f, [line("t0", 50), line("t1", 50), line("huge", 2000)]);
    trimLog(f, 1000, 800);
    const kept = ats(f);
    expect(kept).toEqual(["huge"]);
    // Proof it was kept whole, not truncated to the target.
    expect(statSync(f).size).toBeGreaterThan(800);
  });

  it("leaves only complete, parseable entries after trimming", () => {
    const f = tmpFile();
    write(f, Array.from({ length: 30 }, (_, i) => line(`t${i}`, 80)));
    trimLog(f, 500, 400);
    // readLog JSON.parses every retained line; a partial leading line would throw.
    expect(() => ats(f)).not.toThrow();
  });

  it("does nothing for a missing file", () => {
    expect(() => trimLog(join(tmpdir(), "glot-trim-nope.jsonl"), 10, 5)).not.toThrow();
  });

  it("preserves multi-byte content in retained entries", () => {
    const f = tmpFile();
    write(f, [line("t0", 100), JSON.stringify({ at: "t1", kind: "key", summary: "日本語café" })]);
    trimLog(f, 80, 60);
    expect(entries(f)[0]!.summary).toBe("日本語café");
  });
});

describe("appendLog auto-trim", () => {
  it("keeps the log bounded as it grows past the built-in cap", () => {
    const root = mkdtempSync(join(tmpdir(), "glot-bound-"));
    // ~1.3 MB per entry; five of them (~6.5 MB) crosses the 5 MB ceiling.
    for (let i = 0; i < 5; i++) {
      appendLog(root, { at: `2026-06-04T0${i}:00:00.000Z`, kind: "key", summary: "x".repeat(1_300_000) });
    }
    const path = join(root, ".glotfile", "log.jsonl");
    expect(statSync(path).size).toBeLessThanOrEqual(5 * 1024 * 1024);
    const log = readLog(root, 1000);
    // Newest survives; the oldest was evicted to stay under the cap.
    expect(log[0]!.at).toBe("2026-06-04T04:00:00.000Z");
    expect(log.map((e) => e.at)).not.toContain("2026-06-04T00:00:00.000Z");
  });
});
