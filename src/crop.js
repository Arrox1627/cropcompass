// Stages 2 and 3: put the crop on the subject, and give each photo the frame it suits.
//
// Stage 2, the crop. A frame of a given shape (width / height) shows only part of a photo of
// another shape. Instead of always showing the middle, the visible window slides so it's centred
// on the subject box from focus.js, a little above the box's middle vertically, because faces and
// horizons sit high. Without a box it leans slightly upwards for the same reason. The result is a
// CSS-ready `object-position`: x and y from 0 to 1.
//
// Stage 3, assignment. With several photos and several frames on a page, each photo can go in any
// frame. Every pairing gets a cost: how much of the photo the frame's shape throws away, plus,
// weighted much higher, how much of the *subject* even the best crop must cut. Every ordering is
// tried (at most 6! = 720 for six frames) and the cheapest wins. "Starred" favourites keep the
// largest frames. Frames that are still tight are flagged so a person can take a look.

/** @typedef {{ x: number, y: number, w: number, h: number }} Focus */
/** @typedef {{ aspect: number, focus?: Focus, starred?: boolean, id?: string }} Photo  aspect = width / height */
/** @typedef {{ x: number, y: number, zoom: number }} Crop  x, y: object-position from 0 to 1 */
/** @typedef {{ aspect: number, area?: number }} Frame */

/** Without a subject box, the window sits this far down a photo cropped top and bottom (0.5: centred). */
export const LEAN = 0.42;
/** Down the photo, the window centres this far into the subject box (0.5: its middle). */
export const HIGH = 0.45;
/** A frame that cuts more than this share of the subject is flagged for a check. */
export const CHECK_CUT = 0.18;
/** Without a subject box, a frame that throws away more than this share of the photo is flagged. */
export const CHECK_LOSS = 0.42;

/**
 * How much of the photo a frame of this shape shows, across (vx) and down (vy). One of them is 1.
 * @returns {{ vx: number, vy: number }}
 */
export function visible(photoAspect, frameAspect, zoom = 1) {
  return photoAspect > frameAspect
    ? { vx: frameAspect / photoAspect / zoom, vy: 1 / zoom }
    : { vx: 1 / zoom, vy: photoAspect / frameAspect / zoom };
}

/** The share of the photo a frame of this shape throws away (0: none). */
export function lossOf(photoAspect, frameAspect) {
  const r = photoAspect / frameAspect;
  return 1 - Math.min(r, 1 / r);
}

/** The window's position on one axis (0 to 1) for a window of size v, aimed at the span lo..hi. */
function along(v, lo, hi, high) {
  if (v >= 0.999) return 0.5;
  const centre = high ? lo + (hi - lo) * HIGH : (lo + hi) / 2;
  return Math.min(1, Math.max(0, (centre - v / 2) / (1 - v)));
}

const round = (v) => Math.round(v * 1000) / 1000;

/**
 * The crop that best shows a photo's subject in a frame of this shape.
 * @param {Photo} photo
 * @param {number} frameAspect
 * @returns {Crop}
 */
export function cropFor(photo, frameAspect) {
  const { vx, vy } = visible(photo.aspect, frameAspect);
  const f = photo.focus;
  if (!f) return { x: 0.5, y: round(along(vy, LEAN, LEAN, true)), zoom: 1 };
  return { x: round(along(vx, f.x, f.x + f.w, false)), y: round(along(vy, f.y, f.y + f.h, true)), zoom: 1 };
}

/** The plain centre crop, for comparison. */
export const centreCrop = () => ({ x: 0.5, y: 0.5, zoom: 1 });

/**
 * The share of the subject box a crop leaves out, on the worse axis (0: all of it shows).
 * @param {Photo} photo
 * @param {number} frameAspect
 * @param {Crop} crop
 */
export function cutOf(photo, frameAspect, crop) {
  const f = photo.focus;
  if (!f) return 0;
  const { vx, vy } = visible(photo.aspect, frameAspect, crop.zoom);
  const axis = (v, p, lo, size) => {
    if (size <= 0) return 0;
    const a = p * (1 - v), b = a + v;
    return 1 - Math.max(0, Math.min(b, lo + size) - Math.max(a, lo)) / size;
  };
  const cut = Math.max(axis(Math.min(1, vx), crop.x, f.x, f.w), axis(Math.min(1, vy), crop.y, f.y, f.h));
  return cut < 1e-9 ? 0 : cut;
}

/** Whether a frame is still tight enough that a person should check it. */
export function isTight(photo, frameAspect, crop) {
  return photo.focus ? cutOf(photo, frameAspect, crop) > CHECK_CUT : lossOf(photo.aspect, frameAspect) > CHECK_LOSS;
}

/**
 * How badly a photo sits in a frame of this shape, at its best crop. Losing background is cheap;
 * losing the subject is expensive.
 */
export function costOf(photo, frameAspect) {
  const loss = lossOf(photo.aspect, frameAspect);
  if (!photo.focus) return loss;
  return 0.4 * loss + 2 * cutOf(photo, frameAspect, cropFor(photo, frameAspect));
}

const permutations = (n) => {
  if (n <= 1) return [[0]];
  const out = [];
  for (const rest of permutations(n - 1)) for (let i = 0; i <= rest.length; i++) out.push([...rest.slice(0, i), n - 1, ...rest.slice(i)]);
  return out;
};
const PERMS = new Map([1, 2, 3, 4, 5, 6].map((n) => [n, permutations(n)]));

/**
 * Put photos into frames: the cheapest ordering, starred photos in the largest frames, each
 * cropped on its subject and flagged if still tight.
 * @param {Photo[]} photos as many as there are frames (up to 6 are searched exhaustively)
 * @param {Frame[]} frames each with an aspect and, optionally, an area (for starred photos)
 * @returns {{ cells: { photo: Photo, frame: Frame, crop: Crop, check: boolean }[], cost: number }}
 */
export function arrange(photos, frames) {
  const n = Math.min(photos.length, frames.length);
  const ps = photos.slice(0, n), fs = frames.slice(0, n);
  const byArea = fs.map((_, i) => i).sort((a, b) => (fs[b].area ?? 0) - (fs[a].area ?? 0));
  const stars = ps.filter((p) => p.starred).length;
  const big = new Set(byArea.slice(0, stars));
  const costFor = (order) => order.reduce((s, p, i) => s + costOf(p, fs[i].aspect), 0);
  // More than six frames: keep the order given (6! = 720 orderings is the exhaustive limit).
  let best = null;
  for (const perm of PERMS.get(n) ?? [ps.map((_, i) => i)]) {
    const order = perm.map((k) => ps[k]);
    if (order.some((p, i) => p.starred && !big.has(i))) continue;
    const cost = costFor(order);
    if (!best || cost < best.cost - 1e-9) best = { order, cost };
  }
  best ??= { order: ps, cost: costFor(ps) };
  return {
    cost: best.cost,
    cells: best.order.map((photo, i) => {
      const crop = cropFor(photo, fs[i].aspect);
      return { photo, frame: fs[i], crop, check: isTight(photo, fs[i].aspect, crop) };
    }),
  };
}
