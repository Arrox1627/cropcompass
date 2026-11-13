// Optional: faces as subjects, from a small machine-learning face detector.
//
// Edges and colour (focus.js, subjects.js) can't tell two people apart when they stand close
// together on a busy background: the detail runs straight from one to the other. A face detector
// knows what a face looks like, so every face found becomes its own subject, widened to head and
// shoulders. Anything else that stands out and isn't a person (a dog, a boat, a cake) is still
// found by subjects.js and kept alongside, at a lower weight.
//
// The detector is Google's MediaPipe BlazeFace (Apache 2.0), run in the browser on WebAssembly.
// Nothing here loads until loadFaceDetector() is called: the core library stays dependency-free.
// First use downloads the runtime (about 9 MB) and the model (230 KB); the browser caches both
// after that. Photos are analysed on the device and never uploaded.

/** @typedef {{ x: number, y: number, w: number, h: number, weight: number }} Subject */
/** @typedef {{ originX: number, originY: number, width: number, height: number }} PixelBox  as MediaPipe gives it */

/** The MediaPipe Tasks runtime, pinned. */
export const FACE_RUNTIME = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';

/**
 * The face model: BlazeFace short range, the one MediaPipe Tasks runs. (The full-range model's
 * anchors don't match this runtime's face detector, so it can't be swapped in.)
 */
export const FACE_MODELS = {
  short: 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',
};

/**
 * The model sees the photo at 128 × 128, so a face a few metres away is too small for it. It's
 * also run on overlapping tiles (2 × 2, 3 × 3 and 4 × 4 grids, each tile enlarged), and duplicates are
 * merged, so distant faces in couple and group photos are found too.
 */
export const TILE_GRIDS = [1, 2, 3, 4];
/** Smaller tiles make the model guess more, so each grid needs more confidence (measured on real photos: real faces 0.72 and up in 4 × 4 tiles, mistakes 0.56 and below). */
const MIN_SCORE = { 1: 0.5, 2: 0.55, 3: 0.62, 4: 0.7 };
/** How much neighbouring tiles overlap, as a share of a tile. */
const TILE_OVERLAP = 0.25;

/** How much two boxes overlap: intersection over union. */
function iou(a, b) {
  const x = Math.max(0, Math.min(a.originX + a.width, b.originX + b.width) - Math.max(a.originX, b.originX));
  const y = Math.max(0, Math.min(a.originY + a.height, b.originY + b.height) - Math.max(a.originY, b.originY));
  const inter = x * y;
  return inter / (a.width * a.height + b.width * b.height - inter || 1);
}

/** Detections from overlapping views, merged: the most confident of each group that overlaps. */
export function mergeFaces(found, overlap = 0.3) {
  const kept = [];
  for (const f of [...found].sort((a, b) => b.score - a.score)) if (!kept.some((k) => iou(k, f) > overlap)) kept.push(f);
  return kept;
}

/** A face box widened to head and shoulders, as multiples of the face's own size. */
const SHOULDERS = { wide: 2.4, above: 0.6, tall: 3.2 };

/**
 * Faces (pixel boxes from a detector) as subjects: each widened to head and shoulders, weighted by
 * its size (a bigger face is nearer the camera and usually matters more).
 * @param {PixelBox[]} boxes
 * @param {number} width of the image the boxes are in
 * @param {number} height
 * @returns {Subject[]} heaviest first
 */
export function facesToSubjects(boxes, width, height) {
  const clamp = (v) => Math.min(1, Math.max(0, v));
  const subjects = boxes
    .filter((b) => b && b.width > 0 && b.height > 0)
    .map((b) => {
      const cx = b.originX + b.width / 2;
      const x0 = clamp((cx - (b.width * SHOULDERS.wide) / 2) / width);
      const x1 = clamp((cx + (b.width * SHOULDERS.wide) / 2) / width);
      const y0 = clamp((b.originY - b.height * SHOULDERS.above) / height);
      const y1 = clamp((b.originY - b.height * SHOULDERS.above + b.height * SHOULDERS.tall) / height);
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, weight: b.width * b.height };
    });
  const total = subjects.reduce((a, s) => a + s.weight, 0) || 1;
  const r = (v) => Math.round(v * 1000) / 1000;
  return subjects
    .map((s) => ({ x: r(s.x), y: r(s.y), w: r(s.w), h: r(s.h), weight: s.weight / total }))
    .sort((a, b) => b.weight - a.weight)
    .map((s) => ({ ...s, weight: r(s.weight) }));
}

