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

// How to scroll the selected row into view. Returns null to leave the scroll
// alone (the row is already fully on screen, so selecting it shouldn't jump),
// or "start" to anchor the row's top to the viewport top.
//
// We deliberately never use the virtualizer's "auto" alignment: auto snaps a
// not-fully-visible row to the *nearest* edge, which is the bottom when you
// move down — leaving the row's top mid-viewport. And a row taller than the
// viewport can never satisfy auto, so it scrolls past the row's top entirely,
// hiding the key name. Always anchoring the top keeps the key name visible.
export function scrollAlignForRow(opts: {
  // Row top offset and height, from the virtualizer's measurements.
  start: number;
  size: number;
  // Current scroll position and viewport height of the scroll container.
  scrollTop: number;
  viewport: number;
}): "start" | null {
  const { start, size, scrollTop, viewport } = opts;
  const fullyVisible = start >= scrollTop && start + size <= scrollTop + viewport;
  return fullyVisible ? null : "start";
}
