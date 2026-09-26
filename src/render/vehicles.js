// Vehicles as little hand-drawn models: cars, trucks, trains.
//
// A model is made of parts, each a side profile – a convex polygon in (x, z),
// x forward, z up, in grid units – pushed out sideways to its half width, as
// in a quick pen sketch of a car seen from the side. They are drawn through
// the same isometric projection as the buildings, turned to the way the car
// is heading: back faces dropped, parts in order (body, wheels on the near
// side, cabin, roof gear, then the inked windows).
//
//   body    the main part (required)
//   cabin   a glasshouse on top: every face but its roof is a window
//   top     plain roof gear (no windows)
//   wheels  { x: [positions along], r }, inked discs on the near side
//   glass   (face) -> bool: body faces that are windows (when no cabin)
//   panes   window profiles [[x, z]…] on the near side
//
// Projecting every car every frame would cost too much, so a drawing is
// made once per model, heading (snapped to VEHICLES.headings directions),
// camera rotation and hand (VEHICLES.hands slightly different jitters, so
// no two cars in a row look stamped) and cached as SVG. Per frame a car
// only moves, and swaps its drawing when it turns into another direction.

import { rotateQuarter } from '../core/grid.js';
import { mulberry32 } from '../core/random.js';

export const VEHICLES = {
  minZoom: 1.6,  // closer than this cars are models, further out dots
  headings: 32,  // directions a model can face
  hands: 4,      // jitter variants per model
  jitter: 0.0025, // grid units a profile corner may stray
};

// Profiles, grid units. The eras' cars: a Škoda 120-like saloon (long bonnet
// and boot, cabin in the middle), a hatchback (Škoda Favorit / Trabant-ish,
// cabin to the back) and a van (Avia / Barkas box).
const MODELS = {
  saloon: {
    body: { w: 0.036, profile: [[-0.085, 0.012], [0.085, 0.012], [0.085, 0.034], [0.07, 0.042], [-0.08, 0.042], [-0.085, 0.036]] },
    cabin: { w: 0.032, profile: [[-0.045, 0.042], [0.032, 0.042], [0.016, 0.07], [-0.036, 0.07]] },
    wheels: { x: [-0.05, 0.05], r: 0.015 },
  },
  hatch: {
    body: { w: 0.035, profile: [[-0.07, 0.012], [0.075, 0.012], [0.075, 0.034], [0.06, 0.043], [-0.07, 0.043]] },
    cabin: { w: 0.032, profile: [[-0.068, 0.043], [0.03, 0.043], [0.012, 0.072], [-0.062, 0.072]] },
    wheels: { x: [-0.042, 0.048], r: 0.015 },
  },
  van: {
    // one tall box, glass only at the cab: the windscreen, and a side window
    body: { w: 0.038, profile: [[-0.09, 0.012], [0.09, 0.012], [0.09, 0.046], [0.062, 0.088], [-0.09, 0.088]] },
    wheels: { x: [-0.058, 0.055], r: 0.016 },
    glass: (face) => face.side === 0 && face.x > 0.06 && face.n[0] > 0,
    panes: [[[0.035, 0.05], [0.084, 0.05], [0.06, 0.082], [0.035, 0.082]]],
  },
  // Trucks (Tatra / Liaz cab-over): the cab and the box trailer are two
  // models, each turned its own way, so the truck bends at corners.
  cab: {
    body: { w: 0.038, profile: [[-0.035, 0.014], [0.036, 0.014], [0.036, 0.05], [0.03, 0.08], [-0.035, 0.082]] },
    wheels: { x: [0.004], r: 0.016 },
    glass: (face) => face.side === 0 && face.n[0] > 0 && face.n[2] > 0,
    panes: [[[0.004, 0.05], [0.033, 0.05], [0.028, 0.076], [0.004, 0.076]]],
  },
  trailer: {
    body: { w: 0.04, profile: [[-0.07, 0.018], [0.07, 0.018], [0.07, 0.088], [-0.07, 0.088]] },
    wheels: { x: [-0.048, -0.022], r: 0.015 },
  },
};

// Railway carriages `len` long (their spacing on the track, less a gap):
// a coach with a row of windows and bogies, or a locomotive with a
// windscreen at each end and a box on the roof.
function railModel(kind, len) {
  const h = len / 2;
  const body = { w: 0.042, profile: [[-h, 0.016], [h, 0.016], [h, 0.064], [h - 0.012, 0.078], [-h + 0.012, 0.078], [-h, 0.064]] };
  const wheels = { x: [-h + 0.022, -h + 0.045, h - 0.045, h - 0.022], r: 0.011 };
  if (kind === 'loco') {
    return {
      body, wheels,
      glass: (face) => face.side === 0 && face.n[2] > 0 && Math.abs(face.x) > h - 0.02, // the sloped ends
      panes: [[[h - 0.035, 0.044], [h - 0.012, 0.044], [h - 0.012, 0.06], [h - 0.035, 0.06]], [[-h + 0.012, 0.044], [-h + 0.035, 0.044], [-h + 0.035, 0.06], [-h + 0.012, 0.06]]],
      top: { w: 0.024, profile: [[-h * 0.45, 0.078], [h * 0.45, 0.078], [h * 0.45, 0.09], [-h * 0.45, 0.09]] },
    };
  }
  const n = Math.max(2, Math.floor((len - 0.05) / 0.032));
  const step = (len - 0.05) / n;
  const panes = [];
  for (let i = 0; i < n; i++) {
    const x0 = -h + 0.025 + i * step + step * 0.2;
    panes.push([[x0, 0.042], [x0 + step * 0.6, 0.042], [x0 + step * 0.6, 0.06], [x0, 0.06]]);
  }
  return { body, wheels, panes };
}

