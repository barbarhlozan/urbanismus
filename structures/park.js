// Parks: 1×1 and 2×2. Mostly ground drawing (walkways, ponds)
// plus trees, benches and park furniture. Each level has a few layouts
// (picked by seed): plain greens, playgrounds, memorials, flower gardens,
// bandstands, lime avenues, formal baroque parterres, a spa colonnade, and
// from the 60s–80s a football pitch, a sports ground, a forest park with a
// lookout tower, a koupaliště and a summer cinema. They make nearby homes grow
// faster and are destinations for strolls. Reachable by road or footpath.
// The park fills g.site (up to the road, merging with neighbouring parks).
// There is no border: entrance gates, benches along the walkways and grass
// tufts say "park".
//
// Walkways only go where people come in – a footpath reaching the park, a
// street with sidewalks along it, a neighbouring park (world.sitePaths) –
// and take their shape from how many ways in there are (src/roads/siteWalks.js):
// none leaves a plain green, one runs to a loop, two curve into one another,
// more meet at a plaza. Things that stand in the middle go to
// g.site.paths.centre, which the walkways keep clear of.

import {
  tree, bush, bench, lamp, fountain, gate, tufts, hedgeAlong, statue,
  playground, bandstand, flowerBed, obelisk, sculpture, kiosk, chessTable, colonnade, footbridge,
  pitch, planter, FRAME,
} from './kit.js';
import { segmentDistance } from '../src/core/geom2d.js';
import { offsetPolyline, keepRuns, measurePolyline, pointAt } from '../src/roads/geometry.js';
import { CONFIG } from '../src/config.js';

const W = CONFIG.path.edge; // walkways are as wide as footpaths

// Distance from (x, y) to a polyline.
function lineDistance(p, line) {
  let d = Infinity;
  for (let i = 1; i < line.length; i++) d = Math.min(d, segmentDistance(p, line[i - 1], line[i]));
  return d;
}

// The park's walkways (g.site.paths): each line drawn in the footpath style
// (two narrow edges), open where it meets another one or the plaza; exits
// facing a road carry on to the lawn edge, and entrance posts stand at every
// way in (not between two parks). From here on nothing else in the park is
// put on them (g.isFree).
function walkways(g) {
  const paths = g.site.paths;
  const { hub, exits, lines, plaza } = paths;
  const { x0, y0, x1, y1 } = g.site;
  const lawnEdge = (p) => {
    const e = exits.find((x) => x.road && Math.hypot(x.pos[0] - p[0], x.pos[1] - p[1]) < 1e-6);
    if (!e) return [];
    const [dx, dy] = e.dir;
    return [[dx > 0 ? x1 : dx < 0 ? x0 : e.pos[0], dy > 0 ? y1 : dy < 0 ? y0 : e.pos[1]]];
  };
  lines.forEach((line, i) => {
    const full = [...lawnEdge(line[0]), ...line, ...lawnEdge(line[line.length - 1])];
    const others = lines.filter((_, j) => j !== i);
    const open = (p) => (!plaza || Math.hypot(p[0] - hub[0], p[1] - hub[1]) >= plaza) && others.every((o) => lineDistance(p, o) >= W * 0.95);
    for (const k of [-1, 1]) {
      if (full.length > 1) keepRuns(offsetPolyline(full, W * k), open).forEach((run) => g.groundLine(run, { cls: 'fp' }));
    }
  });
  if (plaza) g.groundCircle(hub[0], hub[1], plaza, { cls: 'fp' });
  for (const e of exits) if (!e.site) gate(g, e.pos[0] - e.dir[0] * 0.08, e.pos[1] - e.dir[1] * 0.08, e.dir);
  // keep what comes next off them (a little leeway for benches beside them)
  // (what stands on the plaza, in the middle, is meant to)
  const free = g.free;
  const onPlaza = (x, y) => plaza && Math.hypot(x - hub[0], y - hub[1]) < plaza;
  g.free = (x, y, r = 0) => (!free || free(x, y, r)) && (onPlaza(x, y) || !nearWalkway(g, x, y, W + 0.01 + r * 0.6));
}

