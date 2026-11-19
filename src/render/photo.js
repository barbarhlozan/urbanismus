// Photo mode: the town seen by someone standing on the map, drawn with the
// same pen as the map. takePhoto() returns a standalone <svg> string.
//
// Everything draws through a PerspectiveCamera (perspective.js): the
// structures, trees and street lamps with their own draw code (the
// renderer's paint* functions) – the shadows they cast only with
// PHOTO.shadows –, the roads, footpaths, fences and railways with the
// renderer's ink items; deer, cows and sheep as the map's figures.
//
// The ground is solid: it is cut into bands across the view, each a little
// further than the last, filled with paper and carrying its own marks
// (pencil strokes, ripples, meadow tufts, lot drawing, roads). Bands and
// solids are drawn together far to near, so a hill hides what is behind it.
// Past the last band a skyline of the terrain closes the picture. Lakes
// and rivers are flat: the ground under the water is drawn at its surface
// (waterSurface), its edge a firm line (shoreLines). Mist (render/mist.js)
// is flat too: paper at its top over each band where the ground is under
// it, nearer than what stands on that band, so it hides the ground and
// cuts what stands in it (photoMist).

import { PerspectiveCamera } from './perspective.js';
import { flattenPath } from './gl/geometry.js';
import { meadowGround, plant } from './meadow.js';
import { mulberry32 } from '../core/random.js';
import { freeTest } from './lots.js';
import { centerOf } from './renderer/shared.js';
import { BRIDGE } from './bridges.js';
import { VEHICLES, vehicleSVGIn, modelFor, truckFor } from './vehicles.js';
import { signsAt, signSVGIn, flashSVGIn, litLight } from './crossings.js';
import { wobble } from './painter.js';
import { sunFor, shadowSVG } from './shadows.js';
import { cloudsSVG, rainSVG } from './clouds.js';
import { DEER, deerSVG } from './deer.js';
import { LIVESTOCK, livestockSVG } from './livestock.js';
import { PEOPLE, bodyFor, walkerSVG, cyclistSVG } from './people.js';
import { smokeSVG } from './particles.js';

export const PHOTO = {
  width: 480,
  height: 320,
  eye: 0.12,     // eye height in grid units (a storey is about 0.15):
                 // a little above a person's, for a bit more overview
  // where the horizon is, as a share of the picture's height from the top:
  // a little below the middle, as a shifted lens puts it, so the town has
  // more of the picture and the bare ground in front less
  horizon: 0.58,
  // The map's relief (warp.js makeLift) is made to be read from above; seen
  // from someone's eyes its rises and dips close by hide the feet of the
  // houses behind them, and they seem to sit on top of the picture rather
  // than on the ground. Around the photographer it is flattened to `near`
  // of itself, coming back to `far` of it from `from` to `to` steps away,
  // so the hills further off still stand.
  relief: { near: 0.4, far: 0.9, from: 2, to: 12 },
  range: 28,     // how far anything is drawn, in grid steps
  clear: 0.3,    // solids closer than this to the photographer are left out,
  trees: 1.4,    // trees and shrubs closer than this (they would be a blob filling the frame)
  // trees (and all else drawn facing the eye) this many times as big as on
  // the map: there they are drawn big to read from above, and seen from the
  // street they towered over the houses
  treeSize: 0.6,
  lamps: 0.8,    // street lamps closer than this (only a piece of the head
                 // would be in the picture, a dark bar along its top edge)
  lots: 1,       // lot drawing on the ground (beds, paving, benches' feet) closer than this
  tuft: 2,       // meadow tufts nearer than this are drawn as big as they would be here,
                 // and the tufts lots draw (kit.js tufts) left out
  // ground bands: from `near` out to `far`, each `step` times further than
  // the last; a solid standing up to `margin` behind a band's far edge is
  // still drawn over it (it stands on it)
  bands: { near: 0.1, far: 20, step: 1.09, margin: 0.35 },
  // mist (photoMist): sampled in `cols` columns across the picture; a
  // photographer standing in it sees only `sight` steps; its far shore in
  // lobes about `lobe` px long, `rise` times as long as high
  mist: { cols: 120, sight: 1.6, lobe: 22, rise: 5 },
  meadow: 12,    // how far the meadow tufts reach
  // line weight by distance, as in a sketch: a little heavier in front,
  // lighter far off – but not by much, as one pen draws the whole picture
  // and the hand only presses less. Lines are drawn with the pens as written
  // (styles.css) `at` steps away, `per` times heavier for every halving of
  // the distance and lighter for every doubling, from `min` to `max` times
  // (in eighths of a doubling, so neighbours share a group). Texture
  // (hatching, windows, grass: --fine in styles.css) only ever gets
  // lighter, so up close it stays fine.
  weight: { at: 2, per: 1.15, min: 0.7, max: 1.35 },
  // …and all of them `pen` times as heavy: a photo is drawn 480 px wide and
  // shown half as wide again (the print, styles.css .photo-print), which
  // would make its lines that much heavier than the map's; so they look
  // about as fine on the print as the map's do on the screen
  pen: 0.65,
  // the pencil strokes: `gap` px apart along a band, about `len` px long;
  // nearer than `blank` steps only one in `sparse` of them (and of the
  // ripples), so the foreground is left mostly bare
  hatch: { gap: 30, len: 16, blank: 1.2, sparse: 4 },
  // …or, `on`, upright: short strokes standing up off the ground, as blades
  // of grass `blade` steps high would on the picture (no shorter than `min`
  // px, no taller than `max`), each its own height, leaning by up to `lean`
  // of it and bent by up to `bend`, now and then two or three from one spot
  // (`tuft` of the time); `gap` px apart along a band
  upright: { on: true, gap: 16, blade: 0.025, min: 1.5, max: 9, lean: 0.5, bend: 0.25, tuft: 0.3 },
  // the ripples on the water: small waves about `len` px long `at` steps
  // away, shorter further off (down to `min` times) and longer up close (up
  // to `max` times), as high as `rise` of their length there – and flatter
  // as they go off, as the water is seen ever more edge on, till far out
  // they are level strokes. A share `skip` of the places for them left out
  ripples: { len: 18, at: 2, min: 0.45, max: 1.4, rise: 0.09, skip: 0.75 },
  // a street's kerb right in front, nearer than `reach` steps: its top
  // edge (`kerb` high) with the joints between its stones
  ground: { reach: 1.6, kerb: 0.006, stone: 0.05 },
  // the shadows things cast on the ground: seen from someone's eyes they lie
  // nearly edge on, and close in to a wall draw a dark band along its foot,
  // the very line the walls are drawn without – so a photo has none
  shadows: false,
  // How a photo is framed (framePhoto): the player says only where they
  // stand and which way they look, and the picture is composed as a drawing
  // is. Its subject is the buildings looked at – those within the wedge of
  // the aim, up to `reach` steps past the point aimed at (or out to `depth`
  // with no point), and the one aimed at. How much it takes in goes by how
  // far off the nearest houses ahead are: standing among them (`near`
  // steps or closer) the wedge is `wedge[0]` degrees either side and the
  // lens up to `long[0]` mm, a picture of a house or two; standing off
  // (`far` steps and more) it is `wedge[1]`, reaching `reach[1]` past the
  // aim, and the lens no longer than `long[1]` – the whole village in its
  // landscape. The lens is the longest, from `wide` mm up to that, that has
  // them all whole, clear of the sides by `side` of the width (where the
  // drawing fades out) and of the top by `top` of the height; the view
  // turns by up to `turn` degrees to have them in the middle. Where even
  // the widest doesn't take them, the photographer steps back, `back` at a
  // time, up to `away` steps. With nothing looked at, the lens is `none` mm.
  // Anything else the sides or the top would cut through is left out of the
  // picture altogether: a drawing leaves paper there, it doesn't saw a
  // house in half.
  frame: {
    near: 2, far: 9, wedge: [16, 26], reach: [2, 6], long: [50, 32], depth: 14,
    wide: 28, side: 0.12, top: 0.08, turn: 10, back: 0.5, away: 6, none: 35,
  },
};

