import { describe, it, expect } from "vitest";
import { formatText, formatJson, formatSarif } from "./report.js";
import type { LintReport } from "./types.js";

const empty: LintReport = { findings: [], counts: { error: 0, warn: 0, suppressed: 0 }, ok: true };
const report: LintReport = {
  findings: [
    { ruleId: "placeholder-mismatch", key: "a.key", locale: "fr", severity: "error", message: "placeholders differ from the source" },
    { ruleId: "max-length", key: "a.key", locale: "de", severity: "warn", message: "length 5 exceeds maxLength 3" },
  ],
  counts: { error: 1, warn: 1, suppressed: 0 },
  ok: false,
};

describe("formatText", () => {
  it("reports a clean catalogue", () => {
    expect(formatText(empty)).toContain("no problems");
  });
  it("groups by key and ends with a summary", () => {
    const out = formatText(report);
    expect(out).toContain("a.key");
    expect(out).toContain("error placeholder-mismatch fr");
    expect(out).toContain("1 error(s), 1 warning(s)");
  });
});

describe("formatJson", () => {
  it("emits the report as the documented contract", () => {
    const parsed = JSON.parse(formatJson(report));
    expect(parsed.ok).toBe(false);
    expect(parsed.counts).toEqual({ error: 1, warn: 1, suppressed: 0 });
    expect(parsed.findings[0]).toEqual({
      ruleId: "placeholder-mismatch", key: "a.key", locale: "fr", severity: "error", message: "placeholders differ from the source",
    });
  });
});

describe("formatSarif", () => {
  it("emits valid SARIF 2.1.0 with mapped levels and a located region", () => {
    const raw = '{\n  "keys": {\n    "a.key": {}\n  }\n}';
    const sarif = JSON.parse(formatSarif(report, { keysUri: "glotfile.json", keysRawText: raw }));
    expect(sarif.version).toBe("2.1.0");
    const result = sarif.runs[0].results[0];
    expect(result.level).toBe("error");
    expect(result.locations[0].physicalLocation.artifactLocation.uri).toBe("glotfile.json");
    expect(result.locations[0].physicalLocation.region.startLine).toBe(3);
  });

  it("points output-stale findings at the output file with no catalog region", () => {
    const r: LintReport = {
      findings: [{ ruleId: "output-stale", key: "lib/l10n/app_fr.arb", locale: "", severity: "error", message: "out of date" }],
      counts: { error: 1, warn: 0, suppressed: 0 }, ok: false,
    };
    const result = JSON.parse(formatSarif(r, { keysUri: "glotfile.json", keysRawText: "" })).runs[0].results[0];
    expect(result.locations[0].physicalLocation.artifactLocation.uri).toBe("lib/l10n/app_fr.arb");
    expect(result.locations[0].physicalLocation.region).toBeUndefined();
  });

  it("locates keys against the split keys.json uri/contents", () => {
    const raw = '{\n  "a.key": {}\n}';
    const result = JSON.parse(formatSarif(report, { keysUri: "glotfile/keys.json", keysRawText: raw })).runs[0].results[0];
    expect(result.locations[0].physicalLocation.artifactLocation.uri).toBe("glotfile/keys.json");
    expect(result.locations[0].physicalLocation.region.startLine).toBe(2);
  });
});
