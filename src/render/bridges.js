// Bridges: where a road, railway or footpath crosses a river (the rules are
// in roads/routing.js). Nothing is stored for them – any run of a network
// over water dots, between two dots on land, is a bridge – so they are
// found again from the networks whenever those change.
//
// The deck stays level from bank to bank, above the valley (ramping up off
// the abutments to BRIDGE.clearance over the water), and everything on it –
// the road or track lines, cars, trains, walkers – is lifted to it through
// deckAt(). The rest is linework, in one of a few styles per network
// (BRIDGE_STYLES) – for roads a concrete beam, an old stone bridge or a
// deep girder; for railways a steel truss, plate
// girders, a bowstring arch or a masonry viaduct; for footpaths railings
// on posts, a lattice railing or a suspension footbridge.
//
//   findBridges(world)            [{ kind, a, b, piers, half, style }] per span
//   makeDeck(bridges, lift)       (x, y) -> height of the deck above the ground there (0 off bridges)
//   bridgeLines(bridge, deck, facing)  [{ cls, line: [[x, y, z]…] }] its railings, piers, arches…
//   hiddenUnder(bridges, deck, camera)  (x, y) -> is a ground point behind a deck on screen

import { rotateQuarter } from '../core/grid.js';

export const BRIDGE = {
  clearance: 0.16, // deck above the water, grid units of height
  ramp: 0.3,       // share of the span at each end over which the deck rises
  thickness: 0.05, // of the deck, seen from the side
  road: { half: 0.1, rail: 0.06, post: 0.16 },  // railings: this far out, high, posts apart
  rail: { half: 0.09, truss: 0.24, panel: 0.25 }, // truss girders: this far out, high, panel length
  path: { half: 0.05, rail: 0.05, post: 0.12 },
};

// Spans on each network: water dots joined to each other, with the two land
// dots at their ends (`a`, `b`: positions); `piers`: the water dots.
export function findBridges(world) {
  const out = [];
  for (const kind of ['road', 'rail', 'path']) {
    const layer = world.networks[kind];
    const { graph, bridge } = layer;
    const seen = new Set();
    for (const start of graph.nodes()) {
      if (seen.has(start) || !bridge.water(start)) continue;
      const span = [start], ends = [];
      seen.add(start);
      for (let k = 0; k < span.length; k++) {
        for (const m of graph.neighbors(span[k])) {
          if (!bridge.water(m)) ends.push(m);
          else if (!seen.has(m)) { seen.add(m); span.push(m); }
        }
      }
      if (ends.length !== 2) continue;
      let half = BRIDGE[kind].half;
      if (kind === 'road' && [...span, ...ends].some((n) => world.sidewalksAt(n).length)) half += 0.06;
      else if (kind === 'road' && span.every((n) => [...graph.neighbors(n)].every((m) => world.isLane(n, m)))) half -= 0.035; // a lane's
      const a = layer.pos(ends[0]), b = layer.pos(ends[1]);
      out.push({ kind, a, b, piers: span.map((n) => layer.pos(n)), half, style: bridgeStyle(kind, a, b, span.length) });
    }
  }
  return out;
}

// The style of a bridge, the same every time for the same crossing (it
// isn't stored): picked from BRIDGE_STYLES by where the bridge stands.
// The suspension footbridge only over wider water: LONG, the water dots they need.
export const BRIDGE_STYLES = {
  road: ['beam', 'stone', 'girder'],
  rail: ['truss', 'plate', 'bowstring', 'viaduct'],
  path: ['posts', 'lattice', 'suspension'],
};
const LONG = { suspension: 3 };

function bridgeStyle(kind, a, b, water) {
  let h = Math.imul(Math.round((a[0] + b[0]) * 2), 374761393) ^ Math.imul(Math.round((a[1] + b[1]) * 2), 668265263) ^ Math.imul(kind.charCodeAt(0) + kind.charCodeAt(2), 40503);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  const list = BRIDGE_STYLES[kind].filter((style) => water >= (LONG[style] ?? 0));
  return list[(h >>> 0) % list.length];
}

// Where (x, y) lies along a bridge: t from a (0) to b (1) and the distance
// off its middle line (signed, left of a -> b positive).
function along({ a, b }, x, y) {
  const vx = b[0] - a[0], vy = b[1] - a[1], len2 = vx * vx + vy * vy;
  const t = ((x - a[0]) * vx + (y - a[1]) * vy) / len2;
  const off = ((x - a[0]) * -vy + (y - a[1]) * vx) / Math.sqrt(len2);
  return [t, off];
}

// Height of the deck above the plain ground at t along the bridge.
function deckHeight(bridge, t, lift) {
  const { a, b } = bridge;
  const ends = lift ? lift(...a) + (lift(...b) - lift(...a)) * t : 0;
  const ground = lift ? lift(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t) : 0;
  const u = Math.min(t, 1 - t) / BRIDGE.ramp;
  const rise = u >= 1 ? 1 : u <= 0 ? 0 : u * u * (3 - 2 * u);
  return Math.max(0, ends - ground) + BRIDGE.clearance * rise;
}