/**
 * Faces and everything else together: every face, plus each subject from subjects.js that
 * doesn't overlap a face and holds at least `minOther` of its photo's detail (a pet, a boat, a
 * cake), at `others` of its weight. With no faces, the other subjects as they are.
 * @param {Subject[]} faces from facesToSubjects
 * @param {Subject[]} found from subjectsFrom
 * @param {{ others?: number, minOther?: number }} [options]
 * @returns {Subject[]}
 */
export function combineSubjects(faces, found, { others = 0.4, minOther = 0.15 } = {}) {
  if (!faces.length) return found;
  const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const extra = found.filter((s) => s.weight >= minOther && !faces.some((f) => overlaps(f, s))).map((s) => ({ ...s, weight: s.weight * others }));
  const all = [...faces, ...extra];
  const total = all.reduce((a, s) => a + s.weight, 0) || 1;
  const r = (v) => Math.round(v * 1000) / 1000;
  return all.map((s) => ({ ...s, weight: r(s.weight / total), ...(faces.includes(s) ? { face: true } : {}) })).sort((a, b) => b.weight - a.weight);
}

/**
 * Load the face detector (in a browser). Resolves once the runtime and model are ready.
 * @param {{ model?: 'short' | string, runtime?: string, minConfidence?: number }} [options]
 * @returns {Promise<{ detect: (image: HTMLImageElement | HTMLCanvasElement | ImageBitmap) => Subject[], close: () => void }>}
 */
export async function loadFaceDetector({ model = 'short', runtime = FACE_RUNTIME, minConfidence = 0.45 } = {}) {
  const { FilesetResolver, FaceDetector } = await import(/* @vite-ignore */ `${runtime}/vision_bundle.mjs`);
  const fileset = await FilesetResolver.forVisionTasks(`${runtime}/wasm`);
  const detector = await FaceDetector.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: FACE_MODELS[model] ?? model, delegate: 'CPU' },
    runningMode: 'IMAGE',
    minDetectionConfidence: minConfidence,
  });
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  return {
    /** Every face in the image, as head-and-shoulders subjects. `grids` picks the tilings (default 1, 2 and 3). */
    detect(image, { grids = TILE_GRIDS } = {}) {
      const width = image.naturalWidth ?? image.width;
      const height = image.naturalHeight ?? image.height;
      const found = [];
      for (const n of grids) {
        // Tiles n across and n down, overlapping, each drawn at up to 512 px on its long edge.
        const tw = width / (n - (n - 1) * TILE_OVERLAP), th = height / (n - (n - 1) * TILE_OVERLAP);
        for (let j = 0; j < n; j++)
          for (let i = 0; i < n; i++) {
            const sx = n === 1 ? 0 : i * tw * (1 - TILE_OVERLAP), sy = n === 1 ? 0 : j * th * (1 - TILE_OVERLAP);
            const k = Math.min(1, 512 / Math.max(tw, th));
            canvas.width = Math.round(tw * k);
            canvas.height = Math.round(th * k);
            ctx.drawImage(image, sx, sy, tw, th, 0, 0, canvas.width, canvas.height);
            for (const d of detector.detect(canvas).detections ?? []) {
              const b = d.boundingBox;
              const score = d.categories?.[0]?.score ?? 0;
              if (score < (MIN_SCORE[n] ?? 0.75)) continue;
              found.push({ originX: sx + b.originX / k, originY: sy + b.originY / k, width: b.width / k, height: b.height / k, score });
            }
          }
      }
      return facesToSubjects(mergeFaces(found), width, height);
    },
    close: () => detector.close(),
  };
}
