// Vehicles as little hand-drawn models: cars, trucks, buses, trains.
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
//   vault   { x: [x0, x1], z, rise, segs, slope, glass }, an arched roof across
//           the body's width (segs 3: a chamfer), its ends leaning back by
//           slope at the top, glazed if glass
//   top     plain roof gear (no windows), or a list of parts standing on
//           the body (drawn back to front), each may have its own vault
//   wheels  { x: [positions along], r }, inked discs on the near side
//   lamps   [{ x, z, r }] round lamps on the end face at x (±, facing out)
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

// Profiles, grid units. The eras' vehicles:
//   hatch   Škoda Favorit – a wedge: low sloping bonnet, long glasshouse,
//           an almost upright hatch
//   saloon  Škoda 120 – long bonnet and boot, cabin in the middle
//   lada    Lada 2107 – a boxy saloon, flat bonnet and boot
//   volga   GAZ-24 Volga – a big long saloon
//   trabant Trabant 601 Universal – small, the roof running to an upright back
//   van     Škoda 1203 – a short rounded nose, then one tall box with a row
//           of side windows
//   bus     Karosa 700 series – a long box, a big raked windscreen, a row of
//           large windows, a glazed front door, the stripe of the livery
//   trucks  one rigid model each (see truckFor): a Praga V3S (bonnet, cab
//           behind it; canvas-covered, a box body or an open flatbed) or a
//           Tatra 815 (cab-over, a tipper body), three axles
// `glass` gets each face with n (normal), x and z (its middle along the car
// and up), side (±1 the flat sides, 0 the faces round the profile).
const MODELS = {
  hatch: {
    body: { w: 0.035, profile: [[-0.074, 0.012], [0.074, 0.012], [0.077, 0.027], [0.072, 0.036], [0.028, 0.045], [-0.072, 0.047], [-0.076, 0.03]] },
    cabin: { w: 0.032, profile: [[-0.071, 0.047], [0.028, 0.045], [-0.006, 0.071], [-0.058, 0.072]] },
    wheels: { x: [-0.047, 0.05], r: 0.015 },
  },
  saloon: {
    body: { w: 0.036, profile: [[-0.085, 0.012], [0.085, 0.012], [0.085, 0.034], [0.07, 0.042], [-0.08, 0.042], [-0.085, 0.036]] },
    cabin: { w: 0.032, profile: [[-0.045, 0.042], [0.032, 0.042], [0.016, 0.07], [-0.036, 0.07]] },
    wheels: { x: [-0.05, 0.05], r: 0.015 },
  },
  volga: {
    body: { w: 0.038, profile: [[-0.095, 0.012], [0.095, 0.012], [0.096, 0.03], [0.09, 0.04], [0.035, 0.044], [-0.05, 0.044], [-0.092, 0.042], [-0.096, 0.03]] },
    cabin: { w: 0.034, profile: [[-0.05, 0.044], [0.035, 0.044], [0.015, 0.071], [-0.035, 0.071]] },
    wheels: { x: [-0.058, 0.058], r: 0.016 },
  },
  lada: {
    body: { w: 0.036, profile: [[-0.083, 0.012], [0.083, 0.012], [0.083, 0.038], [0.03, 0.043], [-0.083, 0.043], [-0.084, 0.03]] },
    cabin: { w: 0.032, profile: [[-0.045, 0.043], [0.03, 0.043], [0.012, 0.071], [-0.04, 0.071]] },
    wheels: { x: [-0.05, 0.052], r: 0.015 },
  },
  trabant: {
    body: { w: 0.032, profile: [[-0.07, 0.013], [0.07, 0.013], [0.071, 0.03], [0.066, 0.037], [0.028, 0.042], [-0.07, 0.042]] },
    cabin: { w: 0.03, profile: [[-0.07, 0.042], [0.028, 0.042], [0.01, 0.066], [-0.068, 0.066]] },
    wheels: { x: [-0.044, 0.046], r: 0.014 },
  },
  van: {
    body: { w: 0.038, profile: [[-0.086, 0.012], [0.086, 0.012], [0.09, 0.03], [0.085, 0.05], [0.066, 0.058], [0.05, 0.09], [-0.084, 0.09], [-0.088, 0.03]] },
    vault: { x: [-0.084, 0.05], z: 0.09, rise: 0.006 },
    wheels: { x: [-0.056, 0.054], r: 0.016 },
    glass: (face) => face.side === 0 && face.n[0] > 0 && face.x > 0.052 && face.z > 0.06, // the windscreen
    panes: [
      [[0.012, 0.062], [0.046, 0.062], [0.042, 0.084], [0.012, 0.084]], // the door
      ...[-0.076, -0.044, -0.012].map((x) => [[x, 0.062], [x + 0.026, 0.062], [x + 0.026, 0.084], [x, 0.084]]),
    ],
  },
  bus: {
    body: { w: 0.044, profile: [[-0.12, 0.014], [0.12, 0.014], [0.121, 0.05], [0.115, 0.098], [-0.12, 0.098], [-0.12, 0.03]] },
    vault: { x: [-0.12, 0.115], z: 0.098, rise: 0.007 },
    wheels: { x: [-0.066, 0.07], r: 0.019 },
    glass: (face) => face.side === 0 && face.n[0] > 0 && face.x > 0.11 && face.z > 0.06, // the windscreen
    panes: [
      [[0.09, 0.03], [0.108, 0.03], [0.108, 0.09], [0.09, 0.09]], // the front door
      [[-0.116, 0.046], [0.086, 0.046], [0.086, 0.051], [-0.116, 0.051]], // the stripe
      ...Array.from({ length: 6 }, (_, i) => {
        const x0 = -0.112 + i * 0.033;
        return [[x0, 0.058], [x0 + 0.028, 0.058], [x0 + 0.028, 0.09], [x0, 0.09]];
      }),
    ],
  },
  // Trucks, one rigid model each, 0.2 long: a chassis (body) with the cab
  // and the load standing on it (top, drawn back to front).
  // Praga V3S: a bonnet in front of the cab, three axles; a canvas-covered
  // back, a box body with windows, or an open flatbed with low sides.
  'v3s-canvas': v3s({ w: 0.046, profile: [[-0.1, 0.058], [-0.006, 0.058], [-0.006, 0.096], [-0.1, 0.096]], vault: { x: [-0.1, -0.006], z: 0.096, rise: 0.012 } }),
  'v3s-box': v3s({ w: 0.046, profile: [[-0.1, 0.058], [-0.006, 0.058], [-0.006, 0.1], [-0.1, 0.1]], vault: { x: [-0.1, -0.006], z: 0.1, rise: 0.008 } },
    [-0.05, -0.028].map((x) => [[x, 0.072], [x + 0.014, 0.072], [x + 0.014, 0.09], [x, 0.09]])),
  'v3s-open': v3s({ w: 0.046, profile: [[-0.1, 0.058], [-0.006, 0.058], [-0.006, 0.074], [-0.1, 0.074]] }),
  // Tatra 815: a tall cab-over with a big raked windscreen, a tipper body
  t815: {
    body: { w: 0.036, profile: [[-0.1, 0.024], [0.1, 0.024], [0.1, 0.05], [-0.1, 0.05]] },
    top: [
      { w: 0.042, profile: [[0.03, 0.05], [0.101, 0.05], [0.097, 0.092], [0.092, 0.098], [0.03, 0.098]] },
      { w: 0.045, profile: [[-0.094, 0.05], [0.022, 0.05], [0.022, 0.088], [-0.1, 0.088], [-0.1, 0.062]] },
    ],
    wheels: { x: [0.064, -0.05, -0.076], r: 0.021 },
    glass: (face) => face.side === 0 && face.n[0] > 0 && face.z > 0.06 && face.x > 0.09, // the windscreen
    panes: [[[0.04, 0.062], [0.07, 0.062], [0.07, 0.088], [0.04, 0.088]]],
  },
};