// a lens's horizontal angle of view (degrees) across the 36 mm frame
const fovOf = (mm) => (2 * Math.atan(18 / mm) * 180) / Math.PI;

const r2 = (n) => Math.round(n * 100) / 100;
// a tree's, a shrub's or a hedge's drawing (features/trees.js, kit.js),
// a lot's grass tuft (kit.js)
const TREE = /class="[^"]*\b(tree|crown-line|leaf|hedge)\b/;
const TUFT = /class="[^"]*\btuft\b/;
const pt = (p) => `${r2(p[0])} ${r2(p[1])}`;
// how ink items are layered, back to front (as on the map)
const NET_ORDER = ['photo-shore', 'footpath', 'fence-post', 'fence-pillar', 'fence', 'grave', 'grave-stone', 'wall-stone', 'wall', 'wall-cap', 'track-bed', 'track-sleeper', 'track-rail', 'track-exit', 'rail-buffer', 'driveway', 'road', 'kerb', 'zebra', 'road-exit', 'bridge', 'bridge-post'];

// What a thing draws above the ground through camera `cam` (`paint(cam)`
// draws it): `out`, as it was drawn, and each point it drew there, as
// `seen(screen point, world point lifted)` is told of it.
function tracing(cam, terrain, paint, seen) {
  const rec = Object.create(cam);
  rec.project = (px, py, pz, at, liftAt = at) => {
    const p = cam.project(px, py, pz, at, liftAt);
    if (pz - terrain.heightAt(px, py) > 0.01) seen(p, px, py, pz + (cam.lift ? cam.lift(...(liftAt ?? [px, py])) : 0));
    return p;
  };
  return paint(rec);
}

// Where drawn solids lie on the picture: [x0, y0, x1, y1] of the points of
// their drawing (as the painters wrote it, in picture px).
const SHAPE = /\b(d|points)="([^"]*)"/g;
function boxOf(solids) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  const grow = (x, y) => {
    if (x < b[0]) b[0] = x;
    if (y < b[1]) b[1] = y;
    if (x > b[2]) b[2] = x;
    if (y > b[3]) b[3] = y;
  };
  for (const so of solids) {
    for (const [, kind, v] of so.parts.join('').matchAll(SHAPE)) {
      if (kind === 'points') {
        const n = v.trim().split(/[\s,]+/).map(Number);
        for (let i = 0; i + 1 < n.length; i += 2) grow(n[i], n[i + 1]);
      } else for (const { pts } of flattenPath(v, 1)) for (const [x, y] of pts) grow(x, y);
    }
  }
  return b;
}

// The photo's framing (PHOTO.frame) for a shot { x, y, yaw, at? } (`at`:
// the point aimed at): { x, y, yaw, fov, subject } – where the photographer
// stands for it, the way they look, the lens's angle (degrees) and the ids
// of the buildings it is of. `memo` (a Map) keeps the buildings' outlines
// between calls, for aiming: the cone on the map shows the framing.
export function framePhoto(renderer, shot, memo = null) {
  const F = PHOTO.frame;
  const { world } = renderer;
  const { terrain } = world;
  const { x, y, yaw, at = null } = shot;
  const { width: W, height: H } = PHOTO;
  const fx = Math.cos(yaw), fy = Math.sin(yaw);
  const lift = photoLift(renderer.camera.lift, x, y);
  const ground = (px, py) => terrain.heightAt(px, py) + (lift ? lift(px, py) : 0);
  // how far off the nearest houses ahead are: 0 among them … 1 off
  let d0 = Infinity;
  const view = (fovOf(F.wide) * Math.PI) / 360;
  for (const s of world.structures.values()) {
    const [cx, cy] = centerOf(world, s);
    const dx = cx - x, dy = cy - y, ahead = dx * fx + dy * fy;
    if (ahead >= PHOTO.clear && Math.abs(Math.atan2(dy * fx - dx * fy, ahead)) <= view) d0 = Math.min(d0, Math.hypot(dx, dy));
  }
  const u = Math.min(1, Math.max(0, (d0 - F.near) / (F.far - F.near))), off = u * u * (3 - 2 * u);
  const mix = ([a, b]) => a + (b - a) * off;
  const reach = at ? Math.hypot(at[0] - x, at[1] - y) + mix(F.reach) : F.depth;
  const wedge = (mix(F.wedge) * Math.PI) / 180, long = mix(F.long);
  let probe = null;
  const subject = new Set(), pts = [];
  // the buildings looked at – or, aimed between them, the nearest one in
  // the picture's middle
  const looked = [], near = [];
  for (const s of world.structures.values()) {
    const [cx, cy] = centerOf(world, s);
    const dx = cx - x, dy = cy - y, ahead = dx * fx + dy * fy, aside = Math.abs(Math.atan2(dy * fx - dx * fy, ahead));
    const aimed = at && world.nodesOf(s).some((n) => { const [nx, ny] = world.grid.xy(n); return Math.hypot(nx - at[0], ny - at[1]) < 0.75; });
    if (aimed || (ahead >= PHOTO.clear && ahead <= reach && aside <= wedge)) looked.push(s);
    else if (ahead >= PHOTO.clear && ahead <= F.depth && aside <= (fovOf(F.none) * Math.PI) / 360) near.push([Math.hypot(dx, dy), s]);
  }
  if (!looked.length && near.length) looked.push(near.sort((a, b) => a[0] - b[0])[0][1]);
  for (const s of looked) {
    // its outline: the points it draws above the ground, from here
    const key = `${s.id}:${Math.round(x)},${Math.round(y)}`;
    let hull = memo?.get(key);
    if (!hull) {
      probe ??= new PerspectiveCamera({ x, y, z: ground(x, y) + PHOTO.eye, yaw, fov: 60, width: W, height: H, lift, horizon: PHOTO.horizon, shapes: PHOTO.treeSize });
      const seen = new Set();
      hull = [];
      tracing(probe, terrain, (cam) => renderer.paintStructure(s, cam), (p, px, py, pz) => {
        const k = `${Math.round(px * 50)},${Math.round(py * 50)},${Math.round(pz * 50)}`;
        if (!seen.has(k)) { seen.add(k); hull.push([px, py, pz]); }
      });
      // (only buildings: what stands on the ground, not a park or a square)
      if (!hull.some((p) => p[2] - ground(p[0], p[1]) > 0.06)) hull = [];
      memo?.set(key, hull);
    }
    if (!hull.length) continue;
    subject.add(s.id);
    pts.push(...hull);
  }
  if (!pts.length) return { x, y, yaw, fov: fovOf(F.none), subject };

  const focalOf = (mm) => W / 2 / Math.tan((fovOf(mm) * Math.PI) / 360);
  const longest = focalOf(long), widest = focalOf(F.wide);
  const horizon = H * PHOTO.horizon, turnMax = (F.turn * Math.PI) / 180;
  let best = null;
  for (let back = 0; back <= F.away + 1e-9; back += F.back) {
    const ex = x - fx * back, ey = y - fy * back, ez = ground(ex, ey) + PHOTO.eye;
    // each point's angle off the aim, how far off it is and how high
    let lo = Infinity, hi = -Infinity;
    const ang = [];
    for (const [px, py, pz] of pts) {
      const dx = px - ex, dy = py - ey, a = dx * fx + dy * fy;
      if (a < 0.15) { lo = NaN; break; }
      const t = Math.atan2(dy * fx - dx * fy, a);
      lo = Math.min(lo, t);
      hi = Math.max(hi, t);
      ang.push([t, Math.hypot(dx, dy), pz - ez]);
    }
    if (Number.isNaN(lo)) continue;
    const turn = Math.max(-turnMax, Math.min(turnMax, (lo + hi) / 2));
    const span = Math.max(hi - turn, turn - lo);
    if (span >= Math.PI / 2 - 0.05) continue;
    let up = 0;
    for (const [t, r, v] of ang) up = Math.max(up, v / Math.max(0.05, r * Math.cos(t - turn)));
    const focal = Math.min(longest, ((W / 2) * (1 - 2 * F.side)) / Math.tan(span), up > 0 ? (horizon - F.top * H) / up : Infinity);
    best = { x: ex, y: ey, yaw: yaw + turn, fov: (2 * Math.atan(W / 2 / Math.max(focal, widest)) * 180) / Math.PI, subject };
    if (focal >= widest) break;
  }
  return best ?? { x, y, yaw, fov: fovOf(F.wide), subject };
}

