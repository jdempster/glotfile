export function normalizeSource(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}
