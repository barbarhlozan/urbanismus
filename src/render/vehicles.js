// Vehicles as little hand-drawn models: the car, the lorry, the fire
// engine, the bus and the railcar – one of each, as Czechoslovak roads and
// lines had them in the 1970s.
//
// A model is made of parts, each a side profile – a convex polygon in (x, z),
// x forward, z up, in grid units – pushed out sideways to its half width w.
// They are drawn through the same isometric projection as the buildings,
// turned to the way the vehicle is heading, back faces dropped, as a doodle:
// each part only its outline, wheel rings, windows drawn round.
//
//   body     the main part (required); round: its profile's corners rounded
//            off by up to this much
//   cabin    a glasshouse on the body, its shape the windows: split, x of
//            the pillars between them, side: [x0, x1] where the side glass
//            ends – each drawn a line on its sides
//   vault    { x: [x0, x1], z, rise, segs }, an arched roof across the body
//   top      parts standing on the body (drawn back to front), each may
//            stand off the middle (y, across) or stick out of an end (end)
//   wheels   { x: [positions along], r }
//   outlines [{ w, profile }]: windows and doors drawn round on the near side
//   lamps    [{ x, y, z, r } or { x, y, z, w, h, line }] round or square lamps
//            on the end face at x (±, facing out), y across it (0 the
//            middle); line: a pane drawn round instead (a windscreen)
//
// Projecting every vehicle every frame would cost too much, so a drawing is
// made once per model, heading on screen (its heading on the ground plus
// the view's turn, snapped to VEHICLES.headings directions) and hand
// (VEHICLES.hands slightly different jitters, so no two in a row look
// stamped) and cached as SVG. Per frame a vehicle only moves, and swaps its
// drawing when it turns into another direction.

import { mulberry32 } from '../core/random.js';

export const VEHICLES = {
  minZoom: 1.6,  // closer than this vehicles are models, further out dots
  headings: 32,  // directions a model can face
  hands: 4,      // jitter variants per model
  jitter: 0.0025, // grid units a profile corner may stray
  // the hand on screen, as the buildings' (LOOK.sketch): each edge bowed by
  // up to `bow` of its length, each corner nudged by up to `nudge` grid
  // units (less on small shapes); keyed on the point on the model, so a
  // turning vehicle keeps its strokes and faces meeting share them
  bow: 0.05,
  nudge: 0.0014,
};

// Models are measured in metres, from photos and drawings of the real
// thing, and put on the map at the scale of a grid step (24.5 m, see
// config.sim), heights at a person's (a walker is 0.08 high, 1.75 m).
// For a model L metres long: at(f, h) is the profile point f metres back
// from its front and h up; x(f) and z(h) the one coordinate; y(m) a width
// (and lamp sizes); h(m) a height (a wheel's radius).
const M = 0.041, MH = 0.046;
const r4 = (n) => Math.round(n * 1e4) / 1e4;
function metres(L) {
  const x = (f) => r4((L / 2 - f) * M), z = (h) => r4(h * MH);
  return { at: (f, h) => [x(f), z(h)], x, z, y: (m) => r4(m * M), h: z };
}

const MODELS = {};

