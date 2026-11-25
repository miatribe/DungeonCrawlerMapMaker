/**
 * The example maps that ship in the editor's File menu (see scripts/gen-examples.ts):
 * doors, traps and geometry here, plus the full example `keep()` in ./maps.ts.
 */
import { createMap, run, rectPositions, type MapDoc, type Action, type GridPos, type EventRef } from "../../src/core";
import * as ops from "../../src/core/ops";

type Dir = "north" | "east" | "south" | "west";
const P = (x: number, y: number, z = 0): GridPos => ({ x, y, z });
const msg = (text: string): Action => ({ type: "showMessage", text });
const edge = (id: string) => ({ kind: "edge" as const, id });
const prop = (id: string) => ({ kind: "prop" as const, id });
/** An inline event that shows a message the first time. */
const note = (text: string): EventRef => ({ once: true, actions: [msg(text)] });

/** Put a connection between a cell and its neighbor (null makes it a wall). */
const link = (cell: GridPos, dir: Dir, type: string | null = "opening", opts: { id?: string; state?: string } = {}) =>
  ops.setEdge({ cell, dir }, type, opts);

function addProps(doc: MapDoc, props: Parameters<typeof ops.addProp>[1][]): MapDoc {
  for (const p of props) doc = run(doc, ops.addProp(doc, p).command);
  return doc;
}

/**
 * "Doors and Levers": four rooms in a row, each opened a harder way.
 * 1. A plain door: walk up and use it.
 * 2. A locked door worked by a lever (pull it again to lock the door).
 * 3. A vault door that opens only when all three levers are up, and locks again if one goes down.
 * 4. A treasure room.
 */
export function doors(): MapDoc {
  let doc = createMap({ id: "doors-and-levers", name: "Doors and Levers" });
  // rooms sit a cell apart; each door is set in a one-cell doorway through that gap
  const rooms = [
    rectPositions(P(0, 0), P(2, 2)),
    rectPositions(P(4, 0), P(6, 2)),
    rectPositions(P(8, 0), P(11, 3)),
    rectPositions(P(13, 0), P(15, 2)),
  ];
  const doorways = [P(3, 1), P(7, 1), P(12, 1)];
  doc = run(
    doc,
    ops.setMapMeta({ tags: ["example"], onLoad: { actions: [msg("Four rooms, four doors. Walk up to a door and press Space to use it.")] } }),
    ops.define("material", "vault", { name: "Vault plating", color: "#6d7480", texture: "builtin:metal" }),
    ...rooms.map((r) => ops.paintCells(r)),
    ops.paintCells(doorways),
    ...doorways.map((d) => link(d, "east")),
    ops.setSurface([...rooms[0]!, doorways[0]!], "walls", "brick"),
    ops.setSurface([...rooms[3]!, doorways[2]!], "walls", "vault"),
    ops.setSurface(rooms[3]!, "down", "iron"),
    link(P(2, 1), "east", "door", { id: "plain_door" }),
    link(P(6, 1), "east", "door", { id: "lever_door", state: "locked" }),
    link(P(11, 1), "east", "door", { id: "vault_door", state: "locked" }),
    ops.setStart({ cell: P(1, 1), facing: "east" }),
  );

  const levers = ["lever_a", "lever_b", "lever_c"];
  doc = run(
    doc,
    // room 2: one lever toggles the door between locked and open
    ops.define("event", "pullLever", {
      conditions: [{ type: "state", target: edge("lever_door"), equals: "locked" }],
      actions: [
        { type: "setConnectionState", target: edge("lever_door"), state: "open" },
        { type: "setPropState", target: prop("lever"), state: "on" },
        msg("Clunk. The bolt slides back and the east door swings open."),
      ],
      else: [
        { type: "setConnectionState", target: edge("lever_door"), state: "locked" },
        { type: "setPropState", target: prop("lever"), state: "off" },
        msg("The door swings shut and the bolt slides home."),
      ],
    }),
    ops.define("event", "bumpLeverDoor", {
      actions: [msg("Locked tight, and there's no keyhole. Try the lever on the north wall.")],
    }),
    ops.updateEdge("6,1,0:east", { onBump: "bumpLeverDoor" }),
    // room 3: each lever flips itself, then checks all three
    ...levers.map((id, i) => ops.define("event", `pull_${id}`, {
      conditions: [{ type: "state", target: prop(id), equals: "off" }],
      actions: [{ type: "setPropState", target: prop(id), state: "on" }, msg(`Lever ${i + 1} clicks up.`), { type: "runEvent", event: "checkLevers" }],
      else: [{ type: "setPropState", target: prop(id), state: "off" }, msg(`Lever ${i + 1} clicks down.`), { type: "runEvent", event: "checkLevers" }],
    })),
    ops.define("event", "checkLevers", {
      notes: "Runs after any of the three levers moves. All up opens the vault; anything else locks it again.",
      conditions: levers.map((id) => ({ type: "state" as const, target: prop(id), equals: "on" })),
      actions: [{ type: "setConnectionState", target: edge("vault_door"), state: "open" }, msg("All three levers are up. The vault door grinds open!")],
      else: [{ type: "runEvent", event: "relockVault" }],
    }),
    ops.define("event", "relockVault", {
      conditions: [{ type: "state", target: edge("vault_door"), equals: "open" }],
      actions: [{ type: "setConnectionState", target: edge("vault_door"), state: "locked" }, msg("The vault door slams shut again.")],
    }),
    ops.define("event", "bumpVault", { actions: [msg("The vault door won't move. Three levers in this room must all be up.")] }),
    ops.updateEdge("11,1,0:east", { onBump: "bumpVault" }),
    // room 4
    ops.define("flag", "treasure", { type: "bool", initial: false }),
    ops.define("event", "openChest", {
      once: true,
      actions: [{ type: "setPropState", target: prop("chest"), state: "open" }, { type: "setFlag", name: "treasure", value: true }, msg("Gold! You've opened every door. You win.")],
    }),
    // a note as you enter each room
    ops.updateCells([P(4, 1)], { onEnter: note("This door is locked and has no keyhole. A lever must work it.") }),
    ops.updateCells([P(8, 1)], { onEnter: note("A heavy vault door, and three levers on the walls. Pull them all up.") }),
    ops.updateCells([P(13, 1)], { onEnter: note("The vault. A chest waits by the far wall.") }),
  );
  return addProps(doc, [
    { id: "lever", type: "lever", cell: P(5, 0), side: "north", onUse: "pullLever" },
    { id: "lever_a", type: "lever", cell: P(8, 3), side: "west", onUse: "pull_lever_a" },
    { id: "lever_b", type: "lever", cell: P(10, 0), side: "north", onUse: "pull_lever_b" },
    { id: "lever_c", type: "lever", cell: P(10, 3), side: "south", onUse: "pull_lever_c" },
    { id: "chest", type: "chest", cell: P(15, 1), onUse: "openChest" },
  ]);
}

