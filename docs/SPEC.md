# DCMM — Dungeon Crawler Map Maker

**Spec version:** 0.1 (draft) · **Date:** 2026-11-23

DCMM is a browser-based editor for building maps for grid/cell-based dungeon crawler games, 2D or 3D. You author the geometry, materials and gameplay logic of a dungeon, test it in a first-person playtest, and export engine-neutral data for whatever engine you use.

The data model grows out of the schema playtest prototype (`https://claude.ai/artifact/N99ajHnvRUVW2MxmuPWeYf`): cells with six surfaces, edges with connection types that change state, props, and events made of conditions and actions.

---

## 1. Goals and non-goals

### Goals
- Fast authoring of multi-level square-grid dungeons with thin walls.
- Real 3D structure: stacked levels, floor and ceiling heights per cell, ramps and stairs, and open vertical spaces.
- Gameplay logic authored in the editor (props, doors, events, flags), which engines can extend with their own custom types.
- Engine-neutral export. JSON first, behind an exporter plugin interface so more formats can be added.
- Testing inside the editor: a first-person playtest and a 3D orbit view.
- Fully local: no accounts and no backend, hosted as a static site.

### Non-goals (for now)
- Hex grids, solid-block cell mode, or free-form geometry.
- Accounts, cloud sync or collaboration.
- Touch or tablet editing. Mobile only needs to view maps.
- Tabletop or print output.
- Entity spawns, lighting, and regions/zones. These are planned (see §12), so the model must leave room for them.

### Target user
Indie game developers on a desktop browser with mouse and keyboard.

---

## 2. Core concepts

| Concept | Meaning |
|---|---|
| **Map** | One document, saved as one file. It holds its own materials, types, flags and events. |
| **Level** | One integer `z` layer of the grid. Levels stack upward. |
| **Cell** | One grid position `(x, y, z)` that exists (is open space). Missing positions are solid or void. |
| **Edge** | A connection between two adjacent cells: horizontal (N/E/S/W) or vertical (up/down). By default an edge is a **wall** (horizontal) or **solid floor/ceiling** (vertical). An edge record exists only when the boundary is something other than that. |
| **Connection type** | Defines what an edge is (opening, door, gate, hatch, pit, secret wall…) and its states. |
| **Surface** | One of a cell's six faces (`north east south west up down`). Each face has a material ID. |
| **Material** | An ID with a preview color, plus an optional preview texture. The engine maps material IDs to its own assets. |
| **Prop** | A placed interactive object (lever, chest, button…) that has a type and a state. |
| **Event** | A named block: conditions → actions, otherwise `else` actions. Triggers fire it. |
| **Flag** | A typed map-level variable (bool / int / string). |
| **Custom type** | A user-defined action, condition, prop or connection type with typed parameters. The engine implements it. |

---

## 3. Coordinate system and units

These are neutral grid coordinates. They are documented and used in every export.

- `x` increases **east**, `y` increases **south**, `z` increases **up** (one level per step).
- North = −y, South = +y, East = +x, West = −x, Up = +z, Down = −z.
- Cell `(x, y, z)` covers the horizontal span `[x, x+1) × [y, y+1)` in cell units.
- Horizontal units: 1 cell = 1 unit. `map.cellSize` (default `1`) is a hint for engines.
- **Vertical units are integer steps.** `map.stepsPerLevel` (default `4`) is how many steps make one level. `map.stepHeight` (default `0.25`, so a level is 1 cell tall) is a hint for engines.
- The absolute elevation of level `z` is `z * stepsPerLevel` steps.
- Facing directions: `north | east | south | west` for horizontal facing.
- Map bounds: `x, y ∈ [0, 255]`, `z ∈ [-16, 15]`. Negative `z` is allowed, so a basement can sit below the entry level.

Engine exporters (later) convert these to Y-up or Z-up, left-handed or right-handed coordinates. The JSON exporter never converts.

---

## 4. Geometry model

### 4.1 Cells

```ts
interface Cell {
  pos: { x: number; y: number; z: number };
  floor: number;     // steps above level base; default 0
  ceiling: number;   // steps above level base; default stepsPerLevel; must be > floor
  shape: CellShape;  // default { kind: "flat" }
  surfaces?: Partial<Record<Side, MaterialId>>; // Side = north|east|south|west|up|down; missing = map default
  onEnter?: EventRef;
  onExit?: EventRef;
  tags?: string[];
  data?: Record<string, unknown>; // custom key-value data, passed through untouched
}

type CellShape =
  | { kind: "flat" }
  | { kind: "ramp";   rise: number; toward: Facing } // floor rises by `rise` steps toward `toward`
  | { kind: "stairs"; rise: number; toward: Facing; treads: number };
```

