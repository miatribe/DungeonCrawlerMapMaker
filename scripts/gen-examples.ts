/** Writes the example maps to examples/ as .dcmm project files plus their JSON exports. */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { saveProject, stringifyProject } from "../src/core";
import { runExport } from "../src/exporters";
import { doors, geometry, traps } from "../tests/fixtures/examples";
import { keep } from "../tests/fixtures/maps";

mkdirSync("examples", { recursive: true });
const docs = [doors(), traps(), geometry(), keep()];
const keepFiles = new Set(docs.flatMap((d) => [`${d.id}.dcmm`, `${d.id}.json`]));
for (const f of readdirSync("examples")) {
  if (/\.(dcmm|json)$/.test(f) && !keepFiles.has(f)) {
    rmSync(`examples/${f}`);
    console.log(`removed examples/${f}`);
  }
}
for (const doc of docs) {
  writeFileSync(`examples/${doc.id}.dcmm`, stringifyProject(saveProject(doc)));
  const r = runExport("json", doc);
  if (!r.ok) throw new Error(`${doc.id}: ${r.problems.map((p) => p.message).join("; ")}`);
  writeFileSync(`examples/${doc.id}.json`, r.result.files[0]!.data);
  console.log(`wrote examples/${doc.id}.dcmm and .json`);
}