// A V3S with `load` on the back (a top part), and panes of its own.
function v3s(load, panes = []) {
  return {
    body: { w: 0.036, profile: [[-0.1, 0.024], [0.1, 0.024], [0.1, 0.044], [0.095, 0.058], [-0.1, 0.058]] },
    top: [{ w: 0.04, profile: [[0, 0.058], [0.056, 0.058], [0.052, 0.095], [0, 0.096]] }, load],
    wheels: { x: [0.076, -0.05, -0.078], r: 0.021 },
    glass: (face) => face.side === 0 && face.n[0] > 0 && face.z > 0.066 && face.x > 0.045, // the windscreen
    panes: [[[0.012, 0.066], [0.044, 0.066], [0.044, 0.088], [0.012, 0.088]], ...panes],
  };
}

// Which model a truck is drawn as, by its id.
const TRUCKS = ['v3s-canvas', 'v3s-open', 'v3s-box', 't815', 't815'];
export function truckFor(id) {
  let h = 0;
  for (const c of String(id)) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193);
  return TRUCKS[(h >>> 5) % TRUCKS.length];
}

// Railway carriages `len` long (their spacing on the track, less a gap),
// after the ČD coaches and the class 753 diesel: a coach is a box body under
// an arched roof with a row of windows and a stripe below them; for the
// locomotive see below.
// RAIL_SCALE sizes their height and details, RAIL_WIDTH their width (1 = a
// car's).
const RAIL_SCALE = 1.7, RAIL_WIDTH = 1.25;
function railModel(kind, len) {
  const h = len / 2, k = RAIL_SCALE, kw = RAIL_WIDTH;
  const [base, eaves, rise] = [0.016 * k, 0.068 * k, 0.014 * k];
  const wheels = { x: [-h + 0.022 * k, -h + 0.045 * k, h - 0.045 * k, h - 0.022 * k], r: 0.011 * k };
  const [z0, z1] = [0.044 * k, 0.06 * k]; // window band
  const a = 0.01 * k; // stripe inset from the ends
  const stripe = [[-h + a, 0.03 * k], [h - a, 0.03 * k], [h - a, 0.035 * k], [-h + a, 0.035 * k]];
  if (kind === 'loco') {
    // ČD class 753 / 752 ("brejlovec"), simplified: one body under an arched
    // roof like the coaches; at each end the cab window in a frame standing
    // out of the front; a cab side window at each end; a few lines of the
    // livery – the stripe low down, the colour split at the windows, a band
    // under the roof, the doors behind the cabs
    const win = 0.05 * k, c = 0.05 * k, out = 0.005 * k, top = eaves - 0.003 * k;
    const cabWindow = (x0, x1) => [[x0, win + 0.002 * k], [x1, win + 0.002 * k], [x1, 0.064 * k], [x0, 0.064 * k]];
    const line = (x0, x1, z, t = 0.0012 * k) => [[x0, z], [x1, z], [x1, z + t], [x0, z + t]];
    const upright = (x) => [[x, base + 0.006 * k], [x + 0.0012 * k, base + 0.006 * k], [x + 0.0012 * k, top], [x, top]];
    const door = c + 0.006 * k;
    return {
      body: { w: 0.042 * kw, profile: [[-h, base], [h, base], [h, eaves], [-h, eaves]] },
      vault: { x: [-h, h], z: eaves, rise },
      top: [-1, 1].map((d) => ({ w: 0.036 * kw, end: true, profile: d > 0
        ? [[h - 0.002, win - 0.002 * k], [h + out, win - 0.002 * k], [h + out, top], [h - 0.002, top]]
        : [[-h - out, win - 0.002 * k], [-h + 0.002, win - 0.002 * k], [-h + 0.002, top], [-h - out, top]] }))
        // the roof gear in the middle
        .concat({ w: 0.02 * kw, profile: [[-h * 0.4, eaves + rise * 0.7], [h * 0.4, eaves + rise * 0.7], [h * 0.4, eaves + rise + 0.008 * k], [-h * 0.4, eaves + rise + 0.008 * k]] }),
      // a headlamp over each window, on the roof's end
      lamps: [-1, 1].map((d) => ({ x: d * (h + 0.001), z: eaves + rise * 0.45, r: 0.0045 * k })),
      wheels,
      // the fronts of the window frames
      glass: (face) => face.side === 0 && Math.abs(face.n[0]) > 0.9 * Math.hypot(...face.n) && Math.abs(face.x) > h + out / 2,
      panes: [
        cabWindow(h - c, h - 0.012 * k), cabWindow(-h + 0.012 * k, -h + c), stripe,
        line(-h + 0.004, h - 0.004, win), line(-h + 0.004, h - 0.004, eaves - 0.008 * k),
        upright(h - door), upright(-h + door - 0.0012 * k),
      ],
    };
  }
  const end = 0.025 * k; // no windows over the doors at the ends
  const n = Math.max(2, Math.floor((len - 2 * end) / (0.032 * k)));
  const step = (len - 2 * end) / n;
  const panes = [stripe];
  for (let i = 0; i < n; i++) {
    const x0 = -h + end + i * step + step * 0.2;
    panes.push([[x0, z0], [x0 + step * 0.6, z0], [x0 + step * 0.6, z1], [x0, z1]]);
  }
  return {
    body: { w: 0.042 * kw, profile: [[-h, base], [h, base], [h, eaves], [-h, eaves]] },
    vault: { x: [-h, h], z: eaves, rise },
    wheels, panes,
  };
}

