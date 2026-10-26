// Tree drawings, shared by the forest trees (features/tree.js) and the trees
// around buildings, in parks and on squares (tree() in structures/kit.js).
//
// Line drawings that always face the viewer, like the glyphs on a paper map,
// grown from the painter's seeded randomness, so every tree is different
// but the same tree always looks the same. Three kinds:
//
//   spruce     tall bare trunk, narrow even crown of foliage pads tapering
//              to a spire, as a filled outline
//   sapling    slender, slightly bent trunk, a few narrow forks and twig tips
//   spreading  short thick trunk splitting into wide, wandering branches
//
// drawTree(g, x, y, kind, height, simple) – height in grid units (1 = one
// grid step). Fine twigs are detail level 2 (close up only). `simple` draws
// a plainer tree (fewer tiers / forks), for forests where many stand together.
//
// With LEAFY on, they are drawn as on a sheet of quick pen sketches
// instead, each crown one pen line over a plain paper fill: a broadleaf
// round a few lopsided lobes, now and then looping back on itself, left
// open underneath where the trunk goes up into it (saplings now and then
// as a tall, ragged poplar); a spruce zigzagging up to its spire and down,
// a branch hanging out at each tier; a shrub as a small broadleaf crown on
// the ground. A few short lines inside on the side away from the light
// (the light the buildings' shadows come from) give the volume, hidden
// when zoomed far out, and a short stroke on the ground at the foot
// (footStroke) stands each tree on the map, as each building stands on one.
// Each leaves its crown's and trunk's shapes for the shadow it casts on
// the ground (Painter.cast, render/shadows.js castShapes): a round one
// from a broadleaf or a shrub, a pointed one from a spruce.

import { SUN, screenLight } from '../src/render/shadows.js';
import { SUN_FREE, sectorLight, lightSector } from '../src/render/sunFree.js';
import { mulberry32 } from '../src/core/random.js';

export const TREE_KINDS = ['spruce', 'sapling', 'spreading'];

export const LEAFY = true;

// A crown's width on the ground for its width in the drawing: a glyph's
// units are the screen's, where a grid unit across shows a little shorter.
const CROWN_ACROSS = 0.8;

export function drawTree(g, x, y, kind, height, simple = false) {
  g.solid(x, y, 0);
  g.swayFrom?.(x, y); // (a garden tree leans in the wind on its own, Painter.swayFrom)
  if (kind === 'spruce') return drawSpruce(g, x, y, height, simple);
  if (LEAFY) return drawLeafy(g, x, y, kind, height, simple);
  for (const [lines, opts] of bareParts(g, kind, height, simple)) g.strokes(x, y, 0, lines, opts);
}

// Several simple trees standing together: [{ x, y, kind, height }…].
// Spruces each get their own outline (drawn back to front, so the filled
// shapes overlap properly). The bare trees' lines are merged into one <path>
// per style – far fewer elements for the browser to paint, and with no
// fills the order they overlap in doesn't show.
export function drawClump(g, x, y, trees) {
  const byStyle = new Map();
  for (const t of trees) {
    if (t.kind === 'spruce' || LEAFY) {
      // filled crowns: each its own solid, so they overlap back to front
      drawTree(g, t.x, t.y, t.kind, t.height, true);
      continue;
    }
    for (const [lines, opts] of bareParts(g, t.kind, t.height, true)) {
      const key = `${opts.cls ?? ''}|${opts.lod ?? 0}`;
      if (!byStyle.has(key)) byStyle.set(key, { opts, groups: [] });
      byStyle.get(key).groups.push({ x: t.x, y: t.y, z: 0, lines });
    }
  }
  if (!byStyle.size) return;
  g.solid(x, y, 0);
  for (const { opts, groups } of byStyle.values()) g.strokeGroups(groups, opts);
}

function drawSpruce(g, x, y, height, simple) {
  if (LEAFY) return sketchSpruce(g, x, y, height, simple);
  const { outline, trunk, inside, branches } = spruceShape(g, height, simple);
  g.strokes(x, y, 0, trunk, { cls: 'trunk' });
  g.shape(x, y, 0, plain(g, outline, height, PLAIN.spruce), { smooth: true, cls: 'tree' });
  g.strokes(x, y, 0, inside, { cls: 'trunk', lod: 2 });
  g.strokes(x, y, 0, branches, { cls: 'twig', lod: 2 });
}

