import { appendFileSync, existsSync, openSync, fstatSync, readSync, closeSync, statSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureGlotfileDir } from "./glotfile-dir.js";
import { writeFileAtomic } from "./atomic-write.js";
import type { GlossaryHint } from "./ai/provider.js";
import type { TokenUsage } from "./ai/pricing.js";

// Rich detail kept for AI operations so the log stays useful for debugging prompts.
export interface AiLogItem {
  id: string;
  key: string;
  source: string;
  targetLocale?: string;
  context?: string;
  result?: string;
  glossary?: GlossaryHint[];
  // The screenshot PATH only — never the image bytes.
  screenshot?: string;
}
export interface AiLogResult { id: string; translation?: string; value?: string; error?: string }

// A batch job whose provider outcome was unusable as a whole: the request
// errored/expired ("failed"), the reply text couldn't be parsed ("malformed",
// raw text attached), or the provider returned no entry for the job's custom
// id at all ("missing").
export interface AiLogJobFailure {
  customId: string;
  locale: string;
  type: "failed" | "malformed" | "missing";
  error?: string;
  raw?: string;
}

export type LogKind =
  | "translation" | "key" | "metadata" | "config"
  | "glossary" | "note" | "dictionary" | "import" | "suppression"
  | "translate" | "context";

// One activity-log entry. General edits carry a before/after audit pair; AI
// operations (kind translate/context) additionally carry the prompt and results.
export interface LogEntry {
  at: string;
  kind: LogKind;
  summary: string;
  key?: string;
  locale?: string;
  before?: unknown;
  after?: unknown;
  // AI-only:
  model?: string;
  system?: string;
  items?: AiLogItem[];
  results?: AiLogResult[];
  // Raw model reply text, recorded when a reply could not be parsed.
  raw?: string;
  // Batch-apply only: jobs whose outcome was unusable (their requests were
  // re-run synchronously) and results dropped because the key was deleted or
  // its source edited between submit and apply.
  jobFailures?: AiLogJobFailure[];
  stale?: Array<{ key: string; locale: string }>;
  // Provider-reported token usage for the run, and the dollar cost derived
  // from it (batch-discounted where applicable). Absent for providers that
  // don't report usage or models without pricing data.
  usage?: TokenUsage;
  estimatedCostUsd?: number;
}

function logPath(projectRoot: string): string {
  return resolve(projectRoot, ".glotfile", "log.jsonl");
}

// The log is local-only debug/audit data, so we cap it rather than let it grow
// forever. On append we trim once it crosses MAX; the gap down to TRIM_TO means
// we don't rewrite on every subsequent append, only when it climbs back to MAX.
const MAX_LOG_BYTES = 5 * 1024 * 1024;
const TRIM_LOG_TO_BYTES = 4 * 1024 * 1024;

export function appendLog(projectRoot: string, entry: LogEntry): void {
  ensureGlotfileDir(projectRoot);
  const path = logPath(projectRoot);
  appendFileSync(path, JSON.stringify(entry) + "\n", "utf8");
  trimLog(path);
}

// Bound the log file's size, keeping the newest entries that fit in targetBytes
// (always at least one, so a single oversized AI entry is never truncated). The
// common path is a cheap stat — we only read/rewrite when over maxBytes, and at
// that point the file is bounded to ~maxBytes precisely because we keep trimming
// it, so reading it whole (which a rewrite needs anyway) stays cheap.
export function trimLog(path: string, maxBytes = MAX_LOG_BYTES, targetBytes = TRIM_LOG_TO_BYTES): void {
  if (!existsSync(path) || statSync(path).size <= maxBytes) return;
  const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim() !== "");
  const kept: string[] = [];
  let bytes = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const lineBytes = Buffer.byteLength(lines[i]!, "utf8") + 1;
    if (kept.length > 0 && bytes + lineBytes > targetBytes) break;
    kept.unshift(lines[i]!);
    bytes += lineBytes;
  }
  writeFileAtomic(path, kept.length ? kept.join("\n") + "\n" : "");
}

// Read the last `n` non-blank lines of a file in file order (oldest of the n
// first) without loading the whole thing: seek to EOF and walk backward in
// chunks until we've gathered enough complete lines or reach the start. Read
// cost is proportional to the size of those last n lines, not the file.
export function readLastLines(path: string, n: number, chunkSize = 64 * 1024): string[] {
  if (n <= 0 || !existsSync(path)) return [];
  const fd = openSync(path, "r");
  try {
    let pos = fstatSync(fd).size;
    if (pos === 0) return [];
    const chunks: Buffer[] = [];
    while (pos > 0) {
      const size = Math.min(chunkSize, pos);
      pos -= size;
      const buf = Buffer.alloc(size);
      readSync(fd, buf, 0, size, pos);
      chunks.unshift(buf);
      // Decode the whole gathered region at once so a multi-byte char split
      // across a chunk boundary is never decoded in halves. When pos > 0 the
      // first segment may be a partial line (and its leading bytes a partial
      // char) — drop it; we only trust lines bounded by newlines on both sides.
      const segments = Buffer.concat(chunks).toString("utf8").split("\n");
      const complete = (pos > 0 ? segments.slice(1) : segments).filter((l) => l.trim() !== "");
      if (complete.length >= n || pos === 0) return complete.slice(-n);
    }
    return [];
  } finally {
    closeSync(fd);
  }
}

export function readLog(projectRoot: string, limit = 100): LogEntry[] {
  // readLastLines yields oldest-first; reverse for the newest-first log view.
  return readLastLines(logPath(projectRoot), limit).map((l) => JSON.parse(l) as LogEntry).reverse();
}
