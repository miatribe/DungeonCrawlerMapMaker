/**
 * Hands-on demo: builds a small map with the core ops, shows undo, validation and the
 * JSON export. Run with `npm run demo`, then edit this file to experiment.
 */
import { apply, createHistory, createMap, rectPositions, undo, validate, type Command } from "../src/core";
import * as ops from "../src/core/ops";
import { runExport } from "../src/exporters";

let doc = createMap({ id: "demo", name: "Demo" });
let history = createHistory();
const edit = (c: Command) => ({ doc, history } = apply(doc, history, c));

// A 3x3 room, a corridor cell to the east behind a door, and a start position.
const room = rectPositions({ x: 0, y: 0, z: 0 }, { x: 2, y: 2, z: 0 });
edit(ops.paintCells(room));
edit(ops.setSurface(room, "walls", "brick"));
edit(ops.paintCells([{ x: 3, y: 1, z: 0 }], { autoOpen: false }));
edit(ops.setEdge({ cell: { x: 2, y: 1, z: 0 }, dir: "east" }, "door", { id: "door" }));
edit(ops.setStart({ cell: { x: 1, y: 1, z: 0 }, facing: "east" }));

console.log(`Cells: ${Object.keys(doc.cells).length}, connections: ${Object.keys(doc.edges).length}`);

// Undo the last edit (the start), see validation complain, then put it back.
({ doc, history } = undo(doc, history));
console.log("After undo:", validate(doc).filter((p) => p.severity === "error").map((p) => p.message));
edit(ops.setStart({ cell: { x: 1, y: 1, z: 0 }, facing: "east" }));

const problems = validate(doc);
console.log("Problems:", problems.length ? problems.map((p) => `${p.severity} ${p.code}: ${p.message}`) : "none");

const result = runExport("json", doc, { pretty: true });
if (!result.ok) {
  console.error("Export blocked:", result.problems);
  process.exit(1);
}
const json = JSON.parse(result.result.files[0]!.data as string);
console.log(`Exported ${json.cells.length} cells and ${json.edges.length} edges. The door:`);
console.log(json.edges.find((e: any) => e.id === "door"));