- `floor` and `ceiling` are integers relative to the level base. `floor` may be negative (a sunken floor) and `ceiling` may exceed `stepsPerLevel` (a tall room).
- **Open vertical spaces:** a cell whose `ceiling` reaches past its level *occupies* the matching positions on the levels above. Those positions must not hold cells (validation error V-OVERLAP). Likewise, a negative `floor` occupies the positions below. That lets a chasm or a multi-story hall be one tall cell. Alternatively, it can be a stack of cells joined by open vertical edges (see §4.3), which is what you use when you need balconies or a walkable surface partway up.
- For a ramp or stairs, `floor` is the low end. The high end is `floor + rise`, which must stay below `ceiling`.
- A side missing from `surfaces` uses the map default material for that kind of side (`map.defaults.wall | floor | ceiling`). Defaults are also left out of the project file (`floor: 0`, `ceiling: stepsPerLevel`, flat shape), so files stay small.
- Definition tables (`materials`, `connectionTypes`, `propTypes`, `customTypes`, `events`, `flags`) are records keyed by id. The objects inside don't repeat the id.
- **Risers:** when two horizontally connected cells have different floor heights, the vertical strip between them is drawn with the side material of the **higher** cell, facing the lower one. Ceiling drops between cells work the same way, using the lower ceiling's cell. Engines receive enough data to build these strips. The export also includes a derived `risers` list (§9.3) for convenience.

### 4.2 Horizontal edges

```ts
interface Edge {
  id?: string;           // optional, user-renamable (e.g. "gate"); needed only when targeted by id
  from: GridPos;         // canonical cell
  dir: "east" | "south" | "up"; // canonical direction (see below)
  toZ?: number;          // z of the far cell when it isn't the default (see below)
  type: ConnectionTypeId;
  state: string;         // must be a state of the type
  onUse?: EventRef;
  onBump?: EventRef;     // player walks into it while impassable
  params?: Record<string, ParamValue>; // per the connection type's ParamDefs
  tags?: string[];
  data?: Record<string, unknown>;
}
```

- **Canonical form:** every edge is stored from its west, north or lower cell, using `dir ∈ {east, south, up}`. The editor and the importers normalize to this form, so one physical boundary always has exactly one key: `"x,y,z:dir"`, or `"x,y,z:dir>toZ"` when `toZ` is set.
- **`toZ`:** the far cell's z. It defaults to `from.z` for a horizontal edge and `from.z + 1` for `up`, and the default is never stored. A horizontal edge with a different `toZ` joins cells on different levels, such as the top of a stair that rises a full level. An `up` edge with `toZ > z + 1` spans a tall cell.
- Openings painted by the editor have no `id`. Doors and other edges that events refer to get one, and the editor can name any edge on demand.
- When an edge's type changes it keeps its `id` and triggers, and its state resets to the new type's `initialState`. So a door placed on an opening starts closed.
- **No edge record = wall** (horizontal) or **solid slab** (vertical). Painting a room in the editor creates `opening` edges between its cells automatically.
- An edge may sit on a boundary where only one side has a cell. Examples are a door into solid rock, which works as a dead end or a teleport trigger, or a fake wall. This triggers warning V-EDGE-VOID, not an error.
- Passability between cells with different floor heights: the playtest lets you step up or down by at most `map.rules.maxStep` steps (default `1`). Ramps and stairs connect heights along their `toward` axis. Engines may use other rules, since this is only a hint that gets exported.

### 4.3 Vertical edges (between levels)

Vertical edges (`dir: "up"`) connect cell `(x, y, z)` to `(x, y, z+1)`. Built-in vertical connection kinds:

| Type | Default behavior |
|---|---|
| `open` | No slab. You can see through it and fall through it. |
| `hatch` | A trapdoor with `closed / open` states. |
| `pit` | Like open, but tagged as a hazard and drawn with a pit marker. |
| `ladder` | Climbable in both directions. A cell feature can also mark the wall the ladder is on (`props.ladderSide`). |
| `grate` | Impassable, but you can see through it. |

