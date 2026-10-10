// Photo mode: the town seen by someone standing on the map, drawn with the
// same pen as the map. takePhoto() returns a standalone <svg> string.
//
// Everything draws through a PerspectiveCamera (perspective.js): the
// structures, trees and street lamps with their own draw code (the
// renderer's paint* functions), the roads, footpaths, fences and railways with the
// renderer's ink items; deer, cows and sheep as the map's figures.
//
// The ground is solid: it is cut into bands across the view, each a little
// further than the last, filled with paper and carrying its own marks
// (pencil strokes, ripples, meadow tufts, lot drawing, roads). Bands and
// solids are drawn together far to near, so a hill hides what is behind it.
// Past the last band a skyline of the terrain closes the picture. Lakes
// are flat: the ground under a lake's water level is drawn at that level
// (lakeSurface).

import { PerspectiveCamera } from './perspective.js';
import { meadowGround, plant } from './meadow.js';
import { mulberry32 } from '../core/random.js';
import { freeTest } from './lots.js';
import { BRIDGE } from './bridges.js';
import { VEHICLES, vehicleSVGIn, modelFor, truckFor } from './vehicles.js';
import { signsAt, signSVGIn, flashSVGIn, litLight } from './crossings.js';
import { wobble } from './painter.js';
import { cloudsSVG } from './clouds.js';
import { DEER, deerSVG } from './deer.js';
import { LIVESTOCK, livestockSVG } from './livestock.js';

export const PHOTO = {
  width: 480,
  height: 320,
  eye: 0.12,     // eye height in grid units (a storey is about 0.15):
                 // a little above a person's, for a bit more overview
  range: 28,     // how far anything is drawn, in grid steps
  clear: 0.3,    // solids closer than this to the photographer are left out,
  trees: 1.4,    // trees and shrubs closer than this (they would be a blob filling the frame)
  lots: 1,       // lot drawing on the ground (beds, paving, benches' feet) closer than this
  tuft: 0.8,     // meadow tufts nearer than this are drawn as big as they would be here
  // ground bands: from `near` out to `far`, each `step` times further than
  // the last; a solid standing up to `margin` behind a band's far edge is
  // still drawn over it (it stands on it)
  bands: { near: 0.1, far: 20, step: 1.09, margin: 0.35 },
  meadow: 12,    // how far the meadow tufts reach
  // line weight by distance, as in a sketch: heavy in front, hairlines far
  // off. Lines are drawn with the pens as written (styles.css) `at` steps
  // away, a pen heavier for every halving of the distance and a pen
  // lighter for every doubling (the pens go up in √2 steps), from `min` to
  // `max` times. Texture (hatching, windows, grass: --fine in styles.css)
  // only ever gets lighter, so up close it stays fine.
  weight: { at: 2, min: 0.5, max: 2 },
  // the pencil strokes: `gap` px apart along a band, about `len` px long
  hatch: { gap: 30, len: 16 },
  // lenses by focal length, as on a 35 mm camera: the horizontal angle of
  // view across the 36 mm frame
  lenses: [28, 42, 80].map((mm) => ({ label: `${mm}mm`, fov: (2 * Math.atan(18 / mm) * 180) / Math.PI })),
};

const r2 = (n) => Math.round(n * 100) / 100;
// a tree's or a shrub's drawing (features/trees.js, kit.js)
const TREE = /class="[^"]*\b(tree|crown-line|leaf)\b/;
const pt = (p) => `${r2(p[0])} ${r2(p[1])}`;
// how ink items are layered, back to front (as on the map)
const NET_ORDER = ['footpath', 'fence-post', 'fence-pillar', 'fence', 'rail', 'rail-dash', 'rail-exit', 'rail-buffer', 'driveway', 'road', 'kerb', 'zebra', 'road-exit', 'bridge', 'bridge-post'];

