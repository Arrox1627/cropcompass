// Stages 2 and 3: put the crop on the subject, and give each photo the frame it suits.
//
// Stage 2, the crop. A frame of a given shape (width / height) shows only part of a photo of
// another shape. Instead of always showing the middle, the visible window slides so it's centred
// on the subject box from focus.js, a little above the box's middle vertically, because faces and
// horizons sit high. Without a box it leans slightly upwards for the same reason. The result is a
// CSS-ready `object-position`: x and y from 0 to 1.
//
// Several subjects (subjects.js): when they all fit in the window, it centres on all of them.
// When they can't, it keeps as many whole subjects as it can, by weight, and never slices one in
// half: a subject cut partway counts for much less than one left out cleanly, and the frame is
// flagged for a check.
//
// Stage 3, assignment. With several photos and several frames on a page, each photo can go in any
// frame. Every pairing gets a cost: how much of the photo the frame's shape throws away, plus,
// weighted much higher, how much of the *subject* even the best crop must cut. Every ordering is
// tried (at most 6! = 720 for six frames) and the cheapest wins. "Starred" favourites keep the
// largest frames. Frames that are still tight are flagged so a person can take a look.

/** @typedef {{ x: number, y: number, w: number, h: number }} Focus */
/** @typedef {{ x: number, y: number, w: number, h: number, weight: number }} Subject */
/**
 * @typedef {{ aspect: number, focus?: Focus, subjects?: Subject[], starred?: boolean, id?: string }} Photo
 * aspect = width / height. `subjects` (from subjects.js) takes over from `focus` when there are several.
 */
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

/** A photo's subjects: its several, or its one focus box, or none. */
export function subjectsOf(photo) {
  if (photo.subjects?.length) return photo.subjects;
  return photo.focus ? [{ ...photo.focus, weight: 1 }] : [];
}

/** The box round every subject. */
const unionOf = (subs) => {
  const x = Math.min(...subs.map((b) => b.x)), y = Math.min(...subs.map((b) => b.y));
  return { x, y, w: Math.max(...subs.map((b) => b.x + b.w)) - x, h: Math.max(...subs.map((b) => b.y + b.h)) - y };
};

/** How much of a span lo..lo+size a window starting at a, of size v, shows (0 to 1). */
const shown = (a, v, lo, size) => (size <= 0 ? 1 : Math.max(0, Math.min(a + v, lo + size) - Math.max(a, lo)) / size);

/**
 * A subject cut partway scores below one left out cleanly: slicing a person in half is worse than
 * leaving them out. It scores between -SLICE (barely shown) and 0 (almost whole).
 */
const SLICE = 0.3;

/**
 * Where to put a window of size v on one axis to keep the most subjects whole, by weight.
 * Every useful position is tried: each subject's start, end and centre lined up with the window.
 */
function bestAlong(v, subs, axis, high) {
  const lo = (b) => (axis === 'x' ? b.x : b.y), size = (b) => (axis === 'x' ? b.w : b.h);
  const clamp = (a) => Math.min(1 - v, Math.max(0, a));
  const starts = new Set();
  for (const b of subs) {
    starts.add(clamp(lo(b)));
    starts.add(clamp(lo(b) + size(b) - v));
    starts.add(clamp(lo(b) + size(b) * (high ? HIGH : 0.5) - v / 2));
  }
  let best = null;
  for (const a of starts) {
    let score = 0, cx = 0, cw = 0;
    for (const b of subs) {
      const c = shown(a, v, lo(b), size(b));
      score += b.weight * (c >= 0.999 ? 1 : c <= 0.001 ? 0 : SLICE * (c - 1));
      if (c >= 0.999) { cx += b.weight * (lo(b) + size(b) * (high ? HIGH : 0.5)); cw += b.weight; }
    }
    // Among equally good windows, the one centred on what it keeps.
    const off = cw ? Math.abs(a + v / 2 - cx / cw) : 0;
    if (!best || score > best.score + 1e-9 || (Math.abs(score - best.score) <= 1e-9 && off < best.off)) best = { a, score, off };
  }
  return v >= 0.999 ? 0.5 : best.a / (1 - v);
}

