# DCMM — Dungeon Crawler Map Maker

A browser-based editor for building maps for grid-based dungeon crawler games, in 2D or 3D. You lay out cells and walls across stacked levels, set floor and ceiling heights, add doors, props and gameplay logic, and export the result as engine-neutral data for whatever engine you use.

The full design is in [docs/SPEC.md](docs/SPEC.md).

## Status

**Milestones 1–5 of 6 are done: the core model, JSON export, the 2D editor, heights and vertical tools, the logic editor, and the 3D view and playtest.**

- **3D overview (F6):** orbit around the dungeon. Rooms are seen from outside, since walls only face inward, and levels above the current one can be hidden. Click a cell to select it.
- **First-person playtest (F5):**
  - Walk the map with doors, gates, levers, traps, stairs, ladders and pits all working.
  - A debug panel shows live flags and states and lets you choose what custom conditions return.
  - **Copy state to map** makes the current states and flag values the map's starting values.

- **Logic editor:**
  - Place and move props (levers, buttons, chests, signs, plates or your own types).
  - Write events with conditions, actions and an otherwise branch.
  - Manage flags, and define connection, prop and custom action/condition types.
  - Share types between maps as type libraries.
  - Selecting anything with a trigger draws arrows to everything its event changes or checks. Selecting a door or prop also shows what affects it.

- **2D editor:** a top-down, level-by-level editor in the browser. You can paint rooms and cells, place doors, gates and openings on cell edges, paint materials, set the start position, edit cells and connections in an inspector, switch levels with the level below shown ghosted, see validation problems as you work, undo and redo, open and save `.dcmm` files, and export JSON. Your work autosaves in the browser.
- **Heights and levels:** raise, lower or set floors and ceilings; build ramp and staircase runs; build stairs that climb a full level; and add hatches, pits, ladders and grates between levels. Connections find the right cell on the other level, even past tall or sunken cells, and can create it for you.
- **Map model:** square grid, thin walls on cell edges, multiple levels, per-cell floor and ceiling heights, ramps and stairs, and tall cells for open vertical spaces.
- **Logic model:** props, events with conditions and actions, flags, connections that change state (doors, gates, hatches), and custom action and condition types that your engine implements.
- **Validation:** missing references, invalid states, overlapping cells, unreachable areas, bad custom params and more (see SPEC §8.8).
- **Files:** a `.dcmm` project format with versioned migrations, and a JSON runtime export behind a pluggable exporter interface.

Next up: polish (milestone 6), with built-in textures, more examples, engine-facing export docs and a shortcut help screen.

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

If the dev server keeps showing old code after you edit a file (its file watcher occasionally misses a change on Windows), stop it with `Ctrl+C`, run `npm run dev` again, and reload the page.

### Using the editor

| Tool | Key | What it does |
|---|---|---|
| Select | `V` | Click a cell or connection to edit it in the Inspector. Drag a box to select cells, Shift adds to the selection, Delete erases it. |
| Room | `R` | Drag a rectangle to add a room. Right-drag removes cells. |
| Paint cells | `B` | Drag to paint cells. Cells painted in one stroke open into each other. Right-drag erases. |
| Erase | `E` | Drag over cells to remove them. Click a connection to turn it back into a wall. |
| Connections | `D` | Click a cell edge to place the connection chosen in the right panel (door, gate, opening, secret wall). Click it again to cycle its state (closed → open → locked). Right-click makes a wall. Drag along edges to place many. |
| Material | `M` | Click near a wall to paint that wall face, or the middle of a cell to paint its floor. Shift paints the whole room, Alt picks up a material, right-click resets to the default. The panel also adds and edits materials. |
| Height | `H` | Click or drag over cells to raise the floor one step; right-click lowers. The panel switches between Floor, Ceiling and Whole cell, and between Raise/lower and Set to value (right-click resets to the default). Alt picks up a cell's height. |
| Ramp / Stairs | `S` | Drag in the uphill direction to build a staircase or ramp run; each cell rises from where the last one ended. Click near an edge for a one-cell ramp toward it. **Up a level** turns one cell into stairs that climb to the level above and creates the landing there. Right-click flattens. |
| Vertical connections | `U` | Click a cell to put a trapdoor, pit, ladder, opening or grate through its floor (or ceiling; Shift flips). Click again to cycle its state, right-click to remove. Creates the cell on the other level if it's missing. |
| Props | `P` | Click the middle of a cell to place the prop chosen in the panel on the floor, or near a wall to mount it there. Drag a prop to move it, click one to select it, right-click to delete. |
| Start | `T` | Click a cell to put the player start there. Click it again to turn. |

Other controls:
- **Moving around:** middle-drag or Space+drag to pan, mouse wheel to zoom, `Home` to fit the level, `PgUp`/`PgDn` to change level.
- **Editing:** `Ctrl+Z` / `Ctrl+Shift+Z` to undo and redo.
- **Files:** `Ctrl+S` to save, `Ctrl+O` to open, `Ctrl+E` to export.
- **Views:** the strip above the map switches between **2D**, **3D** and **▶ Playtest**.
  - **Switching:** F6 toggles 2D/3D. F5 starts a playtest from the map's start. Shift+F5 starts one from the selected cell.
  - **In 3D:** drag to orbit, right-drag to pan, wheel to zoom, click to select. "Hide levels above" cuts the view away at the current level.
- **Playtest controls:**
  - `W`/`S` move, `A`/`D` strafe, `Q`/`E` turn, `Space` uses what's in front of you (a lever, a door, a chest), `R` restarts and `Esc` returns to the editor.
  - Walking into a wall while standing on a ladder climbs it. Pits and open trapdoors drop you.
  - The right panel shows flags, connection and prop states (changed values highlighted), fired events and the full log. Custom actions are logged rather than run, and you can toggle what custom conditions return.
  - The map itself never changes while you play.
- **Making things happen:** select a cell, connection or prop and set its trigger (On enter, On exit, On use, On bump) in the Inspector. Pick **+ New event…** to create the event and open it in the **Events** tab.
- **Events tab:** each event has conditions ("when all of these are true"), actions ("do") and an "otherwise" branch. Fields that point at the map have a ⌖ button: click it, then click the door, prop or cell on the map. Picking a connection that has no id gives it one automatically.
- **Seeing logic:**
  - Selecting a lever, trigger cell or door draws arrows on the map: orange for what it changes, dashed blue for what it checks.
  - The Inspector's **Logic** section lists the same links, plus **Affected by** (what changes this thing). Click any entry to jump to it.
  - Press `L` (or **View → Show all logic links**) to see every link on the level at once.
  - Cells with On enter/On exit triggers show a small orange diamond.
- **Flags tab:** map variables (true/false, number, text) with starting values and usage counts.
- **Types tab:**
  - Edit connection types (states, what's passable or blocks sight, which states a player can switch between), prop types (states, map color, icon) and custom actions/conditions with typed parameters for your engine.
  - **Type library** exports or imports these as a `.dcmm-types.json` file to share between maps.
- **Bottom panel:** drag the top edge of the bottom panel to resize it. Double-click the edge to toggle between small and large.
- **Heights:** `=` / `-` raise or lower the floor of the selected cells, or the cell under the mouse. `Shift` with them changes the ceiling. Heights are in steps (4 per level by default). Each cell shows its floor/ceiling label when they aren't the defaults.
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
src/core/logic/  links (trigger analysis) and runtime (headless event interpreter + movement rules)
src/render/      canvas2d/: the top-down level renderer, view transform and hit-testing
                 mesh/: map -> 3D geometry data; three/: the Three.js scene for 3D and playtest
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
