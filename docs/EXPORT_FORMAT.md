# DCMM export format (`dcmm-map`, schema version 1)

This is a guide for engine developers loading maps exported by DCMM (Dungeon Crawler Map Maker) with the **JSON** exporter. It covers what every field means, how to turn it into geometry, and how the logic is meant to run.

- **Machine-readable schema:** [`schemas/dcmm-map.schema.json`](../schemas/dcmm-map.schema.json), a JSON Schema you can validate against.
- **Examples:** [`examples/three-rooms.json`](../examples/three-rooms.json) (doors, levers, events), [`examples/tower.json`](../examples/tower.json) (multiple levels, stairs, a pit) and [`examples/crypt.json`](../examples/crypt.json) (custom types, flags, trapdoor, ladder, secret wall).
- **Reference implementation:** [`src/core/logic/runtime.ts`](../src/core/logic/runtime.ts) is the headless runtime the editor's playtest uses. It's short, has no UI dependencies, and is the source of truth for the semantics below.

---

## 1. At a glance

```jsonc
{
  "format": "dcmm-map",          // always this string
  "schemaVersion": 1,            // bumped only for breaking changes
  "generator": "DCMM 0.1.0",
  "map": { … },                  // name, units, start, defaults
  "levels": [ … ],               // named z layers
  "cells": [ … ],                // open grid cells (everything else is solid)
  "edges": [ … ],                // anything between cells that isn't a plain wall
  "risers": [ … ],               // derived: vertical strips where floors/ceilings step
  "props": [ … ],                // levers, chests, …
  "materials": { id: … },
  "connectionTypes": { id: … },  // door, gate, hatch, … with their states
  "propTypes": { id: … },
  "customTypes": { id: … },      // engine-defined actions/conditions
  "events": { id: … },           // named logic blocks
  "flags": { name: … }           // map variables with starting values
}
```

The output is **deterministic**: arrays are sorted and object keys come in a fixed order, so diffs stay clean if you commit exports to version control. Unknown fields should be ignored (see §11).

## 2. Coordinates and units

DCMM uses neutral grid coordinates and never converts them for any particular engine.

| Axis | Direction | Notes |
|---|---|---|
| `x` | east | +1 per cell |
| `y` | **south** | north is −y |
| `z` | up | one *level* per z |

- Cell `(x, y, z)` covers the horizontal square `[x, x+1) × [y, y+1)` in cell units.
- **Heights are integer steps.** `map.stepsPerLevel` steps make one level (default 4). Level `z` starts at step `z × stepsPerLevel`.
- `cell.floor` and `cell.ceiling` are relative to the cell's own level. `cell.abs.floor` and `cell.abs.ceiling` are absolute steps, which is usually what you want.
- `map.cellSize` (world units per cell) and `map.stepHeight` (world units per step, in cell units) are scale hints. With the defaults, 1 cell = 1 unit and 1 level = 4 × 0.25 = 1 unit.

To convert to world space, compute the scale first:

```
cellSize  = map.cellSize
stepWorld = map.stepHeight * map.cellSize
```

Then map the axes for your engine:

| Engine | Up axis | Conversion (east, south, steps) |
|---|---|---|
| Unity | Y up, left-handed, +Z forward | `X = x·cellSize`, `Y = steps·stepWorld`, `Z = −y·cellSize` (north = +Z) |
| Godot | Y up, right-handed, −Z forward | `X = x·cellSize`, `Y = steps·stepWorld`, `Z = y·cellSize` (north = −Z) |
| Unreal | Z up, left-handed | `X = −y·cellSize·100`, `Y = x·cellSize·100`, `Z = steps·stepWorld·100` (cm) |

Directions are `north | east | south | west | up | down`. A "facing" is one of the four horizontal ones.

## 3. `map`

| Field | Meaning |
|---|---|
| `id`, `name` | Identifier (also the export file name) and display name. |
| `cellSize`, `stepsPerLevel`, `stepHeight` | Units; see §2. |
| `bounds` | `{min, max}` grid positions over all cells, or `null` for an empty map. |
| `start` | `{cell, facing}`, where the player begins. |
| `rules.maxStep` | Largest floor difference, in steps, the player can walk up or down. |
| `defaults` | `{wall, floor, ceiling}` material ids. They're already applied to every cell's `surfaces`. |
| `onLoad` | Optional event (id or inline) to run when the map starts. |
| `tags`, `data` | Free-form; passed through untouched. |

## 4. `levels`

`[{ z, name }]`, sorted by z. Purely descriptive. A level can exist with no cells, and cells can sit on a z with no level entry.

## 5. `cells`

Every listed cell is open space. **Anything not listed is solid.**