// shot: { x, y, yaw (radians), at? (the point aimed at), eye? } – framed by
// framePhoto – or with its own fov (degrees) as it is
export function takePhoto(renderer, shot) {
  const { world } = renderer;
  const { terrain } = world;
  const base = renderer.camera;
  const { width, height, range } = PHOTO;
  const framed = shot.fov == null ? framePhoto(renderer, shot) : null;
  const { x, y, yaw, fov } = framed ?? shot;
  const subject = framed?.subject ?? new Set();
  const lift = photoLift(base.lift, x, y);
  const water = waterSurface(renderer, lift);
  const raise = water.raise;
  // height of the ground (or the water's surface) above the drawing's zero,
  // and a point of it on the picture
  const groundAt = (px, py) => terrain.heightAt(px, py) + (lift ? lift(px, py) : 0) + raise(px, py);
  const cam = new PerspectiveCamera({
    x, y, z: groundAt(x, y) + (shot.eye ?? PHOTO.eye), yaw, fov, width, height, lift, horizon: PHOTO.horizon, shapes: PHOTO.treeSize,
  });
  const onGround = (px, py) => cam.project(px, py, terrain.heightAt(px, py) + raise(px, py));

  // what could be in the picture: ahead, within the (slightly widened) view
  const spread = Math.tan(Math.min(89, fov / 2 + 8) * Math.PI / 180);
  const seen = (px, py, pad) => {
    const dx = px - x, dy = py - y;
    if (Math.hypot(dx, dy) > range + pad) return false;
    const ahead = dx * cam.fx + dy * cam.fy;
    if (ahead < -pad) return false;
    return Math.abs(dx * cam.rx + dy * cam.ry) <= Math.max(ahead, 0) * spread + pad * 1.5;
  };

  const bands = makeBands(cam, onGround);
  const bandAt = (px, py) => bands.of(cam.ahead(px, py));

  // ----- structures, trees, street lamps -----

  // the free-space test the painters use (set when the map draws its
  // objects; may not have happened yet right after loading)
  renderer.free ??= freeTest(world, renderer.config);
  const solids = [];
  const sun = sunFor(cam);
  const vents = [];
  const take = (out) => {
    if (!out) return;
    const { painter } = out;
    solids.push(...painter.solids);
    vents.push(...painter.vents);
    painter.ground.forEach((svg, i) => {
      const [gx, gy] = painter.groundAt[i];
      if (Math.hypot(gx - x, gy - y) >= PHOTO.lots) bands.add(bandAt(gx, gy), 'lots', svg);
    });
    // the shadow each of its shaded walls casts, on the ground band where
    // the wall stands, and each of its roofs, gables and trees, on the band
    // where it stands
    const project = painter.groundProjector();
    const put = (mx, my, shade) => {
      if (!PHOTO.shadows) return;
      const svg = Math.hypot(mx - x, my - y) >= PHOTO.clear ? shadowSVG({ ...shade, project }, sun) : '';
      if (svg) bands.add(bandAt(mx, my), 'lots', svg);
    };
    for (const f of painter.feet) put((f.a[0] + f.b[0]) / 2, (f.a[1] + f.b[1]) / 2, { feet: [f] });
    for (const c of painter.casts) {
      const [mx, my] = c.at ?? [c.pts.reduce((a, p) => a + p[0], 0) / c.pts.length, c.pts.reduce((a, p) => a + p[1], 0) / c.pts.length];
      put(mx, my, { casts: [c] });
    }
  };
  // drawn whole, or not at all: what the sides or the top of the picture
  // would cut through is left out (PHOTO.frame) – but never the subject
  const whole = (paint, keep = false) => {
    const out = paint(cam);
    if (!out || keep) return out;
    const [x0, y0, x1] = boxOf(out.painter.solids);
    return x0 < 0 || x1 > width || y0 < 0 ? null : out;
  };
  for (const s of world.structures.values()) {
    const nodes = world.nodesOf(s);
    if (seen(...centerOf(world, s), Math.sqrt(nodes.length) + 1.5)) take(whole((c) => renderer.paintStructure(s, c), subject.has(s.id)));
  }
  for (const f of world.features.values()) {
    if (seen(f.x, f.y, 0.6)) take(whole((c) => renderer.paintFeature(f, c)));
  }
  for (const key of world.sidewalks.keys()) {
    const [a] = key.split('-').map(Number);
    if (!seen(...world.grid.xy(a), 2)) continue;
    const out = whole((c) => renderer.paintStreet(key, c));
    if (out && Math.hypot(out.x - x, out.y - y) >= PHOTO.lamps) take(out);
  }

  // ----- roads, footpaths and railways -----

  // the renderer's ink items through this camera, each point carrying how
  // far ahead it is, so the lines can be cut up between the bands, and
  // whether it is up on a bridge (above the ground there)
  const deep = Object.create(cam);
  deep.project = (px, py, pz, at) => [...cam.project(px, py, pz, at), cam.ahead(px, py), pz - terrain.heightAt(px, py) > 0.01];
  let items;
  renderer.camera = deep;
  try {
    items = [...renderer.pathItems(), ...renderer.fenceItems(), ...renderer.wallItems(), ...renderer.railItems(), ...renderer.roadItems(false)];
  } finally {
    renderer.camera = base;
  }
  // railways as the track itself, as on the map close up (not its symbol);
  // items of several lines (sleepers) one by one; not the painted schemes'
  // washes along the roads' and paths' middles (the map's only)
  const SYMBOL = new Set(['rail', 'rail-dash', 'rail-exit', 'road-wash', 'path-wash']);
  items = items.filter((it) => !SYMBOL.has(it.cls)).flatMap((it) => (it.runs ? it.runs.map((pts) => ({ ...it, pts })) : [it]));
  // up on a bridge: each piece sorted on its own with the decks (below),
  // so the deck hides what is under it and not what is on it
  const raised = [];
  for (const { cls, pts } of items) {
    let run = [pts[0]], band = -1;
    for (let i = 1; i < pts.length; i++) {
      if (pts[i - 1][3] && pts[i][3]) {
        raised.push({ depth: -(pts[i - 1][2] + pts[i][2]) / 2 + 0.02, svg: `<path class="${cls}" d="M${pt(pts[i - 1])}L${pt(pts[i])}"/>` });
        if (run.length > 1) bands.line(band, cls, run);
        run = [pts[i]];
        band = -1;
        continue;
      }
      // the band of its nearer end: nearer bands (drawn later) never cover it
      const b = bands.of(Math.min(pts[i - 1][2], pts[i][2]));
      if (band >= 0 && b !== band) {
        bands.line(band, cls, run);
        run = [pts[i - 1]];
      }
      band = b;
      run.push(pts[i]);
    }
    if (band >= 0) bands.line(band, cls, run);
    if (cls === 'kerb') kerbTop(cam, bands, pts);
  }

  groundMarks(world, renderer.config, cam, bands, seen, onGround, water.wet);
  shoreLines(renderer, cam, bands, onGround);

  // ----- together, far to near -----

  // nothing the photographer is standing in or right against (a garden
  // tree, a fence) – it would fill the picture
  const layers = [];
  for (const so of solids) {
    const svg = so.parts.join('');
    const near = so.at ? Math.hypot(so.at[0] - x, so.at[1] - y) : Infinity;
    if (near <= PHOTO.clear || (near < PHOTO.trees && TREE.test(svg)) || (near < PHOTO.tuft && TUFT.test(svg))) continue;
    layers.push({ depth: so.depth, svg });
  }
  layers.push(...bands.layers(), ...photoMist(renderer, cam, bands.d), ...smoke(renderer, cam, vents), ...raised, ...bridgeDecks(renderer, cam, seen), ...vehicles(renderer, cam, seen), ...animals(renderer, cam, seen), ...people(renderer, cam, seen));
  layers.sort((a, b) => a.depth - b.depth);
  // each in the pen for its distance; neighbours in the same pen share a group
  let svg = '', open = null;
  for (const l of layers) {
    const k = penAt(l.dist ?? -l.depth);
    if (k !== open) {
      if (open !== null) svg += '</g>';
      svg += `<g style="--stroke: ${r2(k * PHOTO.pen)}; --fine: ${r2(Math.min(1, k) * PHOTO.pen)}">`;
      open = k;
    }
    svg += l.svg;
  }
  if (open !== null) svg += '</g>';

  return `<svg class="photo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="--sun: ${renderer.config.weather.sun[world.weather.kind] ?? 1}; --stroke: ${PHOTO.pen}">`
    + `<rect class="photo-sky" x="0" y="0" width="${width}" height="${height}"/>`
    + cloudsSVG(mulberry32(Math.imul(Math.round(x * 100), 83492791) ^ Math.imul(Math.round(y * 100), 2654435761) ^ world.seed), width, height, world.weather.kind, { horizon: cam.horizonY, rain: false })
    + skyline(cam, groundAt, range)
    + `<g class="layer-objects">${svg}</g>`
    // the rain, falling between the photographer and all of it
    + rainSVG(mulberry32(Math.imul(Math.round(x * 100), 40503) ^ Math.imul(Math.round(y * 100), 2246822519) ^ world.seed), width, height, world.weather.kind)
    + '</svg>';
}

