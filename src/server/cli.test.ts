import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs, runPrune, runSkill, main, watchTargetFor } from "./cli.js";
import { defaultState } from "./schema.js";
import { createKey, saveState } from "./state.js";

describe("parseArgs", () => {
  it("defaults to serve", () => {
    expect(parseArgs([]).command).toBe("serve");
  });
  it("parses translate flags", () => {
    const a = parseArgs(["translate", "--locale", "fr,de", "--only", "missing", "--key", "auth.*"]);
    expect(a.command).toBe("translate");
    expect(a.locales).toEqual(["fr", "de"]);
    expect(a.onlyMissing).toBe(true);
    expect(a.keyGlob).toBe("auth.*");
  });
  it("parses translate --estimate", () => {
    const a = parseArgs(["translate", "--estimate"]);
    expect(a.command).toBe("translate");
    expect(a.estimate).toBe(true);
  });
  it("parses export adapter filter", () => {
    const a = parseArgs(["export", "--adapter", "flutter-arb"]);
    expect(a.command).toBe("export");
    expect(a.adapter).toBe("flutter-arb");
  });
  it("parses the --dev flag for serve", () => {
    expect(parseArgs(["serve", "--dev"]).dev).toBe(true);
  });
  it("parses --no-open for serve", () => {
    expect(parseArgs(["serve", "--no-open"]).noOpen).toBe(true);
    expect(parseArgs(["serve"]).noOpen).toBeUndefined();
  });
  it("resolves --file to an absolute statePath", () => {
    const a = parseArgs(["serve", "--file", "examples/demo.glotfile.json"]);
    expect(a.statePath.endsWith("examples/demo.glotfile.json")).toBe(true);
    expect(a.statePath.startsWith("/")).toBe(true);
  });
  it("parses the import --cldr flag", () => {
    expect(parseArgs(["import", "--cldr"]).importCldr).toBe(true);
    expect(parseArgs(["import"]).importCldr).toBeUndefined();
  });
  it("parses lint flags", () => {
    const a = parseArgs(["lint", "--format", "json", "--locale", "fr,de", "--rule", "spelling,max-length", "--max-warnings", "0"]);
    expect(a.command).toBe("lint");
    expect(a.format).toBe("json");
    expect(a.locales).toEqual(["fr", "de"]);
    expect(a.ruleIds).toEqual(["spelling", "max-length"]);
    expect(a.maxWarnings).toBe(0);
  });
  it("parses lint --accept and --include-suppressed", () => {
    const a = parseArgs(["lint", "--accept", "--include-suppressed", "--rule", "identical-to-source"]);
    expect(a.accept).toBe(true);
    expect(a.includeSuppressed).toBe(true);
    expect(a.ruleIds).toEqual(["identical-to-source"]);
    expect(parseArgs(["lint"]).accept).toBeUndefined();
  });
  it("parses the check command and defaults format to text", () => {
    const a = parseArgs(["check"]);
    expect(a.command).toBe("check");
    expect(a.format).toBeUndefined();
  });
  it("parses the import command and its flags", () => {
    const a = parseArgs(["import", "--source", "/tmp/myapp", "--format", "laravel-php", "--source-locale", "en", "--locales", "en,fr", "--force"]);
    expect(a.command).toBe("import");
    expect(a.importSource).toBe("/tmp/myapp");
    expect(a.importFormat).toBe("laravel-php");
    expect(a.importSourceLocale).toBe("en");
    expect(a.locales).toEqual(["en", "fr"]);
    expect(a.importForce).toBe(true);
  });

  it("parses build-context command", () => {
    expect(parseArgs(["build-context"]).command).toBe("build-context");
  });
  it("parses build-context --all flag", () => {
    expect(parseArgs(["build-context", "--all"]).all).toBe(true);
  });
  it("parses build-context --key glob", () => {
    expect(parseArgs(["build-context", "--key", "auth.*"]).keyGlob).toBe("auth.*");
  });
  it("parses build-context --limit", () => {
    expect(parseArgs(["build-context", "--limit", "10"]).limit).toBe(10);
  });
  it("parses build-context --since", () => {
    expect(parseArgs(["build-context", "--since", "2026-06-01"]).since).toBe("2026-06-01");
  });
  it("parses suggest-guidance command and --context flag", () => {
    expect(parseArgs(["suggest-guidance", "--context"]).command).toBe("suggest-guidance");
    expect(parseArgs(["suggest-guidance", "--context"]).context).toBe(true);
  });
  it("parses suggest-guidance --locale", () => {
    expect(parseArgs(["suggest-guidance", "--locale", "fr"]).locales).toEqual(["fr"]);
  });
  it("parses the prune command and its flags", () => {
    const a = parseArgs(["prune", "--empty-source", "--write"]);
    expect(a.command).toBe("prune");
    expect(a.emptySource).toBe(true);
    expect(a.write).toBe(true);
  });
  it("parses the prune --unused flag", () => {
    const a = parseArgs(["prune", "--unused", "--write"]);
    expect(a.command).toBe("prune");
    expect(a.unused).toBe(true);
    expect(a.write).toBe(true);
  });
  it("leaves unused undefined when --unused is absent", () => {
    expect(parseArgs(["prune", "--empty-source"]).unused).toBeUndefined();
  });

  it("treats --help, -h, and help as a top-level help request", () => {
    expect(parseArgs(["--help"]).command).toBe("help");
    expect(parseArgs(["-h"]).command).toBe("help");
    expect(parseArgs(["help"]).command).toBe("help");
  });
  it("routes `help <command>` to that command's help", () => {
    const a = parseArgs(["help", "prune"]);
    expect(a.command).toBe("prune");
    expect(a.help).toBe(true);
  });
  it("sets help when a command is given --help or -h", () => {
    expect(parseArgs(["prune", "--help"]).help).toBe(true);
    expect(parseArgs(["lint", "-h"]).help).toBe(true);
    expect(parseArgs(["lint", "-h"]).command).toBe("lint");
  });

  it("treats --version, -v, and version as a version request, not serve", () => {
    expect(parseArgs(["--version"]).command).toBe("version");
    expect(parseArgs(["-v"]).command).toBe("version");
    expect(parseArgs(["version"]).command).toBe("version");
  });

  it("flags an unknown command rather than defaulting to serve", () => {
    expect(parseArgs(["exprot"]).unknownCommand).toBe("exprot");
  });
  it("does not flag the bare (default-serve) invocation as unknown", () => {
    const a = parseArgs([]);
    expect(a.command).toBe("serve");
    expect(a.unknownCommand).toBeUndefined();
  });
  it("treats a leading flag as serve options, not an unknown command", () => {
    const a = parseArgs(["--dev"]);
    expect(a.command).toBe("serve");
    expect(a.unknownCommand).toBeUndefined();
    expect(a.dev).toBe(true);
  });

  it("parses the skill command and its flags", () => {
    expect(parseArgs(["skill"]).command).toBe("skill");
    expect(parseArgs(["skill", "--print"]).print).toBe(true);
    expect(parseArgs(["skill", "--force"]).importForce).toBe(true);
    expect(parseArgs(["skill"]).print).toBeUndefined();
  });

  it("parses translate --state into a list", () => {
    const a = parseArgs(["translate", "--state", "needs-review,missing"]);
    expect(a.command).toBe("translate");
    expect(a.states).toEqual(["needs-review", "missing"]);
  });

  it("parses get with positional globs, --locale, --state, --fields, --keys-only", () => {
    const a = parseArgs(["get", "auth.*", "home.title", "--locale", "en,de", "--state", "missing", "--fields", "value", "--keys-only", "--format", "ndjson"]);
    expect(a.command).toBe("get");
    expect(a.positionals).toEqual(["auth.*", "home.title"]);
    expect(a.locales).toEqual(["en", "de"]);
    expect(a.states).toEqual(["missing"]);
    expect(a.fields).toEqual(["value"]);
    expect(a.keysOnly).toBe(true);
    expect(a.format).toBe("ndjson");
  });

  it("parses set positionals, --value, --create", () => {
    const a = parseArgs(["set", "auth.login", "Sign in", "--locale", "fr", "--state", "machine", "--create"]);
    expect(a.command).toBe("set");
    expect(a.positionals).toEqual(["auth.login", "Sign in"]);
    expect(a.locales).toEqual(["fr"]);
    expect(a.states).toEqual(["machine"]);
    expect(a.create).toBe(true);
  });

  it("parses apply flags", () => {
    const a = parseArgs(["apply", "--dry-run", "--continue-on-error"]);
    expect(a.command).toBe("apply");
    expect(a.dryRun).toBe(true);
    expect(a.continueOnError).toBe(true);
  });
});

