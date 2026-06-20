// Fold away only differences that don't change the source's meaning — leading/
// trailing and runs of whitespace. Case is meaningful (title vs sentence case,
// acronyms, emphasis), so it is preserved: a case-only edit counts as a real
// source change, re-flagging translations and resurfacing lint.
export function normalizeSource(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}
