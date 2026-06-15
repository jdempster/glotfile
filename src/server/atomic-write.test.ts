import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileAtomic } from "./atomic-write.js";

const tmpDir = () => mkdtempSync(join(tmpdir(), "glot-atomic-"));

describe("writeFileAtomic", () => {
  it("writes the contents to the target", () => {
    const path = join(tmpDir(), "out.json");
    writeFileAtomic(path, "hello");
    expect(readFileSync(path, "utf8")).toBe("hello");
  });

  it("creates missing parent directories", () => {
    const path = join(tmpDir(), "a", "b", "out.json");
    writeFileAtomic(path, "x");
    expect(readFileSync(path, "utf8")).toBe("x");
  });

  it("overwrites an existing file", () => {
    const path = join(tmpDir(), "out.json");
    writeFileSync(path, "old", "utf8");
    writeFileAtomic(path, "new");
    expect(readFileSync(path, "utf8")).toBe("new");
  });

  it("writes binary Buffers", () => {
    const path = join(tmpDir(), "blob.bin");
    const buf = Buffer.from([0, 1, 2, 255]);
    writeFileAtomic(path, buf);
    expect(readFileSync(path)).toEqual(buf);
  });

  it("leaves no temp files behind on success", () => {
    const dir = tmpDir();
    writeFileAtomic(join(dir, "out.json"), "x");
    expect(readdirSync(dir)).toEqual(["out.json"]);
  });

  it("preserves the existing file and cleans up when the write cannot complete", () => {
    // A directory at the target path makes the final rename fail, standing in for
    // any mid-write failure (disk full, crash). The original must survive intact.
    const dir = tmpDir();
    const target = join(dir, "data");
    mkdirSync(target);
    writeFileSync(join(target, "sentinel"), "keep", "utf8");
    expect(() => writeFileAtomic(target, "clobber")).toThrow();
    expect(readFileSync(join(target, "sentinel"), "utf8")).toBe("keep");
    // No leftover temp siblings in the parent dir.
    expect(readdirSync(dir).filter((n) => n.includes(".tmp"))).toEqual([]);
  });
});
