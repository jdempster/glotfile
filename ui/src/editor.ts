// Per-developer "open in editor" preference. Stored server-side in the project's
// gitignored .glotfile/settings.json (via /local-settings), NOT in the committed
// project config — which editor you run is personal, and it's now per-project so
// a PHP project and a Flutter project can open different editors on the same machine.
import { ref } from "vue";
import { getLocalSettings, putLocalSettings } from "@/api";

export type EditorId = "vscode" | "zed" | "phpstorm";

export interface UsageRef {
  // Project-relative path (PhpStorm's deep link wants this); absolute path (the
  // VS Code / Zed schemes want this).
  file: string;
  abs: string;
  line: number;
  col: number;
}

export interface EditorDef {
  id: EditorId;
  label: string;
  // Returns the editor's deep-link URL, or null when it can't be built.
  buildUrl: (ref: UsageRef, project: string) => string | null;
}

// abs begins with "/", so `vscode://file` + `/Users/…` → `vscode://file/Users/…`.
export const EDITORS: EditorDef[] = [
  {
    id: "phpstorm",
    label: "PhpStorm",
    buildUrl: (r) => `phpstorm://open?file=${encodeURIComponent(r.abs)}&line=${r.line}`,
  },
  { id: "vscode", label: "VS Code", buildUrl: (r) => `vscode://file${r.abs}:${r.line}:${r.col}` },
  { id: "zed", label: "Zed", buildUrl: (r) => `zed://file${r.abs}:${r.line}:${r.col}` },
];

const DEFAULT_EDITOR: EditorId = "vscode";
const isEditorId = (v: unknown): v is EditorId => EDITORS.some((e) => e.id === v);

// App-wide reactive state so editor links re-render the instant the choice changes.
// Hydrated from the server on startup (hydrateEditor) — the server file is the
// source of truth, which is what makes the preference per-project.
export const currentEditor = ref<EditorId>(DEFAULT_EDITOR);

export function getEditor(): EditorId {
  return currentEditor.value;
}

export function setEditor(id: EditorId): void {
  if (!isEditorId(id)) return;
  currentEditor.value = id;
  void putLocalSettings({ editor: id }).catch(() => {});
}

// Pull the per-project editor from the server after mount. Invalid/absent values
// keep the default; a failed fetch (offline) leaves the current choice in place.
export async function hydrateEditor(): Promise<void> {
  try {
    const { editor } = await getLocalSettings();
    if (isEditorId(editor)) currentEditor.value = editor;
  } catch {
    /* offline or API error: keep the default */
  }
}

export function buildOpenUrl(ref: UsageRef, project: string): string | null {
  const editor = EDITORS.find((e) => e.id === currentEditor.value) ?? EDITORS[0]!;
  return editor.buildUrl(ref, project);
}
