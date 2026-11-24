/** Writes JSON Schema files for the project and runtime formats into schemas/. */
import { mkdirSync, writeFileSync } from "node:fs";
import { zodToJsonSchema } from "zod-to-json-schema";
import { ProjectFileSchema } from "../src/core/schema";
import { RuntimeMapSchema } from "../src/exporters/json/schema";

mkdirSync("schemas", { recursive: true });
const out = [
  ["dcmm-project.schema.json", ProjectFileSchema, "DCMM project file (.dcmm)"],
  ["dcmm-map.schema.json", RuntimeMapSchema, "DCMM runtime map export (dcmm-map)"],
] as const;

for (const [file, schema, title] of out) {
  const json = zodToJsonSchema(schema, { name: "root", $refStrategy: "root" });
  writeFileSync(`schemas/${file}`, JSON.stringify({ title, ...json }, null, 2) + "\n");
  console.log(`wrote schemas/${file}`);
}