// Škoda 105 / 120 (1976–90), the car of the time, its shape measured off
// photos of one side on (4.16 m long, 1.40 high, 1.62 wide, wheelbase
// 2.45) but drawn as a doodle: the outline of the body and of the
// glasshouse on it, both rounded off (its shape the windows, a line
// for each pillar), round headlamps, the tail lamps, wheel
// rings. A short front, a low nose and an almost flat bonnet to a raked
// windscreen; a flat roof, a long sloping back window and a boot deck
// behind it, the back dropping off square.
MODELS.car = (() => {
  const L = 4.16, { at, x, y, z, h } = metres(L);
  return {
    body: { w: y(0.8), round: y(0.3), profile: [at(0.05, 0.3), at(4.1, 0.3), at(L, 0.42), at(L, 0.82), at(4.05, 0.9), at(3.53, 0.93), at(1.29, 0.95), at(0.14, 0.86), at(0, 0.78), at(0, 0.42)] },
    cabin: { w: y(0.7), round: y(0.16), split: [x(2.2)], side: [x(2.95), Infinity], profile: [at(3.53, 0.93), at(1.29, 0.95), at(1.65, 1.4), at(3.06, 1.41)] },
    wheels: { x: [x(0.8), x(3.25)], r: h(0.3) },
    lamps: [
      ...[-1, 1].map((d) => ({ x: x(0) + 0.0005, y: d * y(0.56), z: z(0.62), r: y(0.08) })),
      ...[-1, 1].map((d) => ({ x: x(L) - 0.0005, y: d * y(0.62), z: z(0.62), w: y(0.14), h: z(0.2) })),
    ],
  };
})();

// Škoda 706 RT valník (1957–86), the lorry of the time: a tall rounded
// cab-over, the front wheels under its door, and a dropside bed behind
// (8.2 m long, 2.5 wide, the cab 2.75 high, wheelbase 4.6), a doodle as
// the car is: the outlines of the frame, the cab and the bed, the
// windscreen and the door's window drawn round, round headlamps low on
// the cab's front, wheel rings.
MODELS.truck = (() => {
  const L = 8.2, { at, x, y, z, h } = metres(L);
  const cab = y(1.2);
  return {
    // the frame, low between the wheels
    body: { w: y(0.9), round: y(0.1), profile: [at(0.3, 0.7), at(L - 0.1, 0.7), at(L - 0.1, 1.1), at(0.3, 1.1)] },
    top: [
      { w: cab, round: y(0.45), profile: [at(0, 0.85), at(2.15, 0.85), at(2.15, 2.65), at(1.9, 2.75), at(0.35, 2.75), at(0.1, 2.55), at(0, 1.7)] },
      // the bed and its dropsides
      { w: y(1.25), round: y(0.05), profile: [at(2.35, 1.15), at(L, 1.15), at(L, 1.85), at(2.35, 1.85)] },
    ],
    wheels: { x: [x(1.25), x(5.85)], r: h(0.5) },
    outlines: [
      { w: cab, profile: [at(0.35, 1.95), at(1.3, 1.95), at(1.3, 2.5), at(0.45, 2.5)] }, // the door's window
    ],
    lamps: [
      { x: x(0.05), z: z(2.1), w: y(2.0), h: z(0.6), line: true }, // the windscreen
      ...[-1, 1].map((d) => ({ x: x(0) + 0.0005, y: d * y(0.85), z: z(1.15), r: y(0.11) })),
    ],
  };
})();

