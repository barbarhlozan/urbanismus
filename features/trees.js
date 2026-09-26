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

export const TREE_KINDS = ['spruce', 'sapling', 'spreading'];

export function drawTree(g, x, y, kind, height, simple = false) {
  g.solid(x, y, 0);
  if (kind === 'spruce') return drawSpruce(g, x, y, height, simple);
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
    if (t.kind === 'spruce') {
      g.solid(t.x, t.y, 0);
      drawSpruce(g, t.x, t.y, t.height, true);
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
  const { outline, trunk, inside, branches } = spruceShape(g, height, simple);
  g.strokes(x, y, 0, trunk, { cls: 'trunk' });
  g.shape(x, y, 0, outline, { smooth: true });
  g.strokes(x, y, 0, inside, { cls: 'trunk', lod: 2 });
  g.strokes(x, y, 0, branches, { cls: 'twig', lod: 2 });
}

function bareParts(g, kind, height, simple) {
  return bare(g, height, simple ? { ...BARE[kind], ...SIMPLE } : BARE[kind]);
}

// A shrub: a few thin stems fanning out from the ground, each forking once
// near the top, as one path. `height` in grid units.
export function drawShrub(g, x, y, height) {
  g.solid(x, y, 0);
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
