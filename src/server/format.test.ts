import { describe, it, expect } from "vitest";
import { serializeJson, type FormatOptions } from "./format.js";

const opts: FormatOptions = { indent: 2, sortKeys: true, finalNewline: true };

describe("serializeJson", () => {
  it("sorts object keys deeply but preserves array order", () => {
    const out = serializeJson({ b: 1, a: { d: 2, c: 3 }, list: ["z", "a"] }, opts);
    expect(out).toBe('{\n  "a": {\n    "c": 3,\n    "d": 2\n  },\n  "b": 1,\n  "list": [\n    "z",\n    "a"\n  ]\n}\n');
  });

  it("uses \\n line endings and a single trailing newline", () => {
    const out = serializeJson({ a: 1 }, opts);
    expect(out.includes("\r")).toBe(false);
    expect(out.endsWith("}\n")).toBe(true);
    expect(out.endsWith("}\n\n")).toBe(false);
  });

  it("is idempotent — re-serializing parsed output is byte-identical", () => {
    const value = { keys: { "z.a": { v: 1 }, "a.b": { v: 2 } }, n: 3 };
    const once = serializeJson(value, opts);
    const twice = serializeJson(JSON.parse(once), opts);
    expect(twice).toBe(once);
  });

  it("honors indent and finalNewline options", () => {
    expect(serializeJson({ a: 1 }, { indent: 4, sortKeys: true, finalNewline: false }))
      .toBe('{\n    "a": 1\n}');
  });

  it("preserves insertion order when sortKeys is false", () => {
    expect(serializeJson({ b: 1, a: 2 }, { indent: 2, sortKeys: false, finalNewline: false }))
      .toBe('{\n  "b": 1,\n  "a": 2\n}');
  });
});