// Škoda 706 RTHP CAS 25 (1960s–80s), every brigade's engine, village
// fire house or station: the 706's cab-over front made a long crew cab,
// a tall body behind with the lockers' roller shutters down its side,
// the ladder along its roof and the beacon on the cab (7.9 m long, 2.5
// wide, 2.95 high over the ladder, wheelbase 4.0); a doodle as the lorry.
MODELS.fire = (() => {
  const L = 7.9, { at, x, y, z, h } = metres(L);
  const cab = y(1.2), box = y(1.25);
  return {
    body: { w: y(0.9), round: y(0.1), profile: [at(0.3, 0.7), at(L - 0.1, 0.7), at(L - 0.1, 1.1), at(0.3, 1.1)] },
    top: [
      { w: cab, round: y(0.45), profile: [at(0, 0.85), at(3.2, 0.85), at(3.2, 2.65), at(2.95, 2.75), at(0.35, 2.75), at(0.1, 2.55), at(0, 1.7)] },
      { w: box, round: y(0.15), profile: [at(3.3, 0.9), at(L, 0.9), at(L, 2.6), at(3.3, 2.6)] },
      // the ladder on the roof, the beacon on the cab
      { w: y(0.3), profile: [at(3.4, 2.62), at(L - 0.1, 2.62), at(L - 0.1, 2.8), at(3.4, 2.8)] },
      { w: y(0.12), round: y(0.06), profile: [at(0.9, 2.74), at(1.15, 2.74), at(1.12, 2.95), at(0.93, 2.95)] },
    ],
    wheels: { x: [x(1.3), x(5.3)], r: h(0.5) },
    outlines: [
      { w: cab, profile: [at(0.35, 1.95), at(1.3, 1.95), at(1.3, 2.5), at(0.45, 2.5)] }, // the driver's door window
      { w: cab, profile: [at(1.75, 1.95), at(2.9, 1.95), at(2.9, 2.5), at(1.75, 2.5)] }, // the crew's
      // the roller shutters
      ...[[3.55, 5.0], [5.9, 7.65]].map(([f0, f1]) => ({ w: box, profile: [at(f0, 1.15), at(f1, 1.15), at(f1, 2.4), at(f0, 2.4)] })),
    ],
    lamps: [
      { x: x(0.05), z: z(2.1), w: y(2.0), h: z(0.6), line: true }, // the windscreen
      ...[-1, 1].map((d) => ({ x: x(0) + 0.0005, y: d * y(0.85), z: z(1.15), r: y(0.11) })),
    ],
  };
})();

// Karosa ŠM 11 (1964–81), the bus out to the villages: one long box, its
// roof's edges well rounded, the windscreen raked back, the door ahead of
// the front wheels and a long band of windows (11 m long, 2.5 wide, 3.0
// high, wheelbase 5.5); a doodle as the car is: the body's outline, the
// window band drawn round with a line for each pillar, the door,
// the windscreen, round headlamps, wheel rings.
MODELS.bus = (() => {
  const L = 11, { at, x, y, z, h } = metres(L);
  const w = y(1.25);
  const [b0, b1] = [1.75, 2.6]; // the window band
  const pillars = [];
  for (let f = 2.75; f < L - 0.8; f += 1.2) pillars.push({ w, profile: [at(f, b0), at(f, b1)] });
  return {
    body: { w, round: y(0.45), profile: [at(0, 0.45), at(L, 0.45), at(L, 2.85), at(L - 0.25, 3.0), at(0.45, 3.0), at(0.1, 2.75), at(0, 1.3)] },
    wheels: { x: [x(2.5), x(8.0)], r: h(0.5) },
    outlines: [
      { w, profile: [at(0.55, 0.6), at(1.45, 0.6), at(1.45, 2.6), at(0.55, 2.6)] }, // the door
      { w, profile: [at(1.6, b0), at(L - 0.4, b0), at(L - 0.4, b1), at(1.6, b1)] }, // the windows
      ...pillars,
    ],
    lamps: [
      { x: x(0.05), z: z(2.05), w: y(2.1), h: z(1.0), line: true }, // the windscreen
      ...[-1, 1].map((d) => ({ x: x(0) + 0.0005, y: d * y(0.85), z: z(0.95), r: y(0.11) })),
    ],
  };
})();

