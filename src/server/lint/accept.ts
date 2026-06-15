import type { State } from "../schema.js";
import { addSuppression, systemClock, type Clock } from "../state.js";
import type { Finding } from "./types.js";

export interface AcceptOptions {
  rules?: string[];
  locales?: string[];
  // Suppressing errors hides release blockers, so it must be asked for explicitly.
  includeErrors?: boolean;
}

export interface AcceptResult {
  accepted: number;
  byRule: Record<string, number>;
}

// Bulk-suppress the given lint findings (the UI's "dismiss all" and the CLI's
// `lint --accept`). Project-level findings (locale "") have no key to attach a
// suppression to and are always skipped.
export function acceptFindings(
  state: State, findings: Finding[], opts: AcceptOptions = {}, clock: Clock = systemClock,
): AcceptResult {
  const byRule: Record<string, number> = {};
  let accepted = 0;
  for (const f of findings) {
    if (f.locale === "" || f.suppressed) continue;
    if (f.severity === "error" && !opts.includeErrors) continue;
    if (opts.rules && !opts.rules.includes(f.ruleId)) continue;
    if (opts.locales && !opts.locales.includes(f.locale)) continue;
    if (!state.keys[f.key]) continue;
    addSuppression(state, f.key, f.ruleId, f.locale, clock);
    byRule[f.ruleId] = (byRule[f.ruleId] ?? 0) + 1;
    accepted++;
  }
  return { accepted, byRule };
}