/**
 * The crop that best shows a photo's subject in a frame of this shape.
 * @param {Photo} photo
 * @param {number} frameAspect
 * @returns {Crop}
 */
export function cropFor(photo, frameAspect) {
  const { vx, vy } = visible(photo.aspect, frameAspect);
  const subs = subjectsOf(photo);
  if (!subs.length) return { x: 0.5, y: round(along(vy, LEAN, LEAN, true)), zoom: 1 };
  // One subject, or all of them fitting: centre on the box round them.
  const u = unionOf(subs);
  const x = subs.length === 1 || u.w <= vx ? along(vx, u.x, u.x + u.w, false) : bestAlong(vx, subs, 'x', false);
  const y = subs.length === 1 || u.h <= vy ? along(vy, u.y, u.y + u.h, true) : bestAlong(vy, subs, 'y', true);
  return { x: round(x), y: round(y), zoom: 1 };
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
  const subs = subjectsOf(photo);
  if (!subs.length) return 0;
  const total = subs.reduce((a, b) => a + b.weight, 0) || 1;
  const cut = cutsOf(photo, frameAspect, crop).reduce((a, c, i) => a + (subs[i].weight / total) * c, 0);
  return cut < 1e-9 ? 0 : cut;
}

/** How much of each subject a crop leaves out (0: all of it shows), in subjectsOf order. */
export function cutsOf(photo, frameAspect, crop) {
  const { vx, vy } = visible(photo.aspect, frameAspect, crop.zoom);
  const ax = Math.min(1, vx), ay = Math.min(1, vy);
  return subjectsOf(photo).map((b) => {
    const c = 1 - Math.min(shown(crop.x * (1 - ax), ax, b.x, b.w), shown(crop.y * (1 - ay), ay, b.y, b.h));
    return c < 1e-9 ? 0 : c;
  });
}

/** How many subjects a crop keeps whole, cuts partway, and leaves out. */
export function keptOf(photo, frameAspect, crop) {
  const cuts = cutsOf(photo, frameAspect, crop);
  return { whole: cuts.filter((c) => c === 0).length, sliced: cuts.filter((c) => c > 0 && c < 0.999).length, out: cuts.filter((c) => c >= 0.999).length, total: cuts.length };
}

/** The weight of subjects a crop slices partway (not cleanly in or out): the worst thing a crop can do. */
function slicedWeight(photo, frameAspect, crop) {
  const subs = subjectsOf(photo);
  const total = subs.reduce((a, b) => a + b.weight, 0) || 1;
  return cutsOf(photo, frameAspect, crop).reduce((a, c, i) => a + (c > 0.05 && c < 0.95 ? subs[i].weight / total : 0), 0);
}

/** Whether a frame is still tight enough that a person should check it. */
export function isTight(photo, frameAspect, crop) {
  const subs = subjectsOf(photo);
  if (!subs.length) return lossOf(photo.aspect, frameAspect) > CHECK_LOSS;
  if (subs.length === 1) return cutOf(photo, frameAspect, crop) > CHECK_CUT;
  // Several: a subject that matters sliced partway, or most of the subjects lost.
  return slicedWeight(photo, frameAspect, crop) >= 0.15 || cutOf(photo, frameAspect, crop) > 0.35;
}

/**
 * How badly a photo sits in a frame of this shape, at its best crop. Losing background is cheap;
 * losing the subject is expensive.
 */
export function costOf(photo, frameAspect) {
  const loss = lossOf(photo.aspect, frameAspect);
  const subs = subjectsOf(photo);
  if (!subs.length) return loss;
  const crop = cropFor(photo, frameAspect);
  const cost = 0.4 * loss + 2 * cutOf(photo, frameAspect, crop);
  return subs.length === 1 ? cost : cost + 1.5 * slicedWeight(photo, frameAspect, crop);
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
