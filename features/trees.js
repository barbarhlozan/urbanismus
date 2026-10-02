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
// With LEAFY on, the broadleaf kinds are drawn as on an old map-sketching
// sheet instead: a lumpy crown outline with diagonal hatching on a short
// trunk (saplings now and then as a tall narrow poplar), and spruces and
// shrubs get the same hatching. Hatching is hidden when zoomed far out, and
// crown outlines get plainer with the painter's `detail` (plain()).

export const TREE_KINDS = ['spruce', 'sapling', 'spreading'];

export const LEAFY = true;

export function drawTree(g, x, y, kind, height, simple = false) {
  g.solid(x, y, 0);
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
  const { outline, trunk, inside, branches } = spruceShape(g, height, simple);
  g.strokes(x, y, 0, trunk, { cls: 'trunk' });
  g.shape(x, y, 0, plain(g, outline, height, PLAIN.spruce), { smooth: true, cls: 'tree' });
  castTree(g, x, y, outline);
  if (LEAFY) {
    // hatch inside the smooth outline: it runs through the points' midpoints,
    // pulled in a little towards the trunk
    const clip = midpoints(outline).map(([u, v]) => [u * 0.8, v]);
    g.strokes(x, y, 0, hatchIn(g, clip, height * (simple ? 0.075 : 0.06)), { cls: 'leaf', lod: 1 });
    return;
  }
  g.strokes(x, y, 0, inside, { cls: 'trunk', lod: 2 });
  g.strokes(x, y, 0, branches, { cls: 'twig', lod: 2 });
}

// A tree's shadow: its crown turned into a round lump (Painter.castShape)
// on a thin trunk down to the ground – and for the contact shadows, a
// small block at its foot about half the crown wide and half the tree high.
function castTree(g, x, y, outline) {
  g.castShape(x, y, 0, outline);
  const top = Math.min(...outline.map((p) => p[1])) / g.camera.zScale, w = 0.012;
  g.cast([0, top].flatMap((z) => [[x - w, y, z], [x + w, y, z], [x, y + w, z], [x, y - w, z]]));
  const r = Math.max(...outline.map((p) => Math.abs(p[0]))) * 0.5;
  const h = Math.max(...outline.map((p) => p[1])) / g.camera.zScale * 0.5;
  g.castFoot([[x - r, y - r], [x + r, y - r], [x + r, y + r], [x - r, y + r]], h);
}

function bareParts(g, kind, height, simple) {
  return bare(g, height, simple ? { ...BARE[kind], ...SIMPLE } : BARE[kind]);
}

