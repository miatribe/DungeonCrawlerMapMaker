# DCMM — Dungeon Crawler Map Maker

A browser-based editor for building maps for grid-based dungeon crawler games, in 2D or 3D. Lay out cells and walls across stacked levels, set floor and ceiling heights, add doors, props and gameplay logic, playtest it in first person, and export the result as engine-neutral JSON for whatever engine you use.

**Open it:** https://miatribe.github.io/DungeonCrawlerMapMaker/

Nothing to install, and no account needed. It runs on desktop browsers (Chrome and Edge recommended). Your maps stay on your computer.

## Features

- **2D editor:** edit top-down, one level at a time. Paint rooms and cells, place doors, gates, openings and secret walls on cell edges, paint materials, and set the player start. The level below shows faintly for reference.
- **Heights and levels:** raise, lower or set floors and ceilings; build ramps and staircases; build stairs that climb a full level; and add trapdoors, pits, ladders and grates between levels.
- **Logic:** place props (levers, buttons, chests, signs, pressure plates or your own types), write events with conditions, actions and an "otherwise" branch, and keep flags. Selecting something draws arrows to everything its trigger changes or checks.
- **Custom types:** define your own actions, conditions, props and connection types with typed parameters for your engine, and share them between maps as type libraries.
- **3D view (F6):** orbit around the dungeon, hide upper levels, and click to select.
- **First-person playtest (F5):** walk the map with doors, gates, levers, traps, stairs, ladders and pits all working. A debug panel shows flags and states as you play.
- **Textures:** built-in patterns (bricks, stone, planks, cobble, metal and more) tinted by each material's color, or your own images.
- **Validation:** problems are listed as you work. Errors block export; warnings don't.
- **Help:** press F1 or `?` in the editor for every shortcut and a quick guide.

## Getting started

The first time you open DCMM it loads **The Keep of Echoes**, an example map that uses every feature. Press **F5** to play it, or **F6** to look around in 3D.

- **File → New map** starts from scratch.
- **File → Example: …** opens the other examples:
  - **Doors and Levers:** a plain door, a locked door worked by a lever, and a vault door that needs three levers up at once.
  - **Trap Gauntlet:** a dart plate, a spiked pit, a hidden trapdoor, a rune floor and a flooding room, with a flag that counts your hits.
  - **Geometry Tour:** one room per kind of geometry: raised and sunken floors, low and vaulted ceilings, ramps, stairs, a ramp and stairs that climb a full level, and every vertical connection (grate, trapdoor, pit, open shaft, ladder).
  - **The Keep of Echoes:** the full example game, which you can play from start to finish.

### Saving your work

- Your map **autosaves in the browser**, and the last one reopens when you come back.
- Browser storage can be cleared, and it doesn't follow you to other browsers or computers, so use **File → Save** (`Ctrl+S`) to keep a `.dcmm` project file. In Chrome and Edge it saves straight to disk; other browsers download it.
- **File → Open** (`Ctrl+O`) loads a `.dcmm` file.
- One map per file.

### Exporting for your engine

**File → Export** (`Ctrl+E`) writes the map as JSON for your game to load. The project file (`.dcmm`) is what you edit; the export (`.json`) is what your engine reads.

- Exports use neutral grid coordinates: **x east, y south, z up** (one level per z), with north = −y.
- Heights are whole steps (4 per level by default).
- A missing edge between two cells is a wall. Every other edge (openings, doors, gates, hatches and pits) is listed with its type and current state.

The full guide for engine developers is [docs/EXPORT_FORMAT.md](docs/EXPORT_FORMAT.md). You can validate exports against [schemas/dcmm-map.schema.json](schemas/dcmm-map.schema.json), and [examples/](examples) has each example map as both a `.dcmm` and a `.json` file.

## Controls

### Tools

