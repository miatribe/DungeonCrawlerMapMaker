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
 * "The Keep of Echoes": the flagship example. It uses every feature DCMM has:
 *
 * - 3 levels (Cellar -1, Keep 0, Tower 1); a tall vaulted hall (ceiling 8); a raised dais
 *   reached by a ramp; a staircase run down to a sunken armory; stairs that climb a full
 *   level; a sunken pool.
 * - Vertical connections of every kind: trapdoor (hatch), ladder, pit, open shaft, grate.
 * - Connections: openings, doors (usable and locked), a secret wall, and a custom
 *   "portcullis" connection type with a parameter.
 * - Props: lever, button, chests, sign, pressure plate, a wall-mounted torch, and a custom
 *   "altar" prop type with a parameter.
 * - Logic: map onLoad, cell onEnter/onExit, edge onUse/onBump, prop onUse; once events,
 *   else branches, nested any/none, state/flag/playerFacing/eventFired/custom conditions;
 *   every action type (set/toggle connection, prop state, set/add flag, teleport, message,
 *   delayed runEvent, setSurface, custom actions); bool/int/string flags.
 * - Custom action and condition types, custom materials with built-in textures, tags and
 *   pass-through data.
 *
 * Walkthrough: open the door; pull the hall lever to raise the portcullis; take the key from
 * the armory chest (mind the dart plate and the spike pit); unlock the vault door; climb to
 * the tower; press the button to reveal the library; take the tome; drop down the shaft;
 * wake the altar on the dais (it opens a trapdoor); fall to the cellar; take the crown; climb
 * the ladder out.
 */