function bareParts(g, kind, height, simple) {
  return bare(g, height, simple ? { ...BARE[kind], ...SIMPLE } : BARE[kind]);
}

// A shrub: a few thin stems fanning out from the ground, each forking once
// near the top, as one path – or with LEAFY a small clump of two or three
// lobes drawn as a broadleaf crown is, sitting on the ground, with a curl
// inside. `height` in grid units.
export function drawShrub(g, x, y, height) {
  g.solid(x, y, 0);
  if (LEAFY) {
    const rx = height * g.range(0.55, 0.7), ry = height * 0.45, cy = ry;
    const at = (a, k) => [Math.sin(a) * rx * k, cy + Math.cos(a) * ry * k * (Math.cos(a) < 0 ? 0.8 : 1)];
    const gap = g.range(0.6, 0.9), a0 = -Math.PI + gap, a1 = Math.PI - gap;
    const { pen, fill } = loopCrown(g, at, a0, a1, rx, { lobes: [2, 3] }, false);
    g.cast(x, y, { kind: 'crown', z: cy, r: rx * CROWN_ACROSS, rz: ry });
    // closed along the ground underneath, in a line that runs on a little
    const [s0, s1] = [fill[0], fill[fill.length - 1]], run = g.range(1.05, 1.2);
    pen.push([[s1[0], s1[1]], [s1[0] + (s0[0] - s1[0]) * run, Math.min(s0[1], s1[1]) * g.range(0.3, 0.7)]]);
    g.shape(x, y, 0, fill, { smooth: true, cls: 'tree crown' });
    g.strokes(x, y, 0, pen, { cls: 'crown-line' });
    shaded(g, x, y, (light) => innerCurls(g, at, a0, a1, false, true, light), { cls: 'leaf' });
    return;
  }
  const lines = [];
  const n = g.int(4, 6);
  for (let i = 0; i < n; i++) {
    const a = ((i + 0.5) / n - 0.5) * g.range(1.4, 2) + g.range(-0.15, 0.15);
    const len = height * g.range(0.7, 1);
    const [mx, my] = [Math.sin(a) * len * 0.6, Math.cos(a) * len * 0.6];
    lines.push([[0, 0], [mx, my], [Math.sin(a) * len, Math.cos(a) * len]]);
    const b = a + (a < 0 ? -1 : 1) * g.range(0.4, 0.8); // fork away from the middle
    lines.push([[mx, my], [mx + Math.sin(b) * len * 0.35, my + Math.cos(b) * len * 0.35]]);
  }
  g.strokes(x, y, 0, lines, { cls: 'twig' });
}

// Random kind, weighted: [spruce, sapling, spreading].
export function pickKind(g, weights = [0.3, 0.25, 0.45]) {
  let r = g.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < weights.length; i++) if ((r -= weights[i]) < 0) return TREE_KINDS[i];
  return TREE_KINDS[0];
}

