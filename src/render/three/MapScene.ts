/**
 * Three.js scene for the 3D orbit view and the first-person playtest. Static geometry comes
 * from buildMesh; doors, gates, hatches and props are separate objects whose pose follows
 * runtime state with a short animation.
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { Facing, GridPos } from "../../core/geometry";
import type { ResolvedMap } from "../../core/resolve";
import { buildMesh, type BuildOptions as MeshBuildOptions, type HEdgePart, type MeshData, type PropPart, type VEdgePart } from "../mesh/buildMesh";
import { tinted } from "../textures";

type BuildOptions = MeshBuildOptions & { textureFor?: (materialId: string) => { src: CanvasImageSource; multiply: boolean } | null };

const YAW: Record<Facing, number> = { north: 0, west: Math.PI / 2, south: Math.PI, east: -Math.PI / 2 };

interface Animated {
  obj: THREE.Object3D;
  /** Apply a state immediately (snap) or set the target to animate toward. */
  set(state: string, passable: boolean, snap: boolean): void;
  tick(dt: number): boolean;
}

/** A small tileable noise texture so flat colors read as surfaces. */
function noiseTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d")!;
  const img = g.createImageData(32, 32);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 32 * 32; i++) {
    const x = i % 32, y = Math.floor(i / 32);
    // faint block seams every 16 px plus noise
    const seam = x % 16 === 0 || y % 16 === 0 ? 0.82 : 1;
    const v = Math.round(255 * seam * (0.86 + rnd() * 0.14));
    img.data.set([v, v, v, 255], i * 4);
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export interface ScenePick {
  cell: GridPos;
}

export class MapScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.02, 500);
  private controls: OrbitControls | null = null;
  private root = new THREE.Group();
  private staticGroup = new THREE.Group();
  private dynamicGroup = new THREE.Group();
  private overlayGroup = new THREE.Group();
  private materials = new Map<string, THREE.MeshLambertMaterial>();
  private noise = noiseTexture();
  private animated = new Map<string, Animated>();
  private map: ResolvedMap | null = null;
  private mesh: MeshData | null = null;
  private raf = 0;
  private last = performance.now();
  private dirty = true;
  private mode: "orbit" | "fp" = "orbit";
  private ambient = new THREE.AmbientLight(0xffffff, 0.55);
  private sun = new THREE.DirectionalLight(0xfff2dd, 1.1);
  private torch = new THREE.PointLight(0xffc98a, 2.2, 6, 1.4);
  private camTarget = { pos: new THREE.Vector3(), yaw: 0 };
  private camYaw = 0;
  private hasCamPose = false;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = "block";
    this.scene.background = new THREE.Color(0x0d0b09);
    this.sun.position.set(-3, 8, -5);
    this.scene.add(this.root, this.ambient, this.sun, this.torch);
    this.root.add(this.staticGroup, this.dynamicGroup, this.overlayGroup);
    this.torch.visible = false;
    this.resize();
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.frame();
    };
    loop();
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.controls?.dispose();
    this.clearGroup(this.staticGroup);
    this.clearGroup(this.dynamicGroup);
    this.clearGroup(this.overlayGroup);
    this.resetMaterials();
    this.noise.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  resize(): void {
    const r = this.container.getBoundingClientRect();
    const w = Math.max(1, r.width), h = Math.max(1, r.height);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  // ---------- content ----------

  private textureFor: BuildOptions["textureFor"] | undefined;

  private material(id: string, color: string): THREE.MeshLambertMaterial {
    let m = this.materials.get(id);
    if (!m) {
      const tex = id.startsWith("__") ? null : this.textureFor?.(id) ?? null;
      if (tex) {
        const t = new THREE.CanvasTexture(tinted(tex.src, color, tex.multiply));
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.magFilter = THREE.NearestFilter;
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 4;
        m = new THREE.MeshLambertMaterial({ color: 0xffffff, map: t });
      } else {
        m = new THREE.MeshLambertMaterial({ color, map: this.noise });
      }
      this.materials.set(id, m);
    }
    return m;
  }

  private resetMaterials() {
    for (const m of this.materials.values()) {
      if (m.map && m.map !== this.noise) m.map.dispose();
      m.dispose();
    }
    this.materials.clear();
  }

  private color(id: string): string {
    return this.map?.materials[id]?.color ?? "#ff00ff";
  }

  private clearGroup(g: THREE.Group) {
    g.traverse((o) => { if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) o.geometry.dispose(); });
    g.clear();
  }

  /** Rebuild everything for a map. Edge/prop states default to the authored ones. */
  setMap(map: ResolvedMap, opts: BuildOptions & { edgeStates?: Record<string, string>; propStates?: Record<string, string> } = {}): void {
    this.map = map;
    this.mesh = buildMesh(map, opts);
    this.clearGroup(this.staticGroup);
    this.clearGroup(this.dynamicGroup);
    this.animated.clear();
    this.textureFor = opts.textureFor;
    this.resetMaterials();
    for (const [id, b] of this.mesh.groups) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(b.positions, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(b.normals, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(b.uvs, 2));
      const mesh = new THREE.Mesh(g, this.material(id, this.color(id)));
      this.staticGroup.add(mesh);
    }
    for (const e of this.mesh.edges) {
      const a = e.kind === "hedge" ? this.buildHEdge(e) : this.buildVEdge(e);
      if (!a) continue;
      this.dynamicGroup.add(a.obj);
      this.animated.set(`edge:${e.key}`, a);
    }
    for (const p of this.mesh.props) {
      const a = this.buildProp(p);
      this.dynamicGroup.add(a.obj);
      this.animated.set(`prop:${p.id}`, a);
    }
    this.applyState(opts.edgeStates ?? Object.fromEntries(map.edges.map((e) => [e.key, e.state])), opts.propStates ?? Object.fromEntries(map.props.map((p) => [p.id, p.state])), true);
    this.dirty = true;
  }

  applyState(edgeStates: Record<string, string>, propStates: Record<string, string>, snap = false): void {
    const map = this.map;
    if (!map) return;
    for (const e of map.edges) {
      const a = this.animated.get(`edge:${e.key}`);
      if (!a) continue;
      const st = edgeStates[e.key] ?? e.state;
      a.set(st, !!map.connectionTypes[e.type]?.states[st]?.passable, snap);
    }
    for (const p of map.props) {
      const a = this.animated.get(`prop:${p.id}`);
      if (a) a.set(propStates[p.id] ?? p.state, false, snap);
    }
    this.dirty = true;
  }

  private buildHEdge(e: HEdgePart): Animated | null {
    const mat = this.material(e.material, this.color(e.material));
    const len = 1, h = Math.max(0.05, e.y1 - e.y0);
    const hinge = new THREE.Group();
    // hinge at endpoint a, panel extending toward b
    hinge.position.set(e.a[0], e.y0, e.a[1]);
    const dirX = e.b[0] - e.a[0], dirZ = e.b[1] - e.a[1];
    hinge.rotation.y = Math.atan2(-dirZ, dirX);
    const ct = this.map!.connectionTypes[e.type];
    const kind = e.ctKind;
    if (kind === "door" || (kind === "custom" && Object.values(ct?.states ?? {}).some((s) => s.blocksSight))) {
      const swing = new THREE.Group(); // rotates about the hinge line
      const panel = new THREE.Mesh(new THREE.BoxGeometry(len * 0.96, h * 0.97, 0.07), mat);
      panel.position.set(len * 0.48 + 0.02, h * 0.485, 0);
      const knob = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.14), this.material("__metal", "#c9a227"));
      knob.position.set(len * 0.85, h * 0.45, 0);
      swing.add(panel, knob);
      hinge.add(swing);
      let target = 0;
      return {
        obj: hinge,
        set: (_s, passable, snap) => { target = passable ? (-Math.PI / 2) * 0.95 : 0; if (snap) swing.rotation.y = target; },
        tick: (dt) => approach(swing.rotation, "y", target, dt * 6),
      };
    }
    if (kind === "gate" || kind === "grate" || kind === "custom") {
      const bars = new THREE.Group();
      const barMat = mat;
      const n = 7;
      for (let i = 0; i < n; i++) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.04, h, 0.04), barMat);
        b.position.set((i + 0.5) / n, h / 2, 0);
        bars.add(b);
      }
      for (const y of [0.06, 0.55, 0.94]) {
        const r = new THREE.Mesh(new THREE.BoxGeometry(1, 0.05, 0.05), barMat);
        r.position.set(0.5, h * y, 0);
        bars.add(r);
      }
      hinge.add(bars);
      let target = 0;
      return {
        obj: hinge,
        set: (_s, passable, snap) => { target = passable ? h * 0.92 : 0; if (snap) bars.position.y = target; },
        tick: (dt) => approach(bars.position, "y", target, dt * 2.5),
      };
    }
    if (kind === "wall") {
      const m = this.material(e.material, this.color(e.material));
      const w = new THREE.Mesh(new THREE.BoxGeometry(1, h, 0.04), m);
      w.position.set(0.5, h / 2, 0);
      hinge.add(w);
      let target = 0;
      return {
        obj: hinge,
        set: (_s, passable, snap) => { target = passable ? -h : 0; if (snap) w.position.y = h / 2 + target; },
        tick: (dt) => { const done = approach(w.position, "y", h / 2 + target, dt * 1.5); w.visible = w.position.y > -h / 2 + 0.01; return done; },
      };
    }
    return null;
  }

  private buildVEdge(e: VEdgePart): Animated | null {
    const mat = this.material(e.material, this.color(e.material));
    const g = new THREE.Group();
    g.position.set(e.x, e.y, e.z);
    switch (e.ctKind) {
      case "hatch": {
        const hinge = new THREE.Group();
        const panel = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.05, 0.9), mat);
        panel.position.set(0.45, 0, 0.45);
        hinge.position.set(0.05, 0, 0.05);
        hinge.add(panel);
        g.add(hinge);
        let target = 0;
        return {
          obj: g,
          set: (_s, passable, snap) => { target = passable ? Math.PI / 2 * 0.95 : 0; if (snap) hinge.rotation.z = target; },
          tick: (dt) => approach(hinge.rotation, "z", target, dt * 5),
        };
      }
      case "grate": {
        for (let i = 1; i < 6; i++) {
          const a = new THREE.Mesh(new THREE.BoxGeometry(1, 0.04, 0.04), mat); a.position.set(0.5, 0, i / 6); g.add(a);
          const b = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 1), mat); b.position.set(i / 6, 0, 0.5); g.add(b);
        }
        return { obj: g, set: (_s, passable) => { g.visible = !passable; }, tick: () => true };
      }
      case "ladder": {
        // Built against the north wall around the cell center, then turned to face the
        // wall the playtest climbs by (see ladderSide); free-standing when every side is open.
        const h = e.y - e.yLow + 0.35;
        const turn = new THREE.Group();
        turn.position.set(0.5, 0, 0.5);
        turn.rotation.y = e.side ? YAW[e.side] : 0;
        const z = e.side ? -0.44 : 0;
        for (const x of [-0.18, 0.18]) {
          const rail = new THREE.Mesh(new THREE.BoxGeometry(0.05, h, 0.05), mat);
          rail.position.set(x, -h / 2 + 0.35, z);
          turn.add(rail);
        }
        for (let y = 0.15; y < h; y += 0.22) {
          const rung = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.035, 0.035), mat);
          rung.position.set(0, -(e.y - e.yLow) + y, z);
          turn.add(rung);
        }
        g.add(turn);
        return { obj: g, set: () => {}, tick: () => true };
      }
      case "pit": {
        const rim = new THREE.Mesh(new THREE.RingGeometry(0.36, 0.5, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
        rim.rotation.x = -Math.PI / 2;
        rim.position.set(0.5, -0.002, 0.5);
        g.add(rim);
        return { obj: g, set: () => {}, tick: () => true };
      }
      default:
        return null;
    }
  }

  private buildProp(p: PropPart): Animated {
    const base = this.material(`__prop_${p.type}`, p.color);
    const dark = this.material("__prop_dark", "#3a3f45");
    const g = new THREE.Group();
    g.position.set(...p.pos);
    // face into the room from a wall
    const wallYaw: Record<string, number> = { north: 0, south: Math.PI, east: -Math.PI / 2, west: Math.PI / 2 };
    if (p.mount in wallYaw) g.rotation.y = wallYaw[p.mount]!;
    const onWall = p.mount !== "floor" && p.mount !== "up";
    const box = (w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      return mesh;
    };
    let set: Animated["set"] = () => {};
    let tick: Animated["tick"] = () => true;
    switch (p.icon) {
      case "lever": {
        g.add(box(0.16, onWall ? 0.22 : 0.08, onWall ? 0.05 : 0.16, dark, 0, onWall ? 0 : 0.04, onWall ? 0.025 : 0));
        const pivot = new THREE.Group();
        pivot.position.set(0, onWall ? 0 : 0.08, onWall ? 0.05 : 0);
        const stick = box(0.03, 0.24, 0.03, base, 0, 0.12, 0);
        const knob = box(0.07, 0.07, 0.07, this.material("__knob", "#d9534f"), 0, 0.24, 0);
        pivot.add(stick, knob);
        g.add(pivot);
        let target = 0;
        set = (s, _p, snap) => {
          target = s === "on" ? -0.7 : 0.7;
          knob.material = this.material(s === "on" ? "__knob_on" : "__knob", s === "on" ? "#5fd36b" : "#d9534f");
          if (snap) pivot.rotation.x = target;
        };
        tick = (dt) => approach(pivot.rotation, "x", target, dt * 8);
        break;
      }
      case "chest": {
        g.add(box(0.5, 0.26, 0.34, base, 0, 0.13, 0));
        const hinge = new THREE.Group();
        hinge.position.set(0, 0.26, -0.17);
        hinge.add(box(0.5, 0.1, 0.34, base, 0, 0.05, 0.17));
        g.add(hinge);
        let target = 0;
        set = (s, _p, snap) => { target = s === "open" ? -1.4 : 0; if (snap) hinge.rotation.x = target; };
        tick = (dt) => approach(hinge.rotation, "x", target, dt * 4);
        break;
      }
      case "button": {
        g.add(box(0.18, 0.18, 0.04, dark, 0, onWall ? 0 : 0.02, onWall ? 0.02 : 0));
        const b = box(0.1, 0.1, 0.06, base, 0, onWall ? 0 : 0.05, onWall ? 0.05 : 0);
        if (!onWall) b.rotation.x = -Math.PI / 2;
        g.add(b);
        set = (s) => { b.scale.z = s === "down" ? 0.3 : 1; };
        break;
      }
      case "plate": {
        const plate = box(0.6, 0.04, 0.6, base, 0, 0.02, 0);
        g.add(plate);
        set = (s) => { plate.position.y = s === "down" ? 0.005 : 0.02; };
        break;
      }
      case "sign": {
        if (!onWall) g.add(box(0.05, 0.45, 0.05, dark, 0, 0.22, 0));
        g.add(box(0.36, 0.22, 0.04, base, 0, onWall ? 0 : 0.45, onWall ? 0.02 : 0));
        break;
      }
      default: {
        // Generic props show state by glowing whenever they're not in their type's starting state.
        const mesh = box(0.24, 0.24, 0.24, base, 0, onWall ? 0 : 0.12, onWall ? 0.12 : 0);
        g.add(mesh);
        const initial = this.map?.propTypes[p.type]?.initialState;
        const glow = new THREE.PointLight(new THREE.Color(p.color), 0, 2.5, 1.5);
        glow.position.set(0, onWall ? 0.1 : 0.35, onWall ? 0.25 : 0);
        g.add(glow);
        set = (s) => {
          const active = initial !== undefined && s !== initial;
          const m = new THREE.MeshLambertMaterial({ color: p.color, emissive: active ? new THREE.Color(p.color) : new THREE.Color(0x000000), emissiveIntensity: active ? 0.9 : 0 });
          mesh.material = m;
          glow.intensity = active ? 1.6 : 0;
        };
      }
    }
    if (p.mount === "up") g.rotation.x = Math.PI;
    return { obj: g, set, tick };
  }

  // ---------- overlays ----------

  setSelection(boxes: { min: [number, number, number]; max: [number, number, number] }[], start: { pos: [number, number, number]; facing: Facing } | null): void {
    this.clearGroup(this.overlayGroup);
    const lineMat = new THREE.LineBasicMaterial({ color: 0x4fb3ff });
    for (const b of boxes) {
      const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]));
      const l = new THREE.LineSegments(geo, lineMat);
      l.position.set((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
      this.overlayGroup.add(l);
    }
    if (start && this.mode === "orbit") {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.42, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      cone.rotation.x = -Math.PI / 2; // point along -Z (north)
      const holder = new THREE.Group();
      holder.add(cone);
      holder.position.set(...start.pos);
      holder.position.y += 0.15;
      holder.rotation.y = YAW[start.facing];
      this.overlayGroup.add(holder);
    }
    this.dirty = true;
  }

  // ---------- camera modes ----------

  setOrbit(focus?: { center: THREE.Vector3; radius: number }): void {
    this.mode = "orbit";
    this.scene.fog = null;
    this.ambient.intensity = 0.55;
    this.sun.visible = true;
    this.torch.visible = false;
    this.camera.fov = 50;
    this.camera.near = 0.05;
    this.camera.updateProjectionMatrix();
    if (!this.controls) {
      this.controls = new OrbitControls(this.camera, this.renderer.domElement);
      this.controls.enableDamping = true;
      this.controls.addEventListener("change", () => (this.dirty = true));
    }
    this.controls.enabled = true;
    if (focus) {
      this.controls.target.copy(focus.center);
      const r = Math.max(4, focus.radius);
      this.camera.position.set(focus.center.x - r * 0.3, focus.center.y + r * 1.1, focus.center.z + r * 1.1);
      this.controls.update();
    }
    this.dirty = true;
  }

  setFirstPerson(): void {
    this.mode = "fp";
    if (this.controls) this.controls.enabled = false;
    this.scene.fog = new THREE.Fog(0x0d0b09, 1.5, 9);
    this.ambient.intensity = 0.22;
    this.sun.visible = false;
    this.torch.visible = true;
    this.camera.fov = 70;
    this.camera.near = 0.02;
    this.camera.updateProjectionMatrix();
    this.hasCamPose = false;
    this.clearGroup(this.overlayGroup);
    this.dirty = true;
  }

  /** First-person target pose; the camera eases toward it. */
  setPlayer(pos: [number, number, number], facing: Facing, snap = false): void {
    const yaw = YAW[facing];
    // pick the equivalent angle nearest the current one so turns take the short way round
    let t = yaw;
    while (t - this.camYaw > Math.PI) t -= Math.PI * 2;
    while (t - this.camYaw < -Math.PI) t += Math.PI * 2;
    this.camTarget.pos.set(...pos);
    this.camTarget.yaw = t;
    if (snap || !this.hasCamPose) {
      this.camera.position.copy(this.camTarget.pos);
      this.camYaw = t;
      this.hasCamPose = true;
    }
    this.dirty = true;
  }

  /** The cell under a screen point (orbit view). */
  pick(clientX: number, clientY: number): ScenePick | null {
    if (!this.map || !this.mesh) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = ray.intersectObjects([this.staticGroup, this.dynamicGroup], true)[0];
    if (!hit || !hit.face) return null;
    const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    // step slightly into the face's cell (walls face inward, floors up)
    const p = hit.point.clone().addScaledVector(n, 0.02);
    const x = Math.floor(p.x), y = Math.floor(p.z);
    const h = p.y / this.mesh.unitY;
    const col = this.map.cells.filter((c) => c.pos.x === x && c.pos.y === y);
    const c = col.find((c) => h >= c.abs.floor - 0.6 && h <= c.abs.ceiling + 0.1) ?? col[0];
    return c ? { cell: c.pos } : null;
  }

  private frame(): void {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    let moving = false;
    for (const a of this.animated.values()) if (!a.tick(dt)) moving = true;
    if (this.mode === "orbit" && this.controls) this.controls.update();
    if (this.mode === "fp") {
      const k = 1 - Math.exp(-dt * 12);
      const before = this.camera.position.clone();
      this.camera.position.lerp(this.camTarget.pos, k);
      this.camYaw += (this.camTarget.yaw - this.camYaw) * k;
      this.camera.rotation.set(0, this.camYaw, 0, "YXZ");
      this.torch.position.copy(this.camera.position);
      if (before.distanceTo(this.camera.position) > 1e-4 || Math.abs(this.camTarget.yaw - this.camYaw) > 1e-4) moving = true;
    }
    if (moving) this.dirty = true;
    if (this.dirty || this.mode === "orbit") {
      this.renderer.render(this.scene, this.camera);
      this.dirty = false;
    }
  }
}

/** Ease `obj[key]` toward `target`; returns true when it has arrived. */
function approach<T extends object>(obj: T, key: keyof T, target: number, rate: number): boolean {
  const v = obj[key] as unknown as number;
  const d = target - v;
  if (Math.abs(d) < 1e-3) { (obj[key] as unknown as number) = target; return true; }
  (obj[key] as unknown as number) = v + d * Math.min(1, rate);
  return false;
}

export const facingYaw = YAW;
