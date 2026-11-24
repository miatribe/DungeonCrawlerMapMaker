# DCMM — Dungeon Crawler Map Maker

A browser-based editor for building maps for grid-based dungeon crawler games, in 2D or 3D. You lay out cells and walls across stacked levels, set floor and ceiling heights, add doors, props and gameplay logic, and export the result as engine-neutral data for whatever engine you use.

The full design is in [docs/SPEC.md](docs/SPEC.md).

## Status

**Milestones 1–2 of 6 are done: the core model, JSON export and the 2D editor.**

- **2D editor:** a top-down, level-by-level editor in the browser. You can paint rooms and cells, place doors, gates and openings on cell edges, paint materials, set the start position, edit cells and connections in an inspector, switch levels with the level below shown ghosted, see validation problems as you work, undo and redo, open and save `.dcmm` files, and export JSON. Your work autosaves in the browser.
- **Map model:** square grid, thin walls on cell edges, multiple levels, per-cell floor and ceiling heights, ramps and stairs, and tall cells for open vertical spaces.
- **Logic:** props, events with conditions and actions, flags, connections that change state (doors, gates, hatches), and custom action and condition types that your engine implements. The model supports all of this, but the editor UI for it arrives in milestone 4. For now, logic comes from opened files (see the Three Rooms example).
- **Validation:** missing references, invalid states, overlapping cells, unreachable areas, bad custom params and more (see SPEC §8.8).
- **Files:** a `.dcmm` project format with versioned migrations, and a JSON runtime export behind a pluggable exporter interface.

Next up: dedicated height and stair tools (milestone 3), the logic editor with prop placement (4), then the 3D orbit view and first-person playtest (5).

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

### Run the site

```powershell
npm run dev
```

Then open **http://localhost:5173** in your browser. The first visit opens the **Three Rooms** example. **File → New map** starts from scratch, and **File → Example: Tower** shows a multi-level map. The page reloads by itself when you change the code. Press `Ctrl+C` in the terminal to stop the server.

Your maps autosave to the browser (IndexedDB), and the last one reopens on reload. **File → Save** writes a `.dcmm` file you can keep or share. In Chrome and Edge it saves straight to disk; other browsers download it.

To build the static site and serve the build locally, the way it would run when hosted:

```powershell
npm run build
```

```powershell
npm run preview
```

The output goes to `dist/` and can be hosted on any static host.

### Using the editor

| Tool | Key | What it does |
|---|---|---|
| Select | `V` | Click a cell or connection to edit it in the Inspector. Drag a box to select cells, Shift adds to the selection, Delete erases it. |
| Room | `R` | Drag a rectangle to add a room. Right-drag removes cells. |
| Paint cells | `B` | Drag to paint cells. Cells painted in one stroke open into each other. Right-drag erases. |
| Erase | `E` | Drag over cells to remove them. Click a connection to turn it back into a wall. |
| Connections | `D` | Click a cell edge to place the connection chosen in the right panel (door, gate, opening, secret wall). Click it again to cycle its state (closed → open → locked). Right-click makes a wall. Drag along edges to place many. |
| Material | `M` | Click near a wall to paint that wall face, or the middle of a cell to paint its floor. Shift paints the whole room, Alt picks up a material, right-click resets to the default. The panel also adds and edits materials. |
| Start | `T` | Click a cell to put the player start there. Click it again to turn. |

Other controls:
- **Moving around:** middle-drag or Space+drag to pan, mouse wheel to zoom, `Home` to fit the level, `PgUp`/`PgDn` to change level.
- **Editing:** `Ctrl+Z` / `Ctrl+Shift+Z` to undo and redo.
- **Files:** `Ctrl+S` to save, `Ctrl+O` to open, `Ctrl+E` to export.
- **Heights, ramps and stairs:** set them in the Inspector for now. Dedicated tools come in milestone 3.
- **Hatches, pits and ladders:** set them in the Inspector under **Vertical connections**.
- **Problems:** the **Problems** tab lists validation issues. Click one to jump to it. Errors block export; warnings don't.

### Run the tests

```powershell
npm test
```

This runs the Vitest suite, which covers geometry, edit operations and undo, validation, the resolved map view, project load/save, the JSON exporter and the editor's hit-testing and tool helpers. For a watch mode that re-runs on every save:

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
src/render/      canvas2d/: the top-down level renderer, view transform and hit-testing
src/editor/      The React app: store (Zustand), tools, persistence, components/
index.html       Vite entry page
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