// A model by name: one of MODELS, or 'coach:<len>' / 'loco:<len>'.
function model(name) {
  if (!MODELS[name]) {
    const [kind, len] = name.split(':');
    MODELS[name] = railModel(kind, +len);
  }
  return MODELS[name];
}
const PICK = ['saloon', 'saloon', 'hatch', 'hatch', 'van'];

// Which model an agent drives (by its id).
export function modelFor(id) {
  let h = 0;
  for (const c of String(id)) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193);
  return { name: PICK[(h >>> 3) % PICK.length], hand: (h >>> 7) % VEHICLES.hands };
}

// Heading (radians, world axes) snapped to a direction index.
export function headingIndex(angle) {
  const n = VEHICLES.headings;
  return ((Math.round((angle / (Math.PI * 2)) * n) % n) + n) % n;
}

const cache = new Map();

// Inner SVG for one model, drawn around the origin (its ground point), in
// scene px for `camera`. Cached.
export function vehicleSVG(camera, name, heading, hand) {
  const key = `${name}|${heading}|${hand}|${camera.rotation}|${camera.tile}|${camera.zScale}`;
  let svg = cache.get(key);
  if (svg === undefined) {
    svg = draw(camera, model(name), (heading / VEHICLES.headings) * Math.PI * 2, hand);
    cache.set(key, svg);
  }
  return svg;
}

const COS30 = Math.cos(Math.PI / 6);
const r2 = (n) => Math.round(n * 100) / 100;

function draw(camera, model, angle, hand) {
  const rnd = mulberry32(hand * 7919 + 17);
  const j = () => (rnd() - 0.5) * 2 * VEHICLES.jitter;
  const [c, s] = [Math.cos(angle), Math.sin(angle)];
  // model (x forward, y left, z up) -> world offset -> scene px
  const toWorld = ([x, y, z]) => [x * c - y * s, x * s + y * c, z];
  const project = (p) => {
    const [wx, wy, wz] = toWorld(p);
    const [rx, ry] = rotateQuarter(wx, wy, camera.rotation);
    return [(rx - ry) * COS30 * camera.tile, (rx + ry) * 0.5 * camera.tile - wz * camera.zScale * camera.tile];
  };
  const facing = ([x, y, z]) => camera.facing(toWorld([x, y, z]));
  const poly = (pts) => `M${pts.map((p) => project(p).map(r2).join(' ')).join('L')}Z`;

  // a part's visible faces: { pts, n, side (±1 for the flat sides, 0 for the
  // faces around the profile), x (centre along the car) }
  const faces = (part) => {
    const prof = part.profile.map(([x, z]) => [x + j(), z + j()]);
    const w = part.w;
    const cx = prof.reduce((a, p) => a + p[0], 0) / prof.length, cz = prof.reduce((a, p) => a + p[1], 0) / prof.length;
    const out = [];
    for (const side of [1, -1]) out.push({ pts: prof.map(([x, z]) => [x, side * w, z]), n: [0, side, 0], side, x: cx });
    for (let i = 0; i < prof.length; i++) {
      const [ax, az] = prof[i], [bx, bz] = prof[(i + 1) % prof.length];
      let [nx, nz] = [bz - az, -(bx - ax)];
      if (nx * ((ax + bx) / 2 - cx) + nz * ((az + bz) / 2 - cz) < 0) [nx, nz] = [-nx, -nz];
      out.push({ pts: [[ax, w, az], [bx, w, bz], [bx, -w, bz], [ax, -w, az]], n: [nx, 0, nz], side: 0, x: (ax + bx) / 2 });
    }
    return out.filter((f) => facing(f.n));
  };

  // shrink a face towards its middle (window panes)
  const inset = (pts, k) => {
    const m = pts.reduce((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length, a[2] + p[2] / pts.length], [0, 0, 0]);
    return pts.map((p) => [m[0] + (p[0] - m[0]) * k, m[1] + (p[1] - m[1]) * k, m[2] + (p[2] - m[2]) * k]);
  };

  const body = faces(model.body);
  const cabin = model.cabin ? faces(model.cabin) : [];
  const top = model.top ? faces(model.top) : [];
  // wheels on the side that shows, as inked discs
  const near = [1, -1].find((side) => facing([0, side, 0])) ?? 1; // seen head-on: either
  let wheels = '';
  const { r } = model.wheels;
  for (const wx of model.wheels.x) {
    const pts = [];
    for (let k = 0; k < 10; k++) {
      const t = (k / 10) * Math.PI * 2;
      pts.push([wx + Math.cos(t) * r, near * (model.body.w + 0.002), r + Math.sin(t) * r]);
    }
    wheels += poly(pts);
  }
  // windows: the cabin's faces but the roof, or the body faces `glass`
  // picks, shrunk to panes; plus any side `panes` (profiles) on the near side
  const glass = model.cabin
    ? cabin.filter((f) => f.n[2] < 0.9 * Math.hypot(...f.n))
    : body.filter(model.glass ?? (() => false));
  let windows = glass.map((f) => poly(inset(f.pts, f.side ? 0.7 : 0.72))).join('');
  for (const pane of model.panes ?? []) windows += poly(pane.map(([x, z]) => [x, near * (model.body.w + 0.001), z]));
  return `<path class="vb" d="${body.map((f) => poly(f.pts)).join('')}"/>`
    + `<path class="vi" d="${wheels}"/>`
    + `<path class="vb" d="${[...cabin, ...top].map((f) => poly(f.pts)).join('')}"/>`
    + `<path class="vi" d="${windows}"/>`;
}
