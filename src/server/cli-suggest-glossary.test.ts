import { expect, test, describe, it, vi, afterEach } from "vitest";
import { parseArgs, main } from "./cli.js";

const VAR = "GLOTFILE_BETA_GLOSSARY_SUGGEST";

test("parseArgs recognizes suggest-glossary with scoping flags", () => {
  const a = parseArgs(["suggest-glossary", "--key", "auth.*", "--limit", "50", "--since", "2026-01-01", "--estimate"]);
  expect(a.command).toBe("suggest-glossary");
  expect(a.keyGlob).toBe("auth.*");
  expect(a.limit).toBe(50);
  expect(a.since).toBe("2026-01-01");
  expect(a.estimate).toBe(true);
});

test("parseArgs recognizes suggest-glossary --batch", () => {
  expect(parseArgs(["suggest-glossary", "--batch"]).batch).toBe(true);
});

describe("suggest-glossary beta gate", () => {
  afterEach(() => {
    delete process.env[VAR];
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  it("hides the command from `glotfile help` when disabled", async () => {
    delete process.env[VAR];
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await main(["help"]);
    const out = log.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).not.toContain("suggest-glossary");
  });

  it("lists the command in `glotfile help` when enabled", async () => {
    process.env[VAR] = "1";
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await main(["help"]);
    const out = log.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toContain("suggest-glossary");
  });

  it("refuses to run and exits non-zero when disabled", async () => {
    delete process.env[VAR];
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await main(["suggest-glossary"]);
    expect(err).toHaveBeenCalledWith(expect.stringContaining(VAR));
    expect(process.exitCode).toBe(1);
  });
});