// The mist (render/mist.js, Renderer.mistLevel): over each ground band, a
// strip of paper at the mist's top for each column where the ground there
// is under it, drawn after what stands on this band, which it cuts – and
// only above what nearer ground already covers (horizon).
// Its far shore, where the band behind is out of it, in lobes. Standing in
// it, the photographer sees only what is right by them.
function photoMist(renderer, cam, d) {
  const level = renderer.mistLevel;
  if (level == null) return [];
  const { terrain } = renderer.world;
  const lift = cam.lift;
  const { width, height } = cam;
  const { cols: COLS, sight, lobe, rise } = PHOTO.mist;
  if (cam.ez < level) {
    // paper over all but the nearest, and two drawn bands of it drifting
    // across (as kasumi: lobes along the top, a flat underside, a line inside)
    const rnd = mulberry32(Math.imul(Math.round(cam.ex * 100), 2654435761) ^ Math.round(cam.ey * 100));
    let bands = '';
    for (const [y, x0, x1] of [[height * (0.3 + rnd() * 0.1), -20, width * (0.5 + rnd() * 0.2)], [height * (0.5 + rnd() * 0.12), width * (0.3 + rnd() * 0.2), width + 20]]) {
      const h = 16 + rnd() * 8;
      let d = `M${pt([x0, y])}`;
      for (let x = x0; x < x1 - 1;) {
        const nx = Math.min(x1, x + 40 + rnd() * 50);
        d += `A${r2((nx - x) / 2)} ${r2((nx - x) / (6 + rnd() * 4))} 0 0 1 ${pt([nx, y + (rnd() - 0.5) * 2])}`;
        x = nx;
      }
      d += `A${r2(h / 2)} ${r2(h / 2)} 0 0 1 ${pt([x1, y + h])}L${pt([x0, y + h])}A${r2(h / 2)} ${r2(h / 2)} 0 0 1 ${pt([x0, y])}Z`;
      const ia = x0 + (x1 - x0) * (0.15 + rnd() * 0.1), ib = x1 - (x1 - x0) * (0.15 + rnd() * 0.15);
      bands += `<path class="mist" d="${d}"/><path class="mist-line" d="${d}"/><path class="mist-inner" d="M${pt([ia, y + 5])}L${pt([ib, y + 5])}"/>`;
    }
    return [{ depth: -sight, dist: sight, svg: `<g class="mist-veil"><rect class="mist" x="-4" y="-4" width="${width + 8}" height="${height + 8}"/>${bands}</g>` }];
  }
  const ground = (x, y) => terrain.heightAt(x, y) + (lift ? lift(x, y) : 0);
  const spread = (width / 2 / cam.focal) * 1.15;
  const us = Array.from({ length: COLS + 1 }, (_, i) => -spread + (2 * spread * i) / COLS);
  const mid = us.slice(0, COLS).map((u, i) => (u + us[i + 1]) / 2);
  const at = (u, t) => [cam.ex + cam.fx * t + cam.rx * u * t, cam.ey + cam.fy * t + cam.ry * u * t];
  const up = (u, t, h) => { const [x, y] = at(u, t); return cam.project(x, y, h - (lift ? lift(x, y) : 0)); };
  const n = d.length - 1;
  // per band and column: the ground there, and whether it is under the mist
  const g = Array.from({ length: n }, (_, k) => mid.map((u) => ground(...at(u, (d[k] + d[k + 1]) / 2))));
  const wet = g.map((row) => row.map((h) => h < level));
  // Going out from the photographer, the highest the picture has been
  // covered up to in each column (by nearer ground, or nearer mist): mist
  // further off shows only above it – so a strip can be drawn after what
  // stands on its band and still not over a hill in front of it.
  const horizon = new Array(COLS).fill(Infinity);
  const out = [];
  for (let k = 0; k < n; k++) {
    let fill = '', shore = '';
    const farY = [];
    for (let i = 0; i < COLS; i++) {
      if (wet[k][i]) {
        const f0 = up(us[i], d[k + 1], level), f1 = up(us[i + 1], d[k + 1], level);
        const n0 = up(us[i], d[k], level), n1 = up(us[i + 1], d[k], level);
        const b0 = Math.min(n0[1], horizon[i]), b1 = Math.min(n1[1], horizon[i]);
        if (Math.min(b0 - f0[1], b1 - f1[1]) > 0) fill += `M${pt(f0)}L${pt(f1)}L${pt([n1[0] + 0.4, b1 + 0.4])}L${pt([n0[0] - 0.4, b0 + 0.4])}Z`;
      }
      farY.push(up(mid[i], d[k + 1], Math.max(g[k][i], level))[1]);
    }
    // the far shore: where the band behind is out of the mist (and its
    // ground is not hidden), in lobes standing up off it
    for (let a = 0; a < COLS;) {
      if (!(wet[k][a] && wet[k + 1]?.[a] === false)) { a++; continue; }
      let b = a;
      while (b + 1 < COLS && wet[k][b + 1] && wet[k + 1][b + 1] === false) b++;
      const p = us.slice(a, b + 2).map((u) => up(u, d[k + 1], level));
      if (p.every(([, y], q) => y >= horizon[Math.min(a + q, COLS - 1)] - 0.5)) { a = b + 1; continue; }
      const len = Math.hypot(p[p.length - 1][0] - p[0][0], p[p.length - 1][1] - p[0][1]);
      const m = Math.max(1, Math.round(len / lobe));
      let lobes = `M${pt(p[0])}`;
      for (let q = 1; q <= m; q++) {
        const e = p[Math.round((q * (p.length - 1)) / m)], s0 = p[Math.round(((q - 1) * (p.length - 1)) / m)];
        const l = Math.hypot(e[0] - s0[0], e[1] - s0[1]);
        lobes += `A${r2(l / 2)} ${r2(l / rise)} 0 0 1 ${pt(e)}`;
      }
      fill += `${lobes}${[...p].reverse().map((q) => `L${pt(q)}`).join('')}Z`;
      shore += lobes;
      a = b + 1;
    }
    for (let i = 0; i < COLS; i++) horizon[i] = Math.min(horizon[i], farY[i]);
    // after everything standing on this band, before what stands nearer
    if (fill) out.push({ depth: -d[k] + 1e-4, dist: (d[k] + d[k + 1]) / 2, svg: `<g class="mist-veil"><path class="mist" d="${fill}"/>${shore ? `<path class="mist-line" d="${shore}"/>` : ''}</g>` });
  }
  return out;
}

