/**
 * Headless game runtime for playtesting (SPEC §9.2): runs events and enforces movement rules
 * against a copy of the map's state. The authored map is never modified. Usable from tests,
 * the editor's playtest, or as a reference for engine implementations.
 */
import { cellKey, OPPOSITE, type Direction, type Facing, type GridPos, type Side } from "../geometry";
import { floorAtSide, type ResolvedCell, type ResolvedEdge, type ResolvedMap } from "../resolve";
import type { Action, Condition, EventRef, MapEvent, ParamValue, Start, Target } from "../schema";

export type FlagValue = boolean | number | string;

export interface LogEntry {
  kind: "message" | "info" | "custom" | "warn";
  text: string;
}

export interface RuntimeState {
  player: { pos: GridPos; facing: Facing };
  edges: Record<string, string>;
  props: Record<string, string>;
  flags: Record<string, FlagValue>;
  /** Named events (and inline-once keys) that have fired with `once`. */
  fired: string[];
  /** Surface material overrides from setSurface, by cell key. */
  surfaces: Record<string, Partial<Record<Side, string>>>;
  log: LogEntry[];
}

export interface RuntimeOptions {
  start?: Start;
  /** Result of custom conditions (default: true). */
  customCondition?: (id: string, params: Record<string, ParamValue> | undefined) => boolean;
  /** Called for custom actions (they're also logged). */
  onCustomAction?: (id: string, params: Record<string, ParamValue> | undefined) => void;
  /** Delay runner for runEvent with delayMs (default: setTimeout). Tests pass a synchronous one. */
  schedule?: (fn: () => void, ms: number) => void;
  /** Max log entries kept. */
  logLimit?: number;
}

export type MoveResult =
  | { ok: true; fell?: number; climbed?: "up" | "down" }
  | { ok: false; reason: "wall" | "closed" | "void" | "step" | "busy" };

/**
 * The wall a ladder in this cell leans on: the first of north, east, south, west that is a
 * real wall (no connection, or one leading to rock). Null when every side is open, in which
 * case the ladder stands free in the middle of the cell. The 3D view and the playtest both
 * use this, so the ladder you see is the one you can climb by walking into it.
 */
export function ladderSide(map: ResolvedMap, pos: GridPos): Facing | null {
  for (const side of ["north", "east", "south", "west"] as Facing[]) {
    const e = map.edgesOf(pos).find((x) => x.dir === side)?.edge;
    if (!e) return side;
    const isFrom = e.from.x === pos.x && e.from.y === pos.y && e.from.z === pos.z;
    if (!map.cellAt(isFrom ? e.to : e.from)) return side;
  }
  return null;
}

const LEFT: Record<Facing, Facing> = { north: "west", west: "south", south: "east", east: "north" };
const RIGHT: Record<Facing, Facing> = { north: "east", east: "south", south: "west", west: "north" };

export type MoveDir = "forward" | "back" | "left" | "right";

export class Runtime {
  readonly map: ResolvedMap;
  state: RuntimeState;
  private opts: RuntimeOptions;
  private listeners = new Set<() => void>();
  /** Guards against runaway event recursion (runEvent loops). */
  private depth = 0;

  constructor(map: ResolvedMap, opts: RuntimeOptions = {}) {
    this.map = map;
    this.opts = opts;
    const start = opts.start ?? map.start;
    if (!start) throw new Error("The map has no start position");
    this.state = {
      player: { pos: { ...start.cell }, facing: start.facing },
      edges: Object.fromEntries(map.edges.map((e) => [e.key, e.state])),
      props: Object.fromEntries(map.props.map((p) => [p.id, p.state])),
      flags: Object.fromEntries(Object.entries(map.flags).map(([k, f]) => [k, f.initial])),
      fired: [],
      surfaces: {},
      log: [],
    };
  }

