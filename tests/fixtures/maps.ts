/** Test fixtures built through the public ops, so they double as an ops smoke test. */
import { createMap, run, rectPositions, type MapDoc, type Action, type GridPos, type Side } from "../../src/core";
import * as ops from "../../src/core/ops";

const P = (x: number, y: number, z = 0): GridPos => ({ x, y, z });

/** A port of the schema playtest prototype's "Three Rooms" demo. */
export function threeRooms(): MapDoc {
  let doc = createMap({ id: "three-rooms", name: "Three Rooms" });
  const room = (x0: number, y0: number, x1: number, y1: number, wall: string, floor: string) => {
    const cells = rectPositions({ x: x0, y: y0, z: 0 }, { x: x1, y: y1, z: 0 });
    doc = run(doc, ops.paintCells(cells), ops.setSurface(cells, "walls", wall), ops.setSurface(cells, "down", floor));
  };
  doc = run(
    doc,
    ops.define("material", "flagA", { name: "Flagstone A", color: "#4a3a38" }),
    ops.define("material", "flagB", { name: "Flagstone B", color: "#3b4048" }),
    ops.define("material", "flagC", { name: "Flagstone C", color: "#33472f" }),
  );
  room(1, 1, 3, 3, "brick", "flagA");
  room(4, 1, 7, 3, "stone", "flagB");
  room(5, 4, 7, 5, "moss", "flagC");

  const msg = (text: string): Action => ({ type: "showMessage", text });
  const sc = (id: string, state: string): Action => ({ type: "setConnectionState", target: { kind: "edge", id }, state });
  const sp = (id: string, state: string): Action => ({ type: "setPropState", target: { kind: "prop", id }, state });

  doc = run(
    doc,
    ops.setEdge({ cell: { x: 3, y: 2, z: 0 }, dir: "east" }, "gate", { id: "gate" }),
    ops.setEdge({ cell: { x: 6, y: 3, z: 0 }, dir: "south" }, "door", { id: "door" }),
    ops.define("flag", "treasure", { type: "bool", initial: false }),
    ops.define("event", "welcome", { once: true, actions: [msg("You wake in a cold brick room. An iron gate blocks the east wall. Look for a lever.")] }),
    ops.define("event", "draft", { once: true, actions: [msg("A cold draft slides past you. The stone here is damp.")] }),
    ops.define("event", "toggleGate", {
      conditions: [{ type: "state", target: { kind: "edge", id: "gate" }, equals: "closed" }],
      actions: [sc("gate", "open"), sp("lever1", "on"), msg("Chains rattle. The gate rises.")],
      else: [sc("gate", "closed"), sp("lever1", "off"), msg("The gate grinds shut again.")],
    }),
    ops.define("event", "trap", { once: true, actions: [sc("door", "locked"), msg("The door slams shut behind you and the lock turns.")] }),
    ops.define("event", "unlockDoor", {
      conditions: [{ type: "state", target: { kind: "edge", id: "door" }, equals: "locked" }],
      actions: [sc("door", "closed"), sp("lever2", "on"), msg("Click. Somewhere behind you, a lock releases.")],
      else: [msg("The lever is already pulled.")],
    }),
    ops.define("event", "openChest", {
      once: true,
      actions: [sp("chest", "open"), { type: "setFlag", name: "treasure", value: true }, msg("The chest opens. Gold! You win the demo.")],
    }),
    ops.updateCells([{ x: 1, y: 2, z: 0 }], { onEnter: "welcome" }),
    ops.updateCells([{ x: 5, y: 2, z: 0 }], { onEnter: "draft" }),
    ops.updateCells([{ x: 6, y: 4, z: 0 }], { onEnter: "trap" }),
    ops.setStart({ cell: { x: 1, y: 2, z: 0 }, facing: "east" }),
  );
  for (const [id, x, y, type, onUse] of [
    ["lever1", 3, 3, "lever", "toggleGate"],
    ["lever2", 5, 5, "lever", "unlockDoor"],
    ["chest", 7, 5, "chest", "openChest"],
  ] as const) {
    doc = run(doc, ops.addProp(doc, { id, type, cell: { x, y, z: 0 }, onUse }).command);
  }
  return doc;
}