```jsonc
{
  "pos": { "x": 2, "y": 4, "z": 0 },
  "floor": -1, "ceiling": 4,                 // steps, relative to the level
  "abs": { "floor": -1, "ceiling": 4 },      // steps, absolute
  "shape": { "kind": "stairs", "rise": 1, "toward": "north", "treads": 3 },
  "surfaces": { "north": "stone", "east": "stone", "south": "stone", "west": "stone", "up": "ceiling", "down": "flagstone" },
  "onEnter": "someEvent",                    // optional (id or inline event)
  "onExit": "otherEvent",                    // optional
  "tags": [], "data": {}                     // optional pass-through
}
```

- **`shape`:**
  - `flat`: the floor is level at `abs.floor`.
  - `ramp`: the floor slopes from `abs.floor` (on the side opposite `toward`) up to `abs.floor + rise` (on the `toward` side).
  - `stairs`: the same rise split into `treads` equal steps. Tread *i* (0-based) covers the fraction `[i/treads, (i+1)/treads]` along `toward`, at height `abs.floor + rise·(i+1)/treads`.
- **Tall and sunken cells:** `ceiling` may exceed `stepsPerLevel` (a tall room) and `floor` may be negative (a sunken floor). A cell may therefore reach into another level's space. The editor guarantees no two cells in the same column overlap vertically.
- **`surfaces`:** all six faces always have a material id. Wall faces are the cell's *inner* faces, so two neighboring cells each have their own side of a shared wall.

## 6. `edges`

Edges describe every boundary between cells that isn't a plain solid wall.

```jsonc
{ "id": "gate", "from": {"x":3,"y":2,"z":0}, "to": {"x":4,"y":2,"z":0}, "dir": "east", "type": "gate", "state": "closed" }
{ "id": "crypt_hatch", "from": {"x":2,"y":7,"z":-1}, "to": {"x":2,"y":7,"z":0}, "dir": "up", "type": "hatch", "state": "closed" }
```

- **No edge means wall.** Between two horizontally adjacent cells, or between a cell and solid rock, the absence of an edge means a solid wall. Vertically, it means a solid floor or ceiling slab.
- **Canonical form:** `from` is always the west, north or lower cell, and `dir` is `east`, `south` or `up`. `to` is given explicitly. Each physical boundary appears at most once.
- **Cross-level horizontal edges:** `to.z` may differ from `from.z`. That is how a staircase climbing a full level connects to the floor above: a tall stairs cell's high end joins a cell one level up.
- **Tall vertical edges:** for `up` edges, `to` is the cell whose floor meets `from`'s ceiling, which may be more than one level up when `from` is tall.
- **Doors into rock:** an edge's `to` (or `from`) may have no cell. Treat the far side as solid rock.
- **`id`:** present only when the edge is named, which is required for events that target it.
- **`state`:** the initial state, one of `connectionTypes[type].states`.
- **Optional fields:** `onUse`, `onBump` (§9), `params` (§10), `tags`, `data`.

### Connection types

```jsonc
"door": {
  "name": "Wooden door", "kind": "door", "axis": "horizontal", "material": "wood",
  "initialState": "closed",
  "states": {
    "closed": { "passable": false, "blocksSight": true,  "transitions": ["open"] },
    "open":   { "passable": true,  "blocksSight": false, "transitions": ["closed"] },
    "locked": { "passable": false, "blocksSight": true,  "transitions": [] }
  }
}
```

- `kind` hints at how to draw the connection: `opening`, `door`, `gate`, `hatch`, `pit`, `ladder`, `grate`, `wall` (a secret or fake wall) or `custom`.
- `axis` is `horizontal`, `vertical` or `both`.
- **Behavior is driven by state, not kind.** `passable` decides movement and `blocksSight` decides visibility. `transitions` lists the states the player can switch to by *using* the connection directly: a plain door toggles open/closed, a locked door has none, and a gate has none, so only events move it.

### Building geometry

The 3D preview in the editor builds the map this way (see [`buildMesh.ts`](../src/render/mesh/buildMesh.ts)):

1. **Per cell:**
   - **Floor:** add one, flat or ramp-sloped or stair-stepped, unless the cell has a vertical edge going **down**.
   - **Ceiling:** add one at `abs.ceiling` unless the cell has a vertical edge going **up**.
   - **Walls:** for each horizontal side with **no edge**, or whose edge leads to no cell, add a wall from `abs.floor` to `abs.ceiling` using `surfaces[side]`.
2. **Risers:** add one quad for each entry in `risers` (below).
3. **Connections:** for each edge whose type isn't an `opening`, place a connection object (door panel, gate bars, hatch and so on) in the opening. Its pose follows the current state.
4. **Stair and ramp sides:** where a stairs or ramp cell's lateral side is open to a neighbor, fill the profile under the treads or slope.