  /** Run map onLoad and the start cell's onEnter. Call once after construction. */
  begin(): void {
    if (this.map.onLoad !== undefined) this.run(this.map.onLoad, "map:onLoad");
    const c = this.cell();
    if (c?.onEnter !== undefined) this.run(c.onEnter, `cell:${c.key}:onEnter`);
    this.emit();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const l of this.listeners) l();
  }

  // ---------- queries ----------

  cell(pos: GridPos = this.state.player.pos): ResolvedCell | undefined {
    return this.map.cellAt(pos);
  }

  edgeState(e: ResolvedEdge) {
    return this.map.connectionTypes[e.type]?.states[this.state.edges[e.key] ?? e.state];
  }

  passable(e: ResolvedEdge): boolean {
    return !!this.edgeState(e)?.passable;
  }

  /** The connection on one side of a cell (any level on the far side). */
  edgeOn(pos: GridPos, dir: Direction): ResolvedEdge | undefined {
    return this.map.edgesOf(pos).find((x) => x.dir === dir)?.edge;
  }

  private other(e: ResolvedEdge, pos: GridPos): GridPos {
    const isFrom = e.from.x === pos.x && e.from.y === pos.y && e.from.z === pos.z;
    return isFrom ? e.to : e.from;
  }

  /** Walking height where a cell meets a side; along a ramp's slope, its midpoint. */
  private heightAt(c: ResolvedCell, side: Facing): number {
    const h = floorAtSide(c, side);
    if (h !== null) return h;
    return c.abs.floor + (c.shape.kind === "flat" ? 0 : c.shape.rise / 2);
  }

  surface(pos: GridPos, side: Side): string | undefined {
    return this.state.surfaces[cellKey(pos)]?.[side] ?? this.cell(pos)?.surfaces[side];
  }

  // ---------- player actions ----------

  turn(dir: "left" | "right"): void {
    const f = this.state.player.facing;
    this.state.player.facing = dir === "left" ? LEFT[f] : RIGHT[f];
    this.emit();
  }

  move(rel: MoveDir): MoveResult {
    const r = this.doMove(rel);
    this.emit();
    return r;
  }

  private doMove(rel: MoveDir): MoveResult {
    const p = this.state.player;
    const here = this.cell();
    if (!here) return { ok: false, reason: "void" };
    const d: Facing = rel === "forward" ? p.facing : rel === "back" ? (OPPOSITE[p.facing] as Facing) : rel === "left" ? LEFT[p.facing] : RIGHT[p.facing];
    const e = this.edgeOn(p.pos, d);

    if (!e) {
      // Ladders: walking into a wall while on a ladder climbs it (forward = up, back = down).
      const climb = rel === "forward" ? "up" : rel === "back" ? "down" : null;
      if (climb && this.climb(climb)) return { ok: true, climbed: climb };
      this.info("A solid wall.");
      return { ok: false, reason: "wall" };
    }
    if (!this.passable(e)) {
      if (e.onBump !== undefined) this.run(e.onBump, `edge:${e.key}:onBump`);
      else {
        const kind = this.map.connectionTypes[e.type]?.kind;
        const st = this.state.edges[e.key];
        this.info(kind === "door" ? (st === "locked" ? "The door is locked." : "The door is closed.") : kind === "wall" ? "A solid wall." : "The way is blocked.");
      }
      return { ok: false, reason: "closed" };
    }
    const to = this.other(e, p.pos);
    const there = this.cell(to);
    if (!there) {
      this.info("Nothing but void beyond.");
      return { ok: false, reason: "void" };
    }
    const fa = this.heightAt(here, d);
    const fb = this.heightAt(there, OPPOSITE[d] as Facing);
    if (Math.abs(fa - fb) > this.map.rules.maxStep) {
      this.info(fb > fa ? "It's too high to climb." : "The drop is too far.");
      return { ok: false, reason: "step" };
    }
    const fell = this.enter(to);
    return fell ? { ok: true, fell } : { ok: true };
  }

  /** The passable ladder leading up or down from the player's cell, if any. */
  ladder(dir: "up" | "down", pos: GridPos = this.state.player.pos): ResolvedEdge | undefined {
    const lad = this.edgeOn(pos, dir);
    if (!lad || this.map.connectionTypes[lad.type]?.kind !== "ladder" || !this.passable(lad)) return undefined;
    return this.cell(this.other(lad, pos)) ? lad : undefined;
  }

  private climb(dir: "up" | "down"): boolean {
    const lad = this.ladder(dir);
    if (!lad) return false;
    this.enter(this.other(lad, this.state.player.pos));
    this.info(dir === "up" ? "You climb up the ladder." : "You climb down the ladder.");
    return true;
  }

  /** Move into a cell (exit/enter triggers), then fall through open floors. Returns levels fallen. */
  private enter(to: GridPos): number {
    const from = this.cell();
    if (from?.onExit !== undefined) this.run(from.onExit, `cell:${from.key}:onExit`);
    this.state.player.pos = { ...to };
    const c = this.cell();
    if (c?.onEnter !== undefined) this.run(c.onEnter, `cell:${c.key}:onEnter`);
    let fell = 0;
    for (let guard = 0; guard < 64; guard++) {
      const down = this.edgeOn(this.state.player.pos, "down");
      if (!down || !this.passable(down)) break;
      const kind = this.map.connectionTypes[down.type]?.kind;
      if (kind === "ladder") break;
      const below = this.other(down, this.state.player.pos);
      if (!this.cell(below)) break;
      const prev = this.cell();
      if (prev?.onExit !== undefined) this.run(prev.onExit, `cell:${prev.key}:onExit`);
      this.state.player.pos = { ...below };
      fell++;
      const nc = this.cell();
      if (nc?.onEnter !== undefined) this.run(nc.onEnter, `cell:${nc.key}:onEnter`);
    }
    if (fell) this.info(fell === 1 ? "You fall through the floor!" : `You fall ${fell} levels!`);
    return fell;
  }

  /** Use whatever is in front: a prop here (on the faced wall or the floor), the connection ahead, or a prop just beyond it. */
  use(): void {
    this.doUse();
    this.emit();
  }

  private doUse(): void {
    const p = this.state.player;
    const propsHere = this.map.props.filter((x) => x.cell.x === p.pos.x && x.cell.y === p.pos.y && x.cell.z === p.pos.z);
    const usable = (side?: string) => propsHere.find((x) => x.onUse !== undefined && (x.side ?? undefined) === side);
    const prop = usable(p.facing) ?? usable(undefined);
    if (prop) { this.run(prop.onUse!, `prop:${prop.id}:onUse`); return; }

    const e = this.edgeOn(p.pos, p.facing);
    if (e) {
      const ct = this.map.connectionTypes[e.type];
      if (e.onUse !== undefined) { this.run(e.onUse, `edge:${e.key}:onUse`); return; }
      if (ct && ct.kind !== "opening") {
        const st = this.state.edges[e.key]!;
        const tr = ct.states[st]?.transitions ?? [];
        if (tr.length) {
          this.state.edges[e.key] = tr[0]!;
          const nowOpen = ct.states[tr[0]!]?.passable;
          this.info(ct.kind === "door" ? (nowOpen ? "The door creaks open." : "You pull the door shut.") : `${ct.name}: ${tr[0]}`);
          return;
        }
        this.info(st === "locked" ? "It's locked tight." : "There's no handle. Something else must move it.");
        return;
      }
      if (this.passable(e)) {
        const beyond = this.other(e, p.pos);
        const across = this.map.props.find((x) => x.cell.x === beyond.x && x.cell.y === beyond.y && x.cell.z === beyond.z && x.onUse !== undefined
          && (x.side === undefined || x.side === OPPOSITE[p.facing]));
        if (across) { this.run(across.onUse!, `prop:${across.id}:onUse`); return; }
      }
    }
    // Nothing else to use: standing at a ladder, use climbs it (up first, else down).
    if (this.climb("up") || this.climb("down")) return;
    this.info("Nothing to use here.");
  }

  // ---------- events ----------

  /** Run an event reference. `key` identifies an inline event for `once`. */
  run(ref: EventRef, key?: string): void {
    const ev: MapEvent | undefined = typeof ref === "string" ? this.map.events[ref] : ref;
    if (!ev) { this.warn(`Missing event "${String(ref)}"`); return; }
    const onceKey = typeof ref === "string" ? ref : key;
    if (ev.once && onceKey && this.state.fired.includes(onceKey)) return;
    if (this.depth > 32) { this.warn("Event chain too deep (runEvent loop?) — stopped."); return; }
    this.depth++;
    try {
      const ok = (ev.conditions ?? []).every((c) => this.check(c));
      if (ok && ev.once && onceKey) this.state.fired.push(onceKey);
      if (ok && !ev.once && typeof ref === "string" && !this.state.fired.includes(ref)) this.state.fired.push(ref);
      for (const a of ok ? ev.actions : ev.else ?? []) this.act(a);
    } finally {
      this.depth--;
    }
  }

  private targetEdge(t: Target): ResolvedEdge | undefined {
    try {
      if (t.kind === "edge") return this.map.edgeById(t.id);
      if (t.kind === "edgeAt") return this.map.edgeAt(t.cell, t.dir, t.toZ);
    } catch { /* invalid address */ }
    return undefined;
  }

  private targetState(t: Target): string | undefined {
    if (t.kind === "prop") return this.state.props[t.id];
    const e = this.targetEdge(t);
    return e ? this.state.edges[e.key] : undefined;
  }

  check(c: Condition): boolean {
    switch (c.type) {
      case "state": return this.targetState(c.target) === c.equals;
      case "flag": {
        const v = this.state.flags[c.name];
        switch (c.op) {
          case "==": return v === c.value;
          case "!=": return v !== c.value;
          case ">": return (v as number) > (c.value as number);
          case "<": return (v as number) < (c.value as number);
          case ">=": return (v as number) >= (c.value as number);
          case "<=": return (v as number) <= (c.value as number);
        }
        return false;
      }
      case "playerAt": {
        const p = this.state.player;
        return p.pos.x === c.pos.x && p.pos.y === c.pos.y && p.pos.z === c.pos.z && (!c.facing || c.facing === p.facing);
      }
      case "playerFacing": return this.state.player.facing === c.facing;
      case "eventFired": return this.state.fired.includes(c.event);
      case "any": return c.conditions.some((s) => this.check(s));
      case "not": return !c.conditions.some((s) => this.check(s)); // none of them
      case "custom": return this.opts.customCondition?.(c.custom, c.params) ?? true;
    }
  }

  private act(a: Action): void {
    switch (a.type) {
      case "setConnectionState": {
        const e = this.targetEdge(a.target);
        if (e) this.state.edges[e.key] = a.state; else this.warn("setConnectionState: target not found");
        break;
      }
      case "toggleConnectionState": {
        const e = this.targetEdge(a.target);
        if (!e) { this.warn("toggleConnectionState: target not found"); break; }
        this.state.edges[e.key] = this.state.edges[e.key] === a.states[0] ? a.states[1] : a.states[0];
        break;
      }
      case "setPropState":
        if (a.target.kind === "prop" && a.target.id in this.state.props) this.state.props[a.target.id] = a.state;
        else this.warn("setPropState: target not found");
        break;
      case "setFlag": this.state.flags[a.name] = a.value; break;
      case "addFlag": this.state.flags[a.name] = ((this.state.flags[a.name] as number) ?? 0) + a.amount; break;
      case "teleport":
        if (!this.cell(a.to)) { this.warn("teleport: no cell there"); break; }
        this.state.player.pos = { ...a.to };
        if (a.facing) this.state.player.facing = a.facing;
        break;
      case "showMessage": this.log({ kind: "message", text: a.text }); break;
      case "runEvent": {
        const go = () => { this.run(a.event); this.emit(); };
        if (a.delayMs) (this.opts.schedule ?? ((f, ms) => setTimeout(f, ms)))(go, a.delayMs);
        else this.run(a.event);
        break;
      }
      case "setSurface": {
        const k = cellKey(a.cell);
        this.state.surfaces[k] = { ...this.state.surfaces[k], [a.side]: a.material };
        break;
      }
      case "custom": {
        const name = this.map.customTypes[a.custom]?.name ?? a.custom;
        const args = Object.entries(a.params ?? {}).map(([k, v]) => `${k}=${v && typeof v === "object" ? `(${v.x},${v.y},${v.z})` : JSON.stringify(v)}`).join(" ");
        this.log({ kind: "custom", text: `[${name}] ${args}`.trim() });
        this.opts.onCustomAction?.(a.custom, a.params);
        break;
      }
    }
  }

  private log(e: LogEntry) {
    this.state.log.push(e);
    const lim = this.opts.logLimit ?? 200;
    if (this.state.log.length > lim) this.state.log.splice(0, this.state.log.length - lim);
  }
  private info(text: string) { this.log({ kind: "info", text }); }
  private warn(text: string) { this.log({ kind: "warn", text }); }
}
