import { describe, it, expect, vi } from "vitest";
import { translateStream, batchStatus, batchSubmit, batchApply, batchCancel, syncPreview, syncApply } from "./api.js";
import type { TranslateStart, TranslateProgress } from "./types.js";

// A fake JSON response: used by batchStatus, batchSubmit, batchApply, batchCancel tests.
function jsonResponse(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 400, statusText: ok ? "OK" : "Bad Request", json: async () => body };
}

// A fake SSE response: translateStream only reads `.ok`, `.body.getReader()`, `.statusText`.
function sseResponse(text: string) {
  return {
    ok: true,
    statusText: "OK",
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      },
    }),
  };
}

describe("translateStream", () => {
  it("sends keys + locales in a POST body, never in the request URL", async () => {
    // Regression: keys used to be URL-encoded into the GET query string. A large
    // filtered set (here 800 keys) pushed the request line past Node's 16KB header
    // limit, so the server rejected it with HTTP 431 "Request Header Fields Too
    // Large" before translating anything. The body has no such limit.
    const keys = Array.from({ length: 800 }, (_, i) => `settings.section.group.key_${i}`);
    const locales = ["fr"];
    const sse = `event: done\ndata: ${JSON.stringify({ written: 0, errors: [] })}\n\n`;
    const spy = vi.fn(async () => sseResponse(sse));
    vi.stubGlobal("fetch", spy);
    try {
      const events = [];
      for await (const e of translateStream(undefined, keys, locales)) events.push(e);

      expect(spy).toHaveBeenCalledTimes(1);
      const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("/api/translate/stream");
      // The bug lived here: a huge key list in the URL overflowed the header limit.
      expect(String(url)).not.toContain("key_0");
      expect(init.method).toBe("POST");
      const body = JSON.parse(init.body as string);
      expect(body.keys).toEqual(keys);
      expect(body.locales).toEqual(locales);

      expect(events).toContainEqual(expect.objectContaining({ type: "done", written: 0 }));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("parses the full event sequence into typed events", async () => {
    const sse = [
      `event: start\ndata: ${JSON.stringify({ total: 2, locales: [{ locale: "fr", total: 2 }] })}`,
      `event: locale-start\ndata: ${JSON.stringify({ locale: "fr" })}`,
      `event: progress\ndata: ${JSON.stringify({ done: 1, total: 2, written: 1, errors: [], locale: "fr", localeDone: 1, localeTotal: 2 })}`,
      `event: locale-done\ndata: ${JSON.stringify({ locale: "fr" })}`,
      `event: done\ndata: ${JSON.stringify({ written: 2, errors: [] })}`,
    ].join("\n") + "\n";
    const spy = vi.fn(async () => sseResponse(sse));
    vi.stubGlobal("fetch", spy);
    try {
      const events = [];
      for await (const e of translateStream()) events.push(e);
      expect(events.map((e) => e.type)).toEqual(["start", "locale-start", "progress", "locale-done", "done"]);
      expect((events[0] as TranslateStart).locales).toEqual([{ locale: "fr", total: 2 }]);
      expect(events[2] as TranslateProgress).toMatchObject({ locale: "fr", localeDone: 1, localeTotal: 2 });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("omits keys/locales from the body when unscoped (translate everything)", async () => {
    const sse = `event: done\ndata: ${JSON.stringify({ written: 0, errors: [] })}\n\n`;
    const spy = vi.fn(async () => sseResponse(sse));
    vi.stubGlobal("fetch", spy);
    try {
      for await (const _ of translateStream()) { /* drain */ }
      const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("/api/translate/stream");
      const body = JSON.parse(init.body as string);
      expect(body.keys).toBeUndefined();
      expect(body.locales).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("batchStatus", () => {
  it("GETs /api/batch/status and returns the parsed body", async () => {
    const payload = { supported: true, pending: null };
    const spy = vi.fn(async () => jsonResponse(payload));
    vi.stubGlobal("fetch", spy);
    try {
      const result = await batchStatus();
      expect(spy).toHaveBeenCalledTimes(1);
      const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit | undefined];
      expect(url).toBe("/api/batch/status");
      expect(init).toBeUndefined();
      expect(result).toEqual(payload);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("batchSubmit", () => {
  it("POSTs JSON to /api/batch/translate with correct method, content-type, and body", async () => {
    const payload = { batchId: "batch_abc", total: 42 };
    const spy = vi.fn(async () => jsonResponse(payload));
    vi.stubGlobal("fetch", spy);
    try {
      const result = await batchSubmit({ keys: ["greeting"], locales: ["fr", "de"] });
      expect(spy).toHaveBeenCalledTimes(1);
      const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("/api/batch/translate");
      expect(init.method).toBe("POST");
      expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
      const body = JSON.parse(init.body as string);
      expect(body.keys).toEqual(["greeting"]);
      expect(body.locales).toEqual(["fr", "de"]);
      expect(result).toEqual(payload);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("batchApply", () => {
  it("POSTs to /api/batch/apply and returns the parsed body", async () => {
    const payload = { written: 10, errors: [], staleSkipped: 0, retried: 0, screenshotsSkipped: 0 };
    const spy = vi.fn(async () => jsonResponse(payload));
    vi.stubGlobal("fetch", spy);
    try {
      const result = await batchApply();
      expect(spy).toHaveBeenCalledTimes(1);
      const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("/api/batch/apply");
      expect(init.method).toBe("POST");
      expect(result).toEqual(payload);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("batchCancel", () => {
  it("POSTs to /api/batch/cancel and returns the parsed body", async () => {
    const payload = { canceled: "batch_abc" };
    const spy = vi.fn(async () => jsonResponse(payload));
    vi.stubGlobal("fetch", spy);
    try {
      const result = await batchCancel();
      expect(spy).toHaveBeenCalledTimes(1);
      const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("/api/batch/cancel");
      expect(init.method).toBe("POST");
      expect(result).toEqual(payload);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("sync", () => {
  const plan = { added: ["a"], sourceChanged: [], adopted: [], removed: ["b"], unchanged: 5 };

  it("syncPreview POSTs to /api/sync without apply and returns the plan", async () => {
    const spy = vi.fn(async () => jsonResponse({ plan, warnings: [] }));
    vi.stubGlobal("fetch", spy);
    try {
      const result = await syncPreview();
      const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("/api/sync");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body as string).apply).toBeUndefined();
      expect(result.plan).toEqual(plan);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("syncApply sends apply:true with the prune flag", async () => {
    const spy = vi.fn(async () => jsonResponse({ applied: true, plan, warnings: [], usageRefs: 12 }));
    vi.stubGlobal("fetch", spy);
    try {
      const result = await syncApply({ prune: true });
      const [, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      expect(body).toMatchObject({ apply: true, prune: true });
      expect(result.applied).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
