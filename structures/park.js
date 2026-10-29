// Parks: 1×1 and 2×2. Mostly ground drawing (walkways, ponds) plus trees,
// benches and park furniture. Each tool is one kind of place, its looks
// stepped through with Space, its sizes with Shift: greenery (trees, lime
// avenues), a playground (the sídliště one with its rocket), a sports
// ground (a kids' pitch, a full football ground), flower beds, the village
// pond, and from the 60s–80s a forest park with a lookout tower and a
// summer cinema. They are destinations for strolls.
// Reachable by road or footpath.
// The park fills g.site (up to the road, merging with neighbouring parks).
// There is no border: entrance gates, benches along the walkways and grass
// tufts say "park".
//
// Walkways only go where people come in – a footpath brought to the park or
// a neighbouring park it joins (world.sitePaths; a street alongside is no
// way in, streetWays) – and take their shape from how many ways in there
// are (src/roads/siteWalks.js): none leaves a plain green, one runs in to
// the middle, two curve into one another, more cross in the middle. Things
// that stand in the middle go to
// g.site.paths.centre, which the walkways keep clear of.

import {
  tree, bush, bench, lamp, tufts,
  playground, bandstand, flowerBed, kiosk, pitch, swings, sandpit, FRAME, kindOf,
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
// onto a street or lane run straight on to the road's edge or kerb as drawn
// (exit.edge, render/lots.js siteEdges) – cut short there when the road
// comes in closer than the exit. No gates or posts: a village green is
// open. From here on nothing else in the park is put on them (g.isFree).
// `under` (x, y) -> true: what covers the ground there (a pitch) – the
// walkways stop at its edge, and people just cross it.
function walkways(g, { under = null } = {}) {
  const paths = g.site.paths;
  const { hub, exits, lines, plaza } = paths;
  const roadExit = (p) => exits.find((x) => x.edge && Math.hypot(x.pos[0] - p[0], x.pos[1] - p[1]) < 1e-6);
  // `line` (running out to p = its last point) up to the road's edge
  const toRoad = (line) => {
    const e = roadExit(line[line.length - 1]);
    if (!e) return line;
    const past = (q) => (q[0] - e.edge[0]) * e.dir[0] + (q[1] - e.edge[1]) * e.dir[1];
    if (past(e.pos) < 0) return [...line, e.edge];
    const out = [line[0]];
    for (let i = 1; i < line.length && past(line[i]) < 0; i++) out.push(line[i]);
    return out.length < line.length ? [...out, e.edge] : out;
  };
  lines.forEach((line, i) => {
    const full = toRoad(toRoad(line).reverse()).reverse();
    const others = lines.filter((_, j) => j !== i);
    const open = (p) => (!plaza || Math.hypot(p[0] - hub[0], p[1] - hub[1]) >= plaza) && others.every((o) => lineDistance(p, o) >= W * 0.95)
      && !under?.(...p);
    for (const k of [-1, 1]) {
      if (full.length > 1) keepRuns(offsetPolyline(full, W * k), open).forEach((run) => g.groundLine(run, { cls: 'fp' }));
    }
  });
  if (plaza && !under?.(...hub)) g.groundCircle(hub[0], hub[1], plaza, { cls: 'fp' });
  // keep what comes next off them (a little leeway for benches beside them)
  // (what stands on the plaza, in the middle, is meant to)
  const free = g.free;
  const onPlaza = (x, y) => plaza && Math.hypot(x - hub[0], y - hub[1]) < plaza;
  g.free = (x, y, r = 0) => (!free || free(x, y, r)) && (onPlaza(x, y) || under?.(x, y) || !nearWalkway(g, x, y, W + 0.01 + r * 0.6));
}

// (x, y) -> is it in the rectangle (a little way out of it, so walkways
// stop short of its line)?
const inside = (x0, y0, x1, y1, m = 0.03) => (x, y) => x > x0 - m && x < x1 + m && y > y0 - m && y < y1 + m;

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

// Požární nádrž: a concrete-rimmed tank of water, hw by hd half-sizes,
// a pipe railing along the two sides away from the walkways' middle and a
// sloping ramp down to the water at the front, where the brigade's pump
// draws from it.
function firePond(g, x, y, hw, hd) {
  const box = (w, d) => [[x - w, y - d], [x + w, y - d], [x + w, y + d], [x - w, y + d], [x - w, y - d]];
  g.groundPoly(box(hw, hd), { fill: 'url(#hatch-water)' });
  g.groundLine(box(hw, hd));
  g.groundLine(box(hw + 0.025, hd + 0.025));
  // the ramp in, on the near side
  const rx = x + g.pick([-1, 1]) * hw * 0.5;
  g.groundPoly([[rx - 0.05, y - hd - 0.025], [rx + 0.05, y - hd - 0.025], [rx + 0.05, y - hd + 0.12], [rx - 0.05, y - hd + 0.12]], { fill: 'bg' });
  g.detailed(2, () => {
    for (let v = y - hd + 0.035; v < y - hd + 0.12; v += 0.03) g.groundLine([[rx - 0.05, v], [rx + 0.05, v]]);
  });
  // railing on the far side and one end
  const sx = rx > x ? -1 : 1, h = 0.05, o = 0.035;
  const rail = [[x + sx * (hw + o), y - hd - o], [x + sx * (hw + o), y + hd + o], [x - sx * (hw + o), y + hd + o]];
  g.detailed(1, () => {
    g.line(rail.map(([u, v]) => [u, v, h]));
    for (let i = 1; i < rail.length; i++) {
      const [a, b] = [rail[i - 1], rail[i]], n = Math.max(2, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.1));
      for (let k = i === 1 ? 0 : 1; k <= n; k++) {
        const [u, v] = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n];
        g.line([[u, v, 0], [u, v, h]]);
      }
    }
  });
}

