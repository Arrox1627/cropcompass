// Tests: node test/test.mjs (no dependencies). The detail box finds the detail, crops keep it in
// view where a centre crop would lose it, and arrange() puts photos in the frames they suit.
import { focusFrom, cleanFocus, cropFor, centreCrop, cutOf, isTight, lossOf, arrange } from '../src/index.js';
import { image, scene } from './synthetic.mjs';

let fails = 0, passes = 0;
const ok = (cond, msg) => (cond ? passes++ : (fails++, console.log('FAIL', msg)));
const near = (a, b, t = 0.08) => Math.abs(a - b) <= t;
const sky = [150, 190, 230];

// ---- Stage 1: the subject box
{
  // A busy patch (a person, say) on plain sky, in the top-left third.
  const w = 96, h = 64;
  const d = image(w, h, (u, v, x, y) => (u > 0.1 && u < 0.35 && v > 0.15 && v < 0.6 ? ((x + y) % 2 ? [40, 30, 20] : [230, 200, 170]) : sky));
  const f = focusFrom(d, w, h);
  ok(f.x >= 0.05 && f.x + f.w <= 0.42, `patch box across ${f.x}–${f.x + f.w}`);
  ok(f.y >= 0.08 && f.y + f.h <= 0.68, `patch box down ${f.y}–${f.y + f.h}`);
}
{
  const f = focusFrom(image(80, 80, () => sky), 80, 80);
  ok(f.x === 0 && f.y === 0 && f.w === 1 && f.h === 1, 'a flat photo gives the whole photo');
}
{
  const f = focusFrom(image(80, 60, (_u, _v, x, y) => ((x * 7 + y * 3) % 5 < 2 ? [20, 90, 30] : [120, 200, 90])), 80, 60);
  ok(near(f.x + f.w / 2, 0.5, 0.1) && f.w > 0.45, `an evenly busy photo stays centred (${JSON.stringify(f)})`);
}
{
  // Every synthetic scene: the box's centre lands inside the true subject.
  let inside = 0;
  for (let s = 1; s <= 200; s++) {
    const { data, w, h, truth } = scene(s);
    const f = focusFrom(data, w, h);
    const cx = f.x + f.w / 2, cy = f.y + f.h / 2;
    if (cx >= truth.x && cx <= truth.x + truth.w && cy >= truth.y && cy <= truth.y + truth.h) inside++;
  }
  ok(inside >= 196, `box centre inside the subject in ${inside}/200 scenes`);
}
ok(cleanFocus({ x: 0.2, y: 0.1, w: 0.9, h: 0.3 })?.w === 0.8, 'cleanFocus trims a box running off the photo');
ok(cleanFocus({ x: -1, y: 0, w: 1, h: 1 }) === undefined && cleanFocus('x') === undefined, 'cleanFocus refuses nonsense');

// ---- Stage 2: the crop
{
  // A landscape photo in a portrait frame, its subject on the left: the window moves left and keeps it.
  const photo = { aspect: 1.5, focus: { x: 0.08, y: 0.2, w: 0.22, h: 0.6 } };
  const c = cropFor(photo, 0.8);
  ok(c.x < 0.2, `subject on the left pulls the crop left (${c.x})`);
  ok(cutOf(photo, 0.8, c) === 0, 'and keeps all of it');
  ok(cutOf(photo, 0.8, centreCrop()) > 0.5, 'where the centre crop would have lost most of it');
}
{
  // A portrait photo in a wide frame, its subject low: the window moves down to it.
  const photo = { aspect: 0.75, focus: { x: 0.3, y: 0.55, w: 0.4, h: 0.3 } };
  const c = cropFor(photo, 1.6);
  ok(c.y > 0.6 && cutOf(photo, 1.6, c) === 0, `a low subject pulls the crop down and keeps it (${c.y})`);
}
{
  const c = cropFor({ aspect: 0.75 }, 1.5);
  ok(c.x === 0.5 && c.y < 0.5 && c.y > 0.3, `no box: centred across, leaning up (${c.y})`);
  ok(cropFor({ aspect: 1.5 }, 1.5).y === 0.5, 'a photo that fits its frame is not moved');
}
ok(lossOf(1.5, 1.5) === 0 && near(lossOf(1.5, 0.75), 0.5, 1e-9), 'lossOf: what a frame shape throws away');
ok(isTight({ aspect: 1.8 }, 0.7, centreCrop()) && !isTight({ aspect: 1.4 }, 1.5, centreCrop()), 'tight without a box: by how much is lost');

// ---- Stage 3: arrange
{
  // A wide photo and a tall photo, offered a tall frame and a wide frame in the wrong order: they swap.
  const wide = { id: 'wide', aspect: 1.6, focus: { x: 0.05, y: 0.3, w: 0.2, h: 0.4 } };
  const tall = { id: 'tall', aspect: 0.7, focus: { x: 0.3, y: 0.05, w: 0.4, h: 0.3 } };
  const r = arrange([wide, tall], [{ aspect: 0.75, area: 1 }, { aspect: 1.5, area: 1 }]);
  ok(r.cells[0].photo.id === 'tall' && r.cells[1].photo.id === 'wide', 'each photo goes to the frame of its own shape');
  ok(r.cells.every((c) => !c.check), 'and neither needs a check');
}
{
  // A starred photo keeps the biggest frame even when it costs a little more.
  const a = { id: 'a', aspect: 1.5, starred: true };
  const b = { id: 'b', aspect: 0.75 };
  const r = arrange([a, b], [{ aspect: 0.75, area: 10 }, { aspect: 1.5, area: 1 }]);
  ok(r.cells[0].photo.id === 'a', 'a starred photo keeps the largest frame');
}
{
  // Six photos, six frames: the search finishes and every photo is placed once.
  const photos = Array.from({ length: 6 }, (_, i) => ({ id: 'p' + i, aspect: [1.5, 0.75, 1][i % 3] }));
  const frames = Array.from({ length: 6 }, (_, i) => ({ aspect: [0.8, 1.6, 1][i % 3], area: 6 - i }));
  const r = arrange(photos, frames);
  ok(new Set(r.cells.map((c) => c.photo.id)).size === 6, 'six photos, six frames, each placed once');
}

console.log(`${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