describe("main help output", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("prints a usage overview listing every command for --help", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await main(["--help"]);
    const out = log.mock.calls.flat().join("\n");
    expect(out).toContain("Usage:");
    for (const cmd of ["serve", "export", "translate", "lint", "check", "import", "build-context", "scan", "prune"]) {
      expect(out).toContain(cmd);
    }
  });

  it("prints command-specific options for `prune --help`", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await main(["prune", "--help"]);
    const out = log.mock.calls.flat().join("\n");
    expect(out).toContain("--empty-source");
    expect(out).toContain("--unused");
    expect(out).toContain("--write");
  });
});

describe("main version output", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("prints the package version and does not start the server", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await main(["--version"]);
    const out = log.mock.calls.flat().join("\n");
    expect(out).toMatch(/^\d+\.\d+\.\d+/);
    expect(out).not.toContain("running at");
  });
});

describe("main unknown command", () => {
  afterEach(() => { process.exitCode = 0; vi.restoreAllMocks(); });

  it("errors, exits non-zero, and does not start the server on a typo", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await main(["exprot"]);
    expect(process.exitCode).toBe(1);
    expect(err.mock.calls.flat().join("\n")).toContain("exprot");
    expect(log.mock.calls.flat().join("\n")).not.toContain("running at");
  });
});

