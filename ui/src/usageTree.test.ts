import { describe, it, expect } from "vitest";
import { buildUsageTree, type UsageRefInput } from "./usageTree.js";

const ref = (file: string, line: number, url: string | null = null): UsageRefInput => ({ file, line, url });

describe("buildUsageTree", () => {
  it("groups multiple references to one file onto a single row", () => {
    const tree = buildUsageTree([ref("app/Home.php", 45), ref("app/Home.php", 12)]);
    expect(tree).toEqual([
      { kind: "dir", depth: 0, label: "app" },
      // Lines sorted ascending regardless of input order.
      { kind: "file", depth: 1, name: "Home.php", refs: [{ line: 12, url: null }, { line: 45, url: null }] },
    ]);
  });

  it("collapses single-child directory chains into one label", () => {
    const tree = buildUsageTree([ref("app/Http/Controllers/HomeController.php", 8)]);
    expect(tree).toEqual([
      { kind: "dir", depth: 0, label: "app/Http/Controllers" },
      { kind: "file", depth: 1, name: "HomeController.php", refs: [{ line: 8, url: null }] },
    ]);
  });

  it("branches where a directory has more than one child", () => {
    const tree = buildUsageTree([
      ref("app/Http/Controllers/Home.php", 1),
      ref("app/Http/Middleware/Auth.php", 2),
    ]);
    expect(tree).toEqual([
      { kind: "dir", depth: 0, label: "app/Http" },
      { kind: "dir", depth: 1, label: "Controllers" },
      { kind: "file", depth: 2, name: "Home.php", refs: [{ line: 1, url: null }] },
      { kind: "dir", depth: 1, label: "Middleware" },
      { kind: "file", depth: 2, name: "Auth.php", refs: [{ line: 2, url: null }] },
    ]);
  });

  it("does not fold a directory chain past a level that also holds files", () => {
    const tree = buildUsageTree([
      ref("src/index.ts", 3),
      ref("src/lib/util.ts", 7),
    ]);
    expect(tree).toEqual([
      // `src` holds both a file and a subdir, so it can't merge with `lib`.
      { kind: "dir", depth: 0, label: "src" },
      { kind: "dir", depth: 1, label: "lib" },
      { kind: "file", depth: 2, name: "util.ts", refs: [{ line: 7, url: null }] },
      { kind: "file", depth: 1, name: "index.ts", refs: [{ line: 3, url: null }] },
    ]);
  });

  it("places a root-level file at depth 0 with no directory row", () => {
    const tree = buildUsageTree([ref("index.php", 1)]);
    expect(tree).toEqual([{ kind: "file", depth: 0, name: "index.php", refs: [{ line: 1, url: null }] }]);
  });

  it("carries the open-in-editor url onto each leaf", () => {
    const tree = buildUsageTree([ref("a/b.php", 4, "vscode://file/a/b.php:4")]);
    expect(tree[1]).toEqual({ kind: "file", depth: 1, name: "b.php", refs: [{ line: 4, url: "vscode://file/a/b.php:4" }] });
  });
});