Stairs that change level are a **tall** `stairs` cell on level `z` that rises `stepsPerLevel` steps, with `ceiling ≥ 2 × stepsPerLevel` so there is headroom at the top. It occupies the position above it on level `z+1`, so that position must be empty. Its low end joins a level-`z` neighbor through an ordinary edge. Its high end joins the level-`z+1` neighbor through a horizontal edge with `toZ: z+1`. No vertical edge is needed. The editor's **stair tool** creates the cell and both edges in one operation.

### 4.4 Connection types

```ts
interface ConnectionType { // stored in map.connectionTypes keyed by id
  name: string;
  kind: "opening" | "door" | "gate" | "hatch" | "pit" | "ladder" | "grate" | "wall" | "custom";
  axis: "horizontal" | "vertical" | "both";
  material?: MaterialId;
  initialState: string;
  states: Record<string, {
    passable: boolean;
    blocksSight: boolean;
    transitions?: string[];    // states reachable by direct use; [] = not directly usable
  }>;
  params?: ParamDef[];         // for custom kinds: extra per-edge fields
}
```

Built-ins shipped in every new map: `opening`, `door` (closed/open/locked), `gate` (closed/open; not directly usable), `secretWall` (closed/open; looks like a wall), plus the vertical types from §4.3. Built-in types can be edited or deleted, and you can add new ones.

### 4.5 Materials

```ts
interface Material {      // stored in map.materials keyed by id
  name: string;
  color: string;          // #rrggbb preview color
  texture?: AssetId;      // optional preview-only image (project assets)
  tags?: string[];
  data?: Record<string, unknown>;
}
```

- The engine is expected to map material `id` to its own assets. Textures exist **only to make previews nicer**.
- DCMM ships a small built-in prototype texture set (stone, brick, wood, moss, dirt, metal, water). Users can upload their own PNG/JPG/WebP files, at most 1024² each.
- Uploaded textures are embedded in the project file as data URIs. The JSON export leaves them out by default (option: `includePreviewTextures`).

---

## 5. Logic model

### 5.1 Props

```ts
interface Prop {
  id: string;
  type: PropTypeId;
  cell: GridPos;
  side?: Side;            // mounted on a wall/floor/ceiling face; omitted = cell center
  facing?: Facing;
  state: string;
  onUse?: EventRef;
  params?: Record<string, ParamValue>;
  tags?: string[];
  data?: Record<string, unknown>;
}
interface PropType { // stored in map.propTypes keyed by id
  name: string;
  states: string[]; initialState: string;
  params?: ParamDef[];
  preview?: { color: string; icon?: BuiltinIcon };
}
```

Built-in prop types: `lever`, `button`, `chest`, `sign`, `pressurePlate`. Props are stored in a map-level `props` list rather than inside cells. That keeps IDs global and makes it easy to move a prop.

### 5.2 Triggers

| Source | Trigger |
|---|---|
| Cell | `onEnter`, `onExit` |
| Edge | `onUse`, `onBump` |
| Prop | `onUse` |
| Map | `onLoad` |

`EventRef` is either the ID of a named event or an inline event object. The editor encourages named events.

### 5.3 Events

```ts
interface MapEvent { // stored in map.events keyed by id
  once?: boolean;
  conditions?: Condition[];   // all must pass (AND)
  actions: Action[];
  else?: Action[];
  notes?: string;
}
```

### 5.4 Targets

```ts
type Target =
  | { kind: "edge"; id: string }
  | { kind: "edgeAt"; cell: GridPos; dir: Direction; toZ?: number } // any direction
  | { kind: "prop"; id: string }
  | { kind: "cell"; pos: GridPos }
  | { kind: "player" };
```

### 5.5 Built-in conditions

| type | fields |
|---|---|
| `state` | `target`, `equals` |
| `flag` | `name`, `op` (`== != > < >= <=`), `value` |
| `playerAt` | `pos`, optional `facing` |
| `playerFacing` | `facing` |
| `eventFired` | `event` |
| `not` / `any` | `conditions` (any = OR group) |

### 5.6 Built-in actions

| type | fields |
|---|---|
| `setConnectionState` | `target`, `state` |
| `toggleConnectionState` | `target`, `states: [a, b]` |
| `setPropState` | `target`, `state` |
| `setFlag` | `name`, `value` |
| `addFlag` | `name`, `amount` (int flags) |
| `teleport` | `to: GridPos`, optional `facing` |
| `showMessage` | `text` |
| `runEvent` | `event`, optional `delayMs` |
| `setSurface` | `cell`, `side`, `material` (e.g. reveal a mural) |

