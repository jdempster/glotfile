import { describe, it, expect, vi, afterEach } from "vitest";

const ref = { file: "app/Foo.php", abs: "/Users/me/proj/app/Foo.php", line: 12, col: 5 };
const AI = { provider: "anthropic", model: "m", endpoint: null, region: null, batchSize: 25 };

// editor holds app-wide reactive state and talks to /local-settings, so each test
// loads a fresh copy of the module with fetch stubbed to a given server response.
async function loadEditor(opts: { serverEditor?: string } = {}) {
  vi.resetModules();
  const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
    Promise.resolve(
      new Response(
        JSON.stringify(init?.method === "PUT" ? { ok: true } : { ai: AI, editor: opts.serverEditor ?? "vscode" }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  const mod = await import("./editor.js");
  return { ...mod, fetchMock };
}

afterEach(() => vi.unstubAllGlobals());

describe("editor preference", () => {
  it("defaults to vscode before anything is loaded", async () => {
    const { getEditor } = await loadEditor();
    expect(getEditor()).toBe("vscode");
  });

  it("setEditor updates the current editor and PUTs it", async () => {
    const { setEditor, getEditor, fetchMock } = await loadEditor();
    setEditor("zed");
    expect(getEditor()).toBe("zed");
    expect(fetchMock).toHaveBeenCalledWith("/api/local-settings", expect.objectContaining({ method: "PUT" }));
  });

  it("setEditor ignores an unknown id", async () => {
    const { setEditor, getEditor } = await loadEditor();
    setEditor("emacs" as never);
    expect(getEditor()).toBe("vscode");
  });

  it("hydrateEditor adopts the per-project server value", async () => {
    const { hydrateEditor, getEditor } = await loadEditor({ serverEditor: "phpstorm" });
    await hydrateEditor();
    expect(getEditor()).toBe("phpstorm");
  });

  it("hydrateEditor ignores an unknown server value", async () => {
    const { hydrateEditor, getEditor } = await loadEditor({ serverEditor: "emacs" });
    await hydrateEditor();
    expect(getEditor()).toBe("vscode");
  });

  it("exposes exactly the three supported editors", async () => {
    const { EDITORS } = await loadEditor();
    expect(EDITORS.map((e) => e.id)).toEqual(["phpstorm", "vscode", "zed"]);
  });
});

describe("buildOpenUrl", () => {
  it("builds a VS Code absolute-path url", async () => {
    const { setEditor, buildOpenUrl } = await loadEditor();
    setEditor("vscode");
    expect(buildOpenUrl(ref, "proj")).toBe("vscode://file/Users/me/proj/app/Foo.php:12:5");
  });

  it("builds a Zed absolute-path url", async () => {
    const { setEditor, buildOpenUrl } = await loadEditor();
    setEditor("zed");
    expect(buildOpenUrl(ref, "proj")).toBe("zed://file/Users/me/proj/app/Foo.php:12:5");
  });

  it("builds a PhpStorm absolute-path url", async () => {
    const { setEditor, buildOpenUrl } = await loadEditor();
    setEditor("phpstorm");
    expect(buildOpenUrl(ref, "proj")).toBe(
      "phpstorm://open?file=%2FUsers%2Fme%2Fproj%2Fapp%2FFoo.php&line=12",
    );
  });
});