// A street's kerb close in front (PHOTO.ground): its top edge, the kerb's
// height above the line the map draws, and the joints between its stones.
// `pts`: the kerb on the picture, each [x, y, ahead, raised].
function kerbTop(cam, bands, pts) {
  const { reach, kerb, stone } = PHOTO.ground;
  const up = (p) => [p[0], p[1] - (cam.focal * kerb) / p[2]];
  let run = [], band = -1, along = stone / 2;
  const flush = () => {
    if (run.length > 1) bands.line(band, 'kerb', run.map(up));
    run = [];
  };
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (p[3] || p[2] > reach || p[2] < cam.near) { flush(); continue; }
    const b = bands.of(p[2]);
    if (b !== band) { if (run.length) run.push(p); flush(); band = b; }
    run.push(p);
    if (i === 0) continue;
    // the way along the kerb in steps, from the picture and the distance
    const q = pts[i - 1];
    along += (Math.hypot(p[0] - q[0], p[1] - q[1]) * p[2]) / cam.focal;
    if (along >= stone) {
      along %= stone;
      bands.line(band, 'kerb', [p, up(p)]);
    }
  }
  flush();
}

// Where the water starts: the map's lake shores and river banks
// (Renderer.traceWater) on the ground, one firm line, cut up between the
// bands as the roads are (each piece on the band of its nearer end).
function shoreLines(renderer, cam, bands, onGround) {
  const { shore, bank } = renderer.traceWater();
  const far = bands.d[bands.n];
  for (const line of [...shore, ...bank]) {
    const pts = line.map(([x, y]) => {
      const ahead = cam.ahead(x, y);
      return ahead < cam.near || ahead > far ? null : [...onGround(x, y), ahead];
    });
    let run = [], band = -1;
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1], q = pts[i];
      if (!p || !q) {
        if (run.length > 1) bands.line(band, 'photo-shore', run);
        run = [];
        continue;
      }
      const b = bands.of(Math.min(p[2], q[2]));
      if (run.length && b !== band) {
        bands.line(band, 'photo-shore', run);
        run = [];
      }
      if (!run.length) run.push(p);
      band = b;
      run.push(q);
    }
    if (run.length > 1) bands.line(band, 'photo-shore', run);
  }
}

// The pen for something `dist` steps away (PHOTO.weight): a factor on
// every line width, a whole number of √2 pen steps.
function penAt(dist) {
  const { at, per, min, max } = PHOTO.weight;
  // the factor as a power of two: `per` for every halving of the distance
  const octaves = Math.log2(per) * Math.log2(at / Math.max(dist, 0.01));
  return Math.min(max, Math.max(min, r2(2 ** (Math.round(octaves * 8) / 8))));
}

// The ground bands. Each is sampled along fixed rays across the picture (so
// the same column of the picture in every band), from its near edge d[k]
// to its far edge d[k + 1]. A band's far edge is drawn as a line where it
// is the crest of a hill – where the band behind it drops out of sight.
function makeBands(cam, onGround) {
  const { near, far, step, margin } = PHOTO.bands;
  const d = [];
  for (let t = near; t < far * step; t *= step) d.push(t);
  const n = d.length - 1;
  const spread = (cam.width / 2 / cam.focal) * 1.15;
  const COLS = 48;
  const cols = Array.from({ length: COLS + 1 }, (_, i) => -spread + (2 * spread * i) / COLS);
  const edge = (t) => cols.map((u) => onGround(cam.ex + cam.fx * t + cam.rx * u * t, cam.ey + cam.fy * t + cam.ry * u * t));
  const edges = d.map(edge);
  const marks = Array.from({ length: n }, () => ({ lots: '', meadow: '', hatch: '', ripples: '', net: new Map() }));

  const of = (ahead) => {
    if (ahead < d[0]) return 0;
    const k = Math.floor(Math.log(ahead / near) / Math.log(step));
    return Math.min(n - 1, Math.max(0, k));
  };

  return {
    d, n, of,
    add(k, kind, svg) {
      marks[k][kind] += svg;
    },
    line(k, cls, pts) {
      const m = marks[k].net;
      m.set(cls, (m.get(cls) ?? '') + pts.map((p, i) => `${i ? 'L' : 'M'}${pt(p)}`).join(''));
    },
    layers() {
      const out = [];
      for (let k = 0; k < n; k++) {
        const [a, b] = [edges[k], edges[k + 1]];
        const fill = `M${b.map(pt).join('L')}L${[...a].reverse().map(pt).join('L')}Z`;
        // crest: this band's far edge stands above the next band's far edge
        let crest = '';
        const behind = edges[k + 2];
        if (behind) {
          for (let i = 0; i <= COLS; i++) {
            const up = b[i][1] < behind[i][1] - 0.5;
            const prev = i > 0 && b[i - 1][1] < behind[i - 1][1] - 0.5;
            if (up) crest += `${prev ? 'L' : 'M'}${pt(b[i])}`;
          }
        }
        const m = marks[k];
        const net = [...m.net.keys()]
          .sort((p, q) => NET_ORDER.indexOf(p) - NET_ORDER.indexOf(q))
          .map((cls) => `<path class="${cls}" d="${m.net.get(cls)}"/>`)
          .join('');
        out.push({
          depth: -(d[k + 1] + margin),
          dist: (d[k] + d[k + 1]) / 2,
          svg: `<path class="photo-band" d="${fill}"/>`
            + (m.hatch ? `<path class="photo-hatch" d="${m.hatch}"/>` : '')
            + (m.ripples ? `<path class="photo-ripples" d="${m.ripples}"/>` : '')
            + m.lots
            + (m.meadow ? `<g class="layer-meadow">${m.meadow}</g>` : '')
            + net
            + (crest ? `<path class="photo-crest" d="${crest}"/>` : ''),
        });
      }
      return out;
    },
  };
}