| Tool | Key | What it does |
|---|---|---|
| Select | `V` | Click a cell or connection to edit it in the Inspector. Drag a box to select cells, Shift adds to the selection, Delete erases it. |
| Room | `R` | Drag a rectangle to add a room. Right-drag removes cells. |
| Paint cells | `B` | Drag to paint cells. Cells painted in one stroke open into each other. Right-drag erases. |
| Erase | `E` | Drag over cells to remove them. Click a connection to turn it back into a wall. |
| Connections | `D` | Click a cell edge to place the connection chosen in the right panel (door, gate, opening, secret wall). Click it again to cycle its state (closed → open → locked). Right-click makes a wall. Drag along edges to place many. |
| Material | `M` | Click near a wall to paint that wall face, or the middle of a cell to paint its floor. Shift paints the whole room, Alt picks up a material, right-click resets to the default. The panel also adds and edits materials: name, color, and a texture (a built-in pattern tinted by the color, or an uploaded PNG/JPEG/WebP up to 1024×1024, saved in the project file). |
| Height | `H` | Click or drag over cells to raise the floor one step; right-click lowers. The panel switches between Floor, Ceiling and Whole cell, and between Raise/lower and Set to value (right-click resets to the default). Alt picks up a cell's height. |
| Ramp / Stairs | `S` | Drag in the uphill direction to build a staircase or ramp run; each cell rises from where the last one ended. Click near an edge for a one-cell ramp toward it. **Up a level** turns one cell into stairs that climb to the level above and creates the landing there. Right-click flattens. |
| Vertical connections | `U` | Click a cell to put a trapdoor, pit, ladder, opening or grate through its floor (or ceiling; Shift flips). Click again to cycle its state, right-click to remove. Creates the cell on the other level if it's missing. |
| Props | `P` | Click the middle of a cell to place the prop chosen in the panel on the floor, or near a wall to mount it there. Drag a prop to move it, click one to select it, right-click to delete. |
| Start | `T` | Click a cell to put the player start there. Click it again to turn. |

### Editing and views

- **Moving around:** middle-drag or Space+drag to pan, mouse wheel to zoom, `Home` to fit the level, `PgUp`/`PgDn` to change level.
- **Undo and redo:** `Ctrl+Z` / `Ctrl+Shift+Z`.
- **Heights:** `=` / `-` raise or lower the floor of the selected cells, or the cell under the mouse. Hold `Shift` to change the ceiling instead. Cells show their floor/ceiling label when they aren't the defaults.
- **Switching views:** the strip above the map switches between **2D**, **3D** and **▶ Playtest**. F6 toggles 2D/3D. F5 starts a playtest from the map's start; Shift+F5 starts one from the selected cell.
- **In 3D:** drag to orbit, right-drag to pan, wheel to zoom, click to select. "Hide levels above" cuts the view away at the current level.
- **Bottom panel:** drag its top edge to resize it, or double-click the edge to toggle between small and large.

### Playtest

- `W`/`S` move, `A`/`D` strafe, `Q`/`E` turn, `Space` uses what's in front of you (a lever, a door, a chest), `R` restarts and `Esc` returns to the editor.
- On a ladder, press Space (or walk into the wall it leans on) to climb. Pits and open trapdoors drop you.
- The right panel shows flags, connection and prop states (changed values highlighted), fired events and the full log. Custom actions are logged rather than run, and you can toggle what custom conditions return.
- Playtesting never changes your map.

### Logic

- **Triggers:** select a cell, connection or prop and set its trigger (On enter, On exit, On use, On bump) in the Inspector. Pick **+ New event…** to create the event and open it in the **Events** tab.
- **Events tab:** each event has conditions ("when all of these are true"), actions ("do") and an "otherwise" branch. Fields that point at the map have a ⌖ button: click it, then click the door, prop or cell on the map.
- **Seeing logic:** selecting a lever, trigger cell or door draws arrows on the map: orange for what it changes, dashed blue for what it checks. The Inspector's **Logic** section lists the same links plus **Affected by**; click any entry to jump to it. Press `L` to show every link on the level at once. Cells with On enter/On exit triggers show a small orange diamond.
- **Flags tab:** map variables (true/false, number, text) with starting values and usage counts.
- **Types tab:** edit connection types (states, what's passable or blocks sight, which states a player can switch between), prop types (states, map color, icon) and custom actions/conditions with typed parameters. **Type library** exports or imports these as a `.dcmm-types.json` file to share between maps.
- **Problems tab:** lists validation issues. Click one to jump to it.

## Running it locally

You only need this to work on DCMM itself or to host your own copy. It needs **Node.js 22.12 or newer** (24 recommended) and Git.

```sh
git clone https://github.com/miatribe/DungeonCrawlerMapMaker.git
cd DungeonCrawlerMapMaker
npm install
npm run dev
```

Then open http://localhost:5173.

| Command | What it does |
|---|---|
| `npm run dev` | Starts the dev server, which reloads as you edit. |
| `npm run build` | Builds the static site into `dist/`, ready for any static host. |
| `npm run preview` | Serves the built site locally. |
| `npm test` | Runs the tests. |
| `npm run typecheck` | Checks types across the project. |
| `npm run examples` | Regenerates the example maps in `examples/`. |
| `npm run schemas` | Regenerates the JSON Schemas in `schemas/`. |

Pushes to `master` deploy to GitHub Pages automatically.

To add an exporter for another format, implement the `Exporter` interface in [src/exporters/types.ts](src/exporters/types.ts) and register it in [src/exporters/index.ts](src/exporters/index.ts). The design spec is [docs/SPEC.md](docs/SPEC.md).
