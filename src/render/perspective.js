// Perspective camera for photo mode: a pinhole camera standing on the map,
// with the same interface as the isometric Camera (project, depth, facing),
// so every structure and feature draws through it unchanged.
//
// World space as everywhere: x/y along the grid, z up, one grid step = 1
// (a storey is about 0.15). The terrain relief (`lift`) raises points as it
// does on the map; the map's sideways warp is left out – it is a drawing
// distortion, not part of the town.
//
// The camera looks level (no pitch), so the near plane is vertical and
// clipping can be done on world points before the relief lifts them.
//
// Screen: pixels in a width × height picture, (0, 0) top left.

export class PerspectiveCamera {
  constructor({ x, y, z, yaw, fov = 55, width = 480, height = 320, lift = null, near = 0.06 }) {
    this.perspective = true;
    this.ex = x;
    this.ey = y;
    this.ez = z;             // eye height, relief included
    this.yaw = yaw;          // radians, the direction looked in (world x/y)
    this.fov = fov;          // horizontal, degrees
    this.width = width;
    this.height = height;
    this.lift = lift;
    this.near = near;
    this.fx = Math.cos(yaw);
    this.fy = Math.sin(yaw);
    // right, matching the map: the iso view has +x to the right of -y
    this.rx = -this.fy;
    this.ry = this.fx;
    this.focal = width / 2 / Math.tan((fov * Math.PI) / 360);
    // painters scale the hand-drawn wobble by tile / 32: keep it as on the map
    this.tile = 32;
    this.rotation = 0;
    this.zScale = 1;
  }

  // Distance in front of the eye (along the view) of a world point.
  ahead(x, y) {
    return (x - this.ex) * this.fx + (y - this.ey) * this.fy;
  }

  project(x, y, z = 0, at = null, liftAt = at) {
    if (this.lift) z += this.lift(...(liftAt ?? [x, y]));
    const cz = Math.max(this.ahead(x, y), 1e-4);
    const cx = (x - this.ex) * this.rx + (y - this.ey) * this.ry;
    const cy = z - this.ez;
    return [this.width / 2 + (cx / cz) * this.focal, this.height / 2 - (cy / cz) * this.focal];
  }

  // Pixels per world unit at a point (for screen-facing shapes).
  scaleAt(x, y) {
    return this.focal / Math.max(this.ahead(x, y), this.near);
  }

  // Larger = closer = drawn later. Distance along the view, so solids sort
  // with the bands of ground (photo.js), which run across it.
  depth(x, y) {
    return -this.ahead(x, y);
  }

  // Direction from a world point to the eye (for facing tests).
  toEye(x, y, z, at = null) {
    const [ax, ay] = at ?? [x, y];
    const zz = z + (this.lift ? this.lift(ax, ay) : 0);
    return [this.ex - x, this.ey - y, this.ez - zz];
  }

  // Is a surface with world normal n through world point p turned to the eye?
  facingAt([nx, ny, nz], [x, y, z], at = null) {
    const [vx, vy, vz] = this.toEye(x, y, z, at);
    return nx * vx + ny * vy + nz * vz > 1e-9;
  }

  // Iso-camera fallback (no point known): judge from the view direction.
  facing([nx, ny, nz]) {
    return -(nx * this.fx + ny * this.fy) > 1e-9 || nz > 0;
  }

  // Kept for code that sizes ground circles; ground circles are drawn as
  // polygons in perspective (Painter.groundCircle).
  groundEllipse(r) {
    return [r * this.tile * 1.2, r * this.tile * 0.7];
  }

  isAhead(x, y) {
    return this.ahead(x, y) >= this.near;
  }

  // Clip world points (each [x, y, …]) to the part in front of the near
  // plane. Closed: a polygon (null when nothing is left). Open: the list of
  // visible runs of the polyline.
  clip(points, closed) {
    const n = this.near;
    const d = points.map((p) => this.ahead(p[0], p[1]) - n);
    if (d.every((v) => v >= 0)) return closed ? points : [points];
    const cut = (a, b, da, db) => {
      const t = da / (da - db);
      return a.map((v, i) => v + (b[i] - v) * t);
    };
    if (closed) {
      const out = [];
      for (let i = 0; i < points.length; i++) {
        const j = (i + 1) % points.length;
        const [a, b, da, db] = [points[i], points[j], d[i], d[j]];
        if (da >= 0) out.push(a);
        if ((da >= 0) !== (db >= 0)) out.push(cut(a, b, da, db));
      }
      return out.length >= 3 ? out : null;
    }
    const runs = [];
    let run = [];
    for (let i = 0; i < points.length; i++) {
      if (d[i] >= 0) {
        if (!run.length && i > 0) run.push(cut(points[i - 1], points[i], d[i - 1], d[i]));
        run.push(points[i]);
      } else if (run.length) {
        run.push(cut(points[i - 1], points[i], d[i - 1], d[i]));
        runs.push(run);
        run = [];
      }
    }
    if (run.length > 1) runs.push(run);
    return runs.filter((r) => r.length > 1);
  }
}
