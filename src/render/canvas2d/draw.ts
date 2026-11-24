/**
 * Draws one level of a ResolvedMap top-down onto a 2D canvas. Pure: everything it needs
 * comes in through DrawInput, so the same function serves the editor and thumbnails.
 */
import type { Facing, GridPos } from "../../core/geometry";
import type { ResolvedCell, ResolvedEdge, ResolvedMap } from "../../core/resolve";
import { propPoint, PROP_RADIUS, type Hit } from "./hit";
import { toWorld, type View } from "./view";

export interface DrawInput {
  map: ResolvedMap;
  level: number;
  view: View;
  width: number;
  height: number;
  ghostAbove: boolean;
  ghostBelow: boolean;
  showHeights: boolean;
  hover: Hit | null;
  /** Prop id under the cursor, for a hover ring. */
  hoverProp?: string | null;
  selection:{ cells: Set<string>; edges: Set<string>; props: Set<string> };
  /** Cells with an error, by cell key. */
  problemCells: Set<string>;
  /** In-progress tool preview. */
  preview?: { cells?: GridPos[]; mode: "add" | "remove" | "select" };
  /** Optional per-material preview textures. */
  patterns?: Map<string, CanvasPattern>;
  /** Trigger → effect arrows, in world coordinates. */
  links?: DrawLink[];
  /** Cells that have on-enter/on-exit triggers (by cell key). */
  triggerCells?: Set<string>;
}

export interface DrawLink {
  a: { x: number; y: number; z: number };
  b: { x: number; y: number; z: number };
  effect: "write" | "read";
  faint: boolean;
}

export const THEME = {
  bg: "#100e0b",
  grid: "rgba(255,255,255,0.05)",
  gridMajor: "rgba(255,255,255,0.10)",
  wall: "#d8d0c2",
  accent: "#e0a050",
  select: "#4fb3ff",
  error: "#ff5a4f",
  ghost: 0.18,
};

const KIND_COLOR: Record<string, string> = {
  door: "#c8863c",
  gate: "#9aa0a8",
  wall: "#b48ce0",
  hatch: "#c8863c",
  pit: "#000000",
  ladder: "#c8a46e",
  grate: "#9aa0a8",
  opening: "#5fd36b",
  custom: "#e0a050",
};

const SIDES: Facing[] = ["north", "east", "south", "west"];

function segment(side: Facing, x: number, y: number, inset = 0): [number, number, number, number] {
  switch (side) {
    case "north": return [x + inset, y, x + 1 - inset, y];
    case "south": return [x + inset, y + 1, x + 1 - inset, y + 1];
    case "west": return [x, y + inset, x, y + 1 - inset];
    case "east": return [x + 1, y + inset, x + 1, y + 1 - inset];
  }
}

