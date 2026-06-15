import { statSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { loadState } from "./state.js";
import { serializeJson } from "./format.js";
import { detectFormat, splitDirFor } from "./storage.js";
import type { State } from "./schema.js";

export interface StateWatcher {
  // One detection pass: cheap-stats the file, and only when that signature moves
  // does it load + hash to decide whether to broadcast. Drives the poll loop, but
  // exposed directly so it's callable from tests without timers.
  check(): void;
  // The API calls this right after persist() so the watcher recognizes its own
  // write and stays silent — only writes it did NOT make count as "external".
  noteWrite(state: State): void;
  // Point at a different active file (the UI's file switcher); resets the baseline.
  retarget(statePath: string): void;
  start(): void;
  stop(): void;
}

export interface StateWatcherOptions {
  statePath: string;
  onChange: () => void;
  intervalMs?: number;
}

// Layout-independent content fingerprint: always computed on the assembled State,
// so a single file and the equivalent split directory hash the same. Both the
// in-memory write (noteWrite) and the loaded-from-disk read (check) run it, so a
// round-tripped self-write matches and is ignored.
function hashState(state: State): string {
  return createHash("sha1").update(serializeJson(state, state.config.format)).digest("hex");
}

// Cheap change probe: size + mtime of every file backing the catalog. No JSON
// parse, so an idle poll costs only a handful of stats.
function signature(statePath: string): string {
  const fmt = detectFormat(statePath);
  if (fmt === "none") return "none";
  if (fmt === "single") {
    const s = statSync(statePath);
    return `single:${s.size}:${s.mtimeMs}`;
  }
  const dir = splitDirFor(statePath);
  const parts: string[] = [];
  for (const rel of ["config.json", "keys.json"]) {
    try {
      const s = statSync(join(dir, rel));
      parts.push(`${rel}:${s.size}:${s.mtimeMs}`);
    } catch { /* not present yet */ }
  }
  try {
    for (const name of readdirSync(join(dir, "locales")).sort()) {
      if (!name.endsWith(".json")) continue;
      const s = statSync(join(dir, "locales", name));
      parts.push(`${name}:${s.size}:${s.mtimeMs}`);
    }
  } catch { /* no locales dir yet */ }
  return `split:${parts.join("|")}`;
}

export function createStateWatcher(opts: StateWatcherOptions): StateWatcher {
  const intervalMs = opts.intervalMs ?? 750;
  let statePath = opts.statePath;
  let lastSig = "";
  let lastHash = "";
  let timer: ReturnType<typeof setInterval> | undefined;

  // Capture the starting point without firing, so check() only ever reacts to
  // changes that land after the watcher exists.
  function baseline() {
    try {
      lastSig = signature(statePath);
      lastHash = hashState(loadState(statePath));
    } catch {
      lastSig = "";
      lastHash = "";
    }
  }

  function check() {
    let sig: string;
    try {
      sig = signature(statePath);
    } catch {
      return;
    }
    if (sig === lastSig) return;
    let hash: string;
    try {
      hash = hashState(loadState(statePath));
    } catch {
      // Mid-write or temporarily invalid (e.g. a split git restore caught between
      // files). Accept this signature so we don't reparse a broken file every
      // tick; the next real change moves mtime again and we retry.
      lastSig = sig;
      return;
    }
    lastSig = sig;
    if (hash !== lastHash) {
      lastHash = hash;
      opts.onChange();
    }
  }

  function noteWrite(state: State) {
    try {
      lastSig = signature(statePath);
    } catch {
      lastSig = "";
    }
    lastHash = hashState(state);
  }

  function retarget(next: string) {
    statePath = next;
    baseline();
  }

  function start() {
    if (timer) return;
    timer = setInterval(check, intervalMs);
    // Don't keep the process alive just for the watch loop.
    timer.unref?.();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = undefined;
  }

  baseline();
  return { check, noteWrite, retarget, start, stop };
}
