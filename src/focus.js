// Stage 1: find where a photo's subject is, without a neural network.
//
// The photo is shrunk to a small copy (FOCUS_SIZE on its long edge). Every pixel is scored for how
// sharply it differs from its neighbours (a luminance gradient, the same signal edge detectors use)
// plus a little for colour saturation. People, faces, buildings and objects are full of edges and
// colour; sky, walls, floors and fog are not. Only detail *above the photo's own average* counts,
// so an evenly busy photo (leaves, a crowd) stays centred instead of being dragged to one corner.
// A gentle centre prior reflects how people actually take photos. The result is the box that
// holds the middle 60% of that detail, across and down.
//
// No dependencies, no browser APIs: it takes raw RGBA pixels, so it runs in a browser (canvas
// getImageData), in Node, or in a worker.

/** @typedef {{ x: number, y: number, w: number, h: number }} Focus  Box as fractions of the photo (0 to 1). */

/** Long edge, in pixels, of the small copy the detail is measured on. 96 px is plenty and takes about a millisecond. */
export const FOCUS_SIZE = 96;

/** Weight of colour saturation next to edge strength. */
const SATURATION_WEIGHT = 0.25;
/** How strongly detail near the edges is discounted (0: not at all). */
const CENTRE_PRIOR = 0.125;
/** Share of the detail left outside the box on each side: 0.2 keeps the middle 60%. */
const TAIL = 0.2;

/**
 * The box round a photo's subject.
 * @param {Uint8ClampedArray | number[]} data RGBA pixels, row by row (as from canvas getImageData).
 * @param {number} w width in pixels
 * @param {number} h height in pixels
 * @returns {Focus} the whole photo `{0,0,1,1}` when there's nothing to aim at
 */
export function focusFrom(data, w, h) {
  const whole = { x: 0, y: 0, w: 1, h: 1 };
  if (w < 4 || h < 4) return whole;

  // Luminance (Rec. 601) and a cheap saturation (max - min channel).
  const lum = new Float32Array(w * h);
  const sat = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    lum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    sat[i] = Math.max(r, g, b) - Math.min(r, g, b);
  }

  // Detail score: central-difference gradient magnitude, plus some colour.
  const score = new Float32Array(w * h);
  let total = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = lum[i + 1] - lum[i - 1];
      const gy = lum[i + w] - lum[i - w];
      const s = Math.hypot(gx, gy) + SATURATION_WEIGHT * sat[i];
      score[i] = s;
      total += s;
    }
  }
  const mean = total / ((w - 2) * (h - 2));

  // Keep only detail above the photo's average, softly discounted towards the edges,
  // and project it onto the two axes.
  const cols = new Float64Array(w);
  const rows = new Float64Array(h);
  let mass = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const dx = (x / (w - 1)) * 2 - 1;
      const dy = (y / (h - 1)) * 2 - 1;
      const s = Math.max(0, score[y * w + x] - mean) * (1 - CENTRE_PRIOR * (dx * dx + dy * dy));
      cols[x] += s;
      rows[y] += s;
      mass += s;
    }
  }

  // A flat photo (fog, a plain wall): nothing stands out, so aim at the whole thing.
  if (mass < total * 0.02 || mean < 2) return whole;

  // The span that holds the middle of the detail on one axis (trimming TAIL from each end).
  const span = (m, n) => {
    let acc = 0, lo = 0, hi = n - 1;
    for (let i = 0; i < n; i++) if ((acc += m[i]) >= mass * TAIL) { lo = i; break; }
    acc = 0;
    for (let i = n - 1; i >= 0; i--) if ((acc += m[i]) >= mass * TAIL) { hi = i; break; }
    return [lo / n, (hi + 1) / n];
  };
  const [x0, x1] = span(cols, w);
  const [y0, y1] = span(rows, h);
  const r = (v) => Math.round(v * 1000) / 1000;
  return { x: r(x0), y: r(y0), w: r(Math.max(0.02, x1 - x0)), h: r(Math.max(0.02, y1 - y0)) };
}

/**
 * Scale an image down to FOCUS_SIZE and find its focus, in a browser.
 * @param {CanvasImageSource & { width: number, height: number }} image an <img>, ImageBitmap or canvas
 * @returns {Focus}
 */
export function focusOfImage(image) {
  const scale = FOCUS_SIZE / Math.max(image.width, image.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(4, Math.round(image.width * scale));
  canvas.height = Math.max(4, Math.round(image.height * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return focusFrom(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
}

/**
 * The per-pixel detail map focusFrom works from (0 to 1), for drawing a heatmap.
 * @returns {Float32Array}
 */
export function detailMap(data, w, h) {
  const lum = new Float32Array(w * h);
  const sat = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    lum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    sat[i] = Math.max(r, g, b) - Math.min(r, g, b);
  }
  const out = new Float32Array(w * h);
  let total = 0, max = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const s = Math.hypot(lum[i + 1] - lum[i - 1], lum[i + w] - lum[i - w]) + SATURATION_WEIGHT * sat[i];
      out[i] = s;
      total += s;
    }
  }
  const mean = total / ((w - 2) * (h - 2));
  for (let i = 0; i < out.length; i++) {
    out[i] = Math.max(0, out[i] - mean);
    if (out[i] > max) max = out[i];
  }
  if (max > 0) for (let i = 0; i < out.length; i++) out[i] /= max;
  return out;
}

/**
 * A saved focus box, if it makes sense (for reading stored data back).
 * @returns {Focus | undefined}
 */
export function cleanFocus(v) {
  if (!v || typeof v !== 'object') return undefined;
  const ok = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;
  if (!ok(v.x) || !ok(v.y) || !ok(v.w) || !ok(v.h)) return undefined;
  return { x: v.x, y: v.y, w: Math.min(1 - v.x, v.w), h: Math.min(1 - v.y, v.h) };
}