// Pen marks on the ground bands, so the ground reads as ground:
//   hatch    short level pencil strokes on all the ground but roads and
//            paths (buildings cover their own), in rows along the bands,
//            about the same distance apart on the picture near and far
//   ripples  small waves on lakes and rivers (ripple)
//   meadow   the map's own tufts and flowers (meadow.js), near the camera
// Seeded by the spot, so the same photo comes out the same.
function groundMarks(world, config, cam, bands, seen, onGround, wetAt) {
  const { grid } = world;
  const offRoad = freeTest(world, config);
  const rnd = mulberry32(Math.imul(Math.round(cam.ex * 100), 73856093) ^ Math.imul(Math.round(cam.ey * 100), 19349663) ^ world.seed);
  const { len, blank, sparse } = PHOTO.hatch;
  const up = PHOTO.upright, gap = up.on ? up.gap : PHOTO.hatch.gap;
  const spread = (cam.width / 2 / cam.focal) * 1.1;

  for (let k = 0; k < bands.n; k++) {
    const d = (bands.d[k] + bands.d[k + 1]) / 2, scale = cam.focal / d;
    const half = d * spread + 0.2;
    const { len: wave, at, min, max, rise } = PHOTO.ripples;
    const waves = wave * Math.min(max, Math.max(min, Math.sqrt(at / d)));
    const crest = rise * Math.min(1, (at / d) ** 1.5);
    let hatch = '', ripples = '';
    for (let w = -half + rnd() * gap / scale; w < half; w += (gap * (0.6 + rnd() * 0.8)) / scale) {
      const dd = bands.d[k] + (bands.d[k + 1] - bands.d[k]) * rnd();
      const px = cam.ex + cam.fx * dd + cam.rx * w, py = cam.ey + cam.fy * dd + cam.ry * w;
      const wet = wetAt(px, py);
      if (rnd() < (wet ? PHOTO.ripples.skip : 0.35) || (!wet && !offRoad(px, py))) continue;
      if (dd < blank && rnd() * sparse > 1) continue;
      // level on the picture: along the camera's right, a touch askew
      const l = ((wet ? waves : len) * (0.5 + rnd())) / scale / 2;
      const tilt = (rnd() - 0.5) * 0.25;
      const dx = (cam.rx + cam.fx * tilt) * l, dy = (cam.ry + cam.fy * tilt) * l;
      if (!cam.isAhead(px - dx, py - dy) || !cam.isAhead(px + dx, py + dy)) continue;
      if (wet && !(wetAt(px - dx, py - dy) && wetAt(px + dx, py + dy))) continue; // within the banks
      const a = onGround(px - dx, py - dy), b = onGround(px + dx, py + dy);
      if (wet) ripples += ripple(a, b, crest * (rnd() < 0.5 ? -1 : 1));
      else if (up.on) {
        const foot = onGround(px, py), tall = Math.min(up.max, Math.max(up.min, up.blade * scale));
        const n = rnd() < up.tuft ? 2 + Math.floor(rnd() * 2) : 1;
        for (let b = 0; b < n; b++) {
          // as a hand flicks one up: its own height and lean, a little bowed
          const h = tall * (0.4 + 1.1 * rnd() ** 1.5), lean = h * up.lean * (2 * rnd() - 1) + (b ? (b === 1 ? -1 : 1) * h * 0.25 : 0);
          const bow = h * up.bend * (2 * rnd() - 1), x0 = foot[0] + (b ? (rnd() - 0.5) * tall * 0.3 : 0);
          hatch += `M${pt([x0, foot[1]])}q${r2(lean * 0.3 + bow)} ${r2(-h * 0.55)} ${r2(lean)} ${r2(-h)}`;
        }
      } else hatch += `M${pt(a)}L${pt(b)}`;
    }
    bands.add(k, 'hatch', hatch);
    bands.add(k, 'ripples', ripples);
  }

  // meadow: every dot within reach, each glyph on its own band
  const open = meadowGround(world, config);
  const reach = PHOTO.meadow;
  const r1 = (n) => Math.round(n * 10) / 10;
  for (let cy = Math.max(0, Math.floor(cam.ey - reach)); cy <= Math.min(grid.height - 1, cam.ey + reach); cy++) {
    for (let cx = Math.max(0, Math.floor(cam.ex - reach)); cx <= Math.min(grid.width - 1, cam.ex + reach); cx++) {
      if (!seen(cx, cy, 1)) continue;
      for (const { x, y, tier, parts, ground: lying } of plant(world, open, cx, cy)) {
        const ahead = cam.ahead(x, y);
        if (ahead < cam.near || Math.hypot(x - cam.ex, y - cam.ey) > reach) continue;
        // (lines on the ground: a potato ridge)
        for (const [lines, pen] of lying ?? []) {
          const d = lines.filter((pts) => pts.every(([px, py]) => cam.ahead(px, py) > cam.near)).map((pts) => pts.map((q, i) => `${i ? 'L' : 'M'}${pt(onGround(...q))}`).join('')).join('');
          if (d) bands.add(bands.of(ahead), 'meadow', `<path class="t${tier} ${pen}" d="${d}"/>`);
        }
        const [sx, sy] = onGround(x, y);
        const t = cam.focal / Math.max(ahead, PHOTO.tuft);
        for (const [lines, pen] of parts) {
          if (!lines.length) continue;
          const d = lines.map((pts) => pts.map(([u, v], i) => `${i ? 'L' : 'M'}${r1(sx + u * t)} ${r1(sy - v * t)}`).join('')).join('');
          bands.add(bands.of(ahead), 'meadow', `<path class="t${tier}${pen ? ` ${pen}` : ''}" d="${d}"/>`);
        }
      }
    }
  }
}

// A ripple on the water from a to b (on the picture): a small wave, a
// crest and then a trough, standing up off the water `rise` of its length
// (below 0: a trough first).
function ripple(a, b, rise) {
  const vx = b[0] - a[0], vy = b[1] - a[1];
  // (a cubic's control points stand out about 3.5 times the curve's height)
  const h = Math.hypot(vx, vy) * rise * 3.5;
  return `M${pt(a)}C${pt([a[0] + vx / 3, a[1] + vy / 3 - h])} ${pt([a[0] + (2 * vx) / 3, a[1] + (2 * vy) / 3 + h])} ${pt(b)}`;
}