// Návesní rybník: a pond with a soft, uneven bank, rushes at one end.
function villagePond(g, x, y, rx, ry) {
  const n = 14, bank = [];
  for (let i = 0; i <= n; i++) {
    const a = (i % n / n) * Math.PI * 2, k = i === n ? bank[0][2] : g.range(0.86, 1.08);
    bank.push([x + Math.cos(a) * rx * k, y + Math.sin(a) * ry * k, k]);
  }
  const pts = bank.map(([u, v]) => [u, v]);
  g.groundPoly(pts, { fill: 'url(#hatch-water)' });
  g.groundLine(pts);
  // rushes along the bank at one end
  const end = g.pick([-1, 1]);
  g.detailed(2, () => {
    for (let i = 0; i < 9; i++) {
      const a = (end > 0 ? 0 : Math.PI) + g.range(-0.6, 0.6);
      const [u, v] = [x + Math.cos(a) * rx * 0.93, y + Math.sin(a) * ry * 0.93];
      g.line([[u, v, 0], [u + g.range(-0.01, 0.01), v, g.range(0.03, 0.05)]]);
    }
  });
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
function avenue(g, step = 0.5, off = 0.1) {
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

// ----- leisure of the 60s–80s -----

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

// The sídliště "raketa": a climbing frame of bent steel bars in the shape of
// a rocket – a cage of rings, a cone on top, three fins at the foot.
function rocket(g, x, y, h = 0.5) {
  if (!g.isFree(x, y, 0.1)) return;
  const r = 0.06, ribs = 6;
  g.detailed(1, () => {
    g.solid(x, y, h / 2);
    for (let i = 0; i < ribs; i++) {
      const a = (i / ribs) * Math.PI * 2, [c, s] = [Math.cos(a), Math.sin(a)];
      g.line([[x + c * r, y + s * r, 0.04], [x + c * r, y + s * r, h * 0.72], [x, y, h]]);
    }
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.3, [c, s] = [Math.cos(a), Math.sin(a)];
      g.line([[x + c * r, y + s * r, 0.18], [x + c * r * 2.2, y + s * r * 2.2, 0], [x + c * r, y + s * r, 0.04]]);
    }
  });
  g.detailed(2, () => {
    for (const z of [0.04, 0.14, 0.24, h * 0.72]) {
      const ring = Array.from({ length: 13 }, (_, i) => [x + Math.cos((i / 12) * Math.PI * 2) * r, y + Math.sin((i / 12) * Math.PI * 2) * r, z]);
      g.line(ring);
    }
  });
}

// Prolézačka: a hoop of steel bars to climb through, along x or y.
function climbingArch(g, x, y, alongX) {
  if (!g.isFree(x, y, 0.08)) return;
  const L = 0.07, R = 0.06;
  g.detailed(2, () => {
    g.solid(x, y, R / 2);
    for (const t of [-L, -L / 3, L / 3, L]) {
      const arc = Array.from({ length: 9 }, (_, i) => {
        const a = (i / 8) * Math.PI, u = Math.cos(a) * R, z = Math.sin(a) * R * 1.3;
        return alongX ? [x + t, y + u, z] : [x + u, y + t, z];
      });
      g.line(arc);
    }
    const top = (u) => (alongX ? [[x - L, y + u, R * 1.3 * (u ? 0.7 : 1)], [x + L, y + u, R * 1.3 * (u ? 0.7 : 1)]] : [[x + u, y - L, R * 1.3 * (u ? 0.7 : 1)], [x + u, y + L, R * 1.3 * (u ? 0.7 : 1)]]);
    for (const u of [-R * 0.7, 0, R * 0.7]) g.line(top(u));
  });
}

// Summer cinema (letní kino) in the quadrant at (qx, qy), q wide each way: the screen at the
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
  category: 'spaces',
  tags: ['park'],
  anySlope: true, // paths and trees follow the hillside
  access: 'any',
  site: true,
  streetWays: false, // walkways only from footpaths (world.siteExits)
  sim: { destinations: [] },
};