// Spruce: a tall bare trunk carrying a narrow crown of about even width that
// tapers to a spire at the top, drawn as one filled outline (it hides what
// stands behind it). The outline is made of foliage pads on each side, each
// with its own reach and droop, and now and then a gap where the trunk
// shows. Close up (not simple) the pads get lumpier edges, and the trunk and
// branches are drawn through the crown, as in an ink drawing.
function spruceShape(g, H, simple) {
  const crown0 = H * g.range(0.18, 0.32);    // bare trunk below the crown
  const ch = H - crown0;
  const W = H * g.range(0.13, 0.2);          // half width of the crown
  const n = simple ? g.int(6, 8) : g.int(7, 9); // pads per side
  const lean = g.range(-0.03, 0.03) * H;
  const at = (u, v) => [u + lean * (v / H), v];
  // crown half width at t (0 = crown bottom, 1 = top): a spire in the top
  // third, slightly narrower at the very bottom, even in between
  const width = (t) => W * Math.pow(Math.min(1, (1 - t) / 0.35), 0.85) * (0.8 + 0.2 * Math.min(1, t / 0.25));

  // pads of uneven heights, laid out separately on each side so they
  // alternate like real branches: random shares of the crown, top to bottom
  const cutsFor = () => {
    const shares = Array.from({ length: n }, () => g.range(0.6, 1.4));
    const sum = shares.reduce((a, c) => a + c, 0);
    const cuts = [1];
    for (const sh of shares) cuts.push(cuts[cuts.length - 1] - sh / sum);
    return cuts;
  };
  const bumps = simple ? 1 : 2; // scallops along the top of each pad

  const branches = [];
  const side = (dir) => {
    const cuts = cutsFor();
    const pts = [];
    for (let k = 0; k < n; k++) {             // top to bottom
      const t1 = cuts[k], t0 = Math.max(0, cuts[k + 1]);
      const v1 = crown0 + ch * t1, v0 = crown0 + ch * t0, h = v1 - v0;
      const gap = k > 1 && k < n - 1 && g.chance(0.12);
      const reach = Math.max(H * 0.012, width((t0 + t1) / 2) * (gap ? g.range(0.15, 0.3) : g.range(0.65, 1.15)));
      const inner = reach * g.range(0.1, 0.25);
      const tipV = v0 + h * g.range(-0.1, 0.3); // drooping tip
      // a clump of foliage: in at the trunk, a scalloped top edge out to the
      // drooping tip, a lumpy underside back in (drawn smooth through these)
      pts.push(at(dir * inner, v1 - h * 0.1));
      for (let j = 1; j <= bumps; j++) {
        const f = j / (bumps + 1);
        pts.push(at(dir * (inner + (reach - inner) * f), v1 - h * (0.15 + 0.3 * f) + (j % 2 ? 1 : -1) * h * g.range(0.08, 0.18)));
      }
      pts.push(at(dir * reach, tipV));
      pts.push(at(dir * reach * g.range(0.6, 0.8), v0 + h * g.range(0.05, 0.2)));
      if (!simple) pts.push(at(dir * reach * g.range(0.3, 0.45), v0 + h * g.range(-0.05, 0.15)));
      pts.push(at(dir * inner, v0 + h * 0.2));
      if (!simple && !gap) branches.push([at(0, v1 - h * 0.3), at(dir * reach * 0.45, (v1 + tipV) / 2 - h * 0.15), at(dir * reach * 0.85, tipV + h * 0.1)]);
    }
    pts.push(at(dir * H * 0.018, crown0 - H * 0.01));
    return pts;
  };
  const right = side(1), left = side(-1);
  return {
    outline: [at(0, H), ...right, ...left.reverse()],
    trunk: [[at(0, 0), at(0, crown0 + ch * 0.1)]],
    // drawn over the fill, close-up only
    inside: simple ? [] : [[at(0, crown0), at(0, crown0 + ch * 0.85)]],
    branches,
  };
}

// ----- pen-sketched crowns (LEAFY) -----
//
// After a page of quick ink sketches: the crown is one pen line, not a
// closed shape – round a few lopsided lobes, now and then looping back on
// itself between two of them, sometimes ending in a curl – and it stops
// short underneath, where the trunk goes up into it, on some splitting
// into branches seen below the foliage. A poplar is a tall oval with a
// ragged, zigzag outline instead. Volume: a few short lobe lines inside
// on the shady side.
//
// Angles go round the crown from the top, clockwise: a point at angle a is
// (sin a, cos a) of the way out, u right and v up.

//   trunk   crown bottom (share of the height)
//   width   crown half width (share of the height)
//   lobes   pen lobes round the crown
//   gap     the open part underneath (radians either side of straight down)
const SKETCH = {
  sapling: { trunk: [0.3, 0.42], width: [0.2, 0.28], lobes: [3, 5], gap: [0.4, 0.8] },
  spreading: { trunk: [0.22, 0.32], width: [0.34, 0.48], lobes: [4, 6], gap: [0.35, 0.7] },
  poplar: { trunk: [0.08, 0.16], width: [0.1, 0.14], lobes: [0, 0], gap: [0.2, 0.45] },
};

