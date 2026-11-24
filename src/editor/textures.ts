/** Editor glue for preview textures: resolves a material's texture and caches 2D patterns. */
import { isBuiltinTexture, textureSource, tinted } from "../render/textures";
import { useEditor } from "./store";

const bump = () => useEditor.getState().set({ textureTick: useEditor.getState().textureTick + 1 });

/** For the 3D scene: the image to use for a material, and whether to tint it by color. */
export function textureFor(materialId: string): { src: CanvasImageSource; multiply: boolean } | null {
  const s = useEditor.getState();
  const m = s.resolved.materials[materialId];
  const src = textureSource(m?.texture, s.assets, bump);
  return src ? { src, multiply: isBuiltinTexture(m!.texture) } : null;
}

const patterns = new WeakMap<CanvasRenderingContext2D, Map<string, CanvasPattern>>();

/** For the 2D view: a repeating pattern per material, scaled so one image spans one cell. */
export function patternsFor(ctx: CanvasRenderingContext2D): Map<string, CanvasPattern> {
  const s = useEditor.getState();
  let cache = patterns.get(ctx);
  if (!cache) patterns.set(ctx, (cache = new Map()));
  const out = new Map<string, CanvasPattern>();
  for (const [id, m] of Object.entries(s.resolved.materials)) {
    if (!m.texture) continue;
    const key = `${m.texture}|${m.color}|${s.assets[m.texture]?.data.length ?? 0}`;
    let p = cache.get(key);
    if (!p) {
      const src = textureSource(m.texture, s.assets, bump);
      if (!src) continue;
      const c = tinted(src, m.color, isBuiltinTexture(m.texture));
      p = ctx.createPattern(c, "repeat") ?? undefined;
      if (!p) continue;
      p.setTransform(new DOMMatrix().scale(1 / c.width, 1 / c.height));
      cache.set(key, p);
    }
    out.set(id, p);
  }
  return out;
}