// Is (x, y) within d of a walkway's centre line (or on the plaza)?
function nearWalkway(g, x, y, d) {
  const { hub, lines, plaza } = g.site.paths;
  if (plaza && Math.hypot(x - hub[0], y - hub[1]) < plaza + d) return true;
  return lines.some((line) => lineDistance([x, y], line) < d);
}

// Is (x, y) within r of a walkway?
function onWalkway(g, x, y, r) {
  return nearWalkway(g, x, y, r + 0.05);
}

// How far (x, y) is from the nearest walkway.
function clearance(g, x, y) {
  const { hub, lines, plaza } = g.site.paths;
  const d = lines.reduce((m, line) => Math.min(m, lineDistance([x, y], line)), Infinity);
  return plaza ? Math.min(d, Math.hypot(x - hub[0], y - hub[1]) - plaza) : d;
}

// The spots, roomiest first (furthest from the walkways).
function roomiest(g, spots) {
  return spots.map((p) => ({ p, c: clearance(g, p[0], p[1]) })).sort((a, b) => b.c - a.c).map((o) => o.p);
}

// A spot for something r across: one of `spots` clear of the walkways,
// picked by seed (the roomiest when none is).
function freeSpot(g, spots, r) {
  const clear = spots.filter(([x, y]) => clearance(g, x, y) > r + W);
  return clear.length ? g.pick(clear) : roomiest(g, spots)[0];
}

// n lamps beside the walkways, spread along them.
function walkLamps(g, n) {
  const walks = g.site.paths.lines.map(measurePolyline).filter((w) => w.total > 0.3);
  const total = walks.reduce((sum, w) => sum + w.total, 0);
  for (let i = 0; i < n && total; i++) {
    let s = ((i + 0.5) / n) * total;
    const w = walks.find((p) => (s -= p.total) < 0) ?? walks[walks.length - 1];
    s += w.total;
    const [x, y] = pointAt(w, s);
    const [ax, ay] = pointAt(w, s - 0.01), [bx, by] = pointAt(w, s + 0.01);
    const l = Math.hypot(bx - ax, by - ay) || 1, k = i % 2 ? 1 : -1;
    lamp(g, x - ((by - ay) / l) * 0.075 * k, y + ((bx - ax) / l) * 0.075 * k);
  }
}

// n benches beside the walkways, facing them, somewhere along the middle.
function benches(g, n) {
  const walks = g.site.paths.lines.map(measurePolyline).filter((w) => w.total > 0.25);
  for (let i = 0, tries = 0; i < n && walks.length && tries < n * 5; tries++) {
    const w = g.pick(walks);
    const s = w.total * g.range(0.3, 0.7);
    const [x, y] = pointAt(w, s);
    const [ax, ay] = pointAt(w, s - 0.02), [bx, by] = pointAt(w, s + 0.02);
    // seat runs along the walkway, backrest away from it
    const alongX = Math.abs(bx - ax) >= Math.abs(by - ay);
    const side = g.pick([-1, 1]);
    const [px, py] = alongX ? [x, y + 0.09 * side] : [x + 0.09 * side, y];
    if (!g.isFree(px, py, 0.07)) continue;
    bench(g, px, py, alongX, side);
    i++;
  }
}

function grass(g, n) {
  const { x0, y0, x1, y1 } = g.site;
  tufts(g, n, x0 + 0.05, y0 + 0.05, x1 - 0.05, y1 - 0.05, (x, y) => onWalkway(g, x, y, 0.03));
}

function pond(g, x, y, r, { island = false } = {}) {
  g.groundCircle(x, y, r, { fill: 'url(#hatch-water)' });
  g.groundCircle(x, y, r);
  if (island) {
    g.groundCircle(x, y, r * 0.3, { fill: 'bg' });
    tree(g, x, y, 0.8);
  }
}

function pavilion(g, x, y) {
  g.cylinder(x, y, 0, 0.08, 0.09, 8);
  g.shape(x, y, 0.09, [[-0.1, 0], [0.1, 0], [0, 0.08]]);
}

