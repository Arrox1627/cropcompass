// Benchmark: node test/bench.mjs. On 1,000 synthetic photos with a known subject, how much of the
// subject survives when each photo is put in frames of other shapes, cropcompass against a plain
// centre crop, and how fast the subject box is found. Synthetic scenes have a clear subject on a
// plain background, so this is a best case for both methods; real photos are messier.
import { focusFrom, cropFor, centreCrop, cutOf } from '../src/index.js';
import { scene } from './synthetic.mjs';

const N = 1000;
const FRAMES = [0.8, 1, 1.25, 1.5, 0.667, 16 / 9]; // portrait, square, 5:4, 3:2, 2:3, 16:9
let centreKept = 0, focalKept = 0, centreWhole = 0, focalWhole = 0, pairs = 0, ms = 0;

for (let s = 1; s <= N; s++) {
  const { data, w, h, aspect, truth } = scene(s);
  const t0 = performance.now();
  const focus = focusFrom(data, w, h);
  ms += performance.now() - t0;
  for (const frame of FRAMES) {
    if (Math.abs(frame - aspect) < 0.05) continue; // no crop needed
    pairs++;
    // Judge both crops against the *true* subject, not the detected box.
    const judged = { aspect, focus: truth };
    const cCut = cutOf(judged, frame, centreCrop());
    const fCut = cutOf(judged, frame, cropFor({ aspect, focus }, frame));
    centreKept += 1 - cCut;
    focalKept += 1 - fCut;
    if (cCut === 0) centreWhole++;
    if (fCut === 0) focalWhole++;
  }
}

const pct = (v) => `${(v * 100).toFixed(1)}%`;
console.log(`${N} photos, ${pairs} photo-and-frame pairs\n`);
console.log('                          centre crop   cropcompass');
console.log(`subject kept, on average   ${pct(centreKept / pairs).padStart(9)}   ${pct(focalKept / pairs).padStart(9)}`);
console.log(`subject kept whole         ${pct(centreWhole / pairs).padStart(9)}   ${pct(focalWhole / pairs).padStart(9)}`);
console.log(`\nfinding the subject: ${(ms / N).toFixed(2)} ms a photo (96 px copy, Node ${process.version})`);