/**
 * "Trap Gauntlet": a run of corridors and rooms, one trap each. The `hits` flag counts how
 * often the traps get you.
 * - Dart plate: step on it and keep moving; a delayed event checks whether you're still there.
 * - Spike pit: an open pit in the middle of a room; walk around it.
 * - Hidden trapdoor: the floor opens as you step on it and drops you into a cellar with a ladder.
 * - Rune floor: glowing tiles throw you back to the start of the hall. Find the safe path.
 * - Flooding room: the door slams behind you, water rises, and a lever is the way out.
 */
export function traps(): MapDoc {
  let doc = createMap({ id: "trap-gauntlet", name: "Trap Gauntlet" });
  const start = rectPositions(P(0, 0), P(1, 2));
  const hall1 = rectPositions(P(2, 1), P(6, 1));
  const pitRoom = rectPositions(P(7, 0), P(9, 2));
  const hall2 = rectPositions(P(10, 1), P(13, 1));
  const cellar = [P(12, 1, -1), P(13, 1, -1)];
  const runeHall = rectPositions(P(14, 0), P(18, 2));
  const runes = [P(15, 0), P(15, 1), P(17, 1), P(17, 2)];
  const hall3 = [P(19, 1)];
  const flood = rectPositions(P(20, 0), P(22, 2));
  doc = run(
    doc,
    ops.setMapMeta({ tags: ["example"] }),
    ops.define("material", "rune", { name: "Glowing rune", color: "#9b5cff", texture: "builtin:flagstone" }),
    ops.define("flag", "hits", { type: "int", initial: 0 }),
    // the rooms and halls touch only along row y=1, so one stroke opens just those joins
    ops.paintCells([...start, ...hall1, ...pitRoom, ...hall2]),
    ops.paintCells(runeHall),
    link(P(13, 1), "east"),
    ops.paintCells(hall3),
    link(P(18, 1), "east"),
    ops.paintCells(flood),
    link(P(19, 1), "east", "door", { id: "slam_door", state: "open" }),
    ops.paintCells(cellar),
    ops.setLevelName(-1, "Below"),
    ops.setSurface([...hall1, ...hall2, ...hall3], "walls", "brick"),
    ops.setSurface(runes, "down", "rune"),
    ops.setSurface(cellar, "all", "moss"),
    ops.setSurface(cellar, "down", "dirt"),
    ops.setStart({ cell: P(0, 1), facing: "east" }),
  );
  doc = run(
    doc,
    ops.connectVertical(doc, P(8, 1), "down", "pit", { createMissing: true }),
    ops.connectVertical(doc, P(12, 1), "down", "hatch"),
    ops.connectVertical(doc, P(13, 1, -1), "up", "ladder"),
  );
  doc = run(
    doc,
    ops.updateEdge("12,1,-1:up", { id: "trapdoor" }),
    ops.setSurface([P(8, 1, -1)], "all", "stone"),
  );

  const hit: Action = { type: "addFlag", name: "hits", amount: 1 };
  const floodFloor = (material: string): Action[] => flood.map((cell) => ({ type: "setSurface", cell, side: "down", material }));
  doc = run(
    doc,
    ops.define("event", "arrive", { actions: [msg("Five traps lie between you and the exit. Watch the floor.")] }),
    // dart plate
    ops.define("event", "dartPlate", {
      actions: [{ type: "setPropState", target: prop("dart_plate"), state: "down" }, msg("Click! The plate sinks under your foot. Move!"), { type: "runEvent", event: "dartFires", delayMs: 1200 }],
    }),
    ops.define("event", "dartFires", {
      notes: "Fires 1.2 s after the plate. It only hits if the player is still standing on it.",
      conditions: [{ type: "playerAt", pos: P(4, 1) }],
      actions: [hit, { type: "setPropState", target: prop("dart_plate"), state: "up" }, msg("A dart shoots out of the wall and hits you!")],
      else: [{ type: "setPropState", target: prop("dart_plate"), state: "up" }, msg("A dart whistles through the spot where you just stood.")],
    }),
    // spike pit
    ops.define("event", "spikes", {
      actions: [hit, msg("You fall onto rusty spikes!"), { type: "runEvent", event: "climbOutOfPit", delayMs: 1500 }],
    }),
    ops.define("event", "climbOutOfPit", { actions: [{ type: "teleport", to: P(7, 1), facing: "east" }, msg("You climb back out. Walk around the pit this time.")] }),
    // hidden trapdoor
    ops.define("event", "trapdoorOpens", {
      conditions: [{ type: "state", target: edge("trapdoor"), equals: "closed" }],
      actions: [{ type: "setConnectionState", target: edge("trapdoor"), state: "open" }, msg("The floor gives way!")],
    }),
    ops.define("event", "cellarLanding", {
      actions: [hit, { type: "setConnectionState", target: edge("trapdoor"), state: "closed" }, msg("You land in a damp cellar and the trapdoor snaps shut above you. There's a ladder to the east.")],
    }),
    // rune floor
    ops.define("event", "rune", {
      actions: [hit, { type: "teleport", to: P(14, 1), facing: "east" }, msg("The rune flares and throws you back to the start of the hall.")],
    }),
    // flooding room
    ops.define("event", "slam", {
      once: true,
      actions: [
        { type: "setConnectionState", target: edge("slam_door"), state: "locked" },
        ...floodFloor("water"),
        msg("The door slams behind you and water pours in from the walls! There's a lever on the east wall."),
        { type: "runEvent", event: "drowning", delayMs: 10000 },
      ],
    }),
    ops.define("event", "drowning", {
      conditions: [{ type: "state", target: prop("drain_lever"), equals: "off" }],
      actions: [hit, msg("The water is up to your chin. Pull the lever!")],
    }),
    ops.define("event", "drain", {
      once: true,
      actions: [
        { type: "setPropState", target: prop("drain_lever"), state: "on" },
        { type: "setConnectionState", target: edge("slam_door"), state: "open" },
        ...floodFloor("flagstone"),
        msg("The water drains away and the door unlocks."),
        { type: "runEvent", event: "score" },
      ],
    }),
    ops.define("event", "score", {
      conditions: [{ type: "flag", name: "hits", op: "==", value: 0 }],
      actions: [msg("You beat the gauntlet without a scratch!")],
      else: [msg("You beat the gauntlet. The hits flag shows how often the traps got you.")],
    }),
    // triggers
    ops.setMapMeta({ onLoad: "arrive" }),
    ops.updateCells([P(3, 1)], { onEnter: note("A loose stone in the floor ahead. Step on it, then keep moving.") }),
    ops.updateCells([P(4, 1)], { onEnter: "dartPlate" }),
    ops.updateCells([P(7, 1)], { onEnter: note("A spiked pit fills the middle of this room.") }),
    ops.updateCells([P(8, 1, -1)], { onEnter: "spikes" }),
    ops.updateCells([P(11, 1)], { onEnter: note("The floor here sounds hollow...") }),
    ops.updateCells([P(12, 1)], { onEnter: "trapdoorOpens" }),
    ops.updateCells([P(12, 1, -1)], { onEnter: "cellarLanding" }),
    ops.updateCells([P(14, 1)], { onEnter: note("Purple runes glow in the floor. Don't step on them.") }),
    ops.updateCells(runes, { onEnter: "rune" }),
    ops.updateCells([P(21, 1)], { onEnter: "slam" }),
  );
  return addProps(doc, [
    { id: "dart_plate", type: "pressurePlate", cell: P(4, 1) },
    { id: "drain_lever", type: "lever", cell: P(22, 1), side: "east", onUse: "drain" },
  ]);
}