function drawLeafy(g, x, y, kind, H, simple) {
  const key = kind === 'sapling' && g.chance(0.3) ? 'poplar' : kind;
  const p = SKETCH[key];
  const vb = H * g.range(...p.trunk);           // crown bottom
  const ry = (H - vb) / 2, cy = vb + ry;
  const rx = Math.min(H * g.range(...p.width), ry * 1.5);
  const lean = g.range(-0.05, 0.05) * H;
  // lopsided: the crown sits off the trunk, heavier on one side
  const heavy = g.chance(0.65) ? g.pick([-1, 1]) : 0;
  const ox = lean + heavy * rx * g.range(0.08, 0.28);
  const side = [rx * (heavy < 0 ? g.range(1.05, 1.25) : g.range(0.85, 1)), rx * (heavy > 0 ? g.range(1.05, 1.25) : g.range(0.85, 1))];
  const gap = g.range(...p.gap), a0 = -Math.PI + gap + g.range(-0.15, 0.15), a1 = Math.PI - gap + g.range(-0.15, 0.15);
  const at = (a, k) => [ox + Math.sin(a) * side[Math.sin(a) < 0 ? 0 : 1] * k, cy + Math.cos(a) * ry * k * (Math.cos(a) < 0 ? 0.9 : 1)];

  const { pen, fill } = key === 'poplar' ? raggedCrown(g, at, a0, a1, simple) : loopCrown(g, at, a0, a1, rx, p, simple);

  g.cast(x, y, { kind: 'crown', z: cy, r: (side[0] + side[1]) / 2 * CROWN_ACROSS, rz: ry });
  g.cast(x, y, { kind: 'stem', z: vb });
  footStroke(g, x, y, H);
  if (!simple && g.chance(0.5)) grassTicks(g, x, y, H);
  sketchTrunk(g, x, y, key, H, vb, ox, rx, simple);
  g.shape(x, y, 0, fill, { smooth: true, cls: 'tree crown' });
  g.strokes(x, y, 0, pen, { cls: 'crown-line' });

  shaded(g, x, y, (light) => innerCurls(g, at, a0, a1, key === 'poplar', simple, light), { cls: 'leaf', lod: 1 });
}

// One pen line round lopsided lobes from a0 to a1, with loops back on
// itself between some of them, a hook at the start and now and then a curl
// at the end or a loose stroke part way back underneath. `fill`: the same
// lobes without the loops, closed straight across the bottom (the paper
// that hides what stands behind).
function loopCrown(g, at, a0, a1, rx, p, simple) {
  const n = simple ? g.int(3, 4) : g.int(...p.lobes);
  const shares = Array.from({ length: n }, () => g.range(0.6, 1.5));
  const sum = shares.reduce((a, b) => a + b, 0);
  const cuts = [a0];
  for (const sh of shares) cuts.push(cuts[cuts.length - 1] + (a1 - a0) * sh / sum);
  const pen = [], fill = [], m = simple ? 6 : 9;
  const loops = g.pick([0, 0.3, 0.5]); // some trees loop, some don't
  const inward = (pt, k) => { const c = at(0, 0); return [c[0] + (pt[0] - c[0]) * k, c[1] + (pt[1] - c[1]) * k]; };
  // a hook into the start
  if (g.chance(0.5)) pen.push(inward(at(a0 + 0.1, 0.9), 0.75));
  for (let i = 0; i < n; i++) {
    const [b0, b1] = [cuts[i], cuts[i + 1]];
    // lobes of uneven reach and bulge, each leaning one way (skew)
    const reach = g.range(0.84, 1.1), bump = g.range(0.1, 0.36), skew = g.range(0.6, 1.6);
    const lobe = [];
    for (let j = 0; j <= m; j++) {
      const t = j / m;
      lobe.push(at(b0 + (b1 - b0) * t, reach * (0.86 + bump * Math.sin(Math.PI * t ** skew))));
    }
    // a loop between this lobe and the last: the pen runs on round and
    // comes back into the line, as in joined-up writing
    if (i > 0 && !simple && g.chance(loops)) pen.push(...penLoop(g, lobe[0], lobe[1], at(0, 0), rx * g.range(0.1, 0.2)));
    pen.push(...lobe);
    fill.push(...lobe);
  }
  const end = pen[pen.length - 1];
  if (!simple && g.chance(0.35)) {
    // a curl to finish: spiralling in from the end
    const c = inward(end, 0.8), r0 = Math.hypot(end[0] - c[0], end[1] - c[1]);
    const f0 = Math.atan2(end[1] - c[1], end[0] - c[0]), turns = g.range(1, 1.5);
    for (let j = 1; j <= 14; j++) {
      const t = j / 14, f = f0 + t * turns * Math.PI * 2, r = r0 * (1 - 0.65 * t);
      pen.push([c[0] + Math.cos(f) * r, c[1] + Math.sin(f) * r]);
    }
  } else if (g.chance(0.35)) {
    // a loose stroke part way back underneath, sagging a little
    const start = fill[0], go = g.range(0.35, 0.65), sag = (end[1] - start[1]) * 0.1 + rx * 0.08;
    for (let j = 1; j <= 6; j++) {
      const t = (j / 6) * go;
      pen.push([end[0] + (start[0] - end[0]) * t, end[1] + (start[1] - end[1]) * t - Math.sin(Math.PI * t) * sag]);
    }
  }
  return { pen: [pen], fill };
}

