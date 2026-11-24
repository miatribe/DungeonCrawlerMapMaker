/**
 * Preview textures. A material's `texture` is either `builtin:<pattern>` (a procedural
 * grayscale pattern tinted by the material's color) or the id of an uploaded image in the
 * project's assets. Textures exist only for previews; engines map material ids to their
 * own art.
 */

export const BUILTIN_PATTERNS = ["brick", "stone", "cobble", "flagstone", "planks", "metal", "dirt", "moss", "water", "noise"] as const;
export type BuiltinPattern = (typeof BUILTIN_PATTERNS)[number];

export const PATTERN_LABEL: Record<BuiltinPattern, string> = {
  brick: "Bricks", stone: "Stone blocks", cobble: "Cobblestones", flagstone: "Flagstones", planks: "Planks",
  metal: "Metal plates", dirt: "Dirt", moss: "Moss", water: "Water", noise: "Plain",
};

export const isBuiltinTexture = (t: string | undefined): t is `builtin:${BuiltinPattern}` =>
  !!t && t.startsWith("builtin:") && (BUILTIN_PATTERNS as readonly string[]).includes(t.slice(8));

export const SIZE = 64;

/** Small deterministic PRNG so patterns look the same every time. */
function rng(seed: number) {
  let s = seed % 2147483647 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** Draw a grayscale pattern (white = full material color) into a SIZE×SIZE canvas context. */
export function drawPattern(g: CanvasRenderingContext2D, p: BuiltinPattern): void {
  const r = rng(p.length * 977 + p.charCodeAt(0));
  const shade = (v: number) => { const c = Math.max(0, Math.min(255, Math.round(v * 255))); return `rgb(${c},${c},${c})`; };
  g.fillStyle = shade(0.9);
  g.fillRect(0, 0, SIZE, SIZE);
  const speckle = (n: number, lo: number, hi: number, s = 1) => {
    for (let i = 0; i < n; i++) { g.fillStyle = shade(lo + r() * (hi - lo)); g.fillRect(Math.floor(r() * SIZE), Math.floor(r() * SIZE), s, s); }
  };
  switch (p) {
    case "brick": {
      const bh = 16, bw = 32;
      for (let row = 0; row < SIZE / bh; row++) {
        const off = row % 2 ? bw / 2 : 0;
        for (let col = -1; col < SIZE / bw + 1; col++) {
          g.fillStyle = shade(0.78 + r() * 0.2);
          g.fillRect(col * bw + off + 1, row * bh + 1, bw - 2, bh - 2);
        }
      }
      g.fillStyle = shade(0.45);
      for (let row = 0; row <= SIZE / bh; row++) g.fillRect(0, row * bh - 1, SIZE, 2);
      for (let row = 0; row < SIZE / bh; row++) {
        const off = row % 2 ? bw / 2 : 0;
        for (let x = off; x < SIZE + bw; x += bw) g.fillRect((x % SIZE) - 1, row * bh, 2, bh);
      }
      speckle(260, 0.7, 1);
      break;
    }
    case "stone": case "flagstone": {
      const n = p === "stone" ? 2 : 3;
      const s = SIZE / n;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        g.fillStyle = shade(0.72 + r() * 0.24);
        const jx = p === "flagstone" ? Math.floor(r() * 4) : 0;
        g.fillRect(x * s + 2 + jx, y * s + 2, s - 4 - jx, s - 4);
      }
      g.fillStyle = shade(0.4);
      for (let i = 0; i <= n; i++) { g.fillRect(i * s - 1, 0, 2, SIZE); g.fillRect(0, i * s - 1, SIZE, 2); }
      speckle(400, 0.65, 1);
      break;
    }
    case "cobble": {
      g.fillStyle = shade(0.4);
      g.fillRect(0, 0, SIZE, SIZE);
      for (let i = 0; i < 34; i++) {
        const x = r() * SIZE, y = r() * SIZE, rad = 5 + r() * 6;
        g.fillStyle = shade(0.7 + r() * 0.28);
        for (const [dx, dy] of [[0, 0], [SIZE, 0], [-SIZE, 0], [0, SIZE], [0, -SIZE]]) {
          g.beginPath(); g.ellipse(x + dx!, y + dy!, rad, rad * (0.7 + r() * 0.3), r() * 3, 0, Math.PI * 2); g.fill();
        }
      }
      break;
    }
    case "planks": {
      const ph = 16;
      for (let i = 0; i < SIZE / ph; i++) {
        g.fillStyle = shade(0.75 + r() * 0.2);
        g.fillRect(0, i * ph, SIZE, ph);
        for (let k = 0; k < 6; k++) { g.fillStyle = shade(0.62 + r() * 0.15); g.fillRect(0, i * ph + 2 + Math.floor(r() * (ph - 4)), SIZE, 1); }
        g.fillStyle = shade(0.4);
        g.fillRect(0, i * ph, SIZE, 1);
        g.fillRect(Math.floor(r() * SIZE), i * ph, 1, ph);
      }
      break;
    }
    case "metal": {
      g.fillStyle = shade(0.8);
      g.fillRect(0, 0, SIZE, SIZE);
      for (let y = 0; y < SIZE; y++) { g.fillStyle = shade(0.74 + r() * 0.1); g.fillRect(0, y, SIZE, 1); }
      g.fillStyle = shade(0.5);
      g.fillRect(0, 0, SIZE, 2); g.fillRect(0, 0, 2, SIZE); g.fillRect(SIZE / 2 - 1, 0, 2, SIZE);
      g.fillStyle = shade(1);
      for (const [x, y] of [[6, 6], [SIZE / 2 - 6, 6], [SIZE / 2 + 6, 6], [SIZE - 6, 6], [6, SIZE - 6], [SIZE / 2 - 6, SIZE - 6], [SIZE / 2 + 6, SIZE - 6], [SIZE - 6, SIZE - 6]]) {
        g.beginPath(); g.arc(x!, y!, 2, 0, Math.PI * 2); g.fill();
      }
      break;
    }
    case "dirt": speckle(1600, 0.6, 1, 2); break;
    case "moss": {
      speckle(900, 0.7, 0.95, 2);
      for (let i = 0; i < 40; i++) { g.fillStyle = shade(1); g.beginPath(); g.arc(r() * SIZE, r() * SIZE, 1 + r() * 3, 0, Math.PI * 2); g.fill(); }
      break;
    }
    case "water": {
      for (let y = 0; y < SIZE; y++) {
        const v = 0.78 + 0.12 * Math.sin((y / SIZE) * Math.PI * 6);
        g.fillStyle = shade(v); g.fillRect(0, y, SIZE, 1);
      }
      for (let i = 0; i < 30; i++) { g.fillStyle = shade(1); g.fillRect(Math.floor(r() * SIZE), Math.floor(r() * SIZE), 6 + Math.floor(r() * 8), 1); }
      break;
    }
    case "noise":
      speckle(700, 0.8, 1);
      break;
  }
}

