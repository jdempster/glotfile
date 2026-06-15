export function flattenObject(
  value: unknown,
  prefix: string,
  warnings: string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (node: unknown, path: string): void => {
    if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") {
      // A literal dotted key and a nested path can collapse to the same flat key
      // (e.g. {"a.b": …} and {a: {b: …}}); warn rather than silently overwrite.
      if (path in out) warnings.push(`duplicate flattened key "${path}" — keeping the first value`);
      else out[path] = typeof node === "string" ? node : String(node);
    } else if (Array.isArray(node)) {
      node.forEach((el, i) => walk(el, path ? `${path}.${i}` : String(i)));
    } else if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        walk(v, path ? `${path}.${k}` : k);
      }
    } else {
      warnings.push(`skipped non-string value at "${path || "(root)"}"`);
    }
  };
  walk(value, prefix.replace(/\.$/, ""));
  return out;
}