// A pen loop at `from`, going on towards `next`: round an oval that
// touches the line there and back into it, on the side towards `centre` or
// (less often) away from it, `r` across, drawn out along the line.
function penLoop(g, from, next, centre, r) {
  let [tu, tv] = [next[0] - from[0], next[1] - from[1]];
  const tl = Math.hypot(tu, tv) || 1;
  [tu, tv] = [tu / tl, tv / tl];
  let [nu, nv] = [-tv, tu];
  const inside = (centre[0] - from[0]) * nu + (centre[1] - from[1]) * nv > 0;
  if (inside !== g.chance(0.7)) [nu, nv] = [-nu, -nv];
  const long = g.range(1, 1.6), out = [];
  for (let j = 1; j <= 10; j++) {
    const f = (j / 10) * Math.PI * 2;
    const a = Math.sin(f) * r * long, b = (1 - Math.cos(f)) * r;
    out.push([from[0] + tu * a + nu * b, from[1] + tv * a + nv * b]);
  }
  return out;
}

// A spruce as a quick sketch: one pen line zigzagging up one side to the
// spire and down the other – each tier a branch hanging out and down from
// near the trunk, its tip back in under it to the next – left open at the
// bottom over a bare trunk, now and then looping once, and a few short
// hanging strokes inside on the shady side.
function sketchSpruce(g, x, y, H, simple) {
  const crown0 = H * g.range(0.12, 0.22), ch = H - crown0;
  const W = H * g.range(0.13, 0.19), lean = g.range(-0.03, 0.03) * H;
  const width = (t) => W * Math.pow(Math.max(0, 1 - t), 0.85) * (0.85 + 0.15 * Math.min(1, t / 0.2));
  const at = (u, v) => [u + lean * (v / H), v];
  const n = simple ? g.int(5, 6) : g.int(6, 8);
  const side = (dir) => {
    // tier heights: uneven shares of the crown, bottom to top
    const shares = Array.from({ length: n }, () => g.range(0.7, 1.3)), sum = shares.reduce((a, b) => a + b, 0);
    const pts = [];
    let t = 0;
    for (let k = 0; k < n; k++) {
      const t1 = t + shares[k] / sum, h = (t1 - t) * ch;
      const tip = [dir * width(t) * g.range(0.85, 1.15), crown0 + t * ch - h * g.range(0, 0.25)];
      const inner = [dir * width(t1) * g.range(0.3, 0.5), crown0 + t1 * ch - h * 0.15];
      // from the tip in under the branch to the trunk side, then the next
      // branch hanging out and down from there (drawn as the pen goes up)
      pts.push(tip, [tip[0] * 0.75 + inner[0] * 0.25, tip[1] + h * 0.12]);
      if (k < n - 1) pts.push(inner);
      t = t1;
    }
    return pts;
  };
  const left = side(-1), right = side(1).reverse();
  const top = [g.range(-0.01, 0.01) * H, H];
  // the branch from each inner point droops out to the next tip: a bend
  const hang = (pts) => {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      out.push(a);
      if (b && Math.abs(b[0]) > Math.abs(a[0])) out.push([a[0] * 0.4 + b[0] * 0.6, Math.max(a[1], b[1]) - (Math.abs(a[1] - b[1])) * 0.1]);
    }
    return out;
  };
  let pen = hang([...left, top, ...right]).map(([u, v]) => at(u, v));
  const fill = pen;
  if (!simple && g.chance(0.3)) {
    const i = g.int(2, pen.length - 3);
    pen = [...pen.slice(0, i), ...penLoop(g, pen[i], pen[i + 1], at(0, crown0 + ch * 0.4), W * g.range(0.15, 0.25)), ...pen.slice(i)];
  }
  g.cast(x, y, { kind: 'cone', z0: crown0, z1: H, r: W * CROWN_ACROSS });
  g.cast(x, y, { kind: 'stem', z: crown0 });
  footStroke(g, x, y, H);
  if (!simple && g.chance(0.4)) grassTicks(g, x, y, H);
  g.strokes(x, y, 0, [[at(0, 0), at(0, crown0 + ch * 0.3)]], { cls: 'trunk' });
  g.shape(x, y, 0, fill, { smooth: true, cls: 'tree crown spruce' });
  g.strokes(x, y, 0, [pen], { cls: 'crown-line spruce' });
  // short hanging tier strokes inside, on the side away from the light
  shaded(g, x, y, (light) => {
    const dir = light[0] > 0 ? -1 : 1, marks = [];
    for (let i = simple ? 1 : g.int(2, 3); i > 0; i--) {
      const t = g.range(0.12, 0.6), w = width(t), v = crown0 + t * ch;
      const u0 = dir * w * g.range(0.1, 0.25), u1 = dir * w * g.range(0.55, 0.75);
      marks.push([at(u0, v), at((u0 + u1) / 2, v - ch * 0.01), at(u1, v - ch * g.range(0.03, 0.06))]);
    }
    return marks;
  }, { cls: 'leaf', lod: 1 });
}