/**
 * "The Crypt": a small puzzle dungeon that uses most features.
 * Chapel (level 0): light three braziers (custom prop type) to count up a flag and open a
 * secret wall. A staircase run leads down to a vault where a pressure plate opens a trapdoor
 * into the crypt (level -1). The sarcophagus fires custom actions; a ladder leads back up.
 */
export function crypt(): MapDoc {
  let doc = createMap({ id: "crypt", name: "The Crypt" });
  const hall = rectPositions(P(0, 0), P(4, 2));
  const corridor = [P(2, 3), P(2, 4), P(2, 5)];
  const vault = [...rectPositions(P(1, 6), P(3, 7)), P(3, 8)];
  const cryptCells = rectPositions(P(1, 7, -1), P(3, 8, -1));
  doc = run(
    doc,
    ops.setLevelName(0, "Chapel"),
    ops.define("material", "bone", { name: "Bone", color: "#d8ccb0", texture: "builtin:cobble" }),
    ops.define("propType", "brazier", { name: "Brazier", states: ["unlit", "lit"], initialState: "unlit", preview: { color: "#e07030", icon: "generic" } }),
    ops.define("customType", "playSound", {
      category: "action", name: "Play sound", description: "Play a sound effect",
      params: [{ name: "sound", type: "string", required: true }, { name: "volume", type: "float", default: 1 }],
    }),
    ops.define("customType", "spawnMonster", {
      category: "action", name: "Spawn monster",
      params: [{ name: "monster", type: "enum", options: ["skeleton", "ghoul"], required: true }, { name: "at", type: "gridPos", required: true }],
    }),
    ops.define("customType", "hasLight", { category: "condition", name: "Player carries a light", params: [] }),
    ops.define("flag", "flames", { type: "int", initial: 0 }),
    ops.define("flag", "relic", { type: "bool", initial: false }),
    // geometry
    ops.paintCells(hall),
    ops.setSurface(hall, "walls", "brick"),
    ops.paintCells(corridor),
    ops.paintCells(vault),
    ops.setHeights(vault, { floor: -2 }),
    ops.setHeights([P(2, 5)], { floor: -2 }),
    ops.buildRamp([P(2, 5), P(2, 4)], { kind: "stairs", rise: 1, toward: "north", treads: 3 }),
    ops.setEdge({ cell: P(2, 2), dir: "south" }, "secretWall", { id: "secret" }),
    ops.setEdge({ cell: P(2, 5), dir: "south" }, "opening"),
    ops.setSurface([...corridor, ...vault], "walls", "stone"),
    ops.paintCells(cryptCells),
    ops.setHeights(cryptCells, { floor: -2, ceiling: 2 }),
    ops.setSurface(cryptCells, "walls", "moss"),
    ops.setSurface(cryptCells, "down", "bone"),
    ops.setLevelName(-1, "Crypt"),
    ops.setStart({ cell: P(0, 1), facing: "east" }),
  );
  doc = run(
    doc,
    ops.connectVertical(doc, P(2, 7), "down", "hatch"),
    ops.connectVertical(doc, P(3, 8, -1), "up", "ladder"),
  );
  doc = run(doc, ops.updateEdge("2,7,-1:up", { id: "crypt_hatch" }));

  const msg = (text: string): Action => ({ type: "showMessage", text });
  const brazier = (n: number) => `brazier_${n}`;
  doc = run(
    doc,
    ops.define("event", "welcome", { actions: [msg("The chapel is cold. Three braziers stand dark along the walls.")] }),
    ops.define("event", "checkFlames", {
      conditions: [{ type: "flag", name: "flames", op: ">=", value: 3 }],
      actions: [
        { type: "setConnectionState", target: { kind: "edge", id: "secret" }, state: "open" },
        { type: "custom", custom: "playSound", params: { sound: "stone_grind" } },
        msg("Stone grinds against stone. Part of the south wall slides away."),
      ],
    }),
    ...[1, 2, 3].map((n) => ops.define("event", `light_${n}`, {
      conditions: [{ type: "state", target: { kind: "prop", id: brazier(n) }, equals: "unlit" }],
      actions: [
        { type: "setPropState", target: { kind: "prop", id: brazier(n) }, state: "lit" },
        { type: "addFlag", name: "flames", amount: 1 },
        msg("The brazier flares to life."),
        { type: "runEvent", event: "checkFlames" },
      ],
      else: [msg("It's already burning.")],
    })),
    ops.define("event", "plate", {
      once: true,
      actions: [
        { type: "setConnectionState", target: { kind: "edge", id: "crypt_hatch" }, state: "open" },
        { type: "custom", custom: "playSound", params: { sound: "click", volume: 0.6 } },
        msg("Click. A trapdoor in the floor swings open."),
      ],
    }),
    ops.define("event", "darkness", {
      once: true,
      conditions: [{ type: "custom", custom: "hasLight" }],
      actions: [msg("You land in the crypt. Your torch shows bones heaped against the walls.")],
      else: [msg("You land in total darkness. Something shifts nearby.")],
    }),
    ops.define("event", "openSarcophagus", {
      once: true,
      actions: [
        { type: "setPropState", target: { kind: "prop", id: "sarcophagus" }, state: "open" },
        { type: "setFlag", name: "relic", value: true },
        { type: "custom", custom: "spawnMonster", params: { monster: "skeleton", at: { x: 1, y: 7, z: -1 } } },
        msg("You lift the relic from the sarcophagus. Behind you, bones begin to rattle."),
      ],
    }),
    ops.define("event", "lastWords", {
      conditions: [{ type: "flag", name: "relic", op: "==", value: true }],
      actions: [msg("You climb out with the relic. Well done.")],
      else: [msg("You climb the ladder. The relic is still below.")],
    }),
    ops.updateCells([P(0, 1)], { onEnter: "welcome" }),
    ops.updateCells([P(1, 6)], { onEnter: "plate" }),
    ops.updateCells([P(2, 7, -1)], { onEnter: "darkness" }),
    ops.updateCells([P(3, 8)], { onEnter: "lastWords" }),
  );
  const props: [string, string, GridPos, Side | undefined, string | undefined, Record<string, string> | undefined][] = [
    ["sign", "sign", P(0, 0), "north", undefined, { text: "Three flames guard the way below." }],
    [brazier(1), "brazier", P(1, 0), "north", "light_1", undefined],
    [brazier(2), "brazier", P(3, 0), "north", "light_2", undefined],
    [brazier(3), "brazier", P(4, 1), "east", "light_3", undefined],
    ["plate", "pressurePlate", P(1, 6), undefined, undefined, undefined],
    ["sarcophagus", "chest", P(2, 8, -1), undefined, "openSarcophagus", undefined],
  ];
  for (const [id, type, cell, side, onUse, params] of props) {
    doc = run(doc, ops.addProp(doc, { id, type, cell, ...(side && { side }), ...(onUse && { onUse }), ...(params && { params }) }).command);
  }
  return doc;
}