// Scatter n trees in a rectangle, keeping clear of walkways and the given circles.
function grove(g, n, x0, y0, x1, y1, avoid = [], kind = null) {
  for (let i = 0, tries = 0; i < n && tries < n * 8; tries++) {
    const x = g.range(x0, x1), y = g.range(y0, y1);
    if (onWalkway(g, x, y, 0.07) || avoid.some(([ax, ay, r]) => Math.hypot(x - ax, y - ay) < r)) continue;
    if (kind || g.chance(0.8)) tree(g, x, y, g.range(0.8, 1.25), kind);
    else bush(g, x, y, g.range(0.035, 0.055));
    i++;
  }
}

// The four spaces between the walkways (diagonals from the hub), `d` out.
function quadrants(g, d) {
  const [hx, hy] = g.site.paths.hub;
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => [hx + sx * d, hy + sy * d]);
}

// Trees lining the walkways on both sides (an avenue), every `step`.
function avenue(g, step = 0.22, off = 0.09) {
  for (const w of g.site.paths.lines.map(measurePolyline)) {
    for (let s = 0.18; s < w.total - 0.05; s += step) {
      const [x, y] = pointAt(w, s);
      const [ax, ay] = pointAt(w, s - 0.01), [bx, by] = pointAt(w, s + 0.01);
      const l = Math.hypot(bx - ax, by - ay) || 1;
      const [nx, ny] = [-(by - ay) / l, (bx - ax) / l];
      for (const k of [-1, 1]) {
        const [tx, ty] = [x + nx * off * k, y + ny * off * k];
        if (clearance(g, tx, ty) > off * 0.8) tree(g, tx, ty, 0.85, 'spreading');
      }
    }
  }
}

// Formal parterre: a clipped hedge square in each quadrant, trimmed conifers
// on the corners, something in the middle.
function parterre(g, d, s) {
  for (const [qx, qy] of quadrants(g, d)) {
    const box = [[qx - s, qy - s], [qx + s, qy - s], [qx + s, qy + s], [qx - s, qy + s], [qx - s, qy - s]];
    hedgeAlong(g, box, 0.03);
    g.groundCircle(qx, qy, s * 0.45, { dash: '1 1.5', lod: 1 });
    tree(g, qx, qy, 0.55, 'spruce');
  }
}

function centrepiece(g, x, y) {
  g.pick([() => obelisk(g, x, y), () => statue(g, x, y), () => sculpture(g, x, y), () => fountain(g, x, y, 0.07)])();
}

// ----- sports and leisure of the 60s–80s -----
// Each fills one quadrant between the walkways, around its centre (qx, qy),
// in a square about 2 * q across.

// Wooden lookout tower in a forest park: a braced timber frame, a roofed
// platform on top.
function lookout(g, x, y, h = 0.65) {
  if (!g.isFree(x, y, 0.08)) return;
  const b = 0.075, t = 0.045;
  g.detailed(1, () => {
    g.solid(x, y, h / 2);
    const legs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (const [sx, sy] of legs) g.line([[x + sx * b, y + sy * b, 0], [x + sx * t, y + sy * t, h]], FRAME);
    for (const k of [0.33, 0.66]) {
      const r = b + (t - b) * k;
      g.line([[x - r, y - r, h * k], [x + r, y - r, h * k], [x + r, y + r, h * k], [x - r, y + r, h * k], [x - r, y - r, h * k]]);
    }
    g.detailed(2, () => {
      for (const [a, c] of [[legs[0], legs[1]], [legs[1], legs[2]]]) {
        g.line([[x + a[0] * b, y + a[1] * b, 0], [x + c[0] * (b + t) / 2, y + c[1] * (b + t) / 2, h * 0.5], [x + a[0] * t, y + a[1] * t, h]]);
      }
    });
  });
  g.box(x - t - 0.015, y - t - 0.015, h, 2 * t + 0.03, 2 * t + 0.03, 0.015);
  g.lathe(x, y, h + 0.07, [[0.075, 0], [0, 0.06]], 4, { phase: 0.5 });
  g.detailed(1, () => {
    g.solid(x, y, h + 0.04);
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) g.line([[x + sx * t, y + sy * t, h], [x + sx * t, y + sy * t, h + 0.07]]);
  });
}

