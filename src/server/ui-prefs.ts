import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { writeFileAtomic } from "./atomic-write.js";

export type ThemeMode = "system" | "light" | "dark";

export interface UiPrefs {
  theme: ThemeMode;
  // Sidebar widths in px, only present once the user has resized away from the
  // UI defaults (which live in the UI layer, not here).
  keyColumnWidth?: number;
  detailPanelWidth?: number;
}

const THEMES: ThemeMode[] = ["system", "light", "dark"];
export const isThemeMode = (v: unknown): v is ThemeMode => THEMES.includes(v as ThemeMode);

// Generous sanity bounds; the UI clamps to its own tighter per-panel ranges.
export const isPanelWidth = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 120 && v <= 1200;

// Per-machine UI preferences, deliberately global (not per-project) so the theme
// follows the user across every glotfile instance regardless of port or host.
export const defaultUiPrefsPath = (): string => join(homedir(), ".glotfile", "ui.json");

const DEFAULTS: UiPrefs = { theme: "system" };

function readJson(path: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function loadUiPrefs(path: string): UiPrefs {
  const raw = readJson(path);
  const prefs: UiPrefs = { theme: isThemeMode(raw.theme) ? raw.theme : DEFAULTS.theme };
  if (isPanelWidth(raw.keyColumnWidth)) prefs.keyColumnWidth = Math.round(raw.keyColumnWidth);
  if (isPanelWidth(raw.detailPanelWidth)) prefs.detailPanelWidth = Math.round(raw.detailPanelWidth);
  return prefs;
}

// Read-modify-write so future keys we don't model here are preserved.
export function saveUiPrefs(path: string, prefs: Partial<UiPrefs>): void {
  const merged = { ...readJson(path), ...prefs };
  writeFileAtomic(path, JSON.stringify(merged, null, 2) + "\n");
}