// Vehicles as they are at the moment of the photo, the same models as on
// the map (vehicles.js) drawn through the photo camera: cars driving
// (turned the way the map last drew them), buses and trucks (between their
// front and back), cars parked in the lots, trains, carriage by
// carriage, and the signs at level crossings.
function vehicles(renderer, cam, seen) {
  const { world, agents, parking, trains } = renderer;
  const { terrain } = world;
  const deck = renderer.bridgeState().deck;
  const out = [];
  // `size`: about half the vehicle's length, for what counts as in view
  // `draw(view)` -> SVG of the thing standing at (x, y)
  const place = (x, y, size, cls, draw) => {
    if (!seen(x, y, size + 0.1) || cam.ahead(x, y) < 0.45 + size) return; // (not one the photographer is right against)
    const z = terrain.heightAt(x, y) + deck(x, y);
    const view = {
      project: ([ox, oy, oz]) => cam.project(x + ox, y + oy, z + oz, [x, y]),
      facing: (n, [ox, oy, oz]) => cam.facingAt(n, [x + ox, y + oy, z + oz], [x, y]),
      depth: ([ox, oy]) => -cam.ahead(x + ox, y + oy),
    };
    const svg = draw(view);
    out.push({ depth: -cam.ahead(x, y), svg: cls ? `<g class="${cls}">${svg}</g>` : svg });
  };
  const add = (x, y, angle, name, hand, cls = '', size = 0.1) => place(x, y, size, cls, (view) => vehicleSVGIn(view, name, angle, hand));

  for (const a of agents.visible()) {
    if (a.bus || a.truck) {
      // between its front (x, y) and back (tx, ty), on the swaying road
      const [wx, wy] = wobble(a.x, a.y), [vx, vy] = wobble(a.tx, a.ty);
      const fx = a.x + wx, fy = a.y + wy, bx = a.tx + vx, by = a.ty + vy;
      const angle = Math.hypot(fx - bx, fy - by) > 1e-4 ? Math.atan2(fy - by, fx - bx) : ((renderer.agentEls.get(a.id)?.heading ?? 0) / VEHICLES.headings) * Math.PI * 2;
      add((fx + bx) / 2, (fy + by) / 2, angle, a.bus ? 'bus' : a.engine ?? truckFor(a.id), modelFor(a.id).hand, '', 0.2); // (a fire engine: its own)
      continue;
    }
    if (a.trip?.mode !== 'drive') continue;
    const [wx, wy] = wobble(a.x, a.y); // on the swaying road, as on the map
    const heading = renderer.agentEls.get(a.id)?.heading ?? 0;
    const { name, hand } = modelFor(a.id);
    add(a.x + wx, a.y + wy, (heading / VEHICLES.headings) * Math.PI * 2, name, hand);
  }
  // trains: the railcar's middle [x, y, dx, dy] (as in Renderer.placeTrain)
  const len = Math.round(renderer.config.trains.length * 100) / 100;
  for (const t of trains.visible()) {
    t.points.forEach(([px, py, dx, dy], i) => add(px, py, Math.atan2(dy, dx), `railcar:${len}`, i % VEHICLES.hands, '', len / 2));
  }
  // the signs at level crossings, the lights of closed road crossings
  // flashing as they are on the map (crossings.js)
  const lit = litLight(performance.now() / 1000);
  for (const c of trains.crossingList()) {
    const closed = c.kind === 'road' && trains.closed.has(c.id);
    for (const sign of signsAt(c)) {
      place(sign.x, sign.y, 0.05, '', (view) => signSVGIn(view, sign.heading, sign.kind) + (closed ? flashSVGIn(view, sign.heading, lit) : ''));
    }
  }
  // (the model is picked by the stall, as in Renderer.renderParked)
  const r2s = (n) => Math.round(n * 100) / 100;
  for (const [id, spots] of parking.spots) {
    const s = world.structures.get(id);
    if (!s) continue;
    for (const [x, y, angle = 0] of spots.slice(0, parking.count(s))) {
      const { name, hand } = modelFor(`${id}:${r2s(x)}:${r2s(y)}`);
      add(x, y, angle, name, hand, 'parked-car');
    }
  }
  return out;
}

// Deer, cows and sheep as they are at the moment of the photo: the map's
// figures (deer.js, livestock.js) stood up on the ground, as large as they
// are on the map against the land round them (scaled by how far they are),
// turned the way they face across the picture.
function animals(renderer, cam, seen) {
  const { terrain } = renderer.world;
  const base = renderer.camera;
  const px = 1 / (base.zScale * base.tile); // map height of one of the figures' units
  const out = [];
  for (const system of [renderer.deer, renderer.livestock]) {
    for (const d of system?.visible() ?? []) {
      if (!seen(d.x, d.y, 0.3) || cam.ahead(d.x, d.y) < 0.2) continue;
      const farm = d.kind === 'cow' || d.kind === 'sheep';
      const stride = farm ? LIVESTOCK.stride : DEER.stride;
      const pose = d.pose !== 'walk' ? d.pose : Math.floor(d.walked / stride) % 2 ? 'step' : 'stand';
      const z = terrain.heightAt(d.x, d.y);
      const [sx, sy] = cam.project(d.x, d.y, z);
      const k = Math.abs(cam.project(d.x, d.y, z + px)[1] - sy);
      const [fx] = cam.project(d.x + Math.cos(d.facing) * 0.1, d.y + Math.sin(d.facing) * 0.1, z);
      const svg = farm ? livestockSVG(d.kind, pose, d.variant) : deerSVG(d.kind, pose, d.variant);
      out.push({
        depth: -cam.ahead(d.x, d.y),
        svg: `<g class="photo-figure" transform="translate(${r2(sx)} ${r2(sy)}) scale(${fx < sx ? -r2(k) : r2(k)} ${r2(k)})">${svg}</g>`,
      });
    }
  }
  return out;
}

// Chimney smoke as it is at the moment of the photo (particles.js, the
// map's own), at each chimney's distance: as large against its building as
// on the map, just behind what stands nearer. None from a chimney under
// the mist.
function smoke(renderer, cam, vents) {
  const { world, config } = renderer;
  const kind = world.weather?.kind;
  const env = { wind: config.weather.wind[kind] ?? 0, rain: config.weather.rain[kind] ?? 0, mist: renderer.mistRisen ?? 0 };
  const level = renderer.mistLevel;
  const out = [];
  for (const v of vents) {
    const [x, y, z] = v.at;
    const ahead = cam.ahead(x, y);
    if (ahead < PHOTO.clear) continue;
    if (level != null && (cam.lift?.(x, y) ?? 0) + z < level) continue;
    const svg = smokeSVG(v, world.time, env, { tile: cam.scaleAt(x, y), zScale: 1 });
    if (svg) out.push({ depth: -ahead + 0.02, dist: ahead, svg });
  }
  return out;
}

// Walkers and cyclists out at the moment of the photo: the map's pen
// figures (people.js) stood up where they are, as large as on the map
// against the land round them (as the animals). A walker faces the way it
// goes across the picture; a cyclist's bike is the one of the map's
// directions that runs most like its way does on the picture. In the rain
// the same walkers as on the map are under umbrellas.
// a figure's coat (--pen-3, 1 px) drawn as heavy as a wall's outline (--pen-4)
const FIGURE_PEN = 1.4;

function people(renderer, cam, seen) {
  const { world, agents, agentEls } = renderer;
  const { terrain } = world;
  const deck = renderer.bridgeState().deck;
  const base = renderer.camera;
  const px = 1 / (base.zScale * base.tile); // map height of one of the figures' units
  const umbrellas = renderer.config.weather?.people?.[world.weather?.kind]?.umbrellas ?? 0;
  const iso = { angle: 0, tile: 32 }; // the bikes' directions as on an unturned map
  const out = [];
  for (const a of agents.visible()) {
    const mode = a.trip?.mode;
    if (a.bus || a.truck || mode === 'drive') continue;
    const [wx, wy] = wobble(a.x, a.y); // on the swaying road, as on the map
    const x = a.x + wx, y = a.y + wy;
    if (!seen(x, y, 0.1) || cam.ahead(x, y) < 0.35) continue;
    const z = terrain.heightAt(x, y) + deck(x, y);
    const [sx, sy] = cam.project(x, y, z, [x, y]);
    const k = Math.abs(cam.project(x, y, z + px, [x, y])[1] - sy);
    // its way across the picture, from the heading the map last drew it with
    const angle = ((agentEls.get(a.id)?.heading ?? 0) / VEHICLES.headings) * Math.PI * 2;
    const [fx, fy] = cam.project(x + Math.cos(angle) * 0.05, y + Math.sin(angle) * 0.05, z, [x, y]);
    const body = bodyFor(a.id);
    let svg, flip = false;
    if (mode === 'cycle') {
      const len = Math.hypot(fx - sx, fy - sy) || 1;
      let best = 0, score = -Infinity;
      for (let h = 0; h < VEHICLES.headings; h++) {
        const b = (h / VEHICLES.headings) * Math.PI * 2, c = Math.cos(b), d = Math.sin(b);
        const ix = (c - d) * Math.cos(Math.PI / 6), iy = (c + d) * 0.5;
        const sc = ((fx - sx) * ix + (fy - sy) * iy) / len / (Math.hypot(ix, iy) || 1);
        if (sc > score) [best, score] = [h, sc];
      }
      svg = cyclistSVG(iso, best, body);
    } else {
      const brolly = umbrellas > 0 && (bodyFor(`${a.id}u`) + 0.5) / PEOPLE.bodies <= umbrellas;
      svg = walkerSVG(body, brolly, a.carry ?? null);
      flip = fx < sx;
    }
    out.push({
      depth: -cam.ahead(x, y),
      // lines in the picture's pen for its distance (penAt), as the
      // buildings' round it – not the map's widths: a coat's outline as
      // heavy as a wall's (the .fig-* pens times --stroke, undone by `k`)
      svg: `<g class="photo-person" style="--stroke:${(FIGURE_PEN * PHOTO.pen * penAt(cam.ahead(x, y)) / k).toFixed(4)}" transform="translate(${r2(sx)} ${r2(sy)}) scale(${flip ? -r2(k) : r2(k)} ${r2(k)})">${svg}</g>`,
    });
  }
  return out;
}

