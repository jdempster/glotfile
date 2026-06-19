import type { GlossaryEntry } from "./types.js";

// Case-insensitive substring search over term, aliases, notes, and pinned
// translations (both locale codes and values).
export function filterGlossary(entries: GlossaryEntry[], query: string): GlossaryEntry[] {
  const q = query.trim().toLowerCase();
  if (q === "") return entries;
  return entries.filter((entry) => {
    if (entry.term.toLowerCase().includes(q)) return true;
    if ((entry.aliases ?? []).some((a) => a.toLowerCase().includes(q))) return true;
    if ((entry.notes ?? "").toLowerCase().includes(q)) return true;
    return Object.entries(entry.translations ?? {}).some(
      ([locale, value]) => locale.toLowerCase().includes(q) || value.toLowerCase().includes(q),
    );
  });
}