const patternCache = new Map<BuiltinPattern, HTMLCanvasElement>();

export function patternCanvas(p: BuiltinPattern): HTMLCanvasElement {
  let c = patternCache.get(p);
  if (!c) {
    c = document.createElement("canvas");
    c.width = c.height = SIZE;
    drawPattern(c.getContext("2d")!, p);
    patternCache.set(p, c);
  }
  return c;
}

const imageCache = new Map<string, HTMLImageElement>();

/**
 * The image source for a material texture, or null if it has none or an uploaded image is
 * still loading (`onLoad` fires once it has).
 */
export function textureSource(texture: string | undefined, assets: Record<string, { data: string }>, onLoad?: () => void): CanvasImageSource | null {
  if (!texture) return null;
  if (isBuiltinTexture(texture)) return patternCanvas(texture.slice(8) as BuiltinPattern);
  const a = assets[texture];
  if (!a) return null;
  let img = imageCache.get(a.data);
  if (!img) {
    img = new Image();
    img.onload = () => onLoad?.();
    img.src = a.data;
    imageCache.set(a.data, img);
  }
  return img.complete && img.naturalWidth ? img : null;
}

/** A texture tinted by a color: builtin patterns multiply; images are used as-is. */
export function tinted(src: CanvasImageSource, color: string, multiply: boolean): HTMLCanvasElement {
  const c = document.createElement("canvas");
  const w = (src as HTMLImageElement).naturalWidth || (src as HTMLCanvasElement).width || SIZE;
  const h = (src as HTMLImageElement).naturalHeight || (src as HTMLCanvasElement).height || SIZE;
  c.width = Math.min(w, 512);
  c.height = Math.min(h, 512);
  const g = c.getContext("2d")!;
  g.drawImage(src, 0, 0, c.width, c.height);
  if (multiply) {
    g.globalCompositeOperation = "multiply";
    g.fillStyle = color;
    g.fillRect(0, 0, c.width, c.height);
  }
  return c;
}