export function draw(ctx: CanvasRenderingContext2D, input: DrawInput): void {
  const { map, level, view, width, height } = input;
  const z = view.zoom;
  const spl = map.stepsPerLevel;
  const px = 1 / z; // one CSS pixel in world units

  ctx.save();
  ctx.fillStyle = THEME.bg;
  ctx.fillRect(0, 0, width, height);
  ctx.translate(view.panX, view.panY);
  ctx.scale(z, z);

  // ---- grid ----
  const tl = toWorld(view, 0, 0);
  const br = toWorld(view, width, height);
  const x0 = Math.floor(tl.x), x1 = Math.ceil(br.x), y0 = Math.floor(tl.y), y1 = Math.ceil(br.y);
  ctx.lineWidth = px;
  for (let x = x0; x <= x1; x++) {
    ctx.strokeStyle = x % 8 === 0 ? THEME.gridMajor : THEME.grid;
    ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke();
  }
  for (let y = y0; y <= y1; y++) {
    ctx.strokeStyle = y % 8 === 0 ? THEME.gridMajor : THEME.grid;
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
  }
  // map bounds origin marker
  ctx.strokeStyle = "rgba(224,160,80,0.35)";
  ctx.lineWidth = 2 * px;
  ctx.strokeRect(0, 0, 256, 256);

  const visible = (c: ResolvedCell) => c.pos.x >= x0 - 1 && c.pos.x <= x1 && c.pos.y >= y0 - 1 && c.pos.y <= y1;
  const color = (mat: string) => map.materials[mat]?.color ?? "#ff00ff";
  const fillMat = (mat: string) => input.patterns?.get(mat) ?? color(mat);

  // ---- ghost levels ----
  const ghost = (gz: number) => {
    ctx.globalAlpha = THEME.ghost;
    for (const c of map.cells) {
      if (c.pos.z !== gz || !visible(c)) continue;
      ctx.fillStyle = color(c.surfaces.down);
      ctx.fillRect(c.pos.x, c.pos.y, 1, 1);
    }
    ctx.globalAlpha = 1;
  };
  if (input.ghostBelow) ghost(level - 1);
  if (input.ghostAbove) {
    ghost(level + 1);
  }

  // ---- cells from other levels that extend into this one (tall cells) ----
  const base = level * spl, top = (level + 1) * spl;
  ctx.lineWidth = 1.5 * px;
  for (const c of map.cells) {
    if (c.pos.z === level || !visible(c)) continue;
    if (c.abs.ceiling > base && c.abs.floor < top) {
      ctx.fillStyle = "rgba(224,160,80,0.10)";
      ctx.fillRect(c.pos.x, c.pos.y, 1, 1);
      ctx.strokeStyle = "rgba(224,160,80,0.45)";
      ctx.beginPath();
      for (let i = -1; i < 1; i += 0.25) {
        ctx.moveTo(c.pos.x + Math.max(0, i), c.pos.y + Math.max(0, -i));
        ctx.lineTo(c.pos.x + Math.min(1, 1 + i), c.pos.y + Math.min(1, 1 - i));
      }
      ctx.stroke();
    }
  }

  const cells = map.cells.filter((c) => c.pos.z === level && visible(c));

  // ---- floors ----
  for (const c of cells) {
    ctx.fillStyle = fillMat(c.surfaces.down);
    ctx.fillRect(c.pos.x, c.pos.y, 1, 1);
    // shade by floor height so steps read at a glance
    const rel = c.floor;
    if (rel !== 0) {
      ctx.fillStyle = rel > 0 ? `rgba(255,255,255,${Math.min(0.35, rel * 0.08)})` : `rgba(0,0,0,${Math.min(0.5, -rel * 0.12)})`;
      ctx.fillRect(c.pos.x, c.pos.y, 1, 1);
    }
  }

  // ---- ramp / stairs arrows ----
  ctx.lineWidth = 2 * px;
  for (const c of cells) {
    if (c.shape.kind === "flat") continue;
    const cx = c.pos.x + 0.5, cy = c.pos.y + 0.5;
    const d = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] }[c.shape.toward];
    ctx.strokeStyle = "rgba(255,255,255,0.75)";
    if (c.shape.kind === "stairs") {
      for (let i = 0; i < 4; i++) {
        const t = -0.3 + i * 0.2;
        ctx.beginPath();
        ctx.moveTo(cx + d[0]! * t - d[1]! * 0.3, cy + d[1]! * t - d[0]! * 0.3);
        ctx.lineTo(cx + d[0]! * t + d[1]! * 0.3, cy + d[1]! * t + d[0]! * 0.3);
        ctx.stroke();
      }
    }
    ctx.beginPath();
    ctx.moveTo(cx - d[0]! * 0.35, cy - d[1]! * 0.35);
    ctx.lineTo(cx + d[0]! * 0.35, cy + d[1]! * 0.35);
    ctx.lineTo(cx + d[0]! * 0.2 - d[1]! * 0.12, cy + d[1]! * 0.2 - d[0]! * 0.12);
    ctx.moveTo(cx + d[0]! * 0.35, cy + d[1]! * 0.35);
    ctx.lineTo(cx + d[0]! * 0.2 + d[1]! * 0.12, cy + d[1]! * 0.2 + d[0]! * 0.12);
    ctx.stroke();
  }

  // ---- vertical connections ----
  for (const c of cells) {
    for (const { edge, dir } of map.edgesOf(c.pos)) {
      if (!edge.vertical) continue;
      const kind = map.connectionTypes[edge.type]?.kind ?? "custom";
      drawVertical(ctx, c.pos, dir === "up" ? "up" : "down", kind, edge.state, px);
    }
  }

  // ---- walls (sides without any connection) ----
  ctx.lineCap = "round";
  for (const c of cells) {
    const edges = map.edgesOf(c.pos);
    for (const side of SIDES) {
      if (edges.some((e) => e.dir === side)) continue;
      ctx.strokeStyle = THEME.wall;
      ctx.lineWidth = Math.max(2 * px, 0.08);
      const [ax, ay, bx, by] = segment(side, c.pos.x, c.pos.y);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    }
  }

  // ---- horizontal connections touching this level ----
  for (const e of map.edges) {
    if (e.vertical) continue;
    const here = e.from.z === level ? e.from : e.to.z === level ? e.to : null;
    if (!here) continue;
    const side = (here === e.from ? e.dir : e.dir === "east" ? "west" : "north") as Facing;
    drawEdge(ctx, map, e, here, side, px, e.from.z !== e.to.z);
  }

  // ---- props ----
  for (const p of map.props) {
    if (p.cell.z !== level) continue;
    const pt = map.propTypes[p.type];
    const { x: cx, y: cy } = propPoint(p);
    ctx.fillStyle = pt?.preview?.color ?? THEME.accent;
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1.5 * px;
    ctx.beginPath(); ctx.arc(cx, cy, PROP_RADIUS, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    drawPropIcon(ctx, pt?.preview?.icon, p.state, cx, cy, px);
    if (input.hoverProp === p.id) {
      ctx.strokeStyle = THEME.accent; ctx.lineWidth = 2 * px;
      ctx.beginPath(); ctx.arc(cx, cy, 0.2, 0, Math.PI * 2); ctx.stroke();
    }
    if (input.selection.props.has(p.id)) {
      ctx.strokeStyle = THEME.select; ctx.lineWidth = 3 * px;
      ctx.beginPath(); ctx.arc(cx, cy, 0.22, 0, Math.PI * 2); ctx.stroke();
    }
  }

  // ---- start marker ----
  if (map.start && map.start.cell.z === level) {
    const { x, y } = map.start.cell;
    const a = { north: -Math.PI / 2, east: 0, south: Math.PI / 2, west: Math.PI }[map.start.facing];
    ctx.save();
    ctx.translate(x + 0.5, y + 0.5);
    ctx.rotate(a);
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1.5 * px;
    ctx.beginPath(); ctx.moveTo(0.32, 0); ctx.lineTo(-0.22, -0.22); ctx.lineTo(-0.1, 0); ctx.lineTo(-0.22, 0.22); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  // ---- height labels ----
  if (input.showHeights && z >= 28) {
    ctx.save();
    ctx.scale(1 / z, 1 / z);
    ctx.font = "10px ui-monospace, Consolas, monospace";
    ctx.textBaseline = "top";
    for (const c of cells) {
      if (c.floor === 0 && c.ceiling === spl) continue;
      const label = `${c.floor}/${c.ceiling}`;
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      const w = ctx.measureText(label).width;
      ctx.fillRect(c.pos.x * z + 3, c.pos.y * z + 3, w + 4, 13);
      ctx.fillStyle = "#fff";
      ctx.fillText(label, c.pos.x * z + 5, c.pos.y * z + 4);
    }
    ctx.restore();
  }

  // ---- trigger markers ----
  if (input.triggerCells?.size) {
    for (const c of cells) {
      if (!input.triggerCells.has(c.key)) continue;
      const x = c.pos.x + 0.13, y = c.pos.y + 0.87;
      ctx.fillStyle = THEME.accent;
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 1 * px;
      ctx.beginPath();
      ctx.moveTo(x, y - 0.09); ctx.lineTo(x + 0.08, y); ctx.lineTo(x, y + 0.09); ctx.lineTo(x - 0.08, y); ctx.closePath();
      ctx.fill(); ctx.stroke();
    }
  }

  // ---- logic links ----
  if (input.links?.length) drawLinks(ctx, input.links, level, px);

  // ---- problems ----
  for (const k of input.problemCells) {
    const c = map.cellAt(parseKey(k));
    if (!c || c.pos.z !== level) continue;
    ctx.fillStyle = THEME.error;
    ctx.beginPath(); ctx.arc(c.pos.x + 0.85, c.pos.y + 0.15, 0.09, 0, Math.PI * 2); ctx.fill();
  }

  // ---- selection ----
  ctx.lineWidth = 2.5 * px;
  ctx.strokeStyle = THEME.select;
  ctx.fillStyle = "rgba(79,179,255,0.18)";
  for (const k of input.selection.cells) {
    const p = parseKey(k);
    if (p.z !== level) continue;
    ctx.fillRect(p.x, p.y, 1, 1);
    ctx.strokeRect(p.x + 1.5 * px, p.y + 1.5 * px, 1 - 3 * px, 1 - 3 * px);
  }
  ctx.lineWidth = Math.max(5 * px, 0.14);
  for (const k of input.selection.edges) {
    const e = map.edges.find((x) => x.key === k);
    if (!e || e.vertical) continue;
    const here = e.from.z === level ? e.from : e.to.z === level ? e.to : null;
    if (!here) continue;
    const side = (here === e.from ? e.dir : e.dir === "east" ? "west" : "north") as Facing;
    const [ax, ay, bx, by] = segment(side, here.x, here.y);
    ctx.globalAlpha = 0.6;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // ---- tool preview ----
  if (input.preview?.cells?.length) {
    const m = input.preview.mode;
    ctx.fillStyle = m === "remove" ? "rgba(255,90,79,0.35)" : m === "select" ? "rgba(79,179,255,0.25)" : "rgba(224,160,80,0.4)";
    for (const p of input.preview.cells) ctx.fillRect(p.x, p.y, 1, 1);
  }

  // ---- hover ----
  if (input.hover) {
    const h = input.hover;
    if (h.kind === "cell") {
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.lineWidth = 1.5 * px;
      ctx.strokeRect(h.pos.x, h.pos.y, 1, 1);
    } else {
      ctx.strokeStyle = THEME.accent;
      ctx.lineWidth = Math.max(4 * px, 0.12);
      const [ax, ay, bx, by] = segment(h.dir, h.cell.x, h.cell.y, 0.05);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    }
  }

  ctx.restore();
}

const LINK_COLOR = { write: "#ffb44a", read: "#4fb3ff" } as const;

/**
 * Curved arrows from trigger sources to what they affect. An end on another level is
 * drawn where it would be on this level, with a level badge, and the arrow is dashed.
 */
function drawLinks(ctx: CanvasRenderingContext2D, links: DrawLink[], level: number, px: number) {
  ctx.save();
  ctx.lineCap = "round";
  for (const l of links) {
    if (l.a.z !== level && l.b.z !== level) continue;
    const offLevel = l.a.z !== l.b.z;
    const dx = l.b.x - l.a.x, dy = l.b.y - l.a.y;
    const len = Math.hypot(dx, dy);
    ctx.globalAlpha = l.faint ? 0.35 : 0.95;
    ctx.strokeStyle = LINK_COLOR[l.effect];
    ctx.fillStyle = LINK_COLOR[l.effect];
    ctx.lineWidth = Math.max((l.faint ? 1.5 : 2.5) * px, l.faint ? 0.025 : 0.045);
    ctx.setLineDash(l.effect === "read" || offLevel ? [0.12, 0.08] : []);
    if (len < 0.05) {
      // same spot (e.g. a lever that changes itself): a small loop
      ctx.beginPath(); ctx.arc(l.a.x + 0.18, l.a.y - 0.18, 0.12, 0, Math.PI * 1.6); ctx.stroke();
      continue;
    }
    // bow the curve sideways so arrows between the same points don't overlap
    const bow = Math.min(0.6, len * 0.18) * (l.effect === "read" ? -1 : 1);
    const mx = (l.a.x + l.b.x) / 2 - (dy / len) * bow;
    const my = (l.a.y + l.b.y) / 2 + (dx / len) * bow;
    // stop short of the target so the head is visible
    const tx = l.b.x - ((l.b.x - mx) / Math.hypot(l.b.x - mx, l.b.y - my)) * 0.14;
    const ty = l.b.y - ((l.b.y - my) / Math.hypot(l.b.x - mx, l.b.y - my)) * 0.14;
    ctx.beginPath(); ctx.moveTo(l.a.x, l.a.y); ctx.quadraticCurveTo(mx, my, tx, ty); ctx.stroke();
    ctx.setLineDash([]);
    const ang = Math.atan2(ty - my, tx - mx);
    const h = l.faint ? 0.12 : 0.18;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx - Math.cos(ang - 0.45) * h, ty - Math.sin(ang - 0.45) * h);
    ctx.lineTo(tx - Math.cos(ang + 0.45) * h, ty - Math.sin(ang + 0.45) * h);
    ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(l.a.x, l.a.y, l.faint ? 0.04 : 0.06, 0, Math.PI * 2); ctx.fill();
    if (offLevel) {
      const other = l.a.z === level ? l.b : l.a;
      const label = `L${other.z}`;
      ctx.save();
      ctx.translate(other.x, other.y);
      ctx.scale(px, px);
      ctx.font = "bold 10px system-ui, sans-serif";
      const w = ctx.measureText(label).width + 6;
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#000";
      ctx.fillRect(4, -16, w, 14);
      ctx.fillStyle = LINK_COLOR[l.effect];
      ctx.fillText(label, 7, -5);
      ctx.restore();
    }
  }
  ctx.restore();
}

/** A tiny glyph inside a prop's circle so types and states read at a glance. */
function drawPropIcon(ctx: CanvasRenderingContext2D, icon: string | undefined, state: string, cx: number, cy: number, px: number) {
  ctx.save();
  ctx.strokeStyle = "#1a1206";
  ctx.fillStyle = "#1a1206";
  ctx.lineWidth = Math.max(1.5 * px, 0.025);
  ctx.lineCap = "round";
  ctx.beginPath();
  switch (icon) {
    case "lever": {
      const on = state === "on";
      ctx.moveTo(cx, cy + 0.08);
      ctx.lineTo(cx + (on ? 0.08 : -0.08), cy - 0.08);
      ctx.stroke();
      ctx.beginPath(); ctx.arc(cx + (on ? 0.08 : -0.08), cy - 0.08, 0.03, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case "chest":
      ctx.rect(cx - 0.08, cy - (state === "open" ? 0.09 : 0.05), 0.16, 0.12);
      ctx.stroke();
      break;
    case "button":
      ctx.arc(cx, cy, state === "down" ? 0.03 : 0.06, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "sign":
      ctx.moveTo(cx - 0.07, cy - 0.04); ctx.lineTo(cx + 0.07, cy - 0.04);
      ctx.moveTo(cx - 0.07, cy + 0.02); ctx.lineTo(cx + 0.04, cy + 0.02);
      ctx.stroke();
      break;
    case "plate":
      ctx.rect(cx - 0.08, cy - 0.08, 0.16, 0.16);
      ctx.stroke();
      break;
  }
  ctx.restore();
}

function parseKey(k: string): GridPos {
  const [x, y, z] = k.split(",").map(Number);
  return { x: x!, y: y!, z: z! };
}

function drawEdge(ctx: CanvasRenderingContext2D, map: ResolvedMap, e: ResolvedEdge, at: GridPos, side: Facing, px: number, crossLevel: boolean) {
  const ct = map.connectionTypes[e.type];
  const kind = ct?.kind ?? "custom";
  const state = ct?.states[e.state];
  const col = (ct?.material && map.materials[ct.material]?.color) || KIND_COLOR[kind] || THEME.accent;
  const [ax, ay, bx, by] = segment(side, at.x, at.y, 0.15);
  ctx.save();
  ctx.lineCap = "butt";
  switch (kind) {
    case "opening":
      break;
    case "door": {
      ctx.strokeStyle = "#000";
      ctx.lineWidth = Math.max(7 * px, 0.2);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(5 * px, 0.15);
      if (state?.passable) ctx.setLineDash([0.12, 0.08]);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      if (e.state === "locked") {
        ctx.fillStyle = THEME.error;
        ctx.beginPath(); ctx.arc((ax + bx) / 2, (ay + by) / 2, 0.07, 0, Math.PI * 2); ctx.fill();
      }
      break;
    }
    case "gate":
    case "grate": {
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(3 * px, 0.08);
      ctx.setLineDash(state?.passable ? [0.04, 0.16] : [0.06, 0.06]);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      break;
    }
    case "wall": {
      ctx.strokeStyle = state?.passable ? "rgba(180,140,224,0.5)" : "#b48ce0";
      ctx.lineWidth = Math.max(3 * px, 0.08);
      ctx.setLineDash([0.03, 0.07]);
      const [cx, cy, dx, dy] = segment(side, at.x, at.y);
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(dx, dy); ctx.stroke();
      break;
    }
    default: {
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(4 * px, 0.1);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    }
  }
  if (crossLevel) {
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    const up = (at === e.from ? e.to.z : e.from.z) > at.z;
    ctx.setLineDash([]);
    ctx.fillStyle = THEME.accent;
    ctx.beginPath();
    if (up) { ctx.moveTo(mx, my - 0.12); ctx.lineTo(mx - 0.09, my + 0.06); ctx.lineTo(mx + 0.09, my + 0.06); }
    else { ctx.moveTo(mx, my + 0.12); ctx.lineTo(mx - 0.09, my - 0.06); ctx.lineTo(mx + 0.09, my - 0.06); }
    ctx.fill();
  }
  ctx.restore();
}

function drawVertical(ctx: CanvasRenderingContext2D, pos: GridPos, dir: "up" | "down", kind: string, state: string, px: number) {
  // up connections sit in the top-left corner, down connections in the bottom-right
  const cx = pos.x + (dir === "up" ? 0.27 : 0.73);
  const cy = pos.y + (dir === "up" ? 0.27 : 0.73);
  const r = 0.16;
  ctx.save();
  ctx.lineWidth = 1.5 * px;
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  switch (kind) {
    case "pit":
      ctx.fillStyle = "#000";
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      break;
    case "hatch":
      ctx.fillStyle = state === "open" ? "#000" : KIND_COLOR.hatch!;
      ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r);
      ctx.strokeRect(cx - r, cy - r, 2 * r, 2 * r);
      break;
    case "ladder":
      ctx.strokeStyle = KIND_COLOR.ladder!;
      ctx.lineWidth = 2 * px;
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.6, cy - r); ctx.lineTo(cx - r * 0.6, cy + r);
      ctx.moveTo(cx + r * 0.6, cy - r); ctx.lineTo(cx + r * 0.6, cy + r);
      for (let i = -1; i <= 1; i++) { ctx.moveTo(cx - r * 0.6, cy + i * r * 0.6); ctx.lineTo(cx + r * 0.6, cy + i * r * 0.6); }
      ctx.stroke();
      break;
    case "grate":
      ctx.strokeStyle = KIND_COLOR.grate!;
      ctx.beginPath();
      for (let i = -1; i <= 1; i++) {
        ctx.moveTo(cx + i * r * 0.6, cy - r); ctx.lineTo(cx + i * r * 0.6, cy + r);
        ctx.moveTo(cx - r, cy + i * r * 0.6); ctx.lineTo(cx + r, cy + i * r * 0.6);
      }
      ctx.stroke();
      break;
    default:
      ctx.setLineDash([0.05, 0.04]);
      ctx.strokeRect(cx - r, cy - r, 2 * r, 2 * r);
  }
  // direction arrow
  ctx.setLineDash([]);
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  const ay = dir === "up" ? -1 : 1;
  ctx.moveTo(cx + r + 0.08, cy + ay * 0.1);
  ctx.lineTo(cx + r + 0.02, cy - ay * 0.02);
  ctx.lineTo(cx + r + 0.14, cy - ay * 0.02);
  ctx.fill();
  ctx.restore();
}

/** The cell side an edge occupies when viewed from level `level`, if it touches that level. */
export function edgeSideOnLevel(e: ResolvedEdge, level: number): { at: GridPos; side: Facing } | null {
  if (e.vertical) return null;
  if (e.from.z === level) return { at: e.from, side: e.dir as Facing };
  if (e.to.z === level) return { at: e.to, side: e.dir === "east" ? "west" : "north" };
  return null;
}
