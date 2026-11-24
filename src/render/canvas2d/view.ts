/** Screen <-> world transform for the 2D level view. World units are cells. */
export interface View {
  /** Screen position (CSS px) of world origin. */
  panX: number;
  panY: number;
  /** CSS px per cell. */
  zoom: number;
}

export const MIN_ZOOM = 8;
export const MAX_ZOOM = 128;

export function toWorld(v: View, sx: number, sy: number): { x: number; y: number } {
  return { x: (sx - v.panX) / v.zoom, y: (sy - v.panY) / v.zoom };
}

export function toScreen(v: View, wx: number, wy: number): { x: number; y: number } {
  return { x: wx * v.zoom + v.panX, y: wy * v.zoom + v.panY };
}

/** Zoom around a screen point so the world point under the cursor stays put. */
export function zoomAt(v: View, sx: number, sy: number, factor: number): View {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * factor));
  const w = toWorld(v, sx, sy);
  return { zoom, panX: sx - w.x * zoom, panY: sy - w.y * zoom };
}

/** Center the view on a cell. */
export function centerOn(v: View, width: number, height: number, cx: number, cy: number): View {
  return { ...v, panX: width / 2 - (cx + 0.5) * v.zoom, panY: height / 2 - (cy + 0.5) * v.zoom };
}
