// Turning a start/end click into a list of grid nodes, and checking whether
// that route can be built on a network layer. Routes are deterministic (no
// detours): if anything is in the way, nothing is built.

export const BEND = {
  DIAGONAL_FIRST: 'diagonal first',
  STRAIGHT_FIRST: 'straight first',
};

export function planRoute(grid, from, to, bend = BEND.DIAGONAL_FIRST) {
  const [x0, y0] = grid.xy(from);
  const [x1, y1] = grid.xy(to);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const diag = Math.min(ax, ay);
  const straight = Math.max(ax, ay) - diag;
  const straightStep = ax > ay ? [sx, 0] : [0, sy];

  const diagSteps = Array(diag).fill([sx, sy]);
  const straightSteps = Array(straight).fill(straightStep);
  const steps = bend === BEND.STRAIGHT_FIRST
    ? [...straightSteps, ...diagSteps]
    : [...diagSteps, ...straightSteps];

  const nodes = [from];
  let x = x0;
  let y = y0;
  for (const [stepX, stepY] of steps) {
    x += stepX;
    y += stepY;
    nodes.push(grid.index(x, y));
  }
  return nodes;
}

// A diagonal edge may not cross the other diagonal of the same grid square.
export function crossesDiagonal(layer, a, b) {
  const { grid, graph } = layer;
  const [ax, ay] = grid.xy(a);
  const [bx, by] = grid.xy(b);
  if (ax === bx || ay === by) return false;
  return graph.hasEdge(grid.index(ax, by), grid.index(bx, ay));
}

// Angle between the directions a -> b and b -> c (0 = straight on).
export function turnAngle(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1];
  const vx = c[0] - b[0], vy = c[1] - b[1];
  const l = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  return l ? Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / l))) : 0;
}

// For layers with a `maxTurn` (railways): the dots where the route bends too
// sharply – inside the route, or where it joins existing line at either end
// (it has to carry on from at least one segment already there).
function sharpBends(layer, nodes) {
  const { graph, maxTurn } = layer;
  if (maxTurn == null) return [];
  const pos = (n) => layer.dot(n); // the grid's angles, not the smoothed track's
  const ok = (a, b, c) => turnAngle(pos(a), pos(b), pos(c)) <= maxTurn + 1e-6;
  const out = [];
  for (let i = 1; i < nodes.length - 1; i++) {
    if (!ok(nodes[i - 1], nodes[i], nodes[i + 1])) out.push(nodes[i]);
  }
  const joins = (end, next) => {
    const others = [...graph.neighbors(end)].filter((m) => m !== next);
    return !others.length || others.some((m) => ok(m, end, next));
  };
  const last = nodes.length - 1;
  if (!joins(nodes[0], nodes[1])) out.push(nodes[0]);
  if (!joins(nodes[last], nodes[last - 1])) out.push(nodes[last]);
  return out;
}

// Water on a route is allowed only as bridges (layer.bridge): straight runs
// of at most `span` water dots, all river, with land at both ends, crossing
// nothing on the way. { clear: water dots that are fine, problem: the first
// run that isn't, as { reason, nodes } }.
function bridgeSpans(layer, nodes) {
  const clear = new Set();
  let problem = null;
  const { bridge } = layer;
  if (!bridge) return { clear, problem };
  for (let i = 0; i < nodes.length; i++) {
    if (!bridge.water(nodes[i])) continue;
    let j = i;
    while (j + 1 < nodes.length && bridge.water(nodes[j + 1])) j++;
    const run = nodes.slice(i, j + 1);
    const reason = spanProblem(layer, nodes, i, j);
    if (!reason) run.forEach((n) => clear.add(n));
    else problem ??= { reason, nodes: run };
    i = j;
  }
  return { clear, problem };
}

function spanProblem(layer, nodes, i, j) {
  const { bridge, graph, grid } = layer;
  if (i === 0 || j === nodes.length - 1) return 'A bridge needs land at both ends';
  if (!nodes.slice(i, j + 1).every(bridge.river)) return 'Bridges only cross rivers';
  if (j - i + 1 > bridge.span) return 'Too wide to bridge';
  const step = (a, b) => {
    const [ax, ay] = grid.xy(a), [bx, by] = grid.xy(b);
    return `${bx - ax},${by - ay}`;
  };
  const dir = step(nodes[i - 1], nodes[i]);
  for (let k = i; k <= j; k++) if (step(nodes[k], nodes[k + 1]) !== dir) return 'A bridge has to be straight';
  for (let k = i; k <= j; k++) {
    if (bridge.taken(nodes[k])) return 'Crosses another line';
    for (const m of graph.neighbors(nodes[k])) if (m !== nodes[k - 1] && m !== nodes[k + 1]) return 'Crosses another line';
  }
  return null;
}

// `steep`: the blocked dots that are only blocked for climbing too steeply
// (shown by a sign rather than a cross, render/overlay.js steepAt).
// `opts.lane`: roads built as lanes, which may climb steeper.
export function validateRoute(layer, nodes, opts = {}) {
  const blocked = [];
  const steep = new Set(), other = new Set();
  const block = (set, ...ns) => { blocked.push(...ns); for (const n of ns) set.add(n); };
  const result = (r) => ({ ...r, steep: [...steep].filter((n) => !other.has(n)) });
  if (!nodes || nodes.length < 2) return { ok: false, blocked, steep: [], reason: 'Too short' };

  const spans = bridgeSpans(layer, nodes);
  for (const n of nodes) {
    if (!spans.clear.has(n) && layer.isBlocked(n)) block(other, n);
  }
  let reason = spans.problem?.reason ?? 'Something is in the way';
  for (let i = 0; i < nodes.length - 1; i++) {
    if (crossesDiagonal(layer, nodes[i], nodes[i + 1])) {
      reason = 'Crosses another line';
      block(other, nodes[i], nodes[i + 1]);
    } else if (layer.conflicts(nodes[i], nodes[i + 1])) {
      reason = 'Runs along another line';
      block(other, nodes[i], nodes[i + 1]);
    } else if (!(spans.clear.has(nodes[i]) && spans.clear.has(nodes[i + 1])) && layer.steep(nodes[i], nodes[i + 1], opts)) {
      reason = 'Too steep';
      block(steep, nodes[i], nodes[i + 1]);
    }
  }
  if (!blocked.length) {
    const sharp = sharpBends(layer, nodes);
    if (sharp.length) return { ok: false, blocked: sharp, steep: [], reason: 'Too sharp a bend for trains' };
  }

  if (blocked.length === 0) return result({ ok: true, blocked });
  return result({ ok: false, blocked, reason });
}