// The bridges' decks as solid slabs – top and sides, in short pieces along
// the span so each sorts by its own distance – under the linework the map
// draws for them (railings, the road on the deck), which comes up on top.
function bridgeDecks(renderer, cam, seen) {
  const { list, deck } = renderer.bridgeState();
  const { terrain } = renderer.world;
  const out = [];
  const T = BRIDGE.thickness, t0 = 0.12, t1 = 0.88; // (as bridgeLines)
  const face = (pts) => {
    const c = cam.clip(pts, true);
    return c ? `<path class="photo-deck" d="M${c.map((p) => pt(cam.project(...p))).join('L')}Z"/>` : '';
  };
  for (const { a, b, half } of list) {
    const vx = b[0] - a[0], vy = b[1] - a[1], len = Math.hypot(vx, vy);
    if (!len || !seen((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, len / 2 + 1)) continue;
    const nx = -vy / len, ny = vx / len;
    const level = (t) => deck(a[0] + vx * t, a[1] + vy * t);
    const Q = (t, side, dz = 0) => {
      const x = a[0] + vx * t + nx * side, y = a[1] + vy * t + ny * side;
      return [x, y, terrain.heightAt(x, y) + level(t) + dz];
    };
    const n = Math.max(2, Math.ceil(((t1 - t0) * len) / 0.1));
    for (let i = 0; i < n; i++) {
      const u0 = t0 + ((t1 - t0) * i) / n, u1 = t0 + ((t1 - t0) * (i + 1)) / n, um = (u0 + u1) / 2;
      const mid = Q(um, 0);
      if (!cam.isAhead(mid[0], mid[1]) && !cam.isAhead(...Q(u0, 0).slice(0, 2)) && !cam.isAhead(...Q(u1, 0).slice(0, 2))) continue;
      let svg = '';
      for (const side of [-half, half]) {
        if (cam.facingAt([nx * Math.sign(side), ny * Math.sign(side), 0], Q(um, side))) {
          svg += face([Q(u0, side, -T), Q(u1, side, -T), Q(u1, side), Q(u0, side)]);
        }
      }
      if (cam.facingAt([0, 0, 1], mid)) svg += face([Q(u0, -half), Q(u1, -half), Q(u1, half), Q(u0, half)]);
      if (svg) out.push({ depth: -cam.ahead(mid[0], mid[1]), svg });
    }
  }
  return out;
}

// Lakes and rivers as flat water: { raise(x, y) -> how far to raise the
// ground there to the surface of the water it lies in (0 elsewhere),
// wet(x, y) -> whether it is in the water, within the drawn shore }.
// Each lake's level is found as on the map (Renderer.waterLevel: halfway
// from its highest dot up to the lowest dry ground next to it), but in the
// relief's own height, so the surface meets the drawn shore. Points within
// REACH of a lake dot belong to it. A river is level across, at the height
// of its water on the centreline nearest by (terrain/rivers.js), so it falls
// only along its way; within its banks, which are cut at that height
// (terrain/elevation.js). The ground is only ever raised, so the banks
// above the water stay.
function waterSurface(renderer, lift) {
  const { grid, terrain, riverField: field } = renderer.world;
  if (!lift) return { raise: () => 0, wet: renderer.wetAt() };
  const REACH = 0.9;
  const level = new Float32Array(grid.size).fill(NaN);
  for (const cells of renderer.waterBodies()) {
    if (terrain.isRiver(grid.nodeAt(...cells[0]))) continue;
    let top = -Infinity, rim = Infinity;
    for (const [cx, cy] of cells) {
      top = Math.max(top, lift(cx, cy));
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = grid.nodeAt(cx + dx, cy + dy);
        if (n >= 0 && !terrain.isWater(n)) rim = Math.min(rim, lift(cx + dx, cy + dy));
      }
    }
    const l = rim > top && rim < Infinity ? (top + rim) / 2 : top;
    for (const [cx, cy] of cells) level[grid.nodeAt(cx, cy)] = l;
  }
  const river = (x, y) => field && field.depth(x, y) > 0;
  // the surface's height at (x, y), -Infinity off the water
  const surface = (x, y) => {
    let best = river(x, y) ? lift.of(field.at(x, y).z, x, y) : -Infinity;
    const rx = Math.round(x), ry = Math.round(y);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const n = grid.nodeAt(rx + dx, ry + dy);
        if (n < 0 || Number.isNaN(level[n]) || Math.hypot(rx + dx - x, ry + dy - y) > REACH) continue;
        best = Math.max(best, level[n]);
      }
    }
    return best;
  };
  return {
    raise: (x, y) => Math.max(0, surface(x, y) - lift(x, y)),
    // (a river's bed lies at its surface where the valley was cut down to it)
    wet: (x, y) => river(x, y) || surface(x, y) > lift(x, y),
  };
}

// The map's relief as the photo has it (PHOTO.relief): flattened around
// the photographer at (x, y), less so further off. Carries the map lift's
// `range` and `of` (the lift of a height – a river's surface – at a point),
// flattened alike.
function photoLift(lift, x, y) {
  if (!lift) return null;
  const { near, far, from, to } = PHOTO.relief;
  const l0 = lift(x, y);
  const share = (px, py) => {
    const t = Math.min(1, Math.max(0, (Math.hypot(px - x, py - y) - from) / (to - from)));
    return near + (far - near) * t * t * (3 - 2 * t);
  };
  const out = (px, py) => l0 + share(px, py) * (lift(px, py) - l0);
  out.range = lift.range;
  out.of = (metres, px = x, py = y) => l0 + share(px, py) * (lift.of(metres) - l0);
  return out;
}

// The far edge of the ground: for each column of the picture, the highest
// point of the terrain along its ray – the backdrop behind the last band.
function skyline(cam, groundAt, range) {
  const { width, height } = cam;
  const pts = [];
  for (let px = -4; px <= width + 4; px += 4) {
    // the ray through this column, in world x/y
    const u = (px - width / 2) / cam.focal;
    const dx = cam.fx + cam.rx * u, dy = cam.fy + cam.ry * u;
    let top = Infinity;
    for (let t = 0.5; t <= range; t *= 1.08) {
      const wx = cam.ex + dx * t, wy = cam.ey + dy * t;
      const sy = cam.horizonY - ((groundAt(wx, wy) - cam.ez) / t) * cam.focal;
      if (sy < top) top = sy;
    }
    pts.push([px, Math.min(top, height + 2)]);
  }
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${pt(p)}`).join('');
  return `<path class="photo-ground" d="${line}L${width + 4} ${height + 4}L-4 ${height + 4}Z"/>`
    + `<path class="photo-horizon" d="${line}"/>`;
}