export function keep(): MapDoc {
  let doc = createMap({ id: "keep-of-echoes", name: "The Keep of Echoes" });
  // rooms are kept a cell apart (or meet only through a doorway), so there are no thin walls
  const entry = [...rectPositions(P(0, 0), P(1, 2)), P(2, 1)];
  const hall = rectPositions(P(3, 0), P(7, 4));
  const dais = rectPositions(P(6, 1), P(7, 3));
  const stairRoom = [P(8, 2), P(9, 2)];
  const armory = rectPositions(P(4, 7), P(6, 8));
  const tower = [...rectPositions(P(10, 1, 1), P(12, 2, 1)), P(11, 3, 1)];
  const library = rectPositions(P(10, 4, 1), P(12, 5, 1));
  const cellar = rectPositions(P(3, 3, -1), P(5, 4, -1));

  doc = run(
    doc,
    ops.setMapMeta({ data: { author: "DCMM examples", difficulty: "easy" }, tags: ["example", "showcase"] }),
    ops.setLevelName(-1, "Cellar"),
    ops.setLevelName(0, "Keep"),
    ops.setLevelName(1, "Tower"),
    // materials (custom ones use built-in preview patterns)
    ops.define("material", "carpet", { name: "Red carpet", color: "#7a2630", texture: "builtin:noise" }),
    ops.define("material", "marble", { name: "Marble", color: "#d9d4c8", texture: "builtin:flagstone" }),
    ops.define("material", "mural", { name: "Faded mural", color: "#b8913a", texture: "builtin:stone" }),
    ops.define("material", "books", { name: "Bookshelves", color: "#6b4a2b", texture: "builtin:planks" }),
    // custom types
    ops.define("connectionType", "portcullis", {
      name: "Portcullis", kind: "gate", axis: "horizontal", material: "iron", initialState: "closed",
      states: { closed: { passable: false, blocksSight: false, transitions: [] }, open: { passable: true, blocksSight: false, transitions: [] } },
      params: [{ name: "sound", type: "string", default: "chains" }],
    }),
    ops.define("propType", "altar", {
      name: "Altar", states: ["dormant", "awake"], initialState: "dormant",
      params: [{ name: "deity", type: "enum", options: ["sun", "moon", "sea"], required: true }],
      preview: { color: "#c9b6ff", icon: "generic" },
    }),
    ops.define("propType", "torch", { name: "Wall torch", states: ["lit", "out"], initialState: "lit", preview: { color: "#ffb347", icon: "generic" } }),
    ops.define("customType", "playSound", {
      category: "action", name: "Play sound",
      params: [{ name: "sound", type: "string", required: true }, { name: "volume", type: "float", default: 1 }],
    }),
    ops.define("customType", "spawnMonster", {
      category: "action", name: "Spawn monster",
      params: [{ name: "monster", type: "enum", options: ["wraith", "skeleton", "rat"], required: true }, { name: "at", type: "gridPos", required: true }, { name: "near", type: "ref:prop" }],
    }),
    ops.define("customType", "hasItem", {
      category: "condition", name: "Player has item", description: "True when the player carries the item",
      params: [{ name: "item", type: "enum", options: ["torch", "rope"], required: true }],
    }),
    // flags
    ops.define("flag", "item", { type: "string", initial: "" }),
    ops.define("flag", "tome", { type: "bool", initial: false }),
    ops.define("flag", "crown", { type: "bool", initial: false }),
    ops.define("flag", "visits", { type: "int", initial: 0 }),
    ops.define("flag", "falls", { type: "int", initial: 0 }),

    // ---- level 0: entry, great hall, dais, stair room ----
    ops.paintCells(entry),
    ops.setSurface(entry, "walls", "brick"),
    ops.paintCells(hall),
    ops.setHeights(hall, { ceiling: 8 }),
    ops.setSurface(hall, "down", "carpet"),
    ops.updateCells([P(5, 2)], { tags: ["hall-center"], data: { music: "hall_theme" } }),
    ops.setHeights(dais, { floor: 1 }),
    ops.setSurface(dais, "down", "marble"),
    ops.buildRamp([P(5, 2)], { kind: "ramp", rise: 1, toward: "east" }),
    ops.setEdge({ cell: P(2, 1), dir: "east" }, "door", { id: "hall_door" }),
    ops.paintCells(stairRoom),
    ops.setEdge({ cell: P(7, 2), dir: "east" }, "door", { id: "vault_door", state: "locked" }),
    // ---- sunken armory down a staircase run, behind the portcullis ----
    ops.paintCells([P(5, 5), P(5, 6)]),
    ops.setHeights([P(5, 6)], { floor: -2 }),
    ops.buildRamp([P(5, 6), P(5, 5)], { kind: "stairs", rise: 1, toward: "north", treads: 3 }),
    ops.setEdge({ cell: P(5, 4), dir: "south" }, "portcullis", { id: "portcullis" }),
    ops.paintCells(armory),
    ops.setHeights(armory, { floor: -2 }),
    ops.setEdge({ cell: P(5, 6), dir: "south" }, "opening"),
    ops.setSurface([P(5, 5), P(5, 6), ...armory], "walls", "stone"),
    // ---- tower (level 1) up a full-level staircase, with a hidden library ----
    ops.paintCells(tower),
    ops.paintCells(library),
    ops.setSurface(library, "walls", "books"),
    ops.setEdge({ cell: P(11, 3, 1), dir: "south" }, "secretWall", { id: "library_wall" }),
    // ---- cellar (level -1) under the hall, with a sunken pool ----
    ops.paintCells(cellar),
    ops.setSurface(cellar, "walls", "moss"),
    ops.setSurface(cellar, "down", "dirt"),
    ops.setHeights([P(5, 4, -1)], { floor: -1, ceiling: 3 }), // stays clear of the stairs above
    ops.setSurface([P(5, 4, -1)], "down", "water"),
    ops.setStart({ cell: P(1, 1), facing: "east" }),
  );
  doc = run(doc, ops.buildLevelStairs(doc, P(9, 2), "east"));
  // vertical connections of every kind
  doc = run(
    doc,
    ops.connectVertical(doc, P(4, 3), "down", "hatch"),                               // hall -> cellar trapdoor
    ops.connectVertical(doc, P(3, 3, -1), "up", "ladder"),                            // cellar -> hall ladder
    ops.connectVertical(doc, P(5, 3, -1), "up", "grate"),                             // look up from the cellar
    ops.connectVertical(doc, P(6, 8), "down", "pit", { createMissing: true }),        // spike pit under the armory
    ops.connectVertical(doc, P(12, 5, 1), "down", "open", { createMissing: true }),   // library shaft -> oubliette
  );
  doc = run(
    doc,
    ops.updateEdge("4,3,-1:up", { id: "trapdoor" }),
    ops.setHeights([P(6, 8, -1)], { floor: -2, ceiling: 2 }),
    ops.setSurface([P(6, 8, -1)], "all", "stone"),
    ops.setSurface([P(12, 5, 0)], "walls", "moss"),
    ops.updateEdge("5,4,0:south", { params: { sound: "chains_heavy" } }),
  );

  const msg = (text: string): Action => ({ type: "showMessage", text });
  const sound = (s: string, volume?: number): Action => ({ type: "custom", custom: "playSound", params: volume === undefined ? { sound: s } : { sound: s, volume } });
  const edge = (id: string) => ({ kind: "edge" as const, id });
  const prop = (id: string) => ({ kind: "prop" as const, id });
  doc = run(
    doc,
    // arrival
    ops.define("event", "arrive", { actions: [{ type: "addFlag", name: "visits", amount: 1 }, msg("Wind howls through the Keep of Echoes. The great hall lies east.")] }),
    ops.define("event", "chill", { once: true, actions: [msg("The air grows colder as you step into the hall.")] }),
    // portcullis lever (toggle with matching lever state)
    ops.define("event", "pullHallLever", {
      conditions: [{ type: "state", target: edge("portcullis"), equals: "closed" }],
      actions: [{ type: "setConnectionState", target: edge("portcullis"), state: "open" }, { type: "setPropState", target: prop("hall_lever"), state: "on" }, sound("chains_heavy"), msg("Chains rattle. The portcullis to the south rises.")],
      else: [{ type: "setConnectionState", target: edge("portcullis"), state: "closed" }, { type: "setPropState", target: prop("hall_lever"), state: "off" }, msg("The portcullis slams down.")],
    }),
    // armory
    ops.define("event", "openArmoryChest", {
      once: true,
      actions: [
        { type: "setPropState", target: prop("armory_chest"), state: "open" },
        { type: "setFlag", name: "item", value: "key" },
        { type: "setSurface", cell: P(6, 7), side: "east", material: "mural" },
        sound("chest_open", 0.8),
        msg("Inside lies an iron key. As you lift it, a faded mural appears on the wall."),
      ],
    }),
    ops.define("event", "dartPlate", { once: true, actions: [msg("Click."), { type: "runEvent", event: "dart", delayMs: 1200 }] }),
    ops.define("event", "dart", { actions: [sound("dart"), msg("A dart whistles past your ear!")] }),
    ops.define("event", "spikes", {
      actions: [{ type: "addFlag", name: "falls", amount: 1 }, msg("You land among rusted spikes. Somewhere a mechanism groans..."), { type: "runEvent", event: "rescue", delayMs: 1500 }],
    }),
    ops.define("event", "rescue", { actions: [{ type: "teleport", to: P(5, 2), facing: "north" }, msg("...and the floor lifts you back up into the hall.")] }),
    // vault door: use = unlock with the key, or open/close once unlocked; bump explains
    ops.define("event", "useVaultDoor", {
      conditions: [{ type: "state", target: edge("vault_door"), equals: "locked" }],
      actions: [{ type: "runEvent", event: "unlockVault" }],
      else: [{ type: "toggleConnectionState", target: edge("vault_door"), states: ["closed", "open"] }],
    }),
    ops.define("event", "unlockVault", {
      conditions: [{ type: "flag", name: "item", op: "==", value: "key" }],
      actions: [{ type: "setConnectionState", target: edge("vault_door"), state: "closed" }, sound("unlock"), msg("The iron key turns. The vault door is unlocked.")],
      else: [msg("Locked. There must be a key somewhere.")],
    }),
    ops.define("event", "bumpVault", {
      conditions: [{ type: "state", target: edge("vault_door"), equals: "locked" }],
      actions: [msg("The vault door is locked.")],
      else: [msg("The vault door is shut. Use it to open it.")],
    }),
    // tower
    ops.define("event", "window", {
      conditions: [{ type: "playerFacing", facing: "north" }],
      actions: [msg("Through a narrow window you see the sea, grey under the moon.")],
    }),
    ops.define("event", "towerButton", {
      once: true,
      actions: [{ type: "setPropState", target: prop("tower_button"), state: "down" }, { type: "setConnectionState", target: edge("library_wall"), state: "open" }, sound("stone_grind"), msg("A bookcase in the south wall swings aside.")],
    }),
    ops.define("event", "takeTome", {
      once: true,
      actions: [{ type: "setPropState", target: prop("tome_chest"), state: "open" }, { type: "setFlag", name: "tome", value: true }, msg("You take the Tome of Echoes. The floor near the east shelves looks hollow.")],
    }),
    ops.define("event", "oubliette", {
      actions: [{ type: "addFlag", name: "falls", amount: 1 }, msg("You tumble into a lightless oubliette."), { type: "runEvent", event: "outOfOubliette", delayMs: 1500 }],
    }),
    ops.define("event", "outOfOubliette", { actions: [{ type: "teleport", to: P(1, 1), facing: "east" }, msg("A cold wind carries you... back to the entrance.")] }),
    // the altar: needs the tome and the key, and only works once
    ops.define("event", "awakenAltar", {
      conditions: [
        { type: "flag", name: "tome", op: "==", value: true },
        { type: "any", conditions: [{ type: "flag", name: "item", op: "==", value: "key" }, { type: "flag", name: "visits", op: ">=", value: 3 }] },
        { type: "not", conditions: [{ type: "state", target: prop("altar"), equals: "awake" }] },
      ],
      actions: [
        { type: "setPropState", target: prop("altar"), state: "awake" },
        { type: "setConnectionState", target: edge("trapdoor"), state: "open" },
        { type: "setPropState", target: prop("hall_torch"), state: "out" },
        sound("choir", 0.7),
        { type: "custom", custom: "spawnMonster", params: { monster: "wraith", at: P(3, 0), near: "altar" } },
        msg("The altar wakes with a sound like distant bells. A trapdoor opens in the hall floor, and something stirs in the shadows."),
      ],
      else: [msg("The altar is cold. It wants the Tome of Echoes, and the key.")],
    }),
    ops.define("event", "takeCrown", {
      once: true,
      conditions: [{ type: "custom", custom: "hasItem", params: { item: "torch" } }, { type: "eventFired", event: "awakenAltar" }],
      actions: [{ type: "setPropState", target: prop("crown_chest"), state: "open" }, { type: "setFlag", name: "crown", value: true }, sound("fanfare"), msg("The Crown of Echoes! Climb the ladder to leave the keep.")],
      else: [msg("It's too dark to find the latch.")],
    }),
    ops.define("event", "leave", {
      conditions: [{ type: "flag", name: "crown", op: "==", value: true }],
      actions: [msg("You climb into the hall, crown in hand. The echoes fall silent. You win!")],
    }),
    // triggers
    ops.setMapMeta({ onLoad: "arrive" }),
    ops.updateCells([P(2, 1)], { onExit: "chill" }),
    ops.updateCells([P(4, 7)], { onEnter: "dartPlate" }),
    ops.updateCells([P(6, 8, -1)], { onEnter: "spikes" }),
    ops.updateCells([P(11, 1, 1)], { onEnter: "window" }),
    ops.updateCells([P(12, 5, 0)], { onEnter: "oubliette" }),
    ops.updateCells([P(3, 3)], { onEnter: "leave" }),
    ops.updateEdge("7,2,0:east", { onUse: "useVaultDoor", onBump: "bumpVault" }),
  );

  const props: [string, string, GridPos, Side | undefined, string | undefined, Record<string, string> | undefined][] = [
    ["entry_sign", "sign", P(0, 1), "west", undefined, { text: "The Keep of Echoes. Wake the altar." }],
    ["hall_lever", "lever", P(4, 0), "north", "pullHallLever", undefined],
    ["hall_torch", "torch", P(3, 2), "west", undefined, undefined],
    ["altar", "altar", P(7, 1), undefined, "awakenAltar", { deity: "moon" }],
    ["armory_chest", "chest", P(6, 7), undefined, "openArmoryChest", undefined],
    ["dart_plate", "pressurePlate", P(4, 7), undefined, undefined, undefined],
    ["tower_button", "button", P(12, 2, 1), "east", "towerButton", undefined],
    ["tome_chest", "chest", P(10, 5, 1), undefined, "takeTome", undefined],
    ["crown_chest", "chest", P(3, 4, -1), undefined, "takeCrown", undefined],
  ];
  for (const [id, type, cell, side, onUse, params] of props) {
    doc = run(doc, ops.addProp(doc, { id, type, cell, ...(side && { side }), ...(onUse && { onUse }), ...(params && { params }) }).command);
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
