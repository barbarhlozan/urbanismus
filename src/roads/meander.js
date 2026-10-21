// Where a footpath runs at dense dot f: not ruled straight from dot to dot
// but wandering a little, as a path trodden across fields does. Each run
// of a footpath (the dots between junctions, ends and anything it must
// meet exactly) is moved sideways by
//   - a slow wave, two swells of its own (seeded by the world and the run,
//     so the same path always bends the same way), and
//   - the ground: it bows round a knoll and into a hollow, away from where
//     the ground rises across it (only the changes along the run: a path
//     along an even slope isn't pushed down it as a whole),
// fading out over the last RAMP of each end, then fitted with the line that
// bends least while staying near those spots (smoothLine, which also evens
// out the staircase a path drawn at a slant makes), none more than
// MAX_SHIFT off its dot.
//
// What stays on its dot: junctions and ends, where it meets or crosses a
// road (and its kerb), a railway or a fence (the gate), dots by water (a
// bridge, a shore) and the walkways in parks and squares. The drawing,
// the walkers, trees and lamps keeping clear, all go by these positions;
// the rules (what may be built where) by the dots.

import { STRUCTURE_TYPES } from '../../structures/index.js';
import { mulberry32 } from '../core/random.js';
import { smoothLine } from '../core/geom2d.js';

const SWAY = 0.2;       // how far the wave swings either way (grid units, before the fit)
const WAVES = [4.2, 2.6]; // its two swells' lengths (grid units)
const GROUND = 0.018;   // grid units aside per metre-per-step of rise across the path
const RAMP = 1;         // grid units over which each end eases into it
const STIFF = 1.5;      // how hard the fit resists bending
const MAX_SHIFT = 0.26; // grid units: no dot moved further

// Map dense dot -> [x, y] for the footpaths' dots that move.
export function meanderPaths(world) {
  const layer = world.networks.path;
  const graph = layer.graph;
  const { fine } = world;
  const height = world.elevation;
  const touches = (f) => world.roadAtFine(f) || world.rails.hasNode(f) || world.fences.hasNode(f);
  const site = (f) => world.coarseAround(f).some((c) => STRUCTURE_TYPES[world.structureAt(c)?.type]?.site);
  const free = (f) => graph.degree(f) === 2 && !touches(f) && !fine.neighbors(f).some(touches) && !layer.bridge.water(f) && !site(f);

  const pos = new Map();
  const done = new Set();
  for (const f of graph.nodes()) {
    if (!free(f) || done.has(f)) continue;
    // the run through f out to a fixed dot each way (or round a loop)
    const walk = (first) => {
      const out = [];
      for (let prev = f, cur = first; ; ) {
        out.push(cur);
        if (cur === f || !free(cur)) return out;
        done.add(cur);
        const next = [...graph.neighbors(cur)].find((m) => m !== prev);
        [prev, cur] = [cur, next];
      }
    };
    done.add(f);
    const [a, b] = [...graph.neighbors(f)];
    const ahead = walk(a);
    // (a loop with nothing fixed on it: held at f, round from f to f)
    let nodes = ahead[ahead.length - 1] === f ? [f, ...ahead] : [...walk(b).reverse(), f, ...ahead];
    // the same way along whichever end it was found from (the same swells)
    if (nodes[0] > nodes[nodes.length - 1]) nodes = nodes.reverse();
    for (const [n, p] of meander(world, nodes, free, height)) pos.set(n, p);
  }
  return pos;
}

function meander(world, nodes, free, height) {
  const layer = world.networks.path;
  const dots = nodes.map((n) => layer.dot(n));
  const along = [0];
  for (let i = 1; i < dots.length; i++) along.push(along[i - 1] + Math.hypot(dots[i][0] - dots[i - 1][0], dots[i][1] - dots[i - 1][1]));
  const length = along[along.length - 1];
  if (length < 2 * RAMP) return [];

  const rand = mulberry32((world.seed ^ Math.imul(nodes[0], 2654435761) ^ Math.imul(nodes[nodes.length - 1], 40503)) >>> 0);
  const swells = WAVES.map((l, k) => ({ l: l * (0.8 + 0.4 * rand()), phase: rand() * Math.PI * 2, size: k ? 0.4 : 0.75 }));
  const sideOf = (i) => {
    const [px, py] = dots[Math.max(0, i - 1)], [qx, qy] = dots[Math.min(dots.length - 1, i + 1)];
    const l = Math.hypot(qx - px, qy - py) || 1;
    return [-(qy - py) / l, (qx - px) / l];
  };
  // the rise across the path at each dot, less its run's average
  const d = 0.35;
  const rise = dots.map(([x, y], i) => {
    const [nx, ny] = sideOf(i);
    return (height(x + nx * d, y + ny * d) - height(x - nx * d, y - ny * d)) / (2 * d);
  });
  const mean = rise.reduce((s, r) => s + r, 0) / rise.length;

  const want = dots.map(([x, y], i) => {
    const s = along[i];
    const ease = smooth(Math.min(1, s / RAMP, (length - s) / RAMP));
    const wave = swells.reduce((sum, w) => sum + w.size * Math.sin((s / w.l) * Math.PI * 2 + w.phase), 0) * SWAY;
    const aside = ease * (wave - GROUND * (rise[i] - mean));
    const [nx, ny] = sideOf(i);
    return [x + nx * aside, y + ny * aside];
  });
  const fixed = nodes.map((n, i) => i === 0 || i === nodes.length - 1 || !free(n));
  const fitted = smoothLine(want, fixed, STIFF);
  const out = [];
  nodes.forEach((n, i) => {
    if (fixed[i]) return;
    const [x, y] = dots[i], [px, py] = fitted[i];
    const l = Math.hypot(px - x, py - y);
    const k = l > MAX_SHIFT ? MAX_SHIFT / l : 1;
    out.push([n, [x + (px - x) * k, y + (py - y) * k]]);
  });
  return out;
}

const smooth = (t) => t * t * (3 - 2 * t);
