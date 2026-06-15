import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Everything glotfile writes under <project>/.glotfile is local-only: the
// per-developer settings, the usage cache, the AI log. glotfile runs inside other
// people's repos, whose .gitignore won't know to ignore .glotfile — so on creation
// we drop a self-ignoring .gitignore ("*") in the directory, making the whole thing
// uncommittable regardless of the host project's ignore rules. Idempotent: the
// ignore file is only written when absent, so a user edit to it is never clobbered.
export function ensureGlotfileDir(projectRoot: string): string {
  const dir = resolve(projectRoot, ".glotfile");
  mkdirSync(dir, { recursive: true });
  const ignore = resolve(dir, ".gitignore");
  if (!existsSync(ignore)) {
    try {
      writeFileSync(ignore, "*\n");
    } catch {
      // Best effort — a write failure here must never break the save that triggered it.
    }
  }
  return dir;
}