// A tall oval with a ragged outline: short straight pen jabs in and out.
function raggedCrown(g, at, a0, a1, simple) {
  const n = simple ? g.int(12, 16) : g.int(20, 28), pen = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * (i + (i && i < n ? g.range(-0.3, 0.3) : 0)) / n;
    pen.push(at(a, (i % 2 ? 1 + g.range(0.02, 0.08) : 1 - g.range(0.02, 0.08))));
  }
  return { pen: [pen], fill: pen };
}

// A few short lines inside the crown on the side away from the
// light, as a sketcher marks the lobes in shade – small arcs with a bump or
// two, or on a poplar short zigzags up and down.
function innerCurls(g, at, a0, a1, ragged, simple, light) {
  const shadeAt = Math.atan2(-light[0], -light[1]);
  const out = [];
  for (let i = simple ? 1 : g.int(2, 3); i > 0; i--) {
    // (every choice made before any is skipped: the light moves with the
    // sun and the view, and the tree – and all drawn after it with the
    // same painter, a building's garden – must not change with it)
    const mid = shadeAt + g.range(-0.7, 0.7), span = ragged ? g.range(0.25, 0.4) : g.range(0.5, 0.9);
    const k = g.range(0.6, 0.8), bumps = g.int(1, 2), line = [], m = 10;
    const from = Math.max(a0 + 0.15, mid - span / 2), to = Math.min(a1 - 0.15, mid + span / 2);
    if (to - from < 0.2) continue;
    for (let j = 0; j <= m; j++) {
      const t = j / m;
      const kk = ragged ? k * (j % 2 ? 1.06 : 0.94) : k * (1 + 0.1 * Math.abs(Math.sin(Math.PI * bumps * t)));
      line.push(at(from + (to - from) * t, kk));
    }
    out.push(line);
  }
  return out;
}

// The trunk: on a big tree two lines that taper up into the crown, on a
// small one a single stroke; on some (not simple) it splits below the
// crown into two or three branches going up into it – drawn before the
// crown, whose paper hides them above its bottom.
function sketchTrunk(g, x, y, key, H, vb, ox, rx, simple) {
  const top = [ox * 0.8, vb + H * 0.08];
  if (key === 'spreading' && !simple) {
    const w0 = H * g.range(0.022, 0.032), w1 = w0 * 0.4;
    const bend = [ox * 0.3 + g.range(-0.01, 0.01) * H, vb * 0.55];
    g.strokes(x, y, 0, [-1, 1].map((s) => [[s * w0 * 1.3, 0], [bend[0] + s * w0 * 0.8, bend[1]], [top[0] + s * w1, top[1]]]), { cls: 'trunk' });
  } else {
    g.strokes(x, y, 0, [[[0, 0], [ox * 0.4, vb * 0.6], top]], { cls: key === 'spreading' ? 'trunk thick' : 'trunk' });
  }
  if (simple || key === 'poplar' || !g.chance(0.45)) return;
  const fork = [ox * 0.45, vb * g.range(0.6, 0.8)], limbs = [];
  for (let i = g.int(2, 3); i > 0; i--) {
    const u = ox + rx * g.range(-0.55, 0.55), v = vb + H * g.range(0.04, 0.12);
    limbs.push([fork, [(fork[0] + u) / 2 + g.range(-0.01, 0.01) * H, (fork[1] + v) / 2], [u, v]]);
  }
  g.strokes(x, y, 0, limbs, { cls: 'limb' });
}