// ----- greenery -----

// Trees along the paths, a bench.
export const green = {
  id: 'green',
  name: 'Green',
  blurb: 'Trees and paths',
  size: 'Small',
  ...common,
  footprint: [[0, 0]],
  stats: {},
  agents: 0,
  draw(g) {
    walkways(g);
    benches(g, 1);
    grove(g, g.int(2, 3), -0.32, -0.32, 0.32, 0.32);
    grass(g, 8);
  },
};

// Grass with a few trees, or lime avenues along the walkways.
export const meadow = {
  id: 'meadow',
  name: 'Green',
  blurb: 'Trees and paths',
  size: 'Large',
  ...common,
  footprint: [[0, 0], [1, 0], [0, 1], [1, 1]],
  stats: {},
  agents: 0,
  kinds: ['meadow', 'avenue'],
  draw(g, s) {
    const kind = kindOf(g, s, this.kinds);
    walkways(g);
    const [cx, cy] = g.site.paths.centre;
    if (kind === 'avenue') {
      // (no walkways to line: a row of lindens across the middle)
      if (g.site.paths.lines.length) avenue(g);
      else for (const x of [-0.2, 0.25, 0.75, 1.2]) tree(g, x, cy, 0.85, 'spreading');
      walkLamps(g, 2);
      benches(g, 4);
    } else {
      benches(g, 2);
      grove(g, g.int(5, 7), -0.3, -0.3, 1.3, 1.3, [[cx, cy, 0.25]]);
    }
    grass(g, 20);
  },
};

// ----- playgrounds -----

// Swings, a slide and a sandpit between the walkways, benches for the
// mothers, trees round it. The large one is the sídliště playground of the
// 70s: the steel rocket, a row of swings, prolézačky, a big sandpit.
export const playgroundSmall = {
  id: 'playground',
  name: 'Playground',
  blurb: 'Swings and a sandpit',
  size: 'Small',
  ...common,
  footprint: [[0, 0]],
  stats: {},
  agents: 0,
  draw(g) {
    walkways(g);
    const [px, py] = freeSpot(g, quadrants(g, 0.23), 0.17);
    playground(g, px, py, 0.17);
    benches(g, 2);
    grove(g, 2, -0.34, -0.34, 0.34, 0.34, [[px, py, 0.23]]);
    grass(g, 8);
  },
};

export const playgroundLarge = {
  id: 'playground-large',
  name: 'Playground',
  blurb: 'Swings and a sandpit',
  size: 'Large',
  ...common,
  footprint: [[0, 0], [1, 0], [0, 1], [1, 1]],
  stats: {},
  agents: 0,
  draw(g) {
    walkways(g);
    // the rocket in the roomiest corner, a row of swings, the prolézačky
    // and a big sandpit in the others
    const [[px, py], [sx, sy], [ax, ay], [bx, by]] = roomiest(g, quadrants(g, 0.45));
    g.groundCircle(px, py, 0.17, { dash: '1 2', lod: 1 });
    rocket(g, px, py);
    const along = g.chance(0.5);
    for (const k of [-1, 1]) swings(g, sx + (along ? k * 0.1 : 0), sy + (along ? 0 : k * 0.1), along);
    for (const k of [-1, 1]) climbingArch(g, ax + (along ? 0 : k * 0.09), ay + (along ? k * 0.09 : 0), !along);
    g.detailed(1, () => g.box(bx - 0.13, by - 0.13, 0, 0.26, 0.26, 0.02));
    sandpit(g, bx, by);
    benches(g, 4);
    grove(g, g.int(4, 6), -0.3, -0.3, 1.3, 1.3, [[px, py, 0.22], [sx, sy, 0.22], [ax, ay, 0.2], [bx, by, 0.2]]);
    grass(g, 20);
  },
};

// ----- sports grounds -----

// A kids' football pitch over the whole dot: the walkways only come up to
// it (people just cross it); a bench and a tree at the side.
export const pitchSmall = {
  id: 'pitch',
  name: 'Sports ground',
  blurb: 'A football pitch',
  size: 'Small',
  ...common,
  footprint: [[0, 0]],
  stats: {},
  agents: 0,
  draw(g) {
    pitch(g, -0.33, -0.21, 0.33, 0.21);
    walkways(g, { under: inside(-0.33, -0.21, 0.33, 0.21) });
    bench(g, 0, -0.32, true, -1);
    tree(g, g.pick([-0.33, 0.33]), 0.33, 0.9);
    grass(g, 4);
  },
};

