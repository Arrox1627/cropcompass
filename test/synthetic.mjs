// Synthetic photos with a known subject, for the tests and the benchmark: a smooth background
// (a sky gradient with soft noise, like a real sky or wall) and one textured "subject" (a person,
// a building: edges and colour) at a known place. Seeded, so every run is the same.

export const rng = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

/** RGBA pixels painted by paint(u, v, x, y) → [r, g, b]. */
export function image(w, h, paint) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b] = paint(x / w, y / h, x, y);
      const i = (y * w + x) * 4;
      d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
    }
  return d;
}

/**
 * One scene: a background and a subject box (fractions of the photo) of a random size and place.
 * @returns {{ data: Uint8ClampedArray, w: number, h: number, aspect: number, truth: {x:number,y:number,w:number,h:number} }}
 */
export function scene(seed, { long = 96 } = {}) {
  const r = rng(seed);
  const aspect = [1.5, 1.5, 4 / 3, 0.75, 0.667, 1][Math.floor(r() * 6)];
  const w = aspect >= 1 ? long : Math.round(long * aspect);
  const h = aspect >= 1 ? Math.round(long / aspect) : long;
  const sw = 0.12 + r() * 0.28, sh = 0.18 + r() * 0.4;
  const truth = { x: r() * (1 - sw), y: r() * (1 - sh), w: sw, h: sh };
  const top = [120 + r() * 60, 160 + r() * 50, 210 + r() * 40];
  const bottom = [top[0] - 40, top[1] - 30, top[2] - 50];
  const a = [r() * 255, r() * 255, r() * 255], b = [r() * 255, r() * 255, r() * 255];
  const noise = rng(seed * 7 + 1);
  const data = image(w, h, (u, v, x, y) => {
    const inside = u >= truth.x && u <= truth.x + truth.w && v >= truth.y && v <= truth.y + truth.h;
    if (inside) return (x + y * 2) % 3 === 0 || (x * 3 + y) % 5 === 0 ? a : b; // edges and colour
    const n = (noise() - 0.5) * 6; // soft, like a real sky
    return top.map((t, k) => t + (bottom[k] - t) * v + n);
  });
  return { data, w, h, aspect, truth };
}

/**
 * A scene with several subjects (2 or 3) that don't overlap, each textured differently, on the same
 * kind of soft background. `truths` are their boxes.
 */
export function sceneMulti(seed, { long = 96, count } = {}) {
  const r = rng(seed * 31 + 7);
  const aspect = [1.5, 1.5, 4 / 3, 16 / 9, 0.75, 1][Math.floor(r() * 6)];
  const w = aspect >= 1 ? long : Math.round(long * aspect);
  const h = aspect >= 1 ? Math.round(long / aspect) : long;
  const n = count ?? 2 + Math.floor(r() * 2);
  const truths = [];
  for (let tries = 0; truths.length < n && tries < 200; tries++) {
    const sw = 0.08 + r() * 0.16, sh = 0.18 + r() * 0.35;
    const b = { x: r() * (1 - sw), y: r() * (1 - sh), w: sw, h: sh };
    // Apart from the others by a clear gap (as separate people or things are).
    const gap = 0.06;
    if (truths.every((t) => b.x > t.x + t.w + gap || t.x > b.x + b.w + gap || b.y > t.y + t.h + gap || t.y > b.y + b.h + gap)) truths.push(b);
  }
  const looks = truths.map(() => [[r() * 255, r() * 255, r() * 255], [r() * 255, r() * 255, r() * 255]]);
  const top = [120 + r() * 60, 160 + r() * 50, 210 + r() * 40];
  const bottom = [top[0] - 40, top[1] - 30, top[2] - 50];
  const noise = rng(seed * 13 + 5);
  const data = image(w, h, (u, v, x, y) => {
    const k = truths.findIndex((t) => u >= t.x && u <= t.x + t.w && v >= t.y && v <= t.y + t.h);
    if (k >= 0) return (x + y * 2) % 3 === 0 || (x * 3 + y) % 5 === 0 ? looks[k][0] : looks[k][1];
    const nn = (noise() - 0.5) * 6;
    return top.map((t, i) => t + (bottom[i] - t) * v + nn);
  });
  return { data, w, h, aspect, truths };
}
