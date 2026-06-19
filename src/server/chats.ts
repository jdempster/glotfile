import { readFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { writeFileAtomic } from "./atomic-write.js";
import { ensureGlotfileDir } from "./glotfile-dir.js";
import type { ChatMessage } from "./ai/chat-types.js";
import type { TokenUsage } from "./ai/pricing.js";

// The Translation Assistant conversation, persisted per-project so it survives
// page reloads and server restarts. Lives under <project>/.glotfile (which is
// self-ignoring — see ensureGlotfileDir), so transcripts never enter git. MVP
// keeps a single thread; the per-thread file layout is left open for later.
export interface ChatTranscript {
  messages: ChatMessage[];
  model: string;
  createdAt: string;
  cumulativeUsage: TokenUsage;
}

const chatPath = (projectRoot: string): string =>
  resolve(projectRoot, ".glotfile", "chats", "current.json");

export function emptyTranscript(): ChatTranscript {
  return {
    messages: [],
    model: "",
    createdAt: "",
    cumulativeUsage: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
  };
}

// Lenient read: a missing or corrupt file yields a fresh empty transcript so the
// chat always starts in a usable state rather than throwing.
export function loadChat(projectRoot: string): ChatTranscript {
  try {
    const raw = JSON.parse(readFileSync(chatPath(projectRoot), "utf8")) as Partial<ChatTranscript>;
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.messages)) return emptyTranscript();
    const base = emptyTranscript();
    return {
      messages: raw.messages as ChatMessage[],
      model: typeof raw.model === "string" ? raw.model : base.model,
      createdAt: typeof raw.createdAt === "string" ? raw.createdAt : base.createdAt,
      cumulativeUsage: { ...base.cumulativeUsage, ...(raw.cumulativeUsage ?? {}) },
    };
  } catch {
    return emptyTranscript();
  }
}

export function saveChat(projectRoot: string, transcript: ChatTranscript): void {
  ensureGlotfileDir(projectRoot);
  const path = chatPath(projectRoot);
  mkdirSync(dirname(path), { recursive: true });
  writeFileAtomic(path, JSON.stringify(transcript, null, 2) + "\n");
}

export function clearChat(projectRoot: string): void {
  rmSync(chatPath(projectRoot), { force: true });
}
