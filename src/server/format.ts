export interface FormatOptions {
  indent: number;
  sortKeys: boolean;
  finalNewline: boolean;
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = sortDeep((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

// Deterministic JSON: stable key order, fixed indent, LF newlines, optional
// trailing newline. JSON.stringify always emits "\n" for pretty-print and
// escapes any newline inside string data, so no OS line-ending leaks in.
export function serializeJson(value: unknown, opts: FormatOptions): string {
  const prepared = opts.sortKeys ? sortDeep(value) : value;
  const body = JSON.stringify(prepared, null, opts.indent);
  return opts.finalNewline ? body + "\n" : body;
}
