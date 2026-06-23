import type { ChatTool, ToolContext } from "../chat-types.js";
import { runLint } from "../../lint/run.js";
import { addLintIgnore, removeLintIgnore, setLocaleLintRule, addSuppression } from "../../state.js";

// Lint access for Lingo: read the catalog's quality findings, and manage the
// rules that silence noise — ignore globs, per-locale severities, and per-key
// dismissals. Read is free; every write is confirm-gated (the chat Approve card).
//
// Guard-rail (reinforced in chat-prompt.ts): these silence NOISE, never real
// problems. Lingo must not turn off a rule or dismiss an error just to make the
// release gate look green — only when a finding is genuinely a false positive.

const MAX_FINDINGS = 100;

const lintCheck: ChatTool = {
  def: {
    name: "lint_check",
    description:
      "Run the catalog's quality checks and return the findings (placeholder/ICU mismatches, glossary violations, length, identical-to-source, whitespace, spelling, untranslated). Use this to see what's wrong before advising on translations or deciding whether a rule is noise worth ignoring. Narrow with key/locale/severity. Errors block a release; warnings don't.",
    schema: {
      type: "object",
      properties: {
        key: { type: "string", description: "Limit to one key." },
        locale: { type: "string", description: "Limit to one locale (BCP-47, e.g. \"de\")." },
        severity: { type: "string", enum: ["error", "warn"], description: "Limit to errors or warnings only." },
        includeSuppressed: { type: "boolean", description: "Also include findings currently hidden by a per-key dismissal (flagged suppressed)." },
      },
      additionalProperties: false,
    },
  },
  humanSummary: () => "run lint checks",
  run: async (input, ctx: ToolContext) => {
    const { key, locale, severity, includeSuppressed } = input as
      { key?: string; locale?: string; severity?: "error" | "warn"; includeSuppressed?: boolean };
    const s = ctx.load();
    const report = await runLint(s, { warn: () => {}, includeSuppressed, locales: locale ? [locale] : undefined });
    let findings = report.findings;
    if (key) findings = findings.filter((f) => f.key === key);
    if (severity) findings = findings.filter((f) => f.severity === severity);
    const out = findings.slice(0, MAX_FINDINGS).map((f) => ({
      key: f.key, locale: f.locale || null, rule: f.ruleId, severity: f.severity, message: f.message,
      ...(f.suppressed ? { suppressed: true } : {}),
    }));
    return {
      counts: report.counts,
      ok: report.ok,
      findings: out,
      ...(findings.length > MAX_FINDINGS ? { truncated: findings.length - MAX_FINDINGS } : {}),
    };
  },
};

const setLintIgnore: ChatTool = {
  confirm: true,
  def: {
    name: "set_lint_ignore",
    description:
      "Exclude keys from EVERY lint check by adding a key glob to config.lint.ignore (e.g. \"legal.*\", or one exact key). For generated, legacy, or intentionally off-spec strings the user doesn't maintain. Prefer dismiss_finding for a single false positive, and set_locale_lint_rule to silence one noisy rule for a language.",
    schema: {
      type: "object",
      properties: { glob: { type: "string", description: "A key or key glob (e.g. \"legal.*\")." } },
      required: ["glob"],
      additionalProperties: false,
    },
  },
  humanSummary: (input) => `lint-ignore keys "${(input as { glob?: string }).glob ?? ""}"`,
  run: async (input, ctx: ToolContext) => {
    const { glob } = input as { glob: string };
    const s = ctx.load();
    addLintIgnore(s, glob);
    ctx.persist(s);
    return { ok: true, ignore: s.config.lint?.ignore ?? [] };
  },
};

const removeLintIgnoreTool: ChatTool = {
  confirm: true,
  def: {
    name: "remove_lint_ignore",
    description: "Remove a glob from config.lint.ignore, re-enabling lint for the keys it matched.",
    schema: {
      type: "object",
      properties: { glob: { type: "string", description: "The exact glob to remove (as stored in config.lint.ignore)." } },
      required: ["glob"],
      additionalProperties: false,
    },
  },
  humanSummary: (input) => `stop lint-ignoring "${(input as { glob?: string }).glob ?? ""}"`,
  run: async (input, ctx: ToolContext) => {
    const { glob } = input as { glob: string };
    const s = ctx.load();
    removeLintIgnore(s, glob);
    ctx.persist(s);
    return { ok: true, ignore: s.config.lint?.ignore ?? [] };
  },
};

const setLocaleRule: ChatTool = {
  confirm: true,
  def: {
    name: "set_locale_lint_rule",
    description:
      "Override a lint rule's severity for ONE language (config.lint.localeRules), layered over the global rules. The classic use: turn \"identical-to-source\" off for English variants (en-gb/en-us/en-au) where matching the source is expected. severity \"default\" clears the override.",
    schema: {
      type: "object",
      properties: {
        locale: { type: "string", description: "Target locale (BCP-47, e.g. \"en-gb\")." },
        rule: {
          type: "string",
          enum: ["empty-source", "empty-translation", "placeholder-mismatch", "icu-mismatch", "glossary-violation", "max-length", "identical-to-source", "whitespace", "spelling"],
          description: "The lint rule id.",
        },
        severity: { type: "string", enum: ["error", "warn", "off", "default"], description: "New severity for this locale, or \"default\" to clear the override." },
      },
      required: ["locale", "rule", "severity"],
      additionalProperties: false,
    },
  },
  humanSummary: (input) => {
    const { locale, rule, severity } = input as { locale?: string; rule?: string; severity?: string };
    return `set ${rule} = ${severity} for ${locale}`;
  },
  run: async (input, ctx: ToolContext) => {
    const { locale, rule, severity } = input as { locale: string; rule: string; severity: "error" | "warn" | "off" | "default" };
    const s = ctx.load();
    setLocaleLintRule(s, locale, rule, severity === "default" ? null : severity);
    ctx.persist(s);
    return { ok: true, localeRules: s.config.lint?.localeRules ?? {} };
  },
};

const dismissFinding: ChatTool = {
  confirm: true,
  def: {
    name: "dismiss_finding",
    description:
      "Dismiss ONE lint finding for a key+locale — a targeted false positive (e.g. \"Logo\" really is \"Logo\" in French). It's hidden only until that key's source text changes, then resurfaces. Use sparingly and only for genuine false positives; never to bury a real error.",
    schema: {
      type: "object",
      properties: {
        key: { type: "string", description: "The key the finding is on." },
        rule: {
          type: "string",
          enum: ["empty-source", "empty-translation", "placeholder-mismatch", "icu-mismatch", "glossary-violation", "max-length", "identical-to-source", "whitespace", "spelling"],
          description: "The lint rule id of the finding (from lint_check).",
        },
        locale: { type: "string", description: "The finding's locale (BCP-47)." },
      },
      required: ["key", "rule", "locale"],
      additionalProperties: false,
    },
  },
  humanSummary: (input) => {
    const { key, rule, locale } = input as { key?: string; rule?: string; locale?: string };
    return `dismiss ${rule} on ${key} [${locale}]`;
  },
  run: async (input, ctx: ToolContext) => {
    const { key, rule, locale } = input as { key: string; rule: string; locale: string };
    const s = ctx.load();
    addSuppression(s, key, rule, locale);
    ctx.persist(s);
    return { ok: true, key, rule, locale };
  },
};

export const lintTools: ChatTool[] = [lintCheck, setLintIgnore, removeLintIgnoreTool, setLocaleRule, dismissFinding];
