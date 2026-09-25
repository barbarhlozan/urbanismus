// The dot grid. Nodes are addressed by a single integer index everywhere
// (maps, road graph, save files); use xy()/index() to convert.

export const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];
export const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

// Rotate a grid vector by r quarter turns (used for camera and building rotation).
export function rotateQuarter(dx, dy, r) {
  switch (((r % 4) + 4) % 4) {
    case 1: return [-dy, dx];
    case 2: return [-dx, -dy];
    case 3: return [dy, -dx];
    default: return [dx, dy];
  }
}

export class Grid {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.size = width * height;
  }

  index(x, y) {
    return y * this.width + x;
  }

  xy(i) {
    return [i % this.width, Math.floor(i / this.width)];
  }

  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  offset(i, dx, dy) {
    const [x, y] = this.xy(i);
    return this.inBounds(x + dx, y + dy) ? this.index(x + dx, y + dy) : -1;
  }

  // Orthogonal neighbours first, then diagonal.
  neighbors(i, diagonal = true) {
    const out = [];
    for (const [dx, dy] of diagonal ? [...ORTHO, ...DIAG] : ORTHO) {
      const n = this.offset(i, dx, dy);
      if (n >= 0) out.push(n);
    }
    return out;
  }

  distance(a, b) {
    const [ax, ay] = this.xy(a);
    const [bx, by] = this.xy(b);
    return Math.hypot(ax - bx, ay - by);
  }

  // Nearest node to a fractional world position, or -1 when off the map.
  nodeAt(x, y) {
    const ix = Math.round(x);
    const iy = Math.round(y);
    return this.inBounds(ix, iy) ? this.index(ix, iy) : -1;
  }
}
