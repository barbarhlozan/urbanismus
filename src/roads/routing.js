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

export function validateRoute(layer, nodes) {
  const blocked = [];
  if (!nodes || nodes.length < 2) return { ok: false, blocked, reason: 'Too short' };

  for (const n of nodes) {
    if (layer.isBlocked(n)) blocked.push(n);
  }
  let crossing = false;
  for (let i = 0; i < nodes.length - 1; i++) {
    if (crossesDiagonal(layer, nodes[i], nodes[i + 1])) {
      crossing = true;
      blocked.push(nodes[i], nodes[i + 1]);
    }
  }

  if (blocked.length === 0) return { ok: true, blocked };
  return { ok: false, blocked, reason: crossing ? 'Crosses another line' : 'Something is in the way' };
}
