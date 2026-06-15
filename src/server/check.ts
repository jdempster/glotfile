import { getAdapter, type ExportWarning } from "./adapters/index.js";
import type { State } from "./schema.js";

export interface CheckSummary {
  ok: boolean;
  drift: string[];          // output paths whose on-disk content is stale or missing
  warnings: ExportWarning[];
}

// Warning codes that corrupt or degrade runtime output (vs. informational ones).
const LOSSY: ReadonlySet<string> = new Set([
  "lossy-plural",
  "lossy-select",
  "placeholder-unmappable",
]);

// Pure core: `readFile(relPath)` returns the on-disk contents or null if absent.
// The CLI injects a fs-backed reader; tests inject a Map-backed one.
export function computeCheck(
  state: State,
  readFile: (relPath: string) => string | null,
  strict: boolean,
): CheckSummary {
  const drift: string[] = [];
  const warnings: ExportWarning[] = [];
  for (const output of state.config.outputs) {
    const result = getAdapter(output.adapter).export(state, output);
    warnings.push(...result.warnings);
    for (const f of result.files) {
      if (readFile(f.path) !== f.contents) drift.push(f.path);
    }
  }
  const hasLossy = warnings.some((w) => LOSSY.has(w.code));
  const ok = drift.length === 0 && (!strict || !hasLossy);
  return { ok, drift, warnings };
}