### `risers`

These are derived for convenience. Each is a vertical strip on the boundary between two horizontally connected cells whose floors (or ceilings) meet at different heights.

```jsonc
{ "between": [{"x":0,"y":0,"z":0}, {"x":0,"y":1,"z":0}], "kind": "floor", "from": -1, "to": 0, "material": "stone", "facing": "south" }
```

- **Heights:** `from` and `to` are absolute steps.
- **`facing`:** the direction the visible face points.
- **Material:** for floor risers it comes from the higher cell's side; for ceiling drops, from the lower ceiling's cell.
- **Ramps:** ramp sides with no well-defined height produce no riser.

## 7. `props` and `propTypes`

```jsonc
{ "id": "brazier_1", "type": "brazier", "cell": {"x":1,"y":0,"z":0}, "side": "north", "state": "unlit", "onUse": "light_1" }
"brazier": { "name": "Brazier", "states": ["unlit", "lit"], "initialState": "unlit", "preview": { "color": "#e07030", "icon": "generic" } }
```

- `side` is the wall the prop is mounted on (`up` means the ceiling). When omitted, the prop stands on the floor at the cell center.
- `facing` is optional.
- `params` follow the prop type's `params` definitions (§10). For example, the built-in `sign` has `text`.
- `preview` is only how the editor draws the prop.

## 8. `materials`

```jsonc
"brick": { "name": "Red brick", "color": "#a5503a" }
```

- **Material ids are the contract:** map each id to your own art. `color` is a preview color.
- **Textures:** `texture` appears only if the map was exported with **Embed preview textures**. It's either a `data:` URI (an image uploaded in the editor) or `builtin:<pattern>`, the name of a procedural editor pattern such as `builtin:brick` or `builtin:planks`. You can use it as a hint or ignore it.

## 9. Logic: triggers, events, conditions, actions

### Triggers