// Outdoor swimming pool (koupaliště) in the quadrant at (qx, qy), q wide
// each way: the basin with lanes, a paddling pool, a concrete diving tower,
// and a row of changing cabins behind.
function pool(g, qx, qy, q) {
  const x0 = qx - q * 0.8, x1 = qx + q * 0.8, y0 = qy - q * 0.35, y1 = qy + q * 0.55;
  const basin = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  g.groundPoly(basin, { fill: 'url(#hatch-water)' });
  g.groundPoly(basin);
  g.groundPoly([[x0 - 0.035, y0 - 0.035], [x1 + 0.035, y0 - 0.035], [x1 + 0.035, y1 + 0.035], [x0 - 0.035, y1 + 0.035]], { lod: 1 });
  for (let i = 1; i < 4; i++) {
    const y = y0 + ((y1 - y0) * i) / 4;
    g.groundLine([[x0 + 0.03, y], [x1 - 0.03, y]], { dash: '2 2', lod: 2 });
  }
  // diving tower at the deep end
  // (concrete, 1, 3 and 5 m boards over the water)
  const tx = x1 - 0.045, ty = (y0 + y1) / 2;
  g.box(tx, ty - 0.025, 0, 0.05, 0.05, 0.3);
  for (const [z, reach] of [[0.08, 0.1], [0.19, 0.09], [0.3, 0.08]]) g.box(tx - reach, ty - 0.03, z, reach + 0.05, 0.06, 0.012);
  g.detailed(2, () => g.line([[tx + 0.05, ty + 0.02, 0], [tx + 0.05, ty + 0.02, 0.3]]));
  // paddling pool and cabins
  g.groundCircle(x0 + 0.06, y0 - q * 0.3, 0.06, { fill: 'url(#hatch-water)' });
  g.groundCircle(x0 + 0.06, y0 - q * 0.3, 0.06);
  const cy = qy - q * 0.88;
  g.roofed(qx - q * 0.3, cy, 0, q * 1.05, 0.09, 0.1, { h: 0.03 });
  g.detailed(2, () => {
    for (let x = qx - q * 0.26; x < qx + q * 0.7; x += 0.055) g.line([[x, cy, 0], [x, cy, 0.075], [x + 0.035, cy, 0.075], [x + 0.035, cy, 0]], { facing: [0, -1, 0] });
  });
}

// Summer cinema (letní kino) in the quadrant at (qx, qy): the screen at the
// back (+y), rows of benches curving towards it, the projection booth in
// front of them.
function cinema(g, qx, qy, q) {
  const sy = qy + q * 0.85, w = q * 1.4;
  for (const k of [-1, 1]) g.box(qx + k * w / 2 - 0.02, sy - 0.02, 0, 0.04, 0.04, 0.34);
  g.box(qx - w / 2, sy - 0.01, 0.07, w, 0.02, 0.27);
  // bench rows: arcs round a point beyond the screen
  const [ox, oy] = [qx, sy + q * 0.3];
  for (let i = 0; i < 6; i++) {
    const r = q * 0.75 + i * q * 0.13;
    const pts = [];
    for (let j = 0; j <= 10; j++) {
      const a = -Math.PI / 2 + (j / 10 - 0.5) * 1.1;
      pts.push([ox + Math.cos(a) * r, oy + Math.sin(a) * r]);
    }
    g.groundLine(pts, { lod: i % 2 ? 2 : 1 });
  }
  const by = oy - q * 1.55 - 0.08;
  g.roofed(qx - 0.07, by - 0.05, 0, 0.14, 0.1, 0.12, { h: 0 });
  g.detailed(2, () => g.line([[qx - 0.03, by + 0.05, 0.07], [qx + 0.03, by + 0.05, 0.07], [qx + 0.03, by + 0.05, 0.1], [qx - 0.03, by + 0.05, 0.1], [qx - 0.03, by + 0.05, 0.07]], { facing: [0, 1, 0] }));
}

