// Bridges: where a road, railway or footpath crosses a river (the rules are
// in roads/routing.js). Nothing is stored for them – any run of a network
// over water dots, between two dots on land, is a bridge – so they are
// found again from the networks whenever those change.
//
// The deck stays level from bank to bank, above the valley (ramping up off
// the abutments to BRIDGE.clearance over the water), and everything on it –
// the road or track lines, cars, trains, walkers – is lifted to it through
// deckAt(). The rest is linework: railings and piers of a concrete beam
// bridge for roads, a steel truss for railways, light railings on posts
// for footpaths.
//
//   findBridges(world)            [{ kind, a, b, piers, half }] per span
//   makeDeck(bridges, lift)       (x, y) -> height of the deck above the ground there (0 off bridges)
//   bridgeLines(bridge, deck)     [{ cls, line: [[x, y, z]…] }] its railings, piers, truss
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
      out.push({ kind, a: layer.pos(ends[0]), b: layer.pos(ends[1]), piers: span.map((n) => layer.pos(n)), half });
    }
  }
  return out;
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

// Railings, piers and the truss of one bridge, as lines of [x, y, z] (z: height above the ground).
export function bridgeLines(br, deck) {
  const { a, b, kind, half } = br;
  const vx = b[0] - a[0], vy = b[1] - a[1], len = Math.hypot(vx, vy);
  const nx = -vy / len, ny = vx / len;
  const at = (t, side, dz = 0) => {
    const x = a[0] + vx * t + nx * side, y = a[1] + vy * t + ny * side;
    return [x, y, deck(a[0] + vx * t, a[1] + vy * t) + dz];
  };
  const run = (t0, t1, side, dz) => {
    const n = Math.max(2, Math.ceil(((t1 - t0) * len) / 0.1));
    return Array.from({ length: n + 1 }, (_, i) => at(t0 + ((t1 - t0) * i) / n, side, dz));
  };
  // the part over the water and its banks: past the ramps' foot
  const t0 = 0.12, t1 = 0.88;
  const out = [];
  const spec = BRIDGE[kind];
  for (const side of [half, -half]) {
    // the deck's side face under the edge
    out.push({ cls: 'bridge', line: run(t0, t1, side, -BRIDGE.thickness) });
    if (kind === 'rail') {
      const h = spec.truss, panels = Math.max(2, Math.round(((t1 - t0) * len) / spec.panel));
      out.push({ cls: 'bridge', line: run(t0, t1, side, h) });
      for (let i = 0; i <= panels; i++) {
        const t = t0 + ((t1 - t0) * i) / panels;
        out.push({ cls: 'bridge', line: [at(t, side, 0), at(t, side, h)] });
        if (i < panels) {
          const u = t0 + ((t1 - t0) * (i + 1)) / panels;
          out.push({ cls: 'bridge', line: i % 2 ? [at(t, side, h), at(u, side, 0)] : [at(t, side, 0), at(u, side, h)] });
        }
      }
    } else {
      out.push({ cls: 'bridge', line: run(t0, t1, side, spec.rail) });
      const posts = Math.max(2, Math.round(((t1 - t0) * len) / spec.post));
      for (let i = 0; i <= posts; i++) {
        const t = t0 + ((t1 - t0) * i) / posts;
        out.push({ cls: 'bridge-post', line: [at(t, side, 0), at(t, side, spec.rail)] });
      }
    }
    // piers down to the water under each water dot (footbridges: every other)
    br.piers.forEach(([px, py], i) => {
      if (kind === 'path' && i % 2) return;
      const [t] = along(br, px, py);
      const top = at(t, side, -BRIDGE.thickness);
      out.push({ cls: kind === 'path' ? 'bridge-post' : 'bridge', line: [top, [top[0], top[1], 0]] });
    });
  }
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
