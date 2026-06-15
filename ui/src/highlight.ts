export interface Segment {
  text: string;
  placeholder: boolean;
}

// Canonical tokens only: an ICU plural/select block, or a simple {name}.
// Values are stored canonically (import normalizes :name, {{name}}, %d away),
// so we never highlight those flavors. ICU must come first so its outer braces
// aren't consumed by the simpler {name} rule.
const ICU = /\{\s*[A-Za-z0-9_]+\s*,\s*(?:plural|select|selectordinal)\s*,(?:[^{}]|\{[^{}]*\})*\}/;
const SINGLE = /\{\s*[A-Za-z0-9_.]+\s*\}/;

const COMBINED = new RegExp([ICU.source, SINGLE.source].join("|"), "g");

// Ranges covered by ICU apostrophe-quoted literals ('{', '{name}', …). A token
// match that starts inside one of these is literal text, not a placeholder.
function quotedRanges(value: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  if (!value.includes("'")) return ranges;
  for (let i = 0; i < value.length; ) {
    if (value[i] === "'") {
      const next = value[i + 1];
      if (next === "'") {
        i += 2;
        continue;
      }
      if (next === "{" || next === "}" || next === "#" || next === "|") {
        const start = i;
        i += 2;
        while (i < value.length && value[i] !== "'") i++;
        const end = i < value.length ? i + 1 : i;
        ranges.push([start, end]);
        i = end;
        continue;
      }
    }
    i++;
  }
  return ranges;
}

// Split a value into plain/placeholder segments for highlighted rendering.
export function highlightSegments(value: string): Segment[] {
  if (!value) return [];
  const quoted = quotedRanges(value);
  const inQuoted = (i: number): boolean => quoted.some(([s, e]) => i >= s && i < e);
  const segments: Segment[] = [];
  let lastIndex = 0;
  COMBINED.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = COMBINED.exec(value)) !== null) {
    // Guard against zero-length matches (shouldn't happen, but keeps the loop safe).
    if (match[0].length === 0) {
      COMBINED.lastIndex++;
      continue;
    }
    // A token inside an apostrophe-quoted span is literal text — leave it plain.
    if (inQuoted(match.index)) continue;
    if (match.index > lastIndex) {
      segments.push({ text: value.slice(lastIndex, match.index), placeholder: false });
    }
    segments.push({ text: match[0], placeholder: true });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < value.length) {
    segments.push({ text: value.slice(lastIndex), placeholder: false });
  }
  return segments;
}