// A model by name: one of MODELS, or 'coach:<len>' / 'loco:<len>'.
function model(name) {
  if (!MODELS[name]) {
    const [kind, len] = name.split(':');
    MODELS[name] = railModel(kind, +len);
  }
  return MODELS[name];
}

const PICK = ['hatch', 'hatch', 'hatch', 'saloon', 'saloon', 'lada', 'lada', 'trabant', 'trabant', 'volga', 'van'];

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
    for (const side of [1, -1]) out.push({ pts: prof.map(([x, z]) => [x, side * w, z]), n: [0, side, 0], side, x: cx, z: cz });
    for (let i = 0; i < prof.length; i++) {
      const [ax, az] = prof[i], [bx, bz] = prof[(i + 1) % prof.length];
      let [nx, nz] = [bz - az, -(bx - ax)];
      if (nx * ((ax + bx) / 2 - cx) + nz * ((az + bz) / 2 - cz) < 0) [nx, nz] = [-nx, -nz];
      out.push({ pts: [[ax, w, az], [bx, w, bz], [bx, -w, bz], [ax, -w, az]], n: [nx, 0, nz], side: 0, x: (ax + bx) / 2, z: (az + bz) / 2 });
    }
    return out.filter((f) => facing(f.n));
  };

  // shrink a face towards its middle (window panes)
  const inset = (pts, k) => {
    const m = pts.reduce((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length, a[2] + p[2] / pts.length], [0, 0, 0]);
    return pts.map((p) => [m[0] + (p[0] - m[0]) * k, m[1] + (p[1] - m[1]) * k, m[2] + (p[2] - m[2]) * k]);
  };

  // an arched roof (model.vault) over the body's width: strips along x
  // round the arch, closed at both ends
  // (segs 3: a chamfer – sloping sides, a flat top; slope: how far the ends
  // lean back at the top, cap: the end faces, flagged)
  const vault = ({ x: [x0, x1], z, rise, segs = 6, slope = 0 }, w) => {
    const arc = Array.from({ length: segs + 1 }, (_, i) => (i / segs) * Math.PI);
    const at = (t) => [w * Math.cos(t), z + rise * Math.sin(t)];
    const lean = (t) => slope * Math.sin(t);
    const out = [];
    for (let i = 0; i < segs; i++) {
      const [ta, tb] = [arc[i], arc[i + 1]], [ya, za] = at(ta), [yb, zb] = at(tb), tm = (ta + tb) / 2;
      out.push({ pts: [[x0 + lean(ta), ya, za], [x1 - lean(ta), ya, za], [x1 - lean(tb), yb, zb], [x0 + lean(tb), yb, zb]], n: [0, Math.cos(tm) / w, Math.sin(tm) / rise], side: 0, x: 0 });
    }
    for (const [x, d] of [[x0, 1], [x1, -1]]) {
      out.push({ pts: arc.map((t) => [x + d * lean(t), ...at(t)]), n: [-d, 0, slope / rise], side: 0, x, cap: true });
    }
    return out.filter((f) => facing(f.n));
  };

  const body = faces(model.body);
  const roof = model.vault ? vault(model.vault, model.body.w) : [];
  const cabin = model.cabin ? faces(model.cabin) : [];
  // parts on top, the one further back first
  const back = (p) => {
    const cx = p.profile.reduce((a, q) => a + q[0], 0) / p.profile.length;
    const [rx, ry] = rotateQuarter(...toWorld([cx, 0, 0]).slice(0, 2), camera.rotation);
    return rx + ry;
  };
  const tops = [].concat(model.top ?? []).sort((a, b) => back(a) - back(b));
  const partFaces = (p) => [...faces(p), ...(p.vault ? vault(p.vault, p.w) : [])];
  // parts on an end (`end`: they stick out of it) go before the body when
  // that end is the far one, so the body hides them
  const behind = tops.filter((p) => p.end && back(p) < 0).map(partFaces);
  const topParts = tops.filter((p) => !(p.end && back(p) < 0)).map(partFaces);
  const top = [...behind, ...topParts].flat();
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
    : [...body, ...top].filter(model.glass ?? (() => false));
  // splitGlass: each window in two side by side (a face round the profile:
  // pts [a+, b+, b-, a-], split between its + and - sides)
  const halves = (pts) => {
    const mid = (a, b) => a.map((v, i) => (v + b[i]) / 2);
    const [p0, p1, p2, p3] = pts, m12 = mid(p1, p2), m30 = mid(p3, p0);
    return [[p0, p1, m12, m30], [m30, m12, p2, p3]];
  };
  let windows = glass.flatMap((f) => (model.splitGlass && f.pts.length === 4 ? halves(f.pts) : [f.pts])
    .map((pts) => poly(inset(pts, f.side ? 0.7 : 0.72)))).join('');
  // glazed vault ends: two windscreens side by side, split down the middle
  if (model.vault?.glass) {
    for (const { pts } of roof.filter((f) => f.cap)) {
      const [p0, pn] = [pts[0], pts[pts.length - 1]];
      const mid = (a, b) => a.map((v, i) => (v + b[i]) / 2);
      const mb = mid(p0, pn), mt = mid(pts[1], pts[pts.length - 2]);
      windows += poly(inset([p0, pts[1], mt, mb], 0.72)) + poly(inset([mb, mt, pts[pts.length - 2], pn], 0.72));
    }
  }
  for (const pane of model.panes ?? []) windows += poly(pane.map(([x, z]) => [x, near * (model.body.w + 0.001), z]));
  // lamps: round, on the end faces (x) that show
  for (const { x, z, r: lr } of model.lamps ?? []) {
    if (!facing([Math.sign(x), 0, 0])) continue;
    windows += poly(Array.from({ length: 12 }, (_, i) => [x, Math.cos((i / 12) * Math.PI * 2) * lr, z + Math.sin((i / 12) * Math.PI * 2) * lr]));
  }
  const pathOf = (fs) => `<path class="vb" d="${fs.map((f) => poly(f.pts)).join('')}"/>`;
  return behind.map(pathOf).join('')
    + `<path class="vb" d="${body.map((f) => poly(f.pts)).join('')}"/>`
    + `<path class="vi" d="${wheels}"/>`
    + `<path class="vb" d="${[...roof, ...cabin].map((f) => poly(f.pts)).join('')}"/>`
    // each part on top its own path, so a nearer one hides the one behind
    + topParts.map(pathOf).join('')
    + `<path class="vi" d="${windows}"/>`;
}