### 5.7 Custom types (engine extensions)

```ts
interface CustomTypeDef {         // stored in map.customTypes keyed by id, e.g. "playSound"
  category: "action" | "condition";
  name: string;
  description?: string;
  params: ParamDef[];
}
interface ParamDef {
  name: string;
  type: "string" | "int" | "float" | "bool" | "enum" | "gridPos" | "direction"
      | "ref:edge" | "ref:prop" | "ref:event" | "ref:flag" | "ref:material" | "color";
  options?: string[];             // for enum
  default?: ParamValue;
  required?: boolean;
}
```

- A custom action looks like `{ type: "custom", custom: "playSound", params: { sound: "creak", volume: 0.5 } }`.
- The editor builds forms from `ParamDef`s and validates references.
- In the playtest, custom actions are **logged rather than executed** ("[playSound] sound=creak"). Custom conditions use a per-playtest override that the user can toggle (default `true`).
- Custom prop and connection types are simply prop and connection types whose `params` the user defines.
- Custom type sets can be exported and imported on their own as "type libraries" (`.dcmm-types.json`), so a team can share their engine's vocabulary across maps.

### 5.8 Flags

```ts
// stored in map.flags keyed by name
type FlagDef = { type: "bool"; initial: boolean } | { type: "int"; initial: number } | { type: "string"; initial: string };
```

---

## 6. File formats

There are two separate formats. Both are UTF-8 JSON, and each has a published JSON Schema.

### 6.1 Project file — `*.dcmm` (editor format)

```jsonc
{
  "format": "dcmm-project",
  "formatVersion": 1,
  "app": { "name": "DCMM", "version": "0.1.0" },
  "map": { /* full authoring model: §4–§5 */ },
  "assets": { "tex_ab12": { "mime": "image/png", "data": "data:image/png;base64,..." } },
  "editor": {
    "view": { "level": 0, "pan": [0, 0], "zoom": 1, "showLevelsAbove": true, "showLevelsBelow": true },
    "notes": [ { "id": "n1", "pos": { "x": 3, "y": 2, "z": 0 }, "text": "Boss room?" } ],
    "playtestStart": null
  }
}
```

- The `editor` block is never exported.
- **Versioning:** `formatVersion` is an integer. When a project opens, migrations run in order (`migrations/v1_to_v2.ts`…). Files from a newer version open read-only, with a warning.
- Cells are stored as an array in the project file. Inside the app they are indexed by key.

### 6.2 Runtime export — `*.json` (the JSON exporter)

A clean, deterministic format for engines to read.

```jsonc
{
  "format": "dcmm-map",
  "schemaVersion": 1,
  "generator": "DCMM 0.1.0",
  "map": {
    "id": "three-rooms", "name": "Three Rooms",
    "cellSize": 1, "stepsPerLevel": 4, "stepHeight": 0.25,
    "bounds": { "min": {"x":1,"y":1,"z":0}, "max": {"x":7,"y":5,"z":0} },
    "start": { "cell": {"x":1,"y":2,"z":0}, "facing": "east" },
    "rules": { "maxStep": 1 },
    "defaults": { "wall": "stone", "floor": "flagA", "ceiling": "ceiling" }
  },
  "levels": [ { "z": 0, "name": "Ground" } ],
  "cells":   [ /* sorted by z, y, x; all defaults filled; all six surfaces; abs: {floor, ceiling} in absolute steps */ ],
  "edges":   [ /* canonical form plus explicit "to" cell; sorted by from z,y,x then dir */ ],
  "risers":  [ /* derived; see §9.3 */ ],
  "props":   [ ],
  "materials": { }, "connectionTypes": { }, "propTypes": { },
  "customTypes": { },
  "events": { }, "flags": { }
}
```

Export rules:
- Output is **deterministic**: keys and arrays are always in the same order, so diffs in version control stay clean.
- Missing surfaces are resolved to concrete material IDs.
- Risers are derived only where both floor (or ceiling) heights at a shared boundary are well defined. The sloped sides of a ramp produce no riser, and engines build those from the ramp's shape.
- Unused materials and types are kept by default. Option: `pruneUnused`.
- Editor notes are left out.
- Validation runs first. Errors block the export, and warnings are listed but don't block it.