| Source | Field | When it fires |
|---|---|---|
| map | `onLoad` | Once, when play starts (before the start cell's `onEnter`) |
| cell | `onEnter` / `onExit` | The player enters or leaves the cell, including by falling or climbing |
| edge | `onUse` | The player uses the connection they're facing |
| edge | `onBump` | The player walks into it while it's impassable |
| prop | `onUse` | The player uses the prop |

A trigger's value is either an **event id** (a key in `events`) or an **inline event** object.

### Events

```jsonc
"toggleGate": {
  "once": false,                         // optional
  "conditions": [ … ],                   // optional; ALL must hold
  "actions": [ … ],                      // run when conditions hold
  "else": [ … ],                         // optional; run when they don't
  "notes": "…"                           // optional designer notes
}
```

- **`once: true`:** after the event runs its `actions` once, it never runs again. Running the `else` branch doesn't count.
- **Inline events with `once`:** they need a per-source key, such as `"prop:lever1:onUse"`.
- **Fired:** an event counts as fired (see `eventFired`) once its conditions have passed at least once.
- **Order:** actions run in order and synchronously, except `runEvent` with `delayMs`.
- **Recursion:** guard against runaway `runEvent` loops. The reference runtime stops at a depth of 32.

### Targets

Many conditions and actions take a target:

| `kind` | Fields | Resolves to |
|---|---|---|
| `edge` | `id` | The edge with that `id` |
| `edgeAt` | `cell`, `dir`, optional `toZ` | The edge on that side of that cell (`dir` may be any direction) |
| `prop` | `id` | The prop with that id |
| `cell` | `pos` | A cell |
| `player` | — | The player |

### Conditions

| `type` | Fields | True when |
|---|---|---|
| `state` | `target`, `equals` | The target edge's or prop's current state equals `equals` |
| `flag` | `name`, `op` (`== != > < >= <=`), `value` | The flag compares true |
| `playerAt` | `pos`, optional `facing` | The player is in that cell (and facing that way) |
| `playerFacing` | `facing` | The player faces that way |
| `eventFired` | `event` | That event has fired (its conditions passed at least once) |
| `any` | `conditions` | **Any** nested condition holds |
| `not` | `conditions` | **None** of the nested conditions hold |
| `custom` | `custom`, `params` | Your engine decides (§10) |

### Actions

| `type` | Fields | Effect |
|---|---|---|
| `setConnectionState` | `target`, `state` | Set an edge's state |
| `toggleConnectionState` | `target`, `states: [a, b]` | If the state is `a`, set it to `b`; otherwise set it to `a` |
| `setPropState` | `target`, `state` | Set a prop's state |
| `setFlag` | `name`, `value` | Set a flag |
| `addFlag` | `name`, `amount` | Add to an integer flag |
| `teleport` | `to`, optional `facing` | Move the player. This does not run `onEnter`. |
| `showMessage` | `text` | Show text to the player |
| `runEvent` | `event`, optional `delayMs` | Run another event, now or after a delay |
| `setSurface` | `cell`, `side`, `material` | Change a face's material at runtime |
| `custom` | `custom`, `params` | Your engine implements it (§10) |

### `flags`

`{ "flames": { "type": "int", "initial": 0 } }`. The type is `bool`, `int` or `string`. Flags hold game state such as keys found, puzzle progress or counters.

## 10. Custom types and parameters

Custom types let a map use your engine's own vocabulary:

```jsonc
"customTypes": {
  "playSound":    { "category": "action",    "name": "Play sound", "params": [ {"name":"sound","type":"string","required":true}, {"name":"volume","type":"float","default":1} ] },
  "spawnMonster": { "category": "action",    "name": "Spawn monster", "params": [ {"name":"monster","type":"enum","options":["skeleton","ghoul"],"required":true}, {"name":"at","type":"gridPos","required":true} ] },
  "hasLight":     { "category": "condition", "name": "Player carries a light", "params": [] }
}
// used as:
{ "type": "custom", "custom": "spawnMonster", "params": { "monster": "skeleton", "at": {"x":1,"y":7,"z":-1} } }
```

- **Param types and values:**
  - `string`, `int`, `float`, `bool` and `color` (`#rrggbb`) are plain values.
  - `enum` is one of `options`.
  - `gridPos` is `{x, y, z}`.
  - `direction` is one of the six directions.
  - `ref:edge`, `ref:prop`, `ref:event`, `ref:flag` and `ref:material` are ids.
- **Defaults:** missing optional params take `default` when one is given.
- **Validation:** the editor validates params before export, so required params are present and correctly typed.
- **Other uses:** the same `params` mechanism appears on connection types and prop types, filled per edge or prop.
- **Recommendation:** register a handler per custom id, and log anything you don't recognize. Don't crash on it.

## 11. Movement rules (recommended)

These are the rules the editor's playtest uses. Your engine is free to differ, but maps are designed and tested against these.

- **Moving horizontally (forward, back or strafe):**
  - Find the edge on that side of the current cell. If there's none, it's a wall.
  - If the edge's state isn't `passable`, run its `onBump` and stay put.
  - The far cell must exist.
  - Compare the floor heights where the two cells meet the boundary, using a ramp's height at that edge and its midpoint along a ramp's sloped sides. The difference must be at most `rules.maxStep`.
- **Entering a cell:** run the old cell's `onExit`, move, then run the new cell's `onEnter`.
- **Falling:** while the current cell has a passable vertical edge going **down** that isn't a `ladder`, and a cell exists below, drop into it. Run exit and enter triggers each time.
- **Ladders:** standing in a cell with a passable `ladder` edge, walking forward into a wall climbs up it and walking back into a wall climbs down.
- **Use:** check these in order:
  1. A prop in the current cell mounted on the faced wall, then a floor prop in the current cell.
  2. The faced edge's `onUse`.
  3. Otherwise, if the faced edge isn't an opening, switch it to its first `transitions` state. With no transitions, it's locked or can only be moved by events.
  4. If the faced edge is passable, a prop in the next cell that sits on the floor or is mounted facing you.

## 12. Versioning and compatibility

- **Breaking changes:** `schemaVersion` increases only for breaking changes. Check it and refuse versions you don't know.
- **Additive changes:** these happen without a version bump, so **ignore unknown fields**.
- **Pass-through data:** `tags` and `data` on the map, cells, edges and props are free-form, for your own pipeline.
- **Editor-only data:** project files (`.dcmm`) are a different format (`dcmm-project`) that holds editor state. Engines should load exports, not project files.

## 13. Loading sketch

```ts
const map = JSON.parse(text);
if (map.format !== "dcmm-map" || map.schemaVersion !== 1) throw new Error("unsupported map");

const key = (p) => `${p.x},${p.y},${p.z}`;
const cells = new Map(map.cells.map((c) => [key(c.pos), c]));
const edgeBySide = new Map(); // "x,y,z:dir" -> edge, from both ends
const opposite = { east: "west", south: "north", up: "down" };
for (const e of map.edges) {
  edgeBySide.set(`${key(e.from)}:${e.dir}`, e);
  edgeBySide.set(`${key(e.to)}:${opposite[e.dir]}`, e);
}
const edgeOn = (pos, dir) => edgeBySide.get(`${key(pos)}:${dir}`); // undefined = wall / solid slab
const state = (e) => map.connectionTypes[e.type].states[e.state];  // { passable, blocksSight, transitions }
```