// shot: { x, y, yaw (radians), fov (degrees), eye? }
export function takePhoto(renderer, shot) {
  const { world } = renderer;
  const { terrain } = world;
  const base = renderer.camera;
  const { width, height, range } = PHOTO;
  const { x, y, yaw, fov } = shot;
  const lift = base.lift;
  const raise = lakeSurface(renderer, lift);
  // height of the ground (or a lake's surface) above the drawing's zero,
  // and a point of it on the picture
  const groundAt = (px, py) => terrain.heightAt(px, py) + (lift ? lift(px, py) : 0) + raise(px, py);
  const cam = new PerspectiveCamera({
    x, y, z: groundAt(x, y) + (shot.eye ?? PHOTO.eye), yaw, fov, width, height, lift,
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
  const take = (out) => {
    if (!out) return;
    const { painter } = out;
    solids.push(...painter.solids);
    painter.ground.forEach((svg, i) => {
      const [gx, gy] = painter.groundAt[i];
      if (Math.hypot(gx - x, gy - y) >= PHOTO.lots) bands.add(bandAt(gx, gy), 'lots', svg);
    });
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
  // far ahead it is, so the lines can be cut up between the bands, and
  // whether it is up on a bridge (above the ground there)
  const deep = Object.create(cam);
  deep.project = (px, py, pz, at) => [...cam.project(px, py, pz, at), cam.ahead(px, py), pz - terrain.heightAt(px, py) > 0.01];
  let items;
  renderer.camera = deep;
  try {
    items = [...renderer.pathItems(), ...renderer.fenceItems(), ...renderer.railItems(), ...renderer.roadItems(false)];
  } finally {
    renderer.camera = base;
  }
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
  }

  groundMarks(world, renderer.config, cam, bands, seen, onGround, renderer.wetAt());

  // ----- together, far to near -----

  // nothing the photographer is standing in or right against (a garden
  // tree, a fence) – it would fill the picture
  const layers = [];
  for (const so of solids) {
    const svg = so.parts.join('');
    const near = so.at ? Math.hypot(so.at[0] - x, so.at[1] - y) : Infinity;
    if (near <= PHOTO.clear || (near < PHOTO.trees && TREE.test(svg))) continue;
    layers.push({ depth: so.depth, svg });
  }
  layers.push(...bands.layers(), ...raised, ...bridgeDecks(renderer, cam, seen), ...vehicles(renderer, cam, seen), ...animals(renderer, cam, seen));
  layers.sort((a, b) => a.depth - b.depth);
  // each in the pen for its distance; neighbours in the same pen share a group
  let svg = '', open = null;
  for (const l of layers) {
    const k = penAt(l.dist ?? -l.depth);
    if (k !== open) {
      if (open !== null) svg += '</g>';
      svg += `<g style="--stroke: ${k}; --fine: ${Math.min(1, k)}">`;
      open = k;
    }
    svg += l.svg;
  }
  if (open !== null) svg += '</g>';

  return `<svg class="photo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="--sun: ${renderer.config.weather.sun[world.weather.kind] ?? 1}">`
    + `<rect class="photo-sky" x="0" y="0" width="${width}" height="${height}"/>`
    + cloudsSVG(mulberry32(Math.imul(Math.round(x * 100), 83492791) ^ Math.imul(Math.round(y * 100), 2654435761) ^ world.seed), width, height, world.weather.kind)
    + skyline(cam, groundAt, range)
    + `<g class="layer-objects">${svg}</g>`
    + '</svg>';
}

// The pen for something `dist` steps away (PHOTO.weight): a factor on
// every line width, a whole number of √2 pen steps.
function penAt(dist) {
  const { at, min, max } = PHOTO.weight;
  const steps = Math.round(Math.log(at / Math.max(dist, 0.01)) / Math.log(2));
  return Math.min(max, Math.max(min, r2(Math.SQRT2 ** steps)));
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
//   ripples  longer ones on lakes and rivers
//   meadow   the map's own tufts and flowers (meadow.js), near the camera
// Seeded by the spot, so the same photo comes out the same.
function groundMarks(world, config, cam, bands, seen, onGround, wetAt) {
  const { grid } = world;
  const offRoad = freeTest(world, config);
  const rnd = mulberry32(Math.imul(Math.round(cam.ex * 100), 73856093) ^ Math.imul(Math.round(cam.ey * 100), 19349663) ^ world.seed);
  const { gap, len } = PHOTO.hatch;
  const spread = (cam.width / 2 / cam.focal) * 1.1;

  for (let k = 0; k < bands.n; k++) {
    const d = (bands.d[k] + bands.d[k + 1]) / 2, scale = cam.focal / d;
    const half = d * spread + 0.2;
    let hatch = '', ripples = '';
    for (let w = -half + rnd() * gap / scale; w < half; w += (gap * (0.6 + rnd() * 0.8)) / scale) {
      const dd = bands.d[k] + (bands.d[k + 1] - bands.d[k]) * rnd();
      const px = cam.ex + cam.fx * dd + cam.rx * w, py = cam.ey + cam.fy * dd + cam.ry * w;
      const wet = wetAt(px, py);
      if (rnd() < (wet ? 0.5 : 0.35) || (!wet && !offRoad(px, py))) continue;
      // level on the picture: along the camera's right, a touch askew
      const l = (len * (wet ? 1.6 : 1) * (0.5 + rnd())) / scale / 2;
      const tilt = (rnd() - 0.5) * 0.25;
      const dx = (cam.rx + cam.fx * tilt) * l, dy = (cam.ry + cam.fy * tilt) * l;
      if (!cam.isAhead(px - dx, py - dy) || !cam.isAhead(px + dx, py + dy)) continue;
      if (wet && !(wetAt(px - dx, py - dy) && wetAt(px + dx, py + dy))) continue; // within the banks
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
    if (!seen(x, y, size + 0.1) || cam.ahead(x, y) < 0.15 + size) return;
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
      add((fx + bx) / 2, (fy + by) / 2, angle, a.bus ? 'bus' : truckFor(a.id), modelFor(a.id).hand, '', 0.2);
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

// Lakes as flat water: (x, y) -> how far to raise the ground there to the
// surface of the lake it lies in (0 elsewhere). Each lake's level is found
// as on the map (Renderer.waterLevel: halfway from its highest dot up to the
// lowest dry ground next to it), but in the relief's own height, so the
// surface meets the drawn shore. Points within REACH of a lake dot belong to
// it; the ground is only ever raised, so the banks above the level stay.
// Rivers keep following their valley.
function lakeSurface(renderer, lift) {
  if (!lift) return () => 0;
  const { grid, terrain } = renderer.world;
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
  return (x, y) => {
    let best = -Infinity;
    const rx = Math.round(x), ry = Math.round(y);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const n = grid.nodeAt(rx + dx, ry + dy);
        if (n < 0 || Number.isNaN(level[n]) || Math.hypot(rx + dx - x, ry + dy - y) > REACH) continue;
        best = Math.max(best, level[n]);
      }
    }
    return best === -Infinity ? 0 : Math.max(0, best - lift(x, y));
  };
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