/**
 * "Geometry Tour": one room per kind of geometry, walked west to east.
 * Flat floors, raised and sunken cells, a low ceiling, a vaulted hall, a ramp, stairs, a
 * sunken grotto with a pool, a ramp and a staircase that each climb a full level, and every
 * vertical connection: grate, trapdoor, pit, open shaft and ladder.
 */
export function geometry(): MapDoc {
  let doc = createMap({ id: "geometry-tour", name: "Geometry Tour" });
  // rooms sit a cell apart or meet only through openings, so there are no thin walls
  const entry = [...rectPositions(P(0, 0), P(1, 2)), P(2, 1)];
  const heights = rectPositions(P(3, 0), P(5, 2));
  const tunnel = [P(6, 1), P(7, 1)];
  const hall = rectPositions(P(8, 0), P(10, 2));
  const balcony = rectPositions(P(8, 4, 1), P(10, 4, 1));
  const slopes = rectPositions(P(11, 1), P(14, 1));
  const grotto = rectPositions(P(15, 0), P(17, 2));
  const upper = rectPositions(P(19, 0, 1), P(21, 2, 1));
  // the room below leaves out the cell under the top of the stairs
  const lower = rectPositions(P(19, 0), P(21, 2)).filter((p) => !(p.x === 19 && p.y === 1));
  doc = run(
    doc,
    ops.setMapMeta({ tags: ["example"] }),
    // entry: plain flat cells
    ops.paintCells(entry),
    ops.setSurface(entry, "walls", "brick"),
    // heights: steps up to a ledge, a sunken pool, a low alcove (no step is more than one)
    ops.paintCells(heights),
    link(P(2, 1), "east"),
    ops.setHeights([P(4, 0), P(5, 1)], { floor: 1 }),
    ops.setHeights([P(5, 0)], { floor: 2 }),
    ops.setHeights([P(4, 2)], { floor: -1 }),
    ops.setSurface([P(4, 2)], "down", "water"),
    ops.setHeights([P(3, 0)], { ceiling: 2 }),
    // a low tunnel
    ops.paintCells(tunnel),
    link(P(5, 1), "east"),
    ops.setHeights(tunnel, { ceiling: 3 }),
    ops.setSurface(tunnel, "walls", "dirt"),
    // vaulted hall two levels tall
    ops.paintCells(hall),
    link(P(7, 1), "east"),
    ops.setHeights(hall, { ceiling: 8 }),
    ops.setSurface(hall, "walls", "brick"),
    // ramp up, landing, stairs down
    ops.paintCells(slopes),
    link(P(10, 1), "east"),
    ops.buildRamp([P(11, 1)], { kind: "ramp", rise: 1, toward: "east" }),
    ops.setHeights([P(12, 1)], { floor: 1 }),
    ops.setHeights([P(14, 1)], { floor: -1 }),
    ops.buildRamp([P(14, 1), P(13, 1)], { kind: "stairs", rise: 1, toward: "west", treads: 4 }),
    ops.setSurface(slopes, "walls", "wood"),
    // sunken grotto with a deeper pool
    ops.paintCells(grotto),
    link(P(14, 1), "east"),
    ops.setHeights(grotto, { floor: -1 }),
    ops.setHeights([P(16, 0)], { floor: -2 }),
    ops.setSurface(grotto, "walls", "moss"),
    ops.setSurface(grotto, "down", "dirt"),
    ops.setSurface([P(16, 0)], "down", "water"),
    ops.paintCells([P(18, 1)]),
    link(P(17, 1), "east"),
    ops.setStart({ cell: P(1, 1), facing: "east" }),
  );
  // a ramp in a niche off the hall up to a balcony, and stairs from the grotto up to the upper room
  doc = run(doc, ops.paintCells([P(10, 3)]), link(P(10, 2), "south"));
  doc = run(doc, ops.buildLevelStairs(doc, P(10, 3), "south", "ramp"));
  doc = run(
    doc,
    ops.paintCells(balcony),
    ops.paintCells([P(8, 3)]), // the way back into the hall from under the balcony's pit
    link(P(8, 2), "south"),
  );
  doc = run(doc, ops.buildLevelStairs(doc, P(18, 1), "east", "stairs", 8));
  doc = run(
    doc,
    ops.paintCells(upper),
    ops.paintCells(lower),
    ops.setLevelName(0, "Ground"),
    ops.setLevelName(1, "Upper"),
    ops.setSurface(upper, "down", "wood"),
  );
  // vertical connections
  doc = run(
    doc,
    ops.connectVertical(doc, P(8, 4, 1), "down", "pit", { createMissing: true }), // balcony pit back toward the hall
    ops.connectVertical(doc, P(19, 0, 1), "down", "grate"),
    ops.connectVertical(doc, P(21, 0, 1), "down", "hatch"),
    ops.connectVertical(doc, P(21, 1, 1), "down", "pit"),
    ops.connectVertical(doc, P(20, 2, 1), "down", "open"),
    ops.connectVertical(doc, P(19, 2), "up", "ladder"),
  );
  doc = run(
    doc,
    link(P(8, 4), "north"),
    ops.updateEdge("21,0,0:up", { id: "hatch" }),
  );

  doc = run(
    doc,
    ops.define("event", "toggleHatch", {
      conditions: [{ type: "state", target: edge("hatch"), equals: "closed" }],
      actions: [{ type: "setConnectionState", target: edge("hatch"), state: "open" }, { type: "setPropState", target: prop("hatch_lever"), state: "on" }, msg("A trapdoor drops open in the north-east corner.")],
      else: [{ type: "setConnectionState", target: edge("hatch"), state: "closed" }, { type: "setPropState", target: prop("hatch_lever"), state: "off" }, msg("The trapdoor swings shut.")],
    }),
    ops.define("event", "lowerRoom", { once: true, actions: [msg("You've dropped into the room below. The ladder in the south-west corner leads back up.")] }),
    ops.updateCells([P(1, 1)], { onEnter: note("Geometry Tour. Walk east through one room per kind of geometry.") }),
    ops.updateCells([P(3, 1)], { onEnter: note("Floor and ceiling heights: steps up to a ledge (north-east), a sunken pool (south), a low alcove (north-west).") }),
    ops.updateCells([P(5, 0)], { onEnter: note("The top of the steps, two above the floor.") }),
    ops.updateCells([P(6, 1)], { onEnter: note("A low tunnel: the ceiling is only three steps high.") }),
    ops.updateCells([P(8, 1)], { onEnter: note("A vaulted hall, two levels tall. The ramp south of the east end climbs a full level to a balcony.") }),
    ops.updateCells([P(10, 4, 1)], { onEnter: note("The balcony. Its west end has a pit back down to the hall.") }),
    ops.updateCells([P(11, 1)], { onEnter: note("A ramp up to a landing, then stairs down.") }),
    ops.updateCells([P(15, 1)], { onEnter: note("A sunken grotto with a deeper pool. The stairs to the east climb a full level.") }),
    ops.updateCells([P(19, 1, 1)], { onEnter: note("The upper room. Its floor has a grate (north-west), a trapdoor (north-east, use the lever), a pit (east) and an open shaft (south).") }),
    ops.updateCells([P(19, 0, 1)], { onEnter: note("An iron grate. You can see down, but not pass.") }),
    ops.updateCells(lower, { onEnter: "lowerRoom" }),
  );
  return addProps(doc, [{ id: "hatch_lever", type: "lever", cell: P(20, 0, 1), side: "north", onUse: "toggleHatch" }]);
}