---

## 7. Exporter plugin interface

```ts
interface Exporter<Options = unknown> {
  id: string;                     // "json"
  name: string;                   // "JSON (DCMM runtime)"
  fileExtension: string;          // ".json"
  optionsSchema?: ParamDef[];     // drives the export dialog form
  defaultOptions: Options;
  export(model: ResolvedMap, options: Options): ExportResult;
}
interface ExportResult {
  files: { name: string; mime: string; data: string | Uint8Array }[]; // >1 file → zip download
  warnings?: string[];
}
```

- Exporters receive a **`ResolvedMap`**. This is a normalized, validated, read-only view with canonical edges, resolved surfaces, derived risers and helpful indexes. That way each exporter doesn't have to redo the geometry logic.
- Exporters register in `exporters/index.ts`. Adding one means writing a single module, with no changes to the editor.
- The JSON exporter's options are `pretty` (bool), `pruneUnused` (bool) and `includePreviewTextures` (bool).
- Importers use the same pattern later (`Importer` interface). In v1 the only importer is the `.dcmm` project file.

---

## 8. Editor

### 8.1 Layout

```
┌──────────────────────────────────────────────────────────────────┐
│ Menu: File  Edit  View  Map  Playtest  Export      [map name]    │
├────────┬───────────────────────────────────────────┬─────────────┤
│ Tools  │  Viewport: [2D] [3D Orbit] [Playtest]      │ Inspector   │
│        │                                           │ (selection) │
│        │                                           ├─────────────┤
│        │                                           │ Palette /   │
│        │                                           │ Materials   │
├────────┴───────────────────────────────────────────┴─────────────┤
│ Levels ▲▼ z=0 "Ground" │ Events │ Flags │ Types │ Problems (2)    │
└──────────────────────────────────────────────────────────────────┘
```

The bottom dock holds tabbed panels for Levels, Events, Flags, Types (connection, prop and custom types) and Problems (validation).

### 8.2 2D level view (canvas)
- Top-down view of the current level. The levels just above and below appear ghosted, and each can be toggled.
- The grid shows cells colored by floor material, edges drawn by type and state, props as icons, and the start marker. Height is shown as a shade or number overlay that can be toggled. Cells that occupy space from a tall neighbor appear hatched.
- Mouse: left-click to apply the tool, right-click to erase or use the tool's alternate action, middle-drag or space-drag to pan, wheel to zoom.
- When the cursor is near a cell boundary it snaps to the **edge**. Otherwise it targets the **cell**.

### 8.3 Tools

| Tool | Key | Behavior |
|---|---|---|
| Select | `V` | Click or drag-box to select cells, edges and props. Selections can be moved, copied and pasted. |
| Paint cells | `B` | Adds cells. Drag to paint. Adjacent painted cells get `opening` edges automatically. |
| Room | `R` | Drag a rectangle to make a room of cells with internal openings. |
| Erase | `E` | Removes cells, or the selected edges and props. |
| Edge | `D` | Click a boundary to cycle through or set the active connection type (wall/opening/door/…). |
| Material | `M` | Paints the active material onto floors, ceilings or wall faces. Shift applies it to the whole room. |
| Height | `H` | Wheel or `+`/`−` raises or lowers the floor, and Shift does the ceiling. Drag sets a height across many cells. |
| Ramp / Stairs | `S` | Drag in the rise direction. Can create the vertical opening at the top. |
| Vertical edge | `U` | Sets the up or down connection (open, hatch, pit, ladder, grate). |
| Prop | `P` | Places the active prop type. Clicking a wall face mounts it on that side. |
| Start | `T` | Sets the start cell and facing. |
| Note | `N` | Adds an editor-only note. |

Other shortcuts: `PgUp`/`PgDn` changes level, `Ctrl+Z`/`Ctrl+Shift+Z` undo and redo, `Ctrl+S` downloads the project, `Ctrl+E` exports, and `F5` runs the playtest from the start position (`Shift+F5` starts from the cursor).

### 8.4 Inspector
Context-sensitive forms:
- **Cell:** position, floor/ceiling, shape, six surfaces, onEnter/onExit, tags, custom props.
- **Edge:** ID, type, state, onUse/onBump, params.
- **Prop:** ID, type, state, side, facing, onUse, params.

Event references use a picker with "＋ New event". Multi-selection edits the shared fields.