const common = {
  category: 'civic',
  tags: ['park'],
  access: 'any',
  site: true,
  sim: { destinations: [] },
};

export const small = {
  ...common,
  id: 'park',
  name: 'Park',
  blurb: 'Trees and paths',
  hotkey: '4',
  footprint: [[0, 0]],
  levels: [
    {
      name: 'Green',
      stats: {},
      agents: 0,
      draw(g) {
        const kind = g.pick(['trees', 'trees', 'playground', 'memorial', 'pitch']);
        if (kind === 'pitch') {
          // a kids' football pitch over the whole green (no walkways –
          // people just cross it), a bench and a tree at the side
          pitch(g, -0.33, -0.21, 0.33, 0.21);
          bench(g, 0, -0.32, true, -1);
          tree(g, g.pick([-0.33, 0.33]), 0.33, 0.9);
          grass(g, 4);
          return;
        }
        walkways(g);
        if (kind === 'playground') {
          const [px, py] = freeSpot(g, quadrants(g, 0.23), 0.16);
          playground(g, px, py, 0.16);
          benches(g, 1);
          grove(g, 2, -0.34, -0.34, 0.34, 0.34, [[px, py, 0.22]]);
        } else if (kind === 'memorial') {
          const [cx, cy] = g.site.paths.centre;
          centrepiece(g, cx, cy);
          grove(g, g.int(2, 4), -0.34, -0.34, 0.34, 0.34, [[cx, cy, 0.14]], 'spruce');
          benches(g, 1);
        } else {
          benches(g, 1);
          grove(g, g.int(2, 3), -0.32, -0.32, 0.32, 0.32);
        }
        grass(g, 8);
      },
    },
    {
      name: 'Garden park',
      stats: {},
      agents: 0,
      grow: { requires: [{ type: 'residential', count: 3, radius: 3 }] },
      draw(g) {
        walkways(g);
        const kind = g.pick(['garden', 'flowers', 'playground', 'kiosk']);
        const qs = quadrants(g, 0.24);
        const [cx, cy] = g.site.paths.centre;
        if (kind === 'flowers') {
          for (const [x, y] of qs) if (clearance(g, x, y) > 0.08 + W) flowerBed(g, x, y, 0.08);
          if (clearance(g, cx, cy) > 0.09 + W) g.groundCircle(cx, cy, 0.09, { lod: 1 });
          benches(g, 3);
          grass(g, 6);
          return;
        }
        if (kind === 'playground') {
          const [px, py] = freeSpot(g, qs, 0.18);
          playground(g, px, py, 0.18);
          benches(g, 2);
          grove(g, 3, -0.34, -0.34, 0.34, 0.34, [[px, py, 0.24]]);
        } else if (kind === 'kiosk') {
          const [[kx, ky], [tx, ty]] = roomiest(g, qs);
          kiosk(g, kx, ky);
          chessTable(g, tx, ty);
          benches(g, 2);
          grove(g, 3, -0.34, -0.34, 0.34, 0.34, [[kx, ky, 0.12], [tx, ty, 0.1]]);
        } else {
          benches(g, 2);
          grove(g, g.int(4, 5), -0.34, -0.34, 0.34, 0.34, [[cx, cy, 0.1]]);
        }
        grass(g, 10);
      },
    },
    {
      name: 'Pavilion park',
      stats: {},
      agents: 0,
      grow: {
        requires: [
          { type: 'residential', count: 6, radius: 3 },
          { type: 'residential', count: 2, radius: 3, minLevel: 2 },
        ],
      },
      draw(g) {
        walkways(g);
        const kind = g.pick(['pavilion', 'bandstand', 'formal']);
        const [cx, cy] = g.site.paths.centre;
        if (kind === 'formal') {
          parterre(g, 0.24, 0.1);
          fountain(g, cx, cy, 0.06);
          benches(g, 2);
          return;
        }
        // a pond in the roomiest corner, if it fits
        const [ox, oy] = roomiest(g, quadrants(g, 0.21))[0];
        const withPond = g.chance(0.5) && clearance(g, ox, oy) > 0.13 + W;
        if (withPond) pond(g, ox, oy, 0.13);
        if (kind === 'bandstand') {
          bandstand(g, cx, cy, 0.1);
          for (const [x, y] of quadrants(g, 0.24)) {
            if (!(withPond && Math.hypot(x - ox, y - oy) < 0.1) && clearance(g, x, y) > 0.06 + W) flowerBed(g, x, y, 0.06);
          }
        } else {
          pavilion(g, cx, cy); // in the middle
        }
        benches(g, 3);
        grove(g, g.int(4, 6), -0.36, -0.36, 0.36, 0.36, [[cx, cy, 0.15], ...(withPond ? [[ox, oy, 0.17]] : [])]);
        grass(g, 12);
      },
    },
  ],
};