// ČSD M 152.0 (ČD 810, 1973–82), the railcar of the local lines, `len`
// grid units long (config.trains.length; 14 m at the cars' scale): one
// box under a low arched roof, a cab at each end with its two windscreens,
// along the side a cab window, a folding door, the band of windows, a
// door, a cab window; a lamp low each side of the ends and one up top,
// little buffers; a pair of wheels under each end. A doodle as the road
// vehicles are: the outlines of the body and its roof, the windows drawn
// round with a line for each pillar, wheel rings.
function railModel(len) {
  const L = len / M, { at, x, y, z, h } = metres(L);
  const w = y(1.3), [b0, b1] = [2.0, 2.8]; // the window band
  const box = (f0, f1, h0 = b0, h1 = b1) => ({ w, profile: [at(f0, h0), at(f1, h0), at(f1, h1), at(f0, h1)] });
  const pillars = [];
  for (let f = 4.3; f < L - 3.2; f += 1.2) pillars.push({ w, profile: [at(f, b0), at(f, b1)] });
  const ends = [x(0) + 0.0005, x(L) - 0.0005];
  return {
    body: { w, round: y(0.15), profile: [at(0, 0.8), at(L, 0.8), at(L, 3.1), at(0, 3.1)] },
    vault: { x: [x(L), x(0)], z: z(3.1), rise: h(0.35) },
    top: [-1, 1].flatMap((d) => [-1, 1].map((side) => ({ w: y(0.12), y: side * y(1.0), end: true, profile: [
      [d * x(-0.15), z(0.95)], [d * (x(0) - 0.0005), z(0.95)], [d * (x(0) - 0.0005), z(1.2)], [d * x(-0.15), z(1.2)],
    ] }))),
    wheels: { x: [x(1.0), x(2.0), x(L - 2.0), x(L - 1.0)], r: h(0.42) },
    outlines: [
      box(0.25, 1.35), box(L - 1.35, L - 0.25),             // the cab windows
      box(1.6, 2.7, 0.95), box(L - 2.7, L - 1.6, 0.95),      // the doors
      box(3.1, L - 3.1), ...pillars,                         // the windows
    ],
    lamps: ends.flatMap((ex) => [
      ...[-1, 1].map((d) => ({ x: ex, y: d * y(0.6), z: z(2.4), w: y(1.0), h: z(0.75), line: true })), // the windscreens
      ...[-1, 1].map((d) => ({ x: ex, y: d * y(0.95), z: z(1.45), r: y(0.1) })),
      { x: ex, z: z(3.15), r: y(0.09) },
    ]),
  };
}

// A model by name: one of MODELS, or 'railcar:<len>' (made on demand).
export const MODEL_NAMES = Object.keys(MODELS);

function model(name) {
  return (MODELS[name] ??= railModel(+name.split(':')[1]));
}

// The car an agent drives, or one parked in a stall (by its id): which
// hand it's drawn in.
export function modelFor(id) {
  let h = 0;
  for (const c of String(id)) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193);
  return { name: 'car', hand: (h >>> 7) % VEHICLES.hands };
}

// The model a truck is drawn as.
export function truckFor() {
  return 'truck';
}

// Heading (radians, world axes) snapped to a direction index.
export function headingIndex(angle) {
  const n = VEHICLES.headings;
  return ((Math.round((angle / (Math.PI * 2)) * n) % n) + n) % n;
}

const cache = new Map();

// Inner SVG for one model heading `heading` (a VEHICLES.headings index, on
// the ground), drawn around the origin (its ground point), in scene px for
// `camera`. Cached by its heading on screen.
export function vehicleSVG(camera, name, heading, hand) {
  const n = VEHICLES.headings;
  const seen = headingIndex((heading / n) * Math.PI * 2 + camera.angle);
  const key = `${name}|${seen}|${hand}|${camera.tile}|${camera.zScale}`;
  let svg = cache.get(key);
  if (svg === undefined) {
    svg = draw(isoView(camera), model(name), (seen / n) * Math.PI * 2, hand);
    cache.set(key, svg);
  }
  return svg;
}

// The same drawing through any view (not cached), e.g. the photo camera
// (photo.js). `angle`: heading in radians, world axes. A view takes world
// offsets from the vehicle's ground point:
//   project(o) -> [x, y] on screen
//   facing(n, o) -> is a surface with world normal n through o seen
//   depth(o) -> larger = nearer the viewer
export function vehicleSVGIn(view, name, angle, hand) {
  return draw(view, model(name), angle, hand);
}

const COS30 = Math.cos(Math.PI / 6);
const r2 = (n) => Math.round(n * 100) / 100;