/**
 * Two levels: a ground room with a sunken nook, stairs rising a full level into an upper
 * room, and a pit from the upper room down into a cellar cell.
 */
export function tower(): MapDoc {
  let doc = createMap({ id: "tower", name: "Tower" });
  const ground = rectPositions({ x: 0, y: 0, z: 0 }, { x: 2, y: 2, z: 0 });
  const stairs = { x: 3, y: 1, z: 0 };
  const upper = rectPositions({ x: 4, y: 0, z: 1 }, { x: 5, y: 2, z: 1 });
  const cellar = { x: 4, y: 2, z: 0 };
  doc = run(
    doc,
    ops.paintCells([...ground, stairs]),
    ops.updateCells([stairs], { shape: { kind: "stairs", rise: 4, toward: "east", treads: 4 }, ceiling: 8 }),
    ops.adjustHeights([{ x: 0, y: 1, z: 0 }], { floor: -1 }),
    ops.paintCells(upper),
    ops.setEdge({ cell: stairs, dir: "east", toZ: 1 }, "opening"),
    ops.paintCells([cellar], { autoOpen: false }),
    ops.setEdge({ cell: { x: 4, y: 2, z: 1 }, dir: "down" }, "pit"),
    ops.setSurface(upper, "down", "wood"),
    ops.setLevelName(1, "Upper floor"),
    ops.setStart({ cell: { x: 1, y: 1, z: 0 }, facing: "east" }),
  );
  return doc;
}
