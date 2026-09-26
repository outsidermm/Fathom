// Pure layout for the ocean's bubbles, in CSS px relative to the stage.

export interface Point { x: number; y: number }
export interface Size { width: number; height: number }

// Clear of the wave at the top.
export const STAGE_TOP = 96;
const STAGE_BOTTOM = 36;
const SIDE = 50;
const SLOT_WIDTH = 158;
const MIN_ROW = 170;
const MAX_ROW = 220;

/**
 * Readings follow a current that snakes left to right, then back, one row at
 * a time (like reading order that folds). Returns each bubble's centre and the
 * height the content needs (taller than the stage when rows overflow).
 */
export function layoutCurrent(count: number, { width, height }: Size) {
  const perRow = Math.max(1, Math.min(6, Math.floor((width - SIDE * 2) / SLOT_WIDTH)));
  const rows = Math.max(1, Math.ceil(count / perRow));
  const room = height - STAGE_TOP - STAGE_BOTTOM;
  const rowHeight = Math.max(MIN_ROW, Math.min(MAX_ROW, room / rows));
  const slot = (width - SIDE * 2) / perRow;
  const points: Point[] = [];
  for (let index = 0; index < count; index++) {
    const row = Math.floor(index / perRow);
    const column = row % 2 === 0 ? index % perRow : perRow - 1 - (index % perRow);
    points.push({
      x: SIDE + (column + 0.5) * slot,
      y: STAGE_TOP + row * rowHeight + rowHeight * 0.3 + Math.sin(index * 1.9) * Math.min(22, rowHeight * 0.12),
    });
  }
  return { points, contentHeight: Math.max(height, STAGE_TOP + rows * rowHeight + STAGE_BOTTOM) };
}

export const DOCK_WIDTH = 300;
const DOCK_GAP = 14;

/**
 * The steering dock sits to the right of the current on a wide ocean, or
 * opens over the bottom of a narrow one. Returns the area left for the bubbles.
 */
export function dockFor({ width, height }: Size) {
  if (width >= 760) {
    return { side: true, area: { width: width - DOCK_WIDTH - DOCK_GAP * 2, height }, dockLeft: width - DOCK_WIDTH - DOCK_GAP };
  }
  // Narrow: the bubbles get the whole ocean; the dock opens as a sheet.
  return { side: false, area: { width, height }, dockLeft: DOCK_GAP };
}

/** A soft curve between two points, bulging outward when they stack vertically. */
export function curve(from: Point, to: Point, width: number) {
  const dx = to.x - from.x;
  if (Math.abs(dx) < 60) {
    const bulge = from.x > width / 2 ? 70 : -70;
    return `M${from.x} ${from.y}C${from.x + bulge} ${from.y},${to.x + bulge} ${to.y},${to.x} ${to.y}`;
  }
  return `M${from.x} ${from.y}C${from.x + dx * 0.5} ${from.y},${to.x - dx * 0.5} ${to.y},${to.x} ${to.y}`;
}
