import { writeFileSync, renameSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

let counter = 0;

// Write a file so a reader (or a crash) never observes a half-written file: write
// to a sibling temp file, then rename() over the target. rename(2) is atomic
// within a filesystem, so the target is always either the previous complete file
// or the new complete one. If the write itself fails (e.g. disk full), the temp is
// discarded and any existing target is left untouched — unlike a direct
// writeFileSync, which truncates the live file before writing.
export function writeFileAtomic(path: string, data: string | Buffer): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  // Same directory → same filesystem, so the rename stays atomic rather than a
  // cross-device copy. pid + counter keeps concurrent writers from colliding.
  const tmp = join(dir, `.${process.pid}.${counter++}.tmp`);
  try {
    writeFileSync(tmp, data);
    renameSync(tmp, path);
  } catch (e) {
    try { rmSync(tmp, { force: true }); } catch { /* best effort */ }
    throw e;
  }
}