describe("lint --rule validation", () => {
  afterEach(() => { process.exitCode = 0; vi.restoreAllMocks(); });

  function tmpState() {
    const dir = mkdtempSync(join(tmpdir(), "glot-rule-"));
    const file = join(dir, "glotfile.json");
    const s = defaultState();
    s.config.sourceLocale = "en";
    s.config.locales = ["en", "fr"];
    saveState(file, s);
    return file;
  }

  it("errors and exits non-zero on an unknown rule id instead of reporting clean", async () => {
    const file = tmpState();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await main(["lint", "--rule", "glossary", "--file", file]);
    expect(process.exitCode).toBe(1);
    const errText = err.mock.calls.flat().join("\n");
    expect(errText).toContain("glossary");
    // Suggests the real id rather than silently passing.
    expect(errText).toContain("glossary-violation");
    // Must not print a clean report.
    expect(log.mock.calls.flat().join("\n")).not.toContain("no problems");
  });

  it("accepts a valid rule id", async () => {
    const file = tmpState();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    await main(["lint", "--rule", "placeholder-mismatch", "--file", file]);
    expect(process.exitCode).toBe(0);
    expect(err.mock.calls.flat().join("\n")).not.toContain("Unknown --rule");
  });
});

describe("runPrune", () => {
  afterEach(() => { process.exitCode = 0; vi.restoreAllMocks(); });

  function fileWith(...pairs: Array<[string, string]>) {
    const dir = mkdtempSync(join(tmpdir(), "glot-"));
    const file = join(dir, "glotfile.json");
    const s = defaultState();
    for (const [k, v] of pairs) createKey(s, k, v);
    saveState(file, s);
    return file;
  }

  it("dry-run lists empty-source keys and does NOT save", async () => {
    const file = fileWith(["full", "Hi"], ["blank", ""]);
    const before = readFileSync(file, "utf8");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runPrune({ command: "prune", statePath: file, emptySource: true });
    expect(log.mock.calls.flat().join("\n")).toContain("blank");
    expect(log.mock.calls.flat().join("\n")).toContain("--write");
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("--write removes empty-source keys and saves", async () => {
    const file = fileWith(["full", "Hi"], ["blank", ""]);
    vi.spyOn(console, "log").mockImplementation(() => {});
    await runPrune({ command: "prune", statePath: file, emptySource: true, write: true });
    const saved = JSON.parse(readFileSync(file, "utf8"));
    expect(Object.keys(saved.keys)).toEqual(["full"]);
  });

  it("reports when there is nothing to prune", async () => {
    const file = fileWith(["full", "Hi"]);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runPrune({ command: "prune", statePath: file, emptySource: true, write: true });
    expect(log.mock.calls.flat().join("\n")).toContain("No keys to prune");
  });

  // A temp project: glotfile.json with the given keys (each seeded with a
  // non-empty source so the empty-source selector ignores them), plus an app.ts
  // source file whose contents drive the scanner's reference detection.
  function projectWith(opts: { keys: string[]; source: string }) {
    const dir = mkdtempSync(join(tmpdir(), "glot-"));
    const file = join(dir, "glotfile.json");
    const s = defaultState();
    for (const k of opts.keys) createKey(s, k, k);
    saveState(file, s);
    writeFileSync(join(dir, "app.ts"), opts.source, "utf8");
    return file;
  }

  it("prune --unused dry-run lists unreferenced keys and does NOT save", async () => {
    const file = projectWith({ keys: ["used.key", "dead.key"], source: "t('used.key')\n" });
    const before = readFileSync(file, "utf8");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runPrune({ command: "prune", statePath: file, unused: true });
    const out = log.mock.calls.flat().join("\n");
    expect(out).toContain("dead.key");
    expect(out).not.toContain("used.key");
    expect(out).toContain("Run with --write");
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("prune --unused --write removes unreferenced keys and keeps referenced ones", async () => {
    const file = projectWith({ keys: ["used.key", "dead.key"], source: "t('used.key')\n" });
    vi.spyOn(console, "log").mockImplementation(() => {});
    await runPrune({ command: "prune", statePath: file, unused: true, write: true });
    const saved = JSON.parse(readFileSync(file, "utf8"));
    expect(Object.keys(saved.keys)).toEqual(["used.key"]);
  });

  it("prune --unused keeps a key covered only by a dynamic prefix", async () => {
    const file = projectWith({ keys: ["errors.timeout"], source: "t('errors.' + code)\n" });
    vi.spyOn(console, "log").mockImplementation(() => {});
    await runPrune({ command: "prune", statePath: file, unused: true, write: true });
    const saved = JSON.parse(readFileSync(file, "utf8"));
    expect(Object.keys(saved.keys)).toEqual(["errors.timeout"]);
  });

  it("prune --unused --empty-source --write removes the union of both sets", async () => {
    const dir = mkdtempSync(join(tmpdir(), "glot-"));
    const file = join(dir, "glotfile.json");
    const s = defaultState();
    createKey(s, "used.key", "Used");
    createKey(s, "dead.key", "Dead");
    createKey(s, "blank", "");
    saveState(file, s);
    // "used.key" and "blank" are referenced; "dead.key" is not. "blank" has an
    // empty source. So --unused catches dead.key, --empty-source catches blank.
    writeFileSync(join(dir, "app.ts"), "t('used.key')\nt('blank')\n", "utf8");
    vi.spyOn(console, "log").mockImplementation(() => {});
    await runPrune({ command: "prune", statePath: file, unused: true, emptySource: true, write: true });
    const saved = JSON.parse(readFileSync(file, "utf8"));
    expect(Object.keys(saved.keys)).toEqual(["used.key"]);
  });

  it("errors and exits non-zero without a selector flag", async () => {
    const file = fileWith(["blank", ""]);
    const before = readFileSync(file, "utf8");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await runPrune({ command: "prune", statePath: file });
    expect(process.exitCode).toBe(1);
    expect(err).toHaveBeenCalled();
    expect(readFileSync(file, "utf8")).toBe(before);
  });
});

describe("runSkill", () => {
  afterEach(() => { process.exitCode = 0; vi.restoreAllMocks(); });

  it("installs SKILL.md and references into .claude/skills/glotfile/", async () => {
    const dir = mkdtempSync(join(tmpdir(), "glot-skill-"));
    vi.spyOn(process, "cwd").mockReturnValue(dir);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runSkill({ command: "skill", statePath: join(dir, "glotfile.json") });
    const base = join(dir, ".claude", "skills", "glotfile");
    expect(existsSync(join(base, "SKILL.md"))).toBe(true);
    expect(existsSync(join(base, "references", "schema.md"))).toBe(true);
    expect(readFileSync(join(base, "SKILL.md"), "utf8")).toContain("name: glotfile");
    expect(log.mock.calls.flat().join("\n")).toContain(base);
  });

  it("--print writes SKILL.md to stdout and installs nothing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "glot-skill-"));
    vi.spyOn(process, "cwd").mockReturnValue(dir);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runSkill({ command: "skill", statePath: join(dir, "glotfile.json"), print: true });
    expect(log.mock.calls.flat().join("\n")).toContain("name: glotfile");
    expect(existsSync(join(dir, ".claude"))).toBe(false);
  });

  it("refuses to overwrite an existing install without --force", async () => {
    const dir = mkdtempSync(join(tmpdir(), "glot-skill-"));
    vi.spyOn(process, "cwd").mockReturnValue(dir);
    const base = join(dir, ".claude", "skills", "glotfile");
    mkdirSync(base, { recursive: true });
    writeFileSync(join(base, "SKILL.md"), "old", "utf8");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    await runSkill({ command: "skill", statePath: join(dir, "glotfile.json") });
    expect(process.exitCode).toBe(1);
    expect(err.mock.calls.flat().join("\n")).toContain("--force");
    expect(readFileSync(join(base, "SKILL.md"), "utf8")).toBe("old");
  });

  it("--force overwrites an existing install", async () => {
    const dir = mkdtempSync(join(tmpdir(), "glot-skill-"));
    vi.spyOn(process, "cwd").mockReturnValue(dir);
    const base = join(dir, ".claude", "skills", "glotfile");
    mkdirSync(base, { recursive: true });
    writeFileSync(join(base, "SKILL.md"), "old", "utf8");
    vi.spyOn(console, "log").mockImplementation(() => {});
    await runSkill({ command: "skill", statePath: join(dir, "glotfile.json"), importForce: true });
    expect(readFileSync(join(base, "SKILL.md"), "utf8")).toContain("name: glotfile");
  });
});

describe("agent commands (get/set/set-state/clear/stats)", () => {
  afterEach(() => { process.exitCode = 0; vi.restoreAllMocks(); });

  function tmpState(build: (s: ReturnType<typeof defaultState>) => void) {
    const dir = mkdtempSync(join(tmpdir(), "glot-agent-"));
    const file = join(dir, "glotfile.json");
    const s = defaultState();
    s.config.sourceLocale = "en";
    s.config.locales = ["en", "fr", "de"];
    build(s);
    saveState(file, s);
    return file;
  }
  const read = (file: string) => JSON.parse(readFileSync(file, "utf8"));
  const captureLog = () => vi.spyOn(console, "log").mockImplementation(() => {});

  it("get prints filtered JSON keyed by key -> locale -> {value,state}", async () => {
    const file = tmpState((s) => {
      createKey(s, "auth.login", "Log in");
      s.keys["auth.login"]!.values.fr = { value: "Connexion", state: "reviewed" };
    });
    const log = captureLog();
    await main(["get", "auth.login", "--file", file]);
    const out = JSON.parse(log.mock.calls.flat().join(""));
    expect(out["auth.login"]).toEqual({
      en: { value: "Log in", state: "source" },
      fr: { value: "Connexion", state: "reviewed" },
      de: { value: "", state: "missing" },
    });
  });

  it("get --keys-only lists matched keys", async () => {
    const file = tmpState((s) => { createKey(s, "a.one", "1"); createKey(s, "a.two", "2"); createKey(s, "b.one", "3"); });
    const log = captureLog();
    await main(["get", "a.*", "--keys-only", "--file", file]);
    expect(log.mock.calls.flat()).toEqual(["a.one", "a.two"]);
  });

  it("set (source) updates the value and flips reviewed targets to needs-review", async () => {
    const file = tmpState((s) => {
      createKey(s, "auth.login", "Log in");
      s.keys["auth.login"]!.values.fr = { value: "Connexion", state: "reviewed" };
    });
    const log = captureLog();
    await main(["set", "auth.login", "Sign in", "--file", file]);
    const saved = read(file);
    expect(saved.keys["auth.login"].values.en.value).toBe("Sign in");
    expect(saved.keys["auth.login"].values.fr.state).toBe("needs-review");
    expect(log.mock.calls.flat().join("\n")).toContain("need re-translation");
  });

  it("set --locale writes a target value (reviewed by default)", async () => {
    const file = tmpState((s) => createKey(s, "auth.login", "Log in"));
    captureLog();
    await main(["set", "auth.login", "Connexion", "--locale", "fr", "--file", file]);
    expect(read(file).keys["auth.login"].values.fr).toMatchObject({ value: "Connexion", state: "reviewed" });
  });

  it("set --create makes a missing key", async () => {
    const file = tmpState(() => {});
    captureLog();
    await main(["set", "home.cta", "Get started", "--create", "--file", file]);
    expect(read(file).keys["home.cta"].values.en.value).toBe("Get started");
  });

  it("set-state flips state across keys matched by a glob", async () => {
    const file = tmpState((s) => {
      createKey(s, "auth.login", "Log in");
      s.keys["auth.login"]!.values.fr = { value: "Connexion", state: "machine" };
      createKey(s, "auth.logout", "Log out");
      s.keys["auth.logout"]!.values.fr = { value: "Déconnexion", state: "machine" };
    });
    const log = captureLog();
    await main(["set-state", "auth.*", "reviewed", "--locale", "fr", "--file", file]);
    const saved = read(file);
    expect(saved.keys["auth.login"].values.fr.state).toBe("reviewed");
    expect(saved.keys["auth.logout"].values.fr.state).toBe("reviewed");
    expect(log.mock.calls.flat().join("\n")).toContain("2 cell(s)");
  });

  it("clear empties a target so it reads as untranslated; refuses the source", async () => {
    const file = tmpState((s) => {
      createKey(s, "auth.login", "Log in");
      s.keys["auth.login"]!.values.fr = { value: "Connexion", state: "reviewed" };
    });
    captureLog();
    await main(["clear", "auth.login", "--locale", "fr", "--file", file]);
    expect(read(file).keys["auth.login"].values.fr).toBeUndefined();

    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await main(["clear", "auth.login", "--locale", "en", "--file", file]);
    expect(process.exitCode).toBe(1);
    expect(err.mock.calls.flat().join("\n")).toContain("source locale");
  });

  it("stats reports per-locale counts as JSON", async () => {
    const file = tmpState((s) => {
      createKey(s, "auth.login", "Log in");
      s.keys["auth.login"]!.values.fr = { value: "Connexion", state: "reviewed" };
    });
    const log = captureLog();
    await main(["stats", "--file", file]);
    const out = JSON.parse(log.mock.calls.flat().join(""));
    expect(out.totals.keys).toBe(1);
    const fr = out.locales.find((l: { locale: string }) => l.locale === "fr");
    expect(fr.counts.reviewed).toBe(1);
    expect(out.locales.find((l: { locale: string }) => l.locale === "de").counts.missing).toBe(1);
  });
});

describe("watchTargetFor", () => {
  it("watches the single file (non-recursive) when not split", () => {
    const dir = mkdtempSync(join(tmpdir(), "glot-"));
    const p = join(dir, "glotfile.json");
    writeFileSync(p, "{}");
    expect(watchTargetFor(p)).toEqual({ path: p, recursive: false });
  });
  it("watches the split directory recursively when split", () => {
    const dir = mkdtempSync(join(tmpdir(), "glot-"));
    const p = join(dir, "glotfile.json");
    mkdirSync(join(dir, "glotfile"));
    writeFileSync(join(dir, "glotfile", "config.json"), "{}");
    expect(watchTargetFor(p)).toEqual({ path: join(dir, "glotfile"), recursive: true });
  });
});

describe("glotfile split", () => {
  it("converts a single file into a glotfile/ directory and removes the file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "glot-"));
    const p = join(dir, "glotfile.json");
    writeFileSync(p, JSON.stringify({
      version: 1,
      config: {
        sourceLocale: "en", locales: ["en", "fr"], outputs: [],
        ai: { provider: "anthropic", model: "m", endpoint: null, batchSize: 25 },
        format: { indent: 2, sortKeys: true, finalNewline: true },
      },
      glossary: [],
      keys: { "x.key": { values: { en: { value: "Hi", state: "source" } } } },
    }));
    await main(["split", "--file", p]);
    expect(existsSync(join(dir, "glotfile", "config.json"))).toBe(true);
    expect(existsSync(join(dir, "glotfile", "locales", "en.json"))).toBe(true);
    expect(existsSync(p)).toBe(false);
    expect(JSON.parse(readFileSync(join(dir, "glotfile", "config.json"), "utf8")).config.storage).toBe("split");
  });
});