### 8.5 Logic editor
- The Events panel lists every event, with search and "used by" back-references.
- The event editor is a structured form, not a node graph: a condition list, an action list and an else list. Each row is a type dropdown plus a param form generated from the type's definition. Target fields offer "pick on map" mode.
- The Types panel is where you author connection types (states table), prop types and custom action/condition types (param list).

### 8.6 3D orbit view (Three.js)
- Renders every level from the same mesh builder the playtest uses (§9). Materials are shown as colors or textures.
- Orbit, pan and zoom. Options: cut away levels above the current one, show X-ray walls, highlight the selection.
- v1 is view-only. Clicking selects the item under the cursor and syncs the selection with the 2D view and the Inspector.

### 8.7 Undo / redo and autosave
- All mutations go through **commands** on an immutable store (Zustand + Immer patches). Undo and redo apply inverse patches. The history keeps 200 steps.
- Autosave writes to IndexedDB, debounced by 1 s. A "Recent maps" list keeps the last 10. Projects can be opened from or downloaded to `.dcmm` files. The File System Access API is used where available, with a fallback to download and upload.

### 8.8 Validation (Problems panel)

| Code | Severity | Rule |
|---|---|---|
| V-OVERLAP | error | A tall cell overlaps a cell on another level |
| V-CEIL | error | `ceiling <= floor`, or a ramp's high end ≥ ceiling |
| V-REF | error | An event, material, type, edge, prop or flag reference is missing |
| V-STATE | error | An edge or prop state is not defined by its type |
| V-START | error | There is no start, or the start is not on a cell |
| V-DUPID | error | A duplicate ID |
| V-PARAM | error | A custom param is missing, required, or has the wrong type. An unknown param name is a warning. |
| V-AXIS | error | A horizontal-only connection type is used on a vertical edge, or the reverse |
| V-TYPE | error | A flag value doesn't match the flag's type, or a custom type is used in the wrong category |
| V-BOUNDS | error | A cell or edge lies outside the map bounds |
| V-SCHEMA | error | The project file fails schema validation on load |
| V-GAP | warning | An edge joins cells that don't touch vertically (a vertical edge whose ceiling and floor don't meet, or a horizontal edge with no height overlap) |
| V-STEP | warning | A passable horizontal edge has a floor step greater than `rules.maxStep` |
| V-EDGE-VOID | warning | An edge has a cell on only one side |
| V-UNREACH | warning | A cell can't be reached from the start (ignoring logic; teleport destinations count as reachable) |
| V-UNUSED | info | A user-defined material, type, event or flag is never used (built-ins are exempt) |

Clicking a problem selects and focuses the item in question.

---

## 9. Shared runtime: mesh builder and playtest

### 9.1 Architecture
A single **pure-TS core** (`src/core`) holds the model, operations, validation, normalization (`ResolvedMap`) and migrations. It has no React or DOM. The editor, the renderers, the playtest and the exporters all import it.

### 9.2 Playtest
- First-person, grid-locked movement with smooth interpolation, using the prototype's controls: `W/S` move, `A/D` strafe, `Q/E` turn, `Space/F` use.
- Built with Three.js, so heights, ramps, open vertical spaces and multiple levels render correctly. This replaces the prototype's raycaster.
- Movement rules:
  - You can pass an edge only if its state is `passable`.
  - The floor height difference must be ≤ `maxStep`, or the move must follow a ramp/stairs axis.
  - If the floor below is `open` or `pit` with no cell beneath, you fall until you reach a floor.
  - Ladders: facing the ladder side and moving forward climbs up, and moving back climbs down.
- Runs the full event interpreter from §5. Messages appear in an on-screen log.
- A debug side panel shows the live flags, edge and prop states and the fired events, like the prototype's "Changing parts". It also has custom-condition toggles and the log of custom actions.
- The playtest runs on a **clone** of the map, so authored data is never changed. `Esc` returns to the editor. Optionally, playtest state (flags, states) can be copied into the map's initial values.

### 9.3 Mesh builder (`buildMesh(resolved)`)
- Generates faces for floors, ceilings, walls (where there is no passable horizontal edge, or where the edge blocks sight), risers (height differences), ramps and stair treads, and edge geometry such as door panels, gate bars and hatches.
- Derived `risers` in the export: `{ between: [GridPos, GridPos], from: steps, to: steps, material }`, in absolute steps.

---

## 10. Tech stack and project layout