export function makeDeck(bridges, lift) {
  if (!bridges.length) return () => 0;
  return (x, y) => {
    for (const br of bridges) {
      const [t, off] = along(br, x, y);
      if (t > 0 && t < 1 && Math.abs(off) <= br.half + 0.08) return deckHeight(br, t, lift);
    }
    return 0;
  };
}

// Railings, piers, arches, girders… of one bridge in its style, as lines
// of [x, y, z] (z: height above the ground). `facing(normal)`: is a side
// seen – on the far side what is below the deck (its face, piers, arches,
// the girder) is left out, as the deck hides it (the lines are drawn
// without hiding each other).
export function bridgeLines(br, deck, facing = null) {
  const { a, b, kind, half } = br;
  const vx = b[0] - a[0], vy = b[1] - a[1], len = Math.hypot(vx, vy);
  const nx = -vy / len, ny = vx / len;
  const level = (t) => deck(a[0] + vx * t, a[1] + vy * t);
  const pt = (t, side, z) => [a[0] + vx * t + nx * side, a[1] + vy * t + ny * side, z];
  const at = (t, side, dz = 0) => pt(t, side, level(t) + dz);
  const curve = (t0, t1, side, z) => {
    const n = Math.max(4, Math.ceil(((t1 - t0) * len) / 0.05));
    return Array.from({ length: n + 1 }, (_, i) => {
      const t = t0 + ((t1 - t0) * i) / n;
      return pt(t, side, z(t));
    });
  };
  const run = (t0, t1, side, dz) => curve(t0, t1, side, (t) => level(t) + dz);
  const steps = (t0, t1, apart, ends = true) => {
    const n = Math.max(2, Math.round(((t1 - t0) * len) / apart));
    return Array.from({ length: n + 1 }, (_, i) => t0 + ((t1 - t0) * i) / n).slice(ends ? 0 : 1, ends ? n + 1 : n);
  };
  // the part over the water and its banks: past the ramps' foot
  const t0 = 0.12, t1 = 0.88;
  const piers = br.piers.map(([px, py]) => along(br, px, py)[0]);
  const out = [];
  const add = (line, cls = 'bridge') => out.push({ cls, line });
  const spec = BRIDGE[kind];
  const near = (side) => !facing || facing([nx * side, ny * side, 0]) || !facing([-nx * side, -ny * side, 0]);

  // pieces shared by the styles
  const face = (side, depth = BRIDGE.thickness) => near(side) && add(run(t0, t1, side, -depth));
  const railing = (side, h, apart, cls = 'bridge-post') => {
    add(run(t0, t1, side, h));
    for (const t of steps(t0, t1, apart)) add([at(t, side), at(t, side, h)], cls);
  };
  const pierLines = (side, cls = 'bridge', every = 1, depth = BRIDGE.thickness) => piers.forEach((t, i) => {
    if (i % every || !near(side)) return;
    const top = at(t, side, -depth);
    add([top, [top[0], top[1], 0]], cls);
  });
  // a row of masonry arches between the banks and the piers (w: half a pier's width, in t)
  const arches = (side, depth) => {
    const w = 0.05 / len, feet = [t0, ...piers, t1];
    for (let i = 0; i + 1 < feet.length; i++) {
      const u0 = feet[i] + (i ? w : 0), u1 = feet[i + 1] - (i + 1 < feet.length - 1 ? w : 0);
      const mid = (u0 + u1) / 2, crown = level(mid) - depth, spring = Math.min(0.03, crown * 0.3);
      add(curve(u0, u1, side, (t) => spring + (crown - spring) * Math.sqrt(Math.max(0, 1 - ((t - mid) / (mid - u0)) ** 2))));
    }
    for (const t of piers) for (const e of [-w, w]) add([pt(t + e, side, 0), pt(t + e, side, 0.03)]);
  };

  const styles = {
    road: {
      // concrete beam on piers, railings on posts
      beam: (side) => { face(side); railing(side, spec.rail, spec.post); pierLines(side); },
      // the old stone bridge: a parapet wall over masonry arches
      stone: (side) => {
        add(run(t0, t1, side, 0.05));
        for (const t of [t0, t1]) add([near(side) ? pt(t, side, 0) : at(t, side), at(t, side, 0.05)]);
        if (near(side)) {
          add(run(t0, t1, side, -0.012));
          arches(side, 0.025);
        }
        // a statue over each pier
        for (const t of piers) add([at(t, side, 0.05), at(t, side, 0.1)]);
      },
      // a deep prestressed girder, deeper over the piers, on wall piers; a tube railing
      girder: (side) => {
        add(run(t0, t1, side, -0.02));
        const w = 0.035 / len, feet = [t0, ...piers, t1];
        const depth = (t) => 0.05 + 0.08 * Math.max(0, 1 - (Math.min(...feet.map((f) => Math.abs(t - f))) * len) / 0.45) ** 2;
        if (near(side)) {
          add(curve(t0, t1, side, (t) => level(t) - depth(t)));
          for (const t of piers) for (const e of [-w, w]) add([at(t + e, side, -depth(t + e)), pt(t + e, side, 0)]);
        }
        railing(side, spec.rail, 0.3);
        add(run(t0, t1, side, spec.rail / 2), 'bridge-post');
      },
    },
    rail: {
      // steel truss girders
      truss: (side) => {
        face(side);
        const h = spec.truss, ts = steps(t0, t1, spec.panel);
        add(run(t0, t1, side, h));
        ts.forEach((t, i) => {
          add([at(t, side), at(t, side, h)]);
          if (i + 1 < ts.length) add(i % 2 ? [at(t, side, h), at(ts[i + 1], side)] : [at(t, side), at(ts[i + 1], side, h)]);
        });
        pierLines(side);
      },
      // plate girders stiffened at even steps
      plate: (side) => {
        face(side);
        add(run(t0, t1, side, 0.09));
        for (const t of steps(t0, t1, 0.12)) add([at(t, side), at(t, side, 0.09)], 'bridge-post');
        pierLines(side);
      },
      // a steel bowstring arch with hangers, bank to bank
      bowstring: (side) => {
        face(side);
        add(run(t0, t1, side, 0));
        const z = (t) => level(t) + 0.3 * Math.sin((Math.PI * (t - t0)) / (t1 - t0));
        add(curve(t0, t1, side, z));
        for (const t of steps(t0, t1, 0.16, false)) add([at(t, side), pt(t, side, z(t))], 'bridge-post');
      },
      // a masonry viaduct
      viaduct: (side) => {
        add(run(t0, t1, side, 0.035));
        for (const t of [t0, t1]) add([near(side) ? pt(t, side, 0) : at(t, side), at(t, side, 0.035)]);
        if (near(side)) {
          add(run(t0, t1, side, -0.01));
          arches(side, 0.02);
        }
      },
    },
    path: {
      // light railings on posts
      posts: (side) => { face(side); railing(side, spec.rail, spec.post); pierLines(side, 'bridge-post', 2); },
      // a steel lattice railing, crossed between the posts
      lattice: (side) => {
        face(side);
        const ts = steps(t0, t1, 0.2);
        add(run(t0, t1, side, spec.rail));
        ts.forEach((t, i) => {
          add([at(t, side), at(t, side, spec.rail)], 'bridge-post');
          if (i + 1 < ts.length) {
            add([at(t, side), at(ts[i + 1], side, spec.rail)], 'bridge-post');
            add([at(t, side, spec.rail), at(ts[i + 1], side)], 'bridge-post');
          }
        });
        pierLines(side, 'bridge-post', 2);
      },
      // a suspension footbridge: two pylons, the cables sagging between, hangers
      suspension: (side) => {
        face(side, 0.03);
        add(run(t0, t1, side, spec.rail), 'bridge-post');
        const p0 = t0 + 0.03, p1 = t1 - 0.03, top = level(0.5) + 0.3;
        for (const t of [p0, p1]) add([near(side) ? pt(t, side, 0) : at(t, side), pt(t, side, top)]);
        const sag = (t) => level(t) + 0.06 + (top - level(0.5) - 0.06) * ((2 * t - p0 - p1) / (p1 - p0)) ** 2;
        add(curve(p0, p1, side, sag));
        for (const t of steps(p0, p1, 0.1, false)) add([at(t, side), pt(t, side, sag(t))], 'bridge-post');
        // backstays down to the banks
        add([pt(p0, side, top), pt(p0 - 0.25 / len, side, 0)]);
        add([pt(p1, side, top), pt(p1 + 0.25 / len, side, 0)]);
        if (side > 0) for (const t of [p0, p1]) add([pt(t, side, top), pt(t, -side, top)]);
      },
    },
  };
  const draw = styles[kind][br.style] ?? Object.values(styles[kind])[0];
  for (const side of [half, -half]) draw(side);
  return out;
}

// A ground point is out of sight behind a deck when the deck point drawn
// over it on screen is on the bridge: raised by dz, a point shows where the
// ground dz * zScale further back (in view axes) does. Tested for heights
// up to the deck's, as its side face hides the ground too.
export function hiddenUnder(bridges, deck, camera) {
  if (!bridges.length) return () => false;
  const shift = (dz) => {
    const s = dz * camera.zScale;
    return rotateQuarter(s, s, -camera.rotation);
  };
  return (x, y) => {
    for (const br of bridges) {
      const [t, off] = along(br, x, y);
      if (t < -0.5 || t > 1.5 || Math.abs(off) > br.half + 1) continue;
      const mx = (br.a[0] + br.b[0]) / 2, my = (br.a[1] + br.b[1]) / 2;
      const [sx, sy] = shift(deck(mx, my) + 0.1);
      for (let k = 0; k <= 4; k++) {
        const [u, o] = along(br, x + (sx * k) / 4, y + (sy * k) / 4);
        if (u > 0.05 && u < 0.95 && Math.abs(o) <= br.half + 0.02) return true;
      }
    }
    return false;
  };
}
