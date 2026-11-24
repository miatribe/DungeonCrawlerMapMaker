/** Writes the fixture maps to examples/ as .dcmm project files plus their JSON exports. */
import { mkdirSync, writeFileSync } from "node:fs";
import { saveProject, stringifyProject } from "../src/core";
import { runExport } from "../src/exporters";
import { crypt, threeRooms, tower } from "../tests/fixtures/maps";

mkdirSync("examples", { recursive: true });
for (const doc of [threeRooms(), tower(), crypt()]) {
  writeFileSync(`examples/${doc.id}.dcmm`, stringifyProject(saveProject(doc)));
  const r = runExport("json", doc);
  if (!r.ok) throw new Error(`${doc.id}: ${r.problems.map((p) => p.message).join("; ")}`);
  writeFileSync(`examples/${doc.id}.json`, r.result.files[0]!.data);
  console.log(`wrote examples/${doc.id}.dcmm and .json`);
}