- **TypeScript (strict), React 18, Vite, Zustand + Immer, Three.js (with @react-three/fiber), Zod** for the schemas. The JSON Schema files are generated from the Zod definitions.
- **Testing:** Vitest for the core (operations, validation, normalization, migrations, golden export snapshots) and Playwright for smoke tests of the editor.
- Builds to a static site. Any static host works (GitHub Pages, Netlify, Cloudflare Pages).

```
src/
  core/            model types, zod schemas, ops (commands), resolve, validate, migrations
  core/logic/      event interpreter (shared by playtest; usable headless in tests)
  exporters/       index.ts registry, json/
  render/
    mesh/          buildMesh(resolved) → geometry (shared by orbit + playtest)
    canvas2d/      2D level renderer + hit-testing (cell vs edge)
  editor/          React app: layout, tools, inspector, panels, store
  playtest/        controller, movement rules, HUD, debug panel
  assets/textures/ built-in prototype textures
schemas/           generated dcmm-project.schema.json, dcmm-map.schema.json
docs/              SPEC.md, EXPORT_FORMAT.md (engine-facing docs)
examples/          three-rooms.dcmm (port of the prototype), tower.dcmm (multi-level)
```

---

## 11. Milestones

1. **Core model:** types, Zod schemas, canonical edges, operations with undo, validation, `ResolvedMap`, and the JSON exporter with golden tests. A port of the prototype's "Three Rooms" acts as the test fixture.
2. **2D editor:** canvas level view, Select/Paint/Room/Erase/Edge/Material tools, Inspector, levels panel, autosave and file open/save, export dialog.
3. **Heights and vertical:** Height, Ramp/Stairs and Vertical-edge tools; tall cells; overlap validation; ghosted levels.
4. **Logic editor:** props, Events, Flags and Types panels, custom types, type libraries.
5. **3D:** mesh builder, orbit view, then the first-person playtest with the interpreter and debug panel.
6. **Polish:** built-in textures, a second example map, `EXPORT_FORMAT.md` for engine developers, keyboard shortcut help.

The MVP is milestones 1–5.

**Status (2026-11-23):** milestones 1 and 2 are done. Milestone 2 left out these items from §8, which come in later milestones:
- Moving, copying and pasting a selection with the Select tool.
- The Height, Ramp/Stairs, Vertical-edge, Prop and Note tools. Heights, shapes and vertical connections can already be edited in the Inspector.
- The Events, Flags and Types panels.
- The 3D and Playtest viewport modes.

The 2D view in milestone 2 uses Zustand state; history uses Immer patches as specified. The editor also adds two conveniences not in §8:
- The Connections tool cycles an edge's state when you click it again.
- Alt+click with the Material tool picks up a material.

---

## 12. Planned extensions (keep room in the model)

- **Entity spawns:** a map-level `entities[]` list (`{id, type, cell, facing, params}`) with `entityTypes`, following the prop pattern.
- **Lighting:** `lights[]` (point or ambient, color, intensity, radius) plus optional per-cell `light` levels.
- **Regions/zones:** `regions[]` (`{id, name, cells: GridPos[] | rect, params}`) for music, fog and encounter tables. These also become trigger sources (`onEnterRegion`).
- **More exporters:** Godot (`.tscn`/GridMap), Unity (prefab JSON or ScriptableObject), Tiled-style, glTF of the built mesh.
- Possibly later: hex grids, solid-block mode, cloud sync.

To make these additions safe, every top-level collection is optional in the schemas, unknown `props`/`params` fields pass through untouched, and adding a field never needs a `schemaVersion` bump. A bump is needed only for breaking changes.

---

## 13. Defaults chosen for open questions

These are proposals and can be changed:

| Question | Default |
|---|---|
| Steps per level | 4 (step height 0.25 cell) |
| Vertical links | Vertical edges (`dir: "up"`) with types open, hatch, pit, ladder, grate. Stairs and ramps are cell shapes. A full-level stair is a tall stairs cell plus a horizontal edge with `toZ`. |
| Walls | Default when no edge exists. Edges exist only for non-wall boundaries. |
| Max map size | 256 × 256 cells × 32 levels (z −16…15) |
| Undo depth | 200 steps |
| Max step-up in playtest | 1 step |
| Format versioning | Integer `formatVersion` / `schemaVersion` with ordered migrations. Additive changes need no bump. |
| Logic editor style | Structured forms, not a node graph |
