// Builds a compact file tree from a flat list of code-usage references so the
// detail panel can show "where is this key used" grouped by directory/file
// instead of repeating the full path on every line.

export interface UsageRefInput {
  file: string;
  line: number;
  url: string | null;
}

export interface UsageLeafRef {
  line: number;
  url: string | null;
}

export type UsageTreeRow =
  | { kind: "dir"; depth: number; label: string }
  | { kind: "file"; depth: number; name: string; refs: UsageLeafRef[] };

interface DirNode {
  dirs: Map<string, DirNode>;
  files: Map<string, UsageLeafRef[]>;
}

function emptyDir(): DirNode {
  return { dirs: new Map(), files: new Map() };
}

// Flatten a flat ref list into depth-tagged rows for rendering. Single-child
// directory chains are collapsed into one label (e.g. "app/Http/Controllers"),
// matching VS Code's "compact folders" so shallow trees don't waste vertical
// space. Multiple references to the same file collapse onto one row, their
// line numbers carried as separate clickable leaves.
export function buildUsageTree(refs: UsageRefInput[]): UsageTreeRow[] {
  const root = emptyDir();
  for (const r of refs) {
    const segs = r.file.split("/").filter(Boolean);
    const name = segs.pop() ?? r.file;
    let node = root;
    for (const seg of segs) {
      let next = node.dirs.get(seg);
      if (!next) {
        next = emptyDir();
        node.dirs.set(seg, next);
      }
      node = next;
    }
    const list = node.files.get(name) ?? [];
    list.push({ line: r.line, url: r.url });
    node.files.set(name, list);
  }

  const rows: UsageTreeRow[] = [];
  const walk = (node: DirNode, depth: number) => {
    for (const dirName of [...node.dirs.keys()].sort()) {
      let label = dirName;
      let child = node.dirs.get(dirName)!;
      // Fold single-child directory chains (with no files of their own) into one label.
      while (child.files.size === 0 && child.dirs.size === 1) {
        const onlyName = [...child.dirs.keys()][0]!;
        label += "/" + onlyName;
        child = child.dirs.get(onlyName)!;
      }
      rows.push({ kind: "dir", depth, label });
      walk(child, depth + 1);
    }
    for (const fileName of [...node.files.keys()].sort()) {
      const fileRefs = node.files.get(fileName)!.slice().sort((a, b) => a.line - b.line);
      rows.push({ kind: "file", depth, name: fileName, refs: fileRefs });
    }
  };
  walk(root, 0);
  return rows;
}
