/** Test fixtures built through the public ops, so they double as an ops smoke test. */
import { createMap, run, rectPositions, type MapDoc, type Action } from "../../src/core";
import * as ops from "../../src/core/ops";

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