export const large = {
  ...common,
  id: 'park-large',
  name: 'Large park',
  hotkey: '5',
  footprint: [[0, 0], [1, 0], [0, 1], [1, 1]],
  levels: [
    {
      name: 'Meadow',
      stats: {},
      agents: 0,
      draw(g) {
        const kind = g.pick(['meadow', 'woods', 'playground', 'sports', 'forest']);
        if (kind === 'sports') {
          // sports ground: a full football pitch across the park (no
          // walkways), benches along one touchline, a changing hut, trees
          // in the corners
          pitch(g, -0.28, 0.02, 1.28, 0.98);
          for (const x of [0.15, 0.5, 0.85]) bench(g, x, -0.12, true, -1);
          g.gable(1.05, -0.36, 0, 0.24, 0.14, 0.08, 0.06);
          for (const [x, y] of [[-0.3, -0.25], [-0.3, 1.28], [1.3, 1.28]]) tree(g, x, y, 1.05);
          grass(g, 10);
          return;
        }
        walkways(g);
        const [cx, cy] = g.site.paths.centre;
        if (kind === 'woods') {
          benches(g, 2);
          grove(g, g.int(12, 16), -0.34, -0.34, 1.34, 1.34, [[cx, cy, 0.12]], g.chance(0.5) ? 'spruce' : null);
        } else if (kind === 'forest') {
          // forest park: dense woods with a wooden lookout tower in a clearing
          const [lx, ly] = freeSpot(g, quadrants(g, 0.45), 0.16);
          lookout(g, lx, ly);
          benches(g, 2);
          grove(g, g.int(14, 18), -0.34, -0.34, 1.34, 1.34, [[cx, cy, 0.12], [lx, ly, 0.16]], 'spruce');
        } else if (kind === 'playground') {
          const [px, py] = freeSpot(g, quadrants(g, 0.45), 0.24);
          playground(g, px, py, 0.24);
          benches(g, 3);
          grove(g, g.int(5, 7), -0.3, -0.3, 1.3, 1.3, [[px, py, 0.3]]);
        } else {
          benches(g, 2);
          grove(g, g.int(5, 7), -0.3, -0.3, 1.3, 1.3, [[cx, cy, 0.25]]);
        }
        grass(g, 20);
      },
    },
    {
      name: 'Pond park',
      stats: {},
      agents: 0,
      grow: { requires: [{ type: 'residential', count: 5, radius: 4 }] },
      draw(g) {
        walkways(g);
        if (g.chance(0.3)) {
          // koupaliště: the pool in the back quadrant, a sunbathing lawn with
          // a kiosk in front, trees round the edge
          const qs = roomiest(g, quadrants(g, 0.45));
          const [[qx, qy], [kx, ky]] = qs;
          pool(g, qx, qy, 0.38);
          kiosk(g, kx, ky);
          for (const [x, y] of qs.slice(1)) if (clearance(g, x + 0.15, y - 0.15) > 0.05 + W) planter(g, x + 0.15, y - 0.15);
          benches(g, 2);
          grove(g, g.int(5, 7), -0.32, -0.32, 1.32, 1.32, [[qx, qy, 0.5], [kx, ky, 0.12]]);
          grass(g, 20);
          return;
        }
        if (g.chance(0.35)) {
          // lime avenues along the walkways, a playground and a kiosk between them
          avenue(g);
          const qs = roomiest(g, quadrants(g, 0.45));
          playground(g, ...qs[0], 0.22);
          kiosk(g, ...qs[1]);
          chessTable(g, ...qs[2]);
          benches(g, 4);
          grass(g, 20);
          return;
        }
        const px = roomiest(g, [[0.05, 0.95], [0.95, 0.95]])[0][0];
        const island = g.chance(0.5);
        pond(g, px, 0.95, 0.3, { island });
        if (!island) footbridge(g, [px - 0.33, 0.95], [px + 0.33, 0.95]);
        if (g.chance(0.5)) kiosk(g, 1 - px, 0.05);
        benches(g, 3);
        grove(g, g.int(8, 10), -0.3, -0.3, 1.3, 1.3, [[px, 0.95, 0.4], [...g.site.paths.centre, 0.15], [1 - px, 0.05, 0.12]]);
        grass(g, 25);
      },
    },
    {
      name: 'City park',
      stats: {},
      agents: 0,
      grow: {
        requires: [
          { type: 'residential', count: 10, radius: 5 },
          { type: 'residential', count: 3, radius: 5, minLevel: 2 },
        ],
      },
      draw(g) {
        walkways(g);
        const [mx, my] = g.site.paths.centre;
        const kind = g.pick(['city', 'formal', 'spa', 'cinema']);
        if (kind === 'cinema') {
          // park of culture and rest: a summer cinema in one quadrant, a
          // bandstand and a kiosk in others, lamps along the walkways
          const [[qx, qy], [bx, by], [kx, ky]] = roomiest(g, quadrants(g, 0.45));
          cinema(g, qx, qy, 0.4);
          bandstand(g, bx, by, 0.1);
          kiosk(g, kx, ky);
          walkLamps(g, 2);
          benches(g, 4);
          grove(g, g.int(6, 8), -0.32, -0.32, 1.32, 1.32, [[qx, qy, 0.5], [bx, by, 0.16], [kx, ky, 0.12]]);
          grass(g, 20);
          return;
        }
        if (kind === 'formal') {
          // baroque garden: hedged parterres, clipped conifers, an obelisk
          parterre(g, 0.42, 0.22);
          obelisk(g, mx, my, 0.34);
          for (const [x, y] of quadrants(g, 0.78)) tree(g, x, y, 1.1, 'spreading');
          benches(g, 4);
          return;
        }
        if (kind === 'spa') {
          // spa colonnade along the back, fountain and flower beds in front
          colonnade(g, -0.2, 1.2, 1.15);
          fountain(g, mx, my, 0.09);
          for (const [x, y] of quadrants(g, 0.38)) if (clearance(g, x, y) > 0.1 + W) flowerBed(g, x, y, 0.1);
          walkLamps(g, 2);
          benches(g, 4);
          grove(g, g.int(4, 6), -0.32, -0.32, 1.32, 0.9, [[mx, my, 0.25], ...quadrants(g, 0.38).map(([x, y]) => [x, y, 0.14])]);
          grass(g, 15);
          return;
        }
        fountain(g, mx, my, 0.08); // in the middle
        // a pond and a bandstand (or pavilion) in two roomy corners
        const [[ox, oy], [bx, by]] = roomiest(g, [[1.05, 0.05], [-0.05, 0.95], [0.05, 0.05], [0.95, 0.95]]);
        pond(g, ox, oy, 0.22);
        if (g.chance(0.5)) bandstand(g, bx, by, 0.12);
        else pavilion(g, bx, by);
        walkLamps(g, 2);
        benches(g, 4);
        grove(g, g.int(10, 13), -0.32, -0.32, 1.32, 1.32, [[mx, my, 0.25], [ox, oy, 0.32], [bx, by, 0.18]]);
        grass(g, 30);
      },
    },
  ],
};
