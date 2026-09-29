// Photo mode: the town seen by someone standing on the map, drawn with the
// same pen as the map. takePhoto() returns a standalone <svg> string.
//
// Everything draws through a PerspectiveCamera (perspective.js): the
// structures, trees and street lamps with their own draw code (the
// renderer's paint* functions), the roads, footpaths and railways with the
// renderer's ink items.
//
// The ground is solid: it is cut into bands across the view, each a little
// further than the last, filled with paper and carrying its own marks
// (pencil strokes, ripples, meadow tufts, lot drawing, roads). Bands and
// solids are drawn together far to near, so a hill hides what is behind it.
// Past the last band a skyline of the terrain closes the picture.

import { PerspectiveCamera } from './perspective.js';
import { meadowGround, plant } from './meadow.js';
import { mulberry32 } from '../core/random.js';
import { freeTest } from './lots.js';

export const PHOTO = {
  width: 480,
  height: 320,
  eye: 0.12,     // eye height in grid units (a storey is about 0.15):
                 // a little above a person's, for a bit more overview
  range: 28,     // how far anything is drawn, in grid steps
  clear: 0.3,    // solids closer than this to the photographer are left out
  // ground bands: from `near` out to `far`, each `step` times further than
  // the last; a solid standing up to `margin` behind a band's far edge is
  // still drawn over it (it stands on it)
  bands: { near: 0.1, far: 20, step: 1.09, margin: 0.35 },
  meadow: 12,    // how far the meadow tufts reach
  // the pencil strokes: `gap` px apart along a band, about `len` px long
  hatch: { gap: 30, len: 16 },
  // lenses by focal length, as on a 35 mm camera: the horizontal angle of
  // view across the 36 mm frame
  lenses: [28, 42, 80].map((mm) => ({ label: `${mm}mm`, fov: (2 * Math.atan(18 / mm) * 180) / Math.PI })),
};

const r2 = (n) => Math.round(n * 100) / 100;
const pt = (p) => `${r2(p[0])} ${r2(p[1])}`;
// how ink items are layered, back to front (as on the map)
const NET_ORDER = ['footpath', 'rail', 'rail-dash', 'rail-exit', 'rail-buffer', 'driveway', 'road', 'kerb', 'zebra', 'road-exit', 'bridge', 'bridge-post'];