// A full football pitch across the park (the walkways come up to it),
// benches along one touchline, a changing hut, trees in the corners.
export const sportsGround = {
  id: 'sports-ground',
  name: 'Sports ground',
  blurb: 'A football pitch',
  size: 'Large',
  ...common,
  footprint: [[0, 0], [1, 0], [0, 1], [1, 1]],
  stats: {},
  agents: 0,
  draw(g) {
    pitch(g, -0.28, 0.02, 1.28, 0.98);
    walkways(g, { under: inside(-0.28, 0.02, 1.28, 0.98) });
    for (const x of [0.15, 0.5, 0.85]) bench(g, x, -0.12, true, -1);
    g.gable(1.05, -0.36, 0, 0.24, 0.14, 0.08, 0.06);
    for (const [x, y] of [[-0.3, -0.25], [-0.3, 1.28], [1.3, 1.28]]) tree(g, x, y, 1.05);
    grass(g, 10);
  },
};

// ----- gardens -----

// Sadové úpravy: round flower beds between the walkways, a ring of
// flowers where they meet, benches – the bit of planting in front of the
// národní výbor or the school.
export const gardenPark = {
  id: 'garden-park',
  name: 'Flower beds',
  blurb: 'Flowers outside the village hall',
  size: 'Small',
  ...common,
  footprint: [[0, 0]],
  stats: {},
  agents: 0,
  draw(g) {
    walkways(g);
    const [cx, cy] = g.site.paths.centre;
    for (const [x, y] of quadrants(g, 0.24)) if (clearance(g, x, y) > 0.08 + W) flowerBed(g, x, y, 0.08);
    if (clearance(g, cx, cy) > 0.09 + W) g.groundCircle(cx, cy, 0.09, { lod: 1 });
    benches(g, 3);
    grass(g, 6);
  },
};

// ----- leisure -----

// Lesopark: dense woods with a wooden lookout tower in a clearing.
export const forestPark = {
  id: 'forest-park',
  name: 'Forest park',
  blurb: 'Woods and a lookout tower',
  ...common,
  footprint: [[0, 0], [1, 0], [0, 1], [1, 1]],
  stats: {},
  agents: 0,
  draw(g) {
    walkways(g);
    const [cx, cy] = g.site.paths.centre;
    const [lx, ly] = freeSpot(g, quadrants(g, 0.45), 0.16);
    lookout(g, lx, ly);
    benches(g, 2);
    grove(g, g.int(14, 18), -0.34, -0.34, 1.34, 1.34, [[cx, cy, 0.12], [lx, ly, 0.16]], 'spruce');
    grass(g, 20);
  },
};

// The náves pond: water in the village's middle, kept for the fire brigade
// – a concrete-rimmed požární nádrž with a railing and a ramp for the
// pump, or the older návesní rybník with a soft bank and rushes – old
// lindens round it, benches.
export const pondPark = {
  id: 'pond-park',
  name: 'Village pond',
  blurb: 'Water for the firemen, lindens round it',
  ...common,
  footprint: [[0, 0], [1, 0], [0, 1], [1, 1]],
  stats: {},
  agents: 0,
  kinds: ['fire-pond', 'village-pond'],
  draw(g, s) {
    const kind = kindOf(g, s, this.kinds);
    walkways(g);
    // the water in the roomiest space between the walkways, as big as it allows
    const [px, py] = roomiest(g, quadrants(g, 0.42))[0];
    const room = Math.max(0.2, Math.min(0.42, clearance(g, px, py) - W - 0.04));
    if (kind === 'fire-pond') firePond(g, px, py, room * 0.85, room * 0.6);
    else villagePond(g, px, py, room, room * 0.75);
    // a few old lindens round it, none in front of the water
    benches(g, 2);
    grove(g, g.int(3, 4), -0.3, -0.3, 1.3, 1.3, [[px, py, room + 0.15], [...g.site.paths.centre, 0.15]], 'spreading');
    grass(g, 20);
  },
};

// Park of culture and rest: a summer cinema in one quadrant, a bandstand
// and a kiosk in others, lamps along the walkways.
export const summerCinema = {
  id: 'summer-cinema',
  name: 'Summer cinema',
  blurb: 'A screen under the trees',
  ...common,
  footprint: [[0, 0], [1, 0], [0, 1], [1, 1]],
  stats: {},
  agents: 0,
  draw(g) {
    walkways(g);
    const [[qx, qy], [bx, by], [kx, ky]] = roomiest(g, quadrants(g, 0.45));
    cinema(g, qx, qy, 0.4);
    bandstand(g, bx, by, 0.1);
    kiosk(g, kx, ky);
    walkLamps(g, 2);
    benches(g, 4);
    grove(g, g.int(6, 8), -0.32, -0.32, 1.32, 1.32, [[qx, qy, 0.5], [bx, by, 0.16], [kx, ky, 0.12]]);
    grass(g, 20);
  },
};
