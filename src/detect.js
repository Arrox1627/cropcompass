// Optional: people and things as subjects, from a small machine-learning object detector.
//
// Edges and colour (focus.js, subjects.js) can't tell two people apart when they stand close
// together on a busy background: the detail runs straight from one to the other. An object
// detector knows what a person looks like from any side (facing away, in profile, half hidden),
// and what a dog, a boat or a bike looks like. Each one it finds becomes its own subject. Furniture
// and other background things it recognises (a couch, a chair, a shelf of books) are ignored.
// Anything else that stands out is still found by subjects.js and kept alongside, at a lower weight.
//
// The detector is EfficientDet-Lite2 (trained on COCO's 80 everyday categories), run by Google's
// MediaPipe in the browser on WebAssembly. Nothing here loads until loadSubjectDetector() is called:
// the core library stays dependency-free. First use downloads the runtime (about 9 MB) and the
// model (about 7.5 MB); the browser caches both after that. Photos are analysed on the device and
// never uploaded.

/** @typedef {{ x: number, y: number, w: number, h: number, weight: number, kind?: string }} Subject */
/** @typedef {{ categoryName: string, score: number, box: { originX: number, originY: number, width: number, height: number } }} Detection */

/** The MediaPipe Tasks runtime, pinned. */
export const DETECT_RUNTIME = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';

/** The model: EfficientDet-Lite2, 8-bit. (Lite0 is smaller and faster but missed people seen from behind.) */
export const DETECT_MODEL = 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite2/int8/1/efficientdet_lite2.tflite';

/**
 * What counts as a subject, and how much: people first, then animals, then things people
 * photograph on purpose. Anything not listed (furniture, cups, bottles, plants) is background.
 */
export const KINDS = {
  person: 1,
  ...Object.fromEntries(['dog', 'cat', 'bird', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe'].map((k) => [k, 0.8])),
  ...Object.fromEntries(['boat', 'bicycle', 'motorcycle', 'car', 'airplane', 'train', 'bus', 'truck', 'kite', 'surfboard', 'skateboard', 'skis', 'snowboard'].map((k) => [k, 0.5])),
  ...Object.fromEntries(['cake', 'pizza', 'teddy bear', 'umbrella', 'sports ball', 'frisbee', 'guitar'].map((k) => [k, 0.4])),
};

/** The confidence a detection needs: measured on real photos (a person seen from behind scored 0.65; mistakes stayed under 0.45). */
export const MIN_SCORE = 0.45;

/** Of a person, the part that matters in a crop: head to hips (the top 65% of the body), at least as tall as it is wide. */
const PERSON_KEEP = 0.65;

/**
 * Detections (pixel boxes from the detector) as subjects: only the kinds in KINDS, a person cut to
 * head and hips, each weighted by its kind, its confidence and its size (nearer usually matters more).
 * @param {Detection[]} detections
 * @param {number} width of the image the boxes are in
 * @param {number} height
 * @returns {Subject[]} heaviest first
 */
export function detectionsToSubjects(detections, width, height) {
  const subjects = [];
  for (const d of detections) {
    const kind = KINDS[d.categoryName];
    if (!kind || d.score < MIN_SCORE || !(d.box?.width > 0) || !(d.box?.height > 0)) continue;
    let { originX: x, originY: y, width: w, height: h } = d.box;
    if (d.categoryName === 'person') h = Math.min(h, Math.max(w, h * PERSON_KEEP));
    const fx = Math.max(0, x / width), fy = Math.max(0, y / height);
    const fw = Math.min(1 - fx, w / width), fh = Math.min(1 - fy, h / height);
    subjects.push({ x: fx, y: fy, w: fw, h: fh, weight: kind * d.score * Math.sqrt(fw * fh), kind: d.categoryName });
  }
  const total = subjects.reduce((a, s) => a + s.weight, 0) || 1;
  const r = (v) => Math.round(v * 1000) / 1000;
  return subjects
    .sort((a, b) => b.weight - a.weight)
    .map((s) => ({ x: r(s.x), y: r(s.y), w: r(s.w), h: r(s.h), weight: r(s.weight / total), kind: s.kind }));
}

/**
 * Detected subjects and everything else together: every detected subject, plus each subject from
 * subjects.js that doesn't overlap one and holds at least `minOther` of its photo's detail, at
 * `others` of its weight. With nothing detected, the other subjects as they are.
 * @param {Subject[]} detected from detectionsToSubjects (or detector.detect)
 * @param {Subject[]} found from subjectsFrom
 * @param {{ others?: number, minOther?: number }} [options]
 * @returns {Subject[]}
 */
export function combineSubjects(detected, found, { others = 0.4, minOther = 0.15 } = {}) {
  if (!detected.length) return found;
  const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const extra = found.filter((s) => s.weight >= minOther && !detected.some((f) => overlaps(f, s))).map((s) => ({ ...s, weight: s.weight * others }));
  const all = [...detected, ...extra];
  const total = all.reduce((a, s) => a + s.weight, 0) || 1;
  const r = (v) => Math.round(v * 1000) / 1000;
  return all.map((s) => ({ ...s, weight: r(s.weight / total) })).sort((a, b) => b.weight - a.weight);
}

/**
 * Load the detector (in a browser). Resolves once the runtime and model are ready.
 * @param {{ model?: string, runtime?: string }} [options]
 * @returns {Promise<{ detect: (image: HTMLImageElement | HTMLCanvasElement | ImageBitmap) => Subject[], close: () => void }>}
 */
export async function loadSubjectDetector({ model = DETECT_MODEL, runtime = DETECT_RUNTIME } = {}) {
  const { FilesetResolver, ObjectDetector } = await import(/* @vite-ignore */ `${runtime}/vision_bundle.mjs`);
  const fileset = await FilesetResolver.forVisionTasks(`${runtime}/wasm`);
  const detector = await ObjectDetector.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: model, delegate: 'CPU' },
    runningMode: 'IMAGE',
    scoreThreshold: MIN_SCORE,
    maxResults: 25,
  });
  return {
    /** Every person and thing worth keeping in view, as subjects, heaviest first. */
    detect(image) {
      const width = image.naturalWidth ?? image.width;
      const height = image.naturalHeight ?? image.height;
      const found = (detector.detect(image).detections ?? []).map((d) => ({
        categoryName: d.categories?.[0]?.categoryName ?? '',
        score: d.categories?.[0]?.score ?? 0,
        box: d.boundingBox,
      }));
      return detectionsToSubjects(found, width, height);
    },
    close: () => detector.close(),
  };
}