// Two or three quick grass ticks by the foot, close up only.
function grassTicks(g, x, y, H) {
  const out = [];
  for (let i = g.int(2, 3); i > 0; i--) {
    const u = H * g.range(-0.18, 0.18), h = H * g.range(0.03, 0.06);
    out.push([[u, 0], [u + g.range(-0.3, 0.3) * h, h]]);
  }
  g.strokes(x, y, 0, out, { cls: 'twig', lod: 2 });
}

// ----- the pen's work on a crown -----

// The light on a round crown, in a glyph's own units (u right, v up):
// towards the sun on screen (screenLight: opposite to where the shadows
// fall in this view) tipped up, as the sun stands high – so a crown is lit
// on top as well as on the sunny side, and its underside is in shade.
// Worked out once per view and sun.
let lit = null;
function ballLight(camera) {
  const key = `${camera.angle ?? 0}|${SUN.azimuth}`;
  if (lit?.key !== key) {
    const [u0, v0] = screenLight(camera);
    const [u, v] = [u0, v0 + 0.9], n = Math.hypot(u, v);
    lit = { key, at: [u / n, v / n] };
  }
  return lit.at;
}

// The marks a tree makes on its side away from the light (`make(light)` ->
// lines), drawn for the light as it is; or, on the map (sun-free,
// src/render/sunFree.js), for each way the light can come from, the same
// marks each time (one draw from the painter's randomness seeds them all,
// so the tree and what is drawn after it are the same whatever the light),
// tagged with its sector – the map's stylesheet shows the one the light has.
function shaded(g, x, y, make, opts) {
  if (!g.sunFree) {
    g.strokes(x, y, 0, make(ballLight(g.camera)), opts);
    return;
  }
  const seed = Math.floor(g.random() * 4294967296), keep = g.random;
  for (const s of SUN_FREE.drawn) {
    g.random = mulberry32(seed);
    g.strokes(x, y, 0, make(sectorLight(s)), { ...opts, cls: `${opts.cls} tq tq${s}` });
  }
  g.random = keep;
}

// The sector of the light on a round crown now (sunFree.js).
export function treeLightSector(camera) {
  return lightSector(ballLight(camera));
}

// A short stroke on the ground at a tree's foot, a little aslant, as each
// building stands on one (LOOK.ground in painter.js); far out it goes.
function footStroke(g, x, y, H) {
  // (watercolour: a pool of the crown's colour on the ground under it)
  if (g.wash) {
    // (its wobble from where it stands, not from g.random: the tree itself
    // stays as in the other schemes)
    const rx = H * 0.24, ry = rx * 0.42, pts = [], [wx, wy] = g.toWorld(x, y);
    const j = (k) => 0.9 + 0.2 * ((Math.sin(k * 12.9898 + wx * 78.233 + wy * 37.719) * 43758.5453) % 1 + 1) % 1;
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      pts.push([Math.cos(a) * rx * j(k), Math.sin(a) * ry * j(k + 10)]);
    }
    g.shape(x, y, 0, pts, { smooth: true, cls: 'pool', lod: 1 });
  }
  const w = H * g.range(0.1, 0.15);
  g.strokes(x, y, 0, [[[-w * g.range(0.6, 1), H * 0.006], [w, -H * 0.008]]], { cls: 'tree-foot', lod: 1 });
}

