import { describe, it, expect, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStateWatcher } from "./watch.js";
import { loadState, saveState } from "./state.js";
import { defaultState, type State } from "./schema.js";

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), "glot-watch-"));
}

function makeState(value: string, opts: { split?: boolean } = {}): State {
  const s = defaultState();
  s.config.locales = ["en", "fr"];
  s.config.sourceLocale = "en";
  if (opts.split) s.config.storage = "split";
  s.keys["greeting"] = { values: { en: { value, state: "source" } } };
  return s;
}

// An "external" writer is anything that saves WITHOUT telling the watcher (CLI,
// git restore, a hand edit) — exactly what we must detect.
function externalWrite(path: string, value: string, opts: { split?: boolean } = {}) {
  saveState(path, makeState(value, opts));
}

describe("createStateWatcher", () => {
  it("fires onChange when an external writer modifies the file", () => {
    const path = join(tmpDir(), "glotfile.json");
    externalWrite(path, "Hello");
    const onChange = vi.fn();
    const w = createStateWatcher({ statePath: path, onChange });

    externalWrite(path, "Goodbye");
    w.check();

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("stays silent when the change came from our own persist (noteWrite)", () => {
    const path = join(tmpDir(), "glotfile.json");
    externalWrite(path, "Hello");
    const onChange = vi.fn();
    const w = createStateWatcher({ statePath: path, onChange });

    // Simulate the API's persist(): save, then tell the watcher we did it.
    const ours = makeState("Edited in the UI");
    saveState(path, ours);
    w.noteWrite(ours);
    w.check();

    expect(onChange).not.toHaveBeenCalled();
  });

  it("stays silent when content is identical despite a fresh mtime", () => {
    const path = join(tmpDir(), "glotfile.json");
    externalWrite(path, "Hello");
    const onChange = vi.fn();
    const w = createStateWatcher({ statePath: path, onChange });

    // Re-save byte-identical content (e.g. `touch`, or git restore to the same
    // bytes): mtime moves but there is nothing new to show.
    externalWrite(path, "Hello");
    w.check();

    expect(onChange).not.toHaveBeenCalled();
  });

  it("only fires once per distinct external change", () => {
    const path = join(tmpDir(), "glotfile.json");
    externalWrite(path, "Hello");
    const onChange = vi.fn();
    const w = createStateWatcher({ statePath: path, onChange });

    externalWrite(path, "Goodbye");
    w.check();
    w.check();

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("detects external changes to a split-format catalog", () => {
    const path = join(tmpDir(), "glotfile.json");
    externalWrite(path, "Hello", { split: true });
    const onChange = vi.fn();
    const w = createStateWatcher({ statePath: path, onChange });

    externalWrite(path, "Goodbye", { split: true });
    w.check();

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("retargets to a new active file and ignores the old one", () => {
    const dir = tmpDir();
    const a = join(dir, "a.glotfile.json");
    const b = join(dir, "b.glotfile.json");
    externalWrite(a, "A1");
    externalWrite(b, "B1");
    const onChange = vi.fn();
    const w = createStateWatcher({ statePath: a, onChange });

    w.retarget(b);

    // The old file changing must no longer matter.
    externalWrite(a, "A2");
    w.check();
    expect(onChange).not.toHaveBeenCalled();

    // The newly-active file changing fires.
    externalWrite(b, "B2");
    w.check();
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
