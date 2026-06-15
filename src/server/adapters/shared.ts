export interface NestResult {
  tree: Record<string, unknown>;
  collisions: string[];
}

// Re-nest flat dot-notation keys into nested objects. A key that is both a leaf
// and a parent ("a" and "a.b") cannot coexist in a nested object; the first
// writer wins and the loser is reported as a collision (never silently merged).
export function nestKeys(flat: Record<string, string>): NestResult {
  const tree: Record<string, unknown> = {};
  const collisions: string[] = [];
  for (const fullKey of Object.keys(flat)) {
    const parts = fullKey.split(".");
    let node: Record<string, unknown> = tree;
    let collided = false;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i]!;
      const existing = node[p];
      if (existing === undefined) {
        const next: Record<string, unknown> = {};
        node[p] = next;
        node = next;
      } else if (typeof existing === "object" && existing !== null) {
        node = existing as Record<string, unknown>;
      } else {
        // A scalar already sits where we need to descend.
        collisions.push(fullKey);
        collided = true;
        break;
      }
    }
    if (collided) continue;
    const leaf = parts[parts.length - 1]!;
    if (typeof node[leaf] === "object" && node[leaf] !== null) {
      // A subtree already sits where this leaf wants to go.
      collisions.push(fullKey);
      continue;
    }
    node[leaf] = flat[fullKey];
  }
  return { tree, collisions };
}