// The map's isometric view, unturned (headings are taken on screen), around
// the origin in scene px.
function isoView(camera) {
  return {
    project: ([wx, wy, wz]) => [(wx - wy) * COS30 * camera.tile, (wx + wy) * 0.5 * camera.tile - wz * camera.zScale * camera.tile],
    facing: ([nx, ny, nz]) => nx + ny + nz / camera.zScale > 1e-9,
    depth: ([wx, wy]) => wx + wy,
  };
}

function draw(view, model, angle, hand) {
  const rnd = mulberry32(hand * 7919 + 17);
  const j = () => (rnd() - 0.5) * 2 * VEHICLES.jitter;
  const [c, s] = [Math.cos(angle), Math.sin(angle)];
  // model (x forward, y left, z up) -> world offset -> screen
  const toWorld = ([x, y, z]) => [x * c - y * s, x * s + y * c, z];
  const project = (p) => view.project(toWorld(p));
  // `p` (model coordinates): a point on the surface, for views in perspective
  const facing = (n, p = [0, 0, 0]) => view.facing(toWorld(n), toWorld(p));
  // the nudge on screen: grid units straight up there
  const nudge = VEHICLES.nudge * Math.hypot(...[0, 1].map((i) => project([0, 0, 1])[i] - project([0, 0, 0])[i]));
  // -1…1, the same for the same point on the model and hand
  const hash = (p, k) => {
    const v = Math.sin(p[0] * 9137.1 + p[1] * 7121.7 + p[2] * 5431.3 + hand * 97.3 + k * 13.7) * 43758.5453;
    return (v - Math.floor(v)) * 2 - 1;
  };
  // (`strip`: a thin shape may bend as one stroke – not a part's face,
  // whose edges are shared with the faces next to it)
  const poly = (pts, strip = true) => {
    const scr = pts.map(project), n = scr.length;
    const len = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
    const size = Math.max(...scr.map((q, i) => len(q, scr[(i + 1) % n])));
    const k = Math.min(nudge, size * 0.04);
    const moved = scr.map((q, i) => [q[0] + hash(pts[i], 1) * k, q[1] + hash(pts[i], 2) * k]);
    const edges = moved.map((a, i) => len(a, moved[(i + 1) % n]));
    const long = Math.max(...edges), li = edges.indexOf(long);
    // a thin shape (a strip, a shut line) bends as one stroke: its long
    // edges all pushed the same way
    const thin = strip && Math.min(...edges) < 0.25 * long;
    const [ua, ub] = [moved[li], moved[(li + 1) % n]];
    const shared = hash(pts.reduce((m, p) => m.map((v, k) => v + p[k] / n), [0, 0, 0]), 4) * VEHICLES.bow * long;
    let d = `M${moved[0].map(r2).join(' ')}`;
    for (let i = 0; i < n; i++) {
      const a = moved[i], b = moved[(i + 1) % n], l = edges[i] || 1;
      let [ox, oy] = [0, 0];
      if (thin) {
        if (l > 0.5 * long) [ox, oy] = [-((ub[1] - ua[1]) / long) * shared, ((ub[0] - ua[0]) / long) * shared];
      } else {
        const [p, q] = [pts[i], pts[(i + 1) % n]];
        const mid = p.map((v, k) => (v + q[k]) / 2); // (the edge's own, either way round)
        const flip = p[0] < q[0] || (p[0] === q[0] && (p[1] < q[1] || (p[1] === q[1] && p[2] < q[2]))) ? 1 : -1;
        const bow = flip * hash(mid, 3) * VEHICLES.bow * l;
        [ox, oy] = [-((b[1] - a[1]) / l) * bow, ((b[0] - a[0]) / l) * bow];
      }
      d += `Q${r2((a[0] + b[0]) / 2 + ox)} ${r2((a[1] + b[1]) / 2 + oy)} ${r2(b[0])} ${r2(b[1])}`;
    }
    return `${d}Z`;
  };

  // a part's visible faces: { pts, n, side (±1 for the flat sides, 0 for the
  // faces around the profile), x (centre along the car) }
  const faces = (part) => {
    const prof = rounded(part.profile.map(([x, z]) => [x + j(), z + j()]), part.round ?? 0);
    const w = part.w, y = part.y ?? 0;
    const cx = prof.reduce((a, p) => a + p[0], 0) / prof.length, cz = prof.reduce((a, p) => a + p[1], 0) / prof.length;
    const out = [];
    for (const side of [1, -1]) out.push({ pts: prof.map(([x, z]) => [x, y + side * w, z]), n: [0, side, 0], side, x: cx, z: cz });
    for (let i = 0; i < prof.length; i++) {
      const [ax, az] = prof[i], [bx, bz] = prof[(i + 1) % prof.length];
      let [nx, nz] = [bz - az, -(bx - ax)];
      if (nx * ((ax + bx) / 2 - cx) + nz * ((az + bz) / 2 - cz) < 0) [nx, nz] = [-nx, -nz];
      out.push({ pts: [[ax, y + w, az], [bx, y + w, bz], [bx, y - w, bz], [ax, y - w, az]], n: [nx, 0, nz], side: 0, x: (ax + bx) / 2, z: (az + bz) / 2 });
    }
    return out.filter((f) => facing(f.n, f.pts[0]));
  };

  // part.round: the profile's corners rounded off by up to this much (a
  // corner cut back along both its edges, a point between)
  function rounded(prof, r) {
    if (!r) return prof;
    const n = prof.length;
    return prof.flatMap((p, i) => {
      const [a, b] = [prof[(i + n - 1) % n], prof[(i + 1) % n]];
      const cut = (q) => {
        const l = Math.hypot(q[0] - p[0], q[1] - p[1]), k = Math.min(r, l / 2.5) / l;
        return [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k];
      };
      const [pa, pb] = [cut(a), cut(b)];
      return [pa, [(pa[0] + pb[0]) / 4 + p[0] / 2, (pa[1] + pb[1]) / 4 + p[1] / 2], pb];
    });
  }

  // an arched roof (model.vault) over the body's width: strips along x
  // round the arch, closed at both ends
  const vault = ({ x: [x0, x1], z, rise, segs = 6 }, w) => {
    const arc = Array.from({ length: segs + 1 }, (_, i) => (i / segs) * Math.PI);
    const at = (t) => [w * Math.cos(t), z + rise * Math.sin(t)];
    const out = [];
    for (let i = 0; i < segs; i++) {
      const [ta, tb] = [arc[i], arc[i + 1]], [ya, za] = at(ta), [yb, zb] = at(tb), tm = (ta + tb) / 2;
      out.push({ pts: [[x0, ya, za], [x1, ya, za], [x1, yb, zb], [x0, yb, zb]], n: [0, Math.cos(tm) / w, Math.sin(tm) / rise], side: 0, x: 0 });
    }
    for (const [x, d] of [[x0, 1], [x1, -1]]) out.push({ pts: arc.map((t) => [x, ...at(t)]), n: [-d, 0, 0], side: 0, x });
    return out.filter((f) => facing(f.n, f.pts[0]));
  };

  const body = faces(model.body);
  const roof = model.vault ? vault(model.vault, model.body.w) : [];
  const cabin = model.cabin ? faces(model.cabin) : [];
  // parts on top, the one further back first
  const back = (p) => {
    const cx = p.profile.reduce((a, q) => a + q[0], 0) / p.profile.length;
    return view.depth(toWorld([cx, p.y ?? 0, 0])) - view.depth([0, 0, 0]);
  };
  const tops = [].concat(model.top ?? []).sort((a, b) => back(a) - back(b));
  const partFaces = (p) => [...faces(p), ...(p.vault ? vault(p.vault, p.w) : [])];
  // parts on an end (`end`: they stick out of it) go before the body when
  // that end is the far one, so the body hides them
  const behind = tops.filter((p) => p.end && back(p) < 0).map(partFaces);
  const topParts = tops.filter((p) => !(p.end && back(p) < 0)).map(partFaces);
  // the side that shows
  const near = [1, -1].find((side) => facing([0, side, 0], [0, side * model.body.w, 0])) ?? 1; // seen head-on: either
  const { r } = model.wheels;
  const wheelsOn = (side) => model.wheels.x.map((wx) => poly(Array.from({ length: 14 }, (_, k) => {
    const t = (k / 14) * Math.PI * 2;
    return [wx + Math.cos(t) * r, side * (model.body.w + 0.002), r + Math.sin(t) * r];
  }))).join('');
  const wheels = wheelsOn(near);
  // the glasshouse (cabin): its shape is its windows; only the pillars
  // between them (split, and side: [x0, x1] where the side glass ends)
  // drawn on its sides, each one line
  const across = (f, x) => {
    const hits = [];
    f.pts.forEach((p, i) => {
      const q = f.pts[(i + 1) % f.pts.length];
      if ((p[0] - x) * (q[0] - x) <= 0 && p[0] !== q[0]) hits.push(p.map((v, k) => v + (q[k] - v) * ((x - p[0]) / (q[0] - p[0]))));
    });
    return hits.length > 1 ? [hits.reduce((a, b) => (b[2] < a[2] ? b : a)), hits.reduce((a, b) => (b[2] > a[2] ? b : a))] : null;
  };
  const lines = [...(model.cabin?.split ?? []), ...(model.cabin?.side ?? []).filter(Number.isFinite)];
  // the glass drawn round in a line (vw), lamps inked (vi)
  let glazing = cabin.filter((f) => f.side).flatMap((f) => lines.map((x) => across(f, x)).filter(Boolean)).map(poly).join(''), inked = '';
  // outlines: window and door shapes drawn round on the near side, at
  // their part's half width w (two points: a line)
  for (const { w, profile } of model.outlines ?? []) glazing += poly(profile.map(([x, z]) => [x, near * (w + 0.001), z]));
  // lamps: round, on the end faces (x) that show, or square (w across by h
  // high); line: a pane drawn round instead (a windscreen)
  for (const { x, y = 0, z, r: lr, w, h, line } of model.lamps ?? []) {
    if (!facing([Math.sign(x), 0, 0], [x, 0, z])) continue;
    const pane = poly(w ? [[x, y - w / 2, z - h / 2], [x, y + w / 2, z - h / 2], [x, y + w / 2, z + h / 2], [x, y - w / 2, z + h / 2]]
      : Array.from({ length: 12 }, (_, i) => [x, y + Math.cos((i / 12) * Math.PI * 2) * lr, z + Math.sin((i / 12) * Math.PI * 2) * lr]));
    if (line) glazing += pane;
    else inked += pane;
  }
  // each part only its outline, as in a quick doodle: a fat line round all
  // its faces (vo) with the faces filled over it (vf), so the folds between
  // them don't show
  const pathOf = (fs) => {
    const d = fs.map((f) => poly(f.pts, false)).join('');
    return `<path class="vo" d="${d}"/><path class="vf" d="${d}"/>`;
  };
  // the wheels paper rings (vr): the far side's under it all, the near
  // side's over the parts above them (a cab over its front wheels)
  return `<path class="vr" d="${wheelsOn(-near)}"/>`
    + behind.map(pathOf).join('')
    + pathOf(body)
    + pathOf([...roof, ...cabin])
    // each part on top its own path, so a nearer one hides the one behind
    + topParts.map(pathOf).join('')
    + `<path class="vr" d="${wheels}"/>`
    + (glazing ? `<path class="vw" d="${glazing}"/>` : '')
    + (inked ? `<path class="vi" d="${inked}"/>` : '');
}
