import { createHash } from "node:crypto";
import { normalizeSource } from "../normalize.js";
import type { KeyEntry, Suppression } from "../schema.js";

// A suppression is tied to the source content it was accepted against: it hides
// one (rule, locale) finding only while the key's source still hashes the same,
// so editing the source resurfaces the warning automatically.

function sourceSignature(entry: KeyEntry, sourceLocale: string): string {
  const lv = entry.values[sourceLocale];
  if (entry.plural) {
    return Object.entries(lv?.forms ?? {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([cat, body]) => `${cat}:${normalizeSource(body ?? "")}`)
      .join("|");
  }
  return normalizeSource(lv?.value ?? "");
}

export function sourceHash(entry: KeyEntry, sourceLocale: string): string {
  return createHash("sha256").update(sourceSignature(entry, sourceLocale)).digest("hex").slice(0, 12);
}

export function findSuppression(
  entry: KeyEntry, sourceLocale: string, ruleId: string, locale: string,
): Suppression | undefined {
  if (!entry.suppressions?.length) return undefined;
  const current = sourceHash(entry, sourceLocale);
  return entry.suppressions.find((s) => s.rule === ruleId && s.locale === locale && s.source === current);
}

export function pruneStaleSuppressions(entry: KeyEntry, sourceLocale: string): void {
  if (!entry.suppressions?.length) return;
  const current = sourceHash(entry, sourceLocale);
  entry.suppressions = entry.suppressions.filter((s) => s.source === current);
  if (!entry.suppressions.length) delete entry.suppressions;
}
