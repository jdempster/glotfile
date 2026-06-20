import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, extname, sep } from "node:path";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:net";
import open from "open";
import { createApi, type ApiDeps } from "./api.js";
import type { StateWatcher } from "./watch.js";
import { loadState } from "./state.js";
import { loadUsageCache } from "./scan.js";
import { runScan, scanOptions } from "./scanner.js";
import { refreshLocationUsage, isLocationScannedState, usageCounts } from "./import/usage.js";

const here = dirname(fileURLToPath(import.meta.url));
// dist/server/server.js -> dist/ui  (published layout)
const DEFAULT_UI_DIR = join(here, "..", "ui");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

async function readFileResponse(absPath: string): Promise<Response | null> {
  try {
    const s = await stat(absPath);
    if (!s.isFile()) return null;
    const body = await readFile(absPath);
    const type = MIME[extname(absPath).toLowerCase()] ?? "application/octet-stream";
    return new Response(new Uint8Array(body), { headers: { "content-type": type } });
  } catch {
    return null;
  }
}

export interface ServeOptions {
  statePath: string;
  dev?: boolean;
  open?: boolean;
  uiDir?: string;
  // Watch the state file and push out-of-band changes to the UI over /events.
  // Off by default so buildApp() in tests starts no background timer; startServer
  // turns it on for the real serve.
  watch?: boolean;
  // Receives the watcher so the caller can stop it on shutdown.
  onWatcher?: (watcher: StateWatcher) => void;
}

// The server binds to 127.0.0.1, but a malicious web page in the user's browser
// could still reach it via DNS-rebinding (its domain re-pointed at 127.0.0.1).
// The browser sends the attacker's Host, so reject any non-local Host: it blocks
// rebinding/CSRF while leaving real localhost/127.0.0.1 access untouched.
// @hono/node-server derives the request URL's host from the incoming Host header.
function isLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return h === "localhost" || h === "127.0.0.1" || h === "::1" || h.endsWith(".localhost");
}

export function buildApp(opts: ServeOptions): Hono {
  const app = new Hono();
  app.use("*", async (c, next) => {
    if (!isLocalHost(new URL(c.req.url).hostname)) return c.text("Forbidden: non-local Host header", 403);
    return next();
  });
  // Serve enables auto-export: edits in the UI write the changed locale files to
  // disk (gated per-project by config.autoExport) so a running app reflects them.
  // The API mutates apiDeps.statePath when the user switches files, so keep a
  // reference: screenshot serving must follow the active file's directory.
  const apiDeps: ApiDeps = {
    statePath: opts.statePath,
    autoExport: true,
    watch: opts.watch,
    onWatcher: opts.onWatcher,
  };
  app.route("/api", createApi(apiDeps));

  // Serve uploaded screenshots from any "<name>-screenshots/" folder next to the
  // ACTIVE glotfile (each source file scopes its own, so files move with their
  // images). Must precede the SPA catch-all so these never fall back to index.html.
  app.get("/:dir/*", async (c, next) => {
    const dirSeg = c.req.param("dir");
    if (!dirSeg.endsWith("-screenshots")) return next();
    const shotsRoot = resolve(dirname(resolve(apiDeps.statePath)), dirSeg);
    const pathname = decodeURIComponent(new URL(c.req.url).pathname);
    const rest = pathname.slice(`/${dirSeg}`.length);
    // Resolve under the folder and reject anything that escapes it (traversal).
    const target = resolve(shotsRoot, "." + rest);
    const inside = target === shotsRoot || target.startsWith(shotsRoot + sep);
    if (inside) {
      const file = await readFileResponse(target);
      if (file) return file;
    }
    return c.notFound();
  });

  if (!opts.dev) {
    const root = resolve(opts.uiDir ?? DEFAULT_UI_DIR);
    app.get("/*", async (c) => {
      const pathname = decodeURIComponent(new URL(c.req.url).pathname);
      // Resolve under root and reject anything that escapes it (path traversal).
      const target = resolve(root, "." + pathname);
      const inside = target === root || target.startsWith(root + sep);
      if (inside && pathname !== "/") {
        const file = await readFileResponse(target);
        if (file) return file;
      }
      // SPA fallback
      const index = await readFileResponse(join(root, "index.html"));
      if (index) return index;
      return c.notFound();
    });
  } else {
    // In dev the UI is served by Vite, not here — this port is API-only. Anyone
    // who opens it directly (it's easy to click the backend URL by mistake) gets
    // a signpost to the Vite UI instead of a bare 404.
    app.get("/", (c) => c.html(DEV_LANDING_PAGE));
  }
  return app;
}

const DEFAULT_PORT = 3000;
const DEV_PORT = 8787;
const DEV_UI_URL = "http://localhost:5173";

// Shown at `/` on the dev API port (8787). It serves no UI in dev — Vite does,
// on 5173 — so this redirects attention there instead of returning a bare 404.
const DEV_LANDING_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Glotfile — dev API</title>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:34rem;margin:16vh auto;padding:0 1.5rem;color:#1f2937}h1{font-size:1.4rem}a{color:#2563eb}code{background:#f3f4f6;padding:.1em .35em;border-radius:.3em}</style>
</head><body>
<h1>Glotfile — dev API server</h1>
<p>This port serves the <strong>API only</strong>. In dev, the app is served by Vite.</p>
<p>Open the app → <a href="${DEV_UI_URL}">${DEV_UI_URL}</a> (the <code>[ui] Local:</code> URL in your terminal).</p>
</body></html>`;

function findAvailablePort(start: number): Promise<number> {
  return new Promise((resolveP, reject) => {
    const probe = createServer();
    probe.listen(start, "127.0.0.1", () => {
      probe.close(() => resolveP(start));
    });
    probe.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        findAvailablePort(start + 1).then(resolveP, reject);
      } else {
        reject(err);
      }
    });
  });
}

export async function startServer(opts: ServeOptions): Promise<{ url: string; close: () => void }> {
  // The running server watches the state file so out-of-band changes (a CLI
  // sync/translate, a git restore, a hand edit) live-reload in the UI.
  let watcher: StateWatcher | undefined;
  const app = buildApp({ ...opts, watch: opts.watch ?? true, onWatcher: (w) => { watcher = w; } });
  const port = await findAvailablePort(opts.dev ? DEV_PORT : DEFAULT_PORT);
  return new Promise((resolveP) => {
    const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port }, (info) => {
      const url = `http://127.0.0.1:${info.port}`;
      if (opts.open !== false && !opts.dev) void open(url);
      resolveP({ url, close: () => { watcher?.stop(); server.close(); } });
      backgroundScan(opts.statePath);
    });
  });
}

function backgroundScan(statePath: string): void {
  const projectRoot = dirname(resolve(statePath));
  Promise.resolve().then(() => {
    const state = loadState(statePath);
    // Angular's hashed keys never appear in code; index from the catalog's source
    // locations instead of the regex walk (which would clobber it with 0 refs).
    if (isLocationScannedState(state)) {
      const cache = refreshLocationUsage(projectRoot);
      const { files, refs } = cache ? usageCounts(cache) : { files: 0, refs: 0 };
      console.log(`[scan] ${files} file(s), ${refs} reference(s) (from catalog locations)`);
      return;
    }
    const existing = loadUsageCache(projectRoot);
    const result = runScan(projectRoot, scanOptions(state.config), existing);
    const { files, refs } = usageCounts(result);
    console.log(`[scan] ${files} file(s), ${refs} reference(s)`);
  }).catch((err: unknown) => {
    console.warn("[scan] failed:", err instanceof Error ? err.message : String(err));
  });
}
