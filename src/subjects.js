// Stage 1, for several subjects: every separate cluster of detail in the photo, each with its own box
// and a weight for how much of the photo's detail it holds.
//
// The same detail score as focus.js (edges plus a little colour, above the photo's own average,
// softly discounted towards the edges) is turned into a mask of the pixels that clearly stand out.
// The mask is grown by a couple of pixels so the parts of one subject (a face, a shirt, an arm)
// join up, then split into connected regions. Each region big enough to matter becomes a subject:
// the box round the core of its detail, and its share of the detail as its weight. Regions that
// touch are merged. A photo that is busy all over gives one subject covering it, and a flat photo
// gives none.

import { FOCUS_SIZE } from './focus.js';

/** @typedef {{ x: number, y: number, w: number, h: number, weight: number }} Subject  box as fractions, weight 0 to 1 */

/** A region needs at least this share of the photo's standout detail to count as a subject. */
const MIN_SHARE = 0.06;
/** A pixel is part of a subject when its standout detail reaches this share of the standout pixels' average (half: a quieter subject beside a vivid one still counts). */
const HOT = 0.5;
/** At most this many subjects are kept (the heaviest). */
const MAX_SUBJECTS = 6;
/** How far, in pixels of the small copy, the mask is grown so one subject's parts join up. */
const GROW = 2;

/** Per-pixel standout detail, the same score focus.js uses. */
function standout(data, w, h) {
  const lum = new Float32Array(w * h);
  const sat = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    lum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    sat[i] = Math.max(r, g, b) - Math.min(r, g, b);
  }
  const score = new Float32Array(w * h);
  let total = 0;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const s = Math.hypot(lum[i + 1] - lum[i - 1], lum[i + w] - lum[i - w]) + 0.25 * sat[i];
      score[i] = s;
      total += s;
    }
  const mean = total / ((w - 2) * (h - 2));
  const out = new Float32Array(w * h);
  let mass = 0;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const dx = (x / (w - 1)) * 2 - 1, dy = (y / (h - 1)) * 2 - 1;
      const s = Math.max(0, score[y * w + x] - mean) * (1 - 0.125 * (dx * dx + dy * dy));
      out[y * w + x] = s;
      mass += s;
    }
  return { s: out, mass, total, mean };
}

/**
 * Every subject in a photo, heaviest first.
 * @param {Uint8ClampedArray | number[]} data RGBA pixels of a small copy (FOCUS_SIZE on its long edge)
 * @param {number} w
 * @param {number} h
 * @param {{ minShare?: number, hot?: number }} [options] the thresholds, for tuning
 * @returns {Subject[]} empty for a flat photo
 */
export function subjectsFrom(data, w, h, { minShare = MIN_SHARE, hot: hotShare = HOT } = {}) {
  if (w < 4 || h < 4) return [];
  const { s, mass, total, mean } = standout(data, w, h);
  if (mass < total * 0.02 || mean < 2) return [];

  // The pixels that clearly stand out: above the average of the standout pixels themselves.
  let sum = 0, n = 0;
  for (const v of s) if (v > 0) { sum += v; n++; }
  const cut = n ? (sum / n) * hotShare : Infinity;
  const hot = new Uint8Array(w * h);
  for (let i = 0; i < s.length; i++) if (s[i] >= cut) hot[i] = 1;

  // Grow the mask so one subject's parts join up (a square of GROW pixels each way).
  const grown = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!hot[y * w + x]) continue;
      for (let yy = Math.max(0, y - GROW); yy <= Math.min(h - 1, y + GROW); yy++)
        for (let xx = Math.max(0, x - GROW); xx <= Math.min(w - 1, x + GROW); xx++) grown[yy * w + xx] = 1;
    }

  // Connected regions (8 neighbours), each with its detail.
  const label = new Int32Array(w * h).fill(-1);
  const regions = [];
  const stack = [];
  for (let start = 0; start < w * h; start++) {
    if (!grown[start] || label[start] >= 0) continue;
    const id = regions.length;
    const pixels = [];
    let weight = 0;
    label[start] = id;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop();
      pixels.push(i);
      weight += s[i];
      const x = i % w, y = (i / w) | 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const j = yy * w + xx;
          if (grown[j] && label[j] < 0) { label[j] = id; stack.push(j); }
        }
    }
    regions.push({ pixels, weight });
  }

  // Each region big enough to matter: the box round the core of its detail (trimming 5% from
  // each end, so a stray edge can't stretch it).
  const regionMass = regions.reduce((a, r) => a + r.weight, 0);
  let subjects = regions
    .filter((r) => r.weight >= regionMass * minShare)
    .map((r) => {
      const cols = new Float64Array(w), rows = new Float64Array(h);
      for (const i of r.pixels) { cols[i % w] += s[i]; rows[(i / w) | 0] += s[i]; }
      const span = (m, len) => {
        let acc = 0, lo = 0, hi = len - 1;
        for (let i = 0; i < len; i++) if ((acc += m[i]) >= r.weight * 0.05) { lo = i; break; }
        acc = 0;
        for (let i = len - 1; i >= 0; i--) if ((acc += m[i]) >= r.weight * 0.05) { hi = i; break; }
        return [lo / len, (hi + 1) / len];
      };
      const [x0, x1] = span(cols, w), [y0, y1] = span(rows, h);
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, weight: r.weight };
    });

  // Boxes that overlap are one subject.
  for (let merged = true; merged; ) {
    merged = false;
    outer: for (let a = 0; a < subjects.length; a++)
      for (let b = a + 1; b < subjects.length; b++) {
        const A = subjects[a], B = subjects[b];
        if (A.x < B.x + B.w && B.x < A.x + A.w && A.y < B.y + B.h && B.y < A.y + A.h) {
          const x = Math.min(A.x, B.x), y = Math.min(A.y, B.y);
          subjects[a] = { x, y, w: Math.max(A.x + A.w, B.x + B.w) - x, h: Math.max(A.y + A.h, B.y + B.h) - y, weight: A.weight + B.weight };
          subjects.splice(b, 1);
          merged = true;
          break outer;
        }
      }
  }

  subjects.sort((a, b) => b.weight - a.weight);
  subjects = subjects.slice(0, MAX_SUBJECTS);
  const kept = subjects.reduce((a, x) => a + x.weight, 0) || 1;
  const r = (v) => Math.round(v * 1000) / 1000;
  return subjects.map((x) => ({ x: r(x.x), y: r(x.y), w: r(Math.max(0.02, x.w)), h: r(Math.max(0.02, x.h)), weight: r(x.weight / kept) }));
}

/** subjectsFrom for an <img>, ImageBitmap or canvas, in the browser. */
export function subjectsOfImage(image) {
  const scale = FOCUS_SIZE / Math.max(image.width, image.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(4, Math.round(image.width * scale));
  canvas.height = Math.max(4, Math.round(image.height * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return subjectsFrom(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
}
