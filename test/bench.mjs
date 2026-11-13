// Benchmark: node test/bench.mjs. On 1,000 synthetic photos with a known subject, how much of the
// subject survives when each photo is put in frames of other shapes, cropcompass against a plain
// centre crop, and how fast the subject box is found. Synthetic scenes have a clear subject on a
// plain background, so this is a best case for both methods; real photos are messier.
import { focusFrom, subjectsFrom, cropFor, centreCrop, cutOf, cutsOf } from '../src/index.js';
import { scene, sceneMulti } from './synthetic.mjs';

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

// ---- Several subjects: 1,000 photos with 2 or 3 subjects each. Each crop is judged on the *true*
// subjects: how many it keeps whole, and how many it slices partway (the worst outcome).
{
  let pairs = 0, subjects = 0, ms = 0;
  const tally = { centre: { whole: 0, sliced: 0 }, one: { whole: 0, sliced: 0 }, many: { whole: 0, sliced: 0 }, best: { whole: 0, sliced: 0 } };
  for (let s = 1; s <= N; s++) {
    const { data, w, h, aspect, truths } = sceneMulti(s);
    const t0 = performance.now();
    const subs = subjectsFrom(data, w, h);
    ms += performance.now() - t0;
    const focus = focusFrom(data, w, h);
    const judged = { aspect, subjects: truths.map((t) => ({ ...t, weight: 1 })) };
    for (const frame of FRAMES) {
      if (Math.abs(frame - aspect) < 0.05) continue;
      pairs++;
      subjects += truths.length;
      const crops = { centre: centreCrop(), one: cropFor({ aspect, focus }, frame), many: cropFor({ aspect, subjects: subs }, frame), best: cropFor(judged, frame) };
      for (const [k, crop] of Object.entries(crops)) {
        const cuts = cutsOf(judged, frame, crop);
        tally[k].whole += cuts.filter((c) => c === 0).length;
        tally[k].sliced += cuts.filter((c) => c > 0.05 && c < 0.95).length;
      }
    }
  }
  console.log(`\n${N} photos with 2 or 3 subjects, ${pairs} photo-and-frame pairs, ${subjects} subjects\n`);
  // "Knowing the truth" crops on the true subjects: the most any crop can keep, since a frame often can't hold them all.
  console.log('                          centre crop   one subject   several subjects   knowing the truth');
  const row = (label, key) => console.log(`${label}${pct(tally.centre[key] / subjects).padStart(9)}   ${pct(tally.one[key] / subjects).padStart(11)}   ${pct(tally.many[key] / subjects).padStart(16)}   ${pct(tally.best[key] / subjects).padStart(17)}`);
  row('subjects kept whole       ', 'whole');
  row('subjects sliced partway   ', 'sliced');
  console.log(`\nfinding the subjects: ${(ms / N).toFixed(2)} ms a photo`);
}
