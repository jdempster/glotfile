import type { State, GlossaryEntry, LintConfig } from "../schema.js";
import type { Severity, RuleId } from "./registry.js";
import type { Speller } from "../spell.js";

export type { Speller };

export interface RawFinding {
  ruleId: string;
  key: string;
  locale: string;
  message: string;
}

export interface Finding extends RawFinding {
  severity: Exclude<Severity, "off">;
  // Present (true) only when the finding is hidden by a per-key suppression and
  // the caller asked for suppressed findings; never counted in counts/ok.
  suppressed?: boolean;
}

export interface LintContext {
  config: LintConfig;
  sourceLocale: string;
  targetLocales: string[];
  glossary: GlossaryEntry[];
  spellers: Map<string, Speller>;
  allowWords: Set<string>;
}

export interface Rule {
  id: RuleId;
  run(state: State, ctx: LintContext): RawFinding[];
}

export interface LintReport {
  findings: Finding[];
  counts: { error: number; warn: number; suppressed: number };
  ok: boolean;
}
