# DCMM — Dungeon Crawler Map Maker

A browser-based editor for building maps for grid-based dungeon crawler games, in 2D or 3D. You lay out cells and walls across stacked levels, set floor and ceiling heights, add doors, props and gameplay logic, and export the result as engine-neutral data for whatever engine you use.

The full design is in [docs/SPEC.md](docs/SPEC.md).

## Status

**Milestone 1 of 6: core model and JSON export.** There is no editor UI yet. What exists today is the engine-independent core that the editor will be built on:

- **Map model:** square grid, thin walls on cell edges, multiple levels, per-cell floor and ceiling heights, ramps and stairs, and tall cells for open vertical spaces.
- **Logic:** props, events with conditions and actions, flags, connections that change state (doors, gates, hatches), and custom action and condition types that your engine implements.
- **Editing:** operations for painting cells, edges, materials, heights and props, with undo/redo and renaming that updates every reference.
- **Validation:** missing references, invalid states, overlapping cells, unreachable areas, bad custom params and more (see SPEC §8.8).
- **Files:** a `.dcmm` project format with versioned migrations, and a JSON runtime export behind a pluggable exporter interface.

Next up: the 2D editor (milestone 2), heights and vertical tools, the logic editor, then the 3D orbit view and first-person playtest.

## Running it yourself

### Requirements

- **Node.js 22.12 or newer** (24 recommended). Check with `node --version`.
- npm (comes with Node).
- Git.

### Setup

```powershell
git clone https://github.com/miatribe/DungeonCrawlerMapMaker.git
```

```powershell
cd DungeonCrawlerMapMaker
```

```powershell
npm install
```

### Run the tests

```powershell
npm test
```

This runs the Vitest suite, which covers geometry, edit operations and undo, validation, the resolved map view, project load/save and the JSON exporter. For a watch mode that re-runs on every save:

```powershell
npm run test:watch
```

To check types across the project:

```powershell
npm run typecheck
```

### Try the core by hand

```powershell
npm run demo
```

[scripts/demo.ts](scripts/demo.ts) builds a small room with a door, shows undo and validation, and prints part of the JSON export. It's meant as a scratchpad: edit it and run it again to try things out. The edit operations are in [src/core/ops.ts](src/core/ops.ts).

### Generate the example maps and schemas

```powershell
npm run examples
```

This writes the two fixture maps to [examples/](examples): **Three Rooms** (a port of the original prototype, with a lever-operated gate, a door trap and a chest) and **Tower** (two levels joined by a full-level staircase, a pit and a sunken floor). Each map gets a `.dcmm` project file and a `.json` export, so you can see both formats.

```powershell
npm run schemas
```

This regenerates the JSON Schema files in [schemas/](schemas). Engines can validate an exported map against `dcmm-map.schema.json`.

### Updating golden files

The export tests compare output with the files in [tests/golden/](tests/golden). If you change the export on purpose, update them with:

```powershell
npx vitest run -u
```

Then review the diff before committing.

## Project layout

```
src/core/        Model, schemas, geometry, edit ops + undo, validation, resolve, project files
src/exporters/   Exporter interface and registry; json/ is the JSON runtime exporter
scripts/         demo, example and schema generators
tests/           Vitest tests, fixture maps and golden export files
examples/        Generated example maps (.dcmm and .json)
schemas/         Generated JSON Schemas for both file formats
docs/SPEC.md     The design spec
```

## Export format at a glance

Exports use neutral grid coordinates: **x east, y south, z up** (one level per z), with north = −y. Heights are integer steps (`stepsPerLevel` per level, 4 by default). A missing edge between two cells is a wall. The other edges (openings, doors, gates, vertical hatches and pits) are listed explicitly, each with its type and current state. See SPEC §3 and §6.2 for the details, or open [examples/three-rooms.json](examples/three-rooms.json).

## Adding an exporter

Implement the `Exporter` interface from [src/exporters/types.ts](src/exporters/types.ts) and register it in [src/exporters/index.ts](src/exporters/index.ts). Exporters receive a validated, normalized `ResolvedMap`, so they don't need to handle geometry edge cases themselves.