// A crown outline as plain as the painter's `detail` asks (0: as is): its
// points thinned (Douglas–Peucker) to within a share of the tree's height
// (`tol`, by detail 1 / 2), so it keeps its shape – a spruce its tiers –
// and loses the small bumps, which can't be told
// apart that far out anyway. Only the drawing changes – every random choice
// was already made – so a tree looks the same at each detail, just plainer.
const PLAIN = { spruce: [0.012, 0.02] };
function plain(g, pts, H, tols) {
  const tol = (tols[g.detail - 1] ?? 0) * H;
  if (!tol || pts.length < 8) return pts;
  const keep = new Uint8Array(pts.length);
  const span = (i, j) => {
    const [ax, ay] = pts[i], [bx, by] = pts[j % pts.length];
    const l = Math.hypot(bx - ax, by - ay) || 1;
    let far = -1, worst = tol;
    for (let k = i + 1; k < j; k++) {
      const d = Math.abs((bx - ax) * (ay - pts[k][1]) - (ax - pts[k][0]) * (by - ay)) / l;
      if (d > worst) { worst = d; far = k; }
    }
    if (far < 0) return;
    keep[far] = 1;
    span(i, far);
    span(far, j);
  };
  // closed: split at the first point and the one furthest from it
  let opp = 0, dmax = -1;
  for (let k = 1; k < pts.length; k++) {
    const d = Math.hypot(pts[k][0] - pts[0][0], pts[k][1] - pts[0][1]);
    if (d > dmax) { dmax = d; opp = k; }
  }
  keep[0] = keep[opp] = 1;
  span(0, opp);
  span(opp, pts.length);
  const out = pts.filter((_, k) => keep[k]);
  return out.length >= 5 ? out : pts;
}

// Bare broadleaf trees. Every limb carries on as a leader and sends off a
// side branch (now and then two), until the pieces get short – so crowns
// come out uneven and open.
//   trunk   trunk length before the first fork (share of the whole)
//   spread  angle of side branches (radians)
//   lead    how much of its length a leader keeps at each fork
//   side    how much of it a side branch gets
//   extra   chance of a second side branch
//   depth   forks at most along any branch (keeps the line count sane)
//   width   crown width relative to the height (at most)
const BARE = {
  sapling: { trunk: [0.35, 0.5], spread: [0.35, 0.55], lead: [0.72, 0.82], side: [0.45, 0.6], extra: 0.1, depth: 6, stop: 0.12, width: 0.5, thick: false },
  spreading: { trunk: [0.25, 0.35], spread: [0.45, 0.8], lead: [0.72, 0.84], side: [0.6, 0.78], extra: 0.2, depth: 6, stop: 0.1, width: 1.05, thick: true },
};

// Plainer bare trees: fewer, longer pieces – few enough to keep the twigs
// when zoomed out, or the crowns would thin to bare sticks.
const SIMPLE = { depth: 4, stop: 0.22, extra: 0.1, simple: true };

function bare(g, H, p) {
  const trunk = [], limbs = [], branches = [], twigs = [];
  const T = g.range(...p.trunk);
  const spread = g.range(...p.spread);
  const grow = (x, y, a, len, main, d = 0) => {
    const ex = x + Math.sin(a) * len, ey = y + Math.cos(a) * len;
    // a slight bend in every piece
    const j = g.range(-0.14, 0.14) * len;
    const line = [[x, y], [(x + ex) / 2 + Math.cos(a) * j, (y + ey) / 2 - Math.sin(a) * j], [ex, ey]];
    const bucket = main && len > T * 0.5 ? trunk : len > T * 0.45 ? limbs : len > T * p.stop * 2 ? branches : twigs;
    bucket.push(line);
    if (len < T * p.stop || d >= p.depth) return;
    const turn = g.chance(0.5) ? 1 : -1;
    // the leader carries on, pulled back towards upright
    grow(ex, ey, a * 0.8 + turn * g.range(0.05, 0.3), len * g.range(...p.lead), main, d + 1);
    // a side branch to the other side
    grow(ex, ey, a - turn * spread * g.range(0.7, 1.3), len * g.range(...p.side), false, d + 1);
    if (g.chance(p.extra)) grow(ex, ey, a + turn * spread * g.range(0.8, 1.4), len * g.range(...p.side) * 0.8, false, d + 1);
  };
  grow(0, 0, g.range(-0.06, 0.06), T, true);

  // scale to the height, and squeeze if the crown came out too wide
  const all = [...trunk, ...limbs, ...branches, ...twigs];
  let top = 0, left = 0, right = 0;
  for (const line of all) for (const [u, v] of line) {
    top = Math.max(top, v);
    left = Math.min(left, u);
    right = Math.max(right, u);
  }
  const k = H / top;
  const squeeze = Math.min(1, (p.width * H) / ((right - left) * k));
  for (const line of all) for (const pt of line) {
    pt[0] *= k * squeeze;
    pt[1] *= k;
  }
  return [
    [trunk, { cls: p.thick ? 'trunk thick' : 'trunk' }],
    [limbs, { cls: 'limb' }],
    [branches, {}],
    [twigs, { cls: 'twig', lod: p.simple ? 0 : 2 }],
  ];
}
