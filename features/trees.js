// Tree drawings, shared by the forest trees (features/tree.js) and the trees
// around buildings, in parks and on squares (tree() in structures/kit.js).
//
// Line drawings that always face the viewer, like the glyphs on a paper map,
// grown from the painter's seeded randomness, so every tree is different
// but the same tree always looks the same. Three kinds:
//
//   spruce     filled outline of drooping skirt tiers, narrowing to a
//              pointed top, on a short trunk
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
  const { outline, trunk } = spruceShape(g, height, simple);
  g.strokes(x, y, 0, trunk, { cls: 'trunk' });
  g.shape(x, y, 0, outline);
}

function bareParts(g, kind, height, simple) {
  return bare(g, height, simple ? { ...BARE[kind], ...SIMPLE } : BARE[kind]);
}

// Random kind, weighted: [spruce, sapling, spreading].
export function pickKind(g, weights = [0.3, 0.25, 0.45]) {
  let r = g.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < weights.length; i++) if ((r -= weights[i]) < 0) return TREE_KINDS[i];
  return TREE_KINDS[0];
}

// Spruce: a filled outline (it hides what stands behind it) of drooping
// skirt tiers narrowing to a pointed top, on a short trunk. Each side is
// jittered on its own, and close-up trees get small teeth along each skirt.
function spruceShape(g, H, simple) {
  const base = H * g.range(0.08, 0.14);   // trunk showing below the lowest skirt
  const W = H * g.range(0.22, 0.3);       // half width at the bottom
  const n = simple ? g.int(3, 4) : g.int(4, 6);
  const tier = (H - base) / n;
  const lean = g.range(-0.025, 0.025) * H;
  const side = (dir) => {
    const pts = [];
    for (let k = 0; k < n; k++) {
      const t = (k + 1) / n;              // 0 at the top, 1 at the bottom tier
      const tip = [dir * W * Math.pow(t, 0.85) * g.range(0.85, 1.12) + lean * (1 - t), base + (H - base) * (1 - t) + tier * g.range(-0.12, 0.05)];
      // the notch where this skirt starts, tucked in under the one above
      if (k > 0) {
        const prev = pts[pts.length - 1];
        const notch = [dir * Math.abs(prev[0]) * g.range(0.6, 0.8) + lean * (1 - t), tip[1] + tier * g.range(0.4, 0.55)];
        pts.push(notch);
        if (!simple) {
          // a small tooth halfway down the skirt
          const m = [(notch[0] + tip[0]) / 2, (notch[1] + tip[1]) / 2];
          pts.push([m[0] + dir * tier * 0.12, m[1] + tier * 0.02], [m[0] + dir * tier * 0.02, m[1] - tier * 0.08]);
        }
      }
      pts.push(tip);
    }
    // under the lowest skirt, back to the trunk
    pts.push([dir * H * 0.025, base + tier * g.range(0.1, 0.25)]);
    return pts;
  };
  const right = side(1), left = side(-1);
  const top = [lean, H];
  return {
    outline: [top, ...right, ...left.reverse()],
    trunk: [[[0, 0], [0, base + tier * 0.2]]],
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
