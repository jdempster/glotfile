// Where ArrowUp/ArrowDown should move the key-list selection.
//
// The wrinkle: the list virtualizes and the user can scroll the current
// selection out of view. When that happens, pressing an arrow should resume
// from what's actually on screen — Down picks the row at the top of the
// viewport, Up the one at the bottom — instead of snapping back to the
// off-screen selection. Only when the selection is still visible do we step by
// a single row.
export function nextRowIndex(opts: {
  down: boolean;
  // Index of the current selection, or -1 if nothing is selected.
  cur: number;
  // Row indices currently inside the viewport, ascending. Empty if unknown.
  visible: number[];
  // Total number of rows.
  count: number;
}): number {
  const { down, cur, visible, count } = opts;
  if (count === 0) return -1;
  if (cur !== -1 && visible.includes(cur)) {
    return Math.max(0, Math.min(count - 1, down ? cur + 1 : cur - 1));
  }
  if (visible.length) return down ? visible[0]! : visible[visible.length - 1]!;
  // No selection and no viewport info: start at the end nearest the direction.
  return down ? 0 : count - 1;
}