// A shrub: a few thin stems fanning out from the ground, each forking once
// near the top, as one path – or with LEAFY a small hatched clump. `height`
// in grid units.
export function drawShrub(g, x, y, height) {
  g.solid(x, y, 0);
  if (LEAFY) {
    const { outline, clip } = blob(g, 0, height * 0.45, height * g.range(0.55, 0.7), height * 0.45, g.int(4, 6));
    g.shape(x, y, 0, outline, { smooth: true, cls: 'tree' });
    g.strokes(x, y, 0, hatchIn(g, clip, height * 0.22), { cls: 'leaf' });
    g.castShape(x, y, 0, outline);
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

// ----- leafy broadleaf trees (LEAFY) -----

//   trunk   bare trunk below the crown (share of the height)
//   width   crown half width (share of the height)
//   lumps   bumps around the crown outline
const LEAF = {
  sapling: { trunk: [0.3, 0.42], width: [0.2, 0.27], lumps: [6, 8] },
  poplar: { trunk: [0.1, 0.18], width: [0.1, 0.14], lumps: [7, 9] },
  spreading: { trunk: [0.22, 0.3], width: [0.34, 0.46], lumps: [8, 11] },
};

function drawLeafy(g, x, y, kind, H, simple) {
  const p = LEAF[kind === 'sapling' && g.chance(0.3) ? 'poplar' : kind];
  const T = H * g.range(...p.trunk);
  const lean = g.range(-0.04, 0.04) * H;
  const ry = (H - T * 0.8) / 2, cy = T * 0.8 + ry;
  const rx = Math.min(H * g.range(...p.width), ry * 1.4);
  const { outline, clip } = blob(g, lean, cy, rx, ry, g.int(...p.lumps));
  // the trunk runs up into the crown (its fill hides the top); close up,
  // a fork shows through it, as in an ink drawing
  g.strokes(x, y, 0, [[[0, 0], [lean * 0.5, T], [lean, cy]]], { cls: kind === 'spreading' ? 'trunk thick' : 'trunk' });
  g.shape(x, y, 0, plain(g, outline, H, PLAIN.leafy), { smooth: true, cls: 'tree' });
  g.strokes(x, y, 0, hatchIn(g, clip, H * (simple ? 0.09 : 0.07)), { cls: 'leaf', lod: 1 });
  castTree(g, x, y, outline);
  if (!simple) {
    const fork = [[lean * 0.6, T * 0.9], [lean - rx * 0.35, cy + ry * 0.1]];
    const fork2 = [[lean * 0.6, T * 0.9], [lean + rx * 0.3, cy + ry * 0.25]];
    g.strokes(x, y, 0, [[[lean * 0.5, T * 0.8], [lean * 0.6, T * 1.1]], fork, fork2], { cls: 'limb', lod: 2 });
  }
}

// A lumpy closed outline around (cx, cy) with half axes rx, ry: points
// alternately out and in, so drawn smooth (g.shape) they make scallops.
// `clip` is a polygon a little inside the smooth outline, for hatching.
function blob(g, cx, cy, rx, ry, lumps) {
  const outline = [];
  const phase = g.range(0, Math.PI);
  for (let i = 0; i < lumps * 2; i++) {
    const a = phase + (i / (lumps * 2)) * Math.PI * 2;
    const r = i % 2 ? g.range(0.8, 0.9) : g.range(0.97, 1.08);
    const flat = Math.cos(a) < -0.4 ? 0.88 : 1; // a flatter underside
    outline.push([cx + Math.sin(a) * rx * r, cy + Math.cos(a) * ry * r * flat]);
  }
  const clip = midpoints(outline).map(([u, v]) => [cx + (u - cx) * 0.86, cy + (v - cy) * 0.86]);
  return { outline, clip };
}

function midpoints(pts) {
  return pts.map((p, i) => {
    const q = pts[(i + 1) % pts.length];
    return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  });
}

// A crown outline as plain as the painter's `detail` asks (0: as is): its
// points thinned (Douglas–Peucker) to within a share of the tree's height
// (`tol`, by detail 1 / 2), so it keeps its shape – a spruce its tiers, a
// broadleaf its lumps – and loses the small bumps, which can't be told
// apart that far out anyway. Only the drawing changes – every random choice
// was already made – so a tree looks the same at each detail, just plainer.
const PLAIN = { spruce: [0.012, 0.02], leafy: [0, 0.012] };
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

// Diagonal hatching ("/") inside a polygon, `step` apart: each line split
// where it leaves and re-enters the shape, and a little uneven, like pencil
// strokes.
function hatchIn(g, poly, step) {
  const lines = [];
  const cs = poly.map(([u, v]) => v - u);
  const [c0, c1] = [Math.min(...cs), Math.max(...cs)];
  for (let c = c0 + step * g.range(0.3, 0.7); c < c1; c += step * g.range(0.85, 1.15)) {
    // crossings of v = u + c with the outline, along u
    const us = [];
    for (let i = 0; i < poly.length; i++) {
      const [a, b] = [poly[i], poly[(i + 1) % poly.length]];
      const fa = a[1] - a[0] - c, fb = b[1] - b[0] - c;
      if ((fa > 0) === (fb > 0)) continue;
      const t = fa / (fa - fb);
      us.push(a[0] + (b[0] - a[0]) * t);
    }
    us.sort((a, b) => a - b);
    for (let i = 0; i + 1 < us.length; i += 2) {
      const len = us[i + 1] - us[i];
      if (len < step * 0.5) continue;
      const u0 = us[i] + len * g.range(0, 0.12), u1 = us[i + 1] - len * g.range(0, 0.12);
      lines.push([[u0, u0 + c], [u1, u1 + c]]);
    }
  }
  return lines;
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