// shot: { x, y, yaw (radians), fov (degrees), eye? }
export function takePhoto(renderer, shot) {
  const { world } = renderer;
  const { terrain } = world;
  const base = renderer.camera;
  const { width, height, range } = PHOTO;
  const { x, y, yaw, fov } = shot;
  const lift = base.lift;
  const groundAt = (px, py) => terrain.heightAt(px, py) + (lift ? lift(px, py) : 0);
  const cam = new PerspectiveCamera({
    x, y, z: groundAt(x, y) + (shot.eye ?? PHOTO.eye), yaw, fov, width, height, lift,
  });
  // a point on the ground, on the picture
  const onGround = (px, py) => cam.project(px, py, terrain.heightAt(px, py));

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
  const take = (out) => {
    if (!out) return;
    const { painter } = out;
    solids.push(...painter.solids);
    painter.ground.forEach((svg, i) => bands.add(bandAt(...painter.groundAt[i]), 'lots', svg));
  };
  for (const s of world.structures.values()) {
    const nodes = world.nodesOf(s);
    if (seen(...world.centerOf(s), Math.sqrt(nodes.length) + 1.5)) take(renderer.paintStructure(s, cam));
  }
  for (const f of world.features.values()) {
    const [nx, ny] = world.grid.xy(f.node);
    if (seen(nx + f.ox, ny + f.oy, 0.6)) take(renderer.paintFeature(f, cam));
  }
  for (const key of world.sidewalks.keys()) {
    const [a] = key.split('-').map(Number);
    if (seen(...world.grid.xy(a), 2)) take(renderer.paintStreet(key, cam));
  }

  // ----- roads, footpaths and railways -----

  // the renderer's ink items through this camera, each point carrying how
  // far ahead it is, so the lines can be cut up between the bands
  const deep = Object.create(cam);
  deep.project = (px, py, pz, at) => [...cam.project(px, py, pz, at), cam.ahead(px, py)];
  let items;
  renderer.camera = deep;
  try {
    items = [...renderer.pathItems(), ...renderer.railItems(), ...renderer.roadItems(false)];
  } finally {
    renderer.camera = base;
  }
  for (const { cls, pts } of items) {
    let run = [pts[0]], band = -1;
    for (let i = 1; i < pts.length; i++) {
      const b = bands.of((pts[i - 1][2] + pts[i][2]) / 2);
      if (band >= 0 && b !== band) {
        bands.line(band, cls, run);
        run = [pts[i - 1]];
      }
      band = b;
      run.push(pts[i]);
    }
    if (band >= 0) bands.line(band, cls, run);
  }

  groundMarks(world, renderer.config, cam, bands, seen);

  // ----- together, far to near -----

  // nothing the photographer is standing in or right against (a garden
  // tree, a fence) – it would fill the picture
  const layers = solids
    .filter((so) => !so.at || Math.hypot(so.at[0] - x, so.at[1] - y) > PHOTO.clear)
    .map((so) => ({ depth: so.depth, svg: so.parts.join('') }));
  layers.push(...bands.layers());
  layers.sort((a, b) => a.depth - b.depth);

  return `<svg class="photo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`
    + `<rect class="photo-sky" x="0" y="0" width="${width}" height="${height}"/>`
    + skyline(cam, groundAt, range)
    + `<g class="layer-objects">${layers.map((l) => l.svg).join('')}</g>`
    + '</svg>';
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
//   ripples  longer ones on lakes and rivers
//   meadow   the map's own tufts and flowers (meadow.js), near the camera
// Seeded by the spot, so the same photo comes out the same.
function groundMarks(world, config, cam, bands, seen) {
  const { terrain, grid } = world;
  const offRoad = freeTest(world, config);
  const rnd = mulberry32(Math.imul(Math.round(cam.ex * 100), 73856093) ^ Math.imul(Math.round(cam.ey * 100), 19349663) ^ world.seed);
  const onGround = (px, py) => cam.project(px, py, terrain.heightAt(px, py));
  const { gap, len } = PHOTO.hatch;
  const spread = (cam.width / 2 / cam.focal) * 1.1;

  for (let k = 0; k < bands.n; k++) {
    const d = (bands.d[k] + bands.d[k + 1]) / 2, scale = cam.focal / d;
    const half = d * spread + 0.2;
    let hatch = '', ripples = '';
    for (let w = -half + rnd() * gap / scale; w < half; w += (gap * (0.6 + rnd() * 0.8)) / scale) {
      const dd = bands.d[k] + (bands.d[k + 1] - bands.d[k]) * rnd();
      const px = cam.ex + cam.fx * dd + cam.rx * w, py = cam.ey + cam.fy * dd + cam.ry * w;
      const node = grid.nodeAt(Math.round(px), Math.round(py));
      const wet = node >= 0 && terrain.isWater(node);
      if (rnd() < (wet ? 0.5 : 0.35) || (!wet && !offRoad(px, py))) continue;
      // level on the picture: along the camera's right, a touch askew
      const l = (len * (wet ? 1.6 : 1) * (0.5 + rnd())) / scale / 2;
      const tilt = (rnd() - 0.5) * 0.25;
      const dx = (cam.rx + cam.fx * tilt) * l, dy = (cam.ry + cam.fy * tilt) * l;
      if (!cam.isAhead(px - dx, py - dy) || !cam.isAhead(px + dx, py + dy)) continue;
      const seg = `M${pt(onGround(px - dx, py - dy))}L${pt(onGround(px + dx, py + dy))}`;
      if (wet) ripples += seg;
      else hatch += seg;
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
      for (const { x, y, tier, parts } of plant(world, open, cx, cy)) {
        const ahead = cam.ahead(x, y);
        if (ahead < cam.near || Math.hypot(x - cam.ex, y - cam.ey) > reach) continue;
        const [sx, sy] = onGround(x, y);
        const t = cam.scaleAt(x, y);
        for (const [lines, pen] of parts) {
          if (!lines.length) continue;
          const d = lines.map((pts) => pts.map(([u, v], i) => `${i ? 'L' : 'M'}${r1(sx + u * t)} ${r1(sy - v * t)}`).join('')).join('');
          bands.add(bands.of(ahead), 'meadow', `<path class="t${tier}${pen ? ` ${pen}` : ''}" d="${d}"/>`);
        }
      }
    }
  }
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
      const sy = height / 2 - ((groundAt(wx, wy) - cam.ez) / t) * cam.focal;
      if (sy < top) top = sy;
    }
    pts.push([px, Math.min(top, height + 2)]);
  }
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${pt(p)}`).join('');
  return `<path class="photo-ground" d="${line}L${width + 4} ${height + 4}L-4 ${height + 4}Z"/>`
    + `<path class="photo-horizon" d="${line}"/>`;
}
