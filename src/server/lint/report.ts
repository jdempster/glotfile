import { locate } from "./locate.js";
import type { LintReport } from "./types.js";

export function formatText(report: LintReport): string {
  if (report.findings.length === 0) return "✓ no problems\n";
  const lines: string[] = [];
  let lastKey = "";
  for (const f of report.findings) {
    if (f.key !== lastKey) { lines.push(f.key); lastKey = f.key; }
    const loc = f.locale ? ` ${f.locale}` : "";
    lines.push(`  ${f.severity} ${f.ruleId}${loc}  ${f.message}${f.suppressed ? "  (suppressed)" : ""}`);
  }
  lines.push("");
  const suppressed = report.counts.suppressed ? `, ${report.counts.suppressed} suppressed` : "";
  lines.push(`✖ ${report.counts.error} error(s), ${report.counts.warn} warning(s)${suppressed}`);
  return lines.join("\n") + "\n";
}

export function formatJson(report: LintReport): string {
  return JSON.stringify(report, null, 2) + "\n";
}

// Where catalog keys live on disk, so SARIF locations point at the real file:
// "glotfile.json" for single storage, "glotfile/keys.json" for split.
export interface SarifContext {
  keysUri: string;
  keysRawText: string;
}

export function formatSarif(report: LintReport, ctx: SarifContext): string {
  const ruleIds = [...new Set(report.findings.map((f) => f.ruleId))];
  const sarif = {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [{
      tool: { driver: { name: "glotfile", rules: ruleIds.map((id) => ({ id })) } },
      results: report.findings.map((f) => {
        const base = {
          ruleId: f.ruleId,
          level: (f.severity === "error" ? "error" : "warning") as "error" | "warning",
        };
        // output-stale findings name an output FILE in `key` (locale is ""); point
        // at that file with no region instead of a bogus location in the catalog.
        if (f.ruleId === "output-stale") {
          return {
            ...base,
            message: { text: `${f.key}: ${f.message}` },
            locations: [{ physicalLocation: { artifactLocation: { uri: f.key } } }],
          };
        }
        const pos = locate(ctx.keysRawText, f.key);
        return {
          ...base,
          message: { text: `${f.key}${f.locale ? ` [${f.locale}]` : ""}: ${f.message}` },
          locations: [{
            physicalLocation: {
              artifactLocation: { uri: ctx.keysUri },
              region: { startLine: pos.line, startColumn: pos.column },
            },
          }],
        };
      }),
    }],
  };
  return JSON.stringify(sarif, null, 2) + "\n";
}
