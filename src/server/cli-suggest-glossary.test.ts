import { expect, test } from "vitest";
import { parseArgs } from "./cli.js";

test("parseArgs recognizes suggest-glossary with scoping flags", () => {
  const a = parseArgs(["suggest-glossary", "--key", "auth.*", "--limit", "50", "--since", "2026-01-01", "--estimate"]);
  expect(a.command).toBe("suggest-glossary");
  expect(a.keyGlob).toBe("auth.*");
  expect(a.limit).toBe(50);
  expect(a.since).toBe("2026-01-01");
  expect(a.estimate).toBe(true);
});
