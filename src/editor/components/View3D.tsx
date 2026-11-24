/** 3D views: the orbit overview (mode "3d") and the first-person playtest (mode "play"). */
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { cellKey, type ResolvedCell } from "../../core";
import { MapScene } from "../../render/three/MapScene";
import { useEditor } from "../store";
import { textureFor } from "../textures";
import { PlayHud, usePlayKeys } from "./PlayHud";

/** World position of a cell's standing point (center, on the floor), in steps then scaled. */
function eyePos(c: ResolvedCell, spl: number, unitY: number): [number, number, number] {
  const floor = c.abs.floor + (c.shape.kind === "flat" ? 0 : c.shape.rise / 2);
  const eye = Math.min(0.6 * spl, c.abs.ceiling - floor - 0.3 * spl * 0.5);
  return [c.pos.x + 0.5, (floor + Math.max(0.2, eye)) * unitY, c.pos.y + 0.5];
}

export function View3D({ mode }: { mode: "3d" | "play" }) {
  const wrap = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<MapScene | null>(null);

  // Mount the renderer once per mode.
  useEffect(() => {
    const scene = new MapScene(wrap.current!);
    sceneRef.current = scene;
    const ro = new ResizeObserver(() => scene.resize());
    ro.observe(wrap.current!);
    return () => { ro.disconnect(); scene.dispose(); sceneRef.current = null; };
  }, [mode]);

  // Orbit: rebuild when the map, level or cutaway changes; keep the camera.
  useEffect(() => {
    if (mode !== "3d") return;
    const scene = sceneRef.current!;
    let first = true;
    const rebuild = () => {
      const s = useEditor.getState();
      scene.setMap(s.resolved, { textureFor, ...(s.cutaway && { includeCell: (c) => c.pos.z <= s.level }) });
      const spl = s.resolved.stepsPerLevel, unitY = s.resolved.stepHeight / s.resolved.cellSize;
      if (first) {
        const b = s.resolved.bounds;
        const center = b ? new THREE.Vector3((b.min.x + b.max.x + 1) / 2, s.level * spl * unitY, (b.min.y + b.max.y + 1) / 2) : new THREE.Vector3(0, 0, 0);
        const radius = b ? Math.max(b.max.x - b.min.x + 1, b.max.y - b.min.y + 1) * 0.8 : 6;
        scene.setOrbit({ center, radius });
        first = false;
      }
      overlay();
    };
    const overlay = () => {
      const s = useEditor.getState();
      const unitY = s.resolved.stepHeight / s.resolved.cellSize;
      const boxes = s.selection.cells.flatMap((k) => {
        const c = s.resolved.cellAt(s.doc.cells[k]?.pos ?? { x: 0, y: 0, z: -999 });
        return c ? [{ min: [c.pos.x + 0.02, c.abs.floor * unitY + 0.01, c.pos.y + 0.02] as [number, number, number], max: [c.pos.x + 0.98, c.abs.ceiling * unitY - 0.01, c.pos.y + 0.98] as [number, number, number] }] : [];
      });
      const st = s.resolved.start;
      const sc = st && s.resolved.cellAt(st.cell);
      scene.setSelection(boxes, sc ? { pos: [sc.pos.x + 0.5, sc.abs.floor * unitY, sc.pos.y + 0.5], facing: st!.facing } : null);
    };
    rebuild();
    const unsub = useEditor.subscribe((s, prev) => {
      if (s.resolved !== prev.resolved || s.level !== prev.level || s.cutaway !== prev.cutaway || s.textureTick !== prev.textureTick || s.assets !== prev.assets) rebuild();
      else if (s.selection !== prev.selection) overlay();
    });
    return unsub;
  }, [mode]);

  // Playtest: build the whole map once, then follow runtime state.
  useEffect(() => {
    if (mode !== "play") return;
    const scene = sceneRef.current!;
    const pt = useEditor.getState().playtest;
    if (!pt) return;
    const rt = pt.runtime;
    const map = rt.map;
    const unitY = map.stepHeight / map.cellSize;
    let surfacesSig = "";
    const build = () => {
      surfacesSig = JSON.stringify(rt.state.surfaces);
      scene.setMap(map, { textureFor, edgeStates: rt.state.edges, propStates: rt.state.props, surface: (p, side) => rt.state.surfaces[cellKey(p)]?.[side] });
    };
    build();
    scene.setFirstPerson();
    const sync = (snap: boolean) => {
      if (JSON.stringify(rt.state.surfaces) !== surfacesSig) build();
      scene.applyState(rt.state.edges, rt.state.props);
      const c = map.cellAt(rt.state.player.pos);
      if (c) scene.setPlayer(eyePos(c, map.stepsPerLevel, unitY), rt.state.player.facing, snap);
    };
    sync(true);
    return rt.subscribe(() => sync(false));
  }, [mode]);

  // Orbit picking: a click (not a drag) selects the cell under the cursor.
  useEffect(() => {
    if (mode !== "3d") return;
    const el = wrap.current!;
    let down: { x: number; y: number } | null = null;
    const pd = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; };
    const pu = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4 || e.button !== 0) { down = null; return; }
      down = null;
      const hit = sceneRef.current?.pick(e.clientX, e.clientY);
      const s = useEditor.getState();
      if (hit) s.select({ cells: [cellKey(hit.cell)] }, e.shiftKey);
      else if (!e.shiftKey) s.clearSelection();
    };
    el.addEventListener("pointerdown", pd);
    el.addEventListener("pointerup", pu);
    return () => { el.removeEventListener("pointerdown", pd); el.removeEventListener("pointerup", pu); };
  }, [mode]);

  usePlayKeys(mode === "play");

  return (
    <div className={`view3d ${mode}`} ref={wrap} tabIndex={-1}>
      {mode === "3d" && (
        <div className="view3d-hint muted small">Drag to orbit · right-drag to pan · wheel to zoom · click a cell to select it</div>
      )}
      {mode === "play" && <PlayHud />}
    </div>
  );
}
