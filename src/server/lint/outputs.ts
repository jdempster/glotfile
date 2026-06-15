import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { getAdapter } from "../adapters/index.js";
import type { State } from "../schema.js";
import type { Finding } from "./types.js";

export function checkOutputs(state: State, root: string): Finding[] {
  const out: Finding[] = [];
  for (const output of state.config.outputs) {
    const result = getAdapter(output.adapter).export(state, output);
    for (const file of result.files) {
      const abs = resolve(root, file.path);
      const current = existsSync(abs) ? readFileSync(abs, "utf8") : null;
      if (current === null) {
        out.push({ ruleId: "output-stale", key: file.path, locale: "", severity: "error", message: "output file is missing; run `glotfile export`" });
      } else if (current !== file.contents) {
        out.push({ ruleId: "output-stale", key: file.path, locale: "", severity: "error", message: "output file is out of date; run `glotfile export`" });
      }
    }
  }
  return out;
}
