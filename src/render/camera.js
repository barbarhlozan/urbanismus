// Isometric camera. World space: x/y along the grid, z up, one grid step = 1.
// "Scene" space: projected pixels before pan/zoom (the SVG scene group then
// applies pan + zoom as a single transform, so panning never re-renders).
//
// The view can rotate in 90° steps. All depth ordering and back-face culling
// goes through depth() and facing(), so it stays correct in every rotation.

const COS30 = Math.cos(Math.PI / 6);
const SIN30 = 0.5;

import { rotateQuarter } from '../core/grid.js';

export { rotateQuarter };

export class Camera {
  constructor(grid, { tile = 32, zScale = 0.9, zoom = 1, minZoom = 0.3, maxZoom = 4 } = {}) {
    this.tile = tile;
    this.zScale = zScale;
    this.zoom = zoom;
    this.minZoom = minZoom;
    this.maxZoom = maxZoom;
    this.rotation = 0;
    this.panX = 0;
    this.panY = 0;
    this.cx = (grid.width - 1) / 2;
    this.cy = (grid.height - 1) / 2;
    this.warp = null; // optional (x, y) -> [x, y] distortion (render/warp.js)
  }

  project(x, y, z = 0) {
    if (this.warp) [x, y] = this.warp(x, y);
    const [rx, ry] = rotateQuarter(x - this.cx, y - this.cy, this.rotation);
    return [
      (rx - ry) * COS30 * this.tile,
      (rx + ry) * SIN30 * this.tile - z * this.zScale * this.tile,
    ];
  }

  // World position in view-aligned axes (both grow towards the viewer).
  rotated(x, y) {
    return rotateQuarter(x - this.cx, y - this.cy, this.rotation);
  }

  // Larger = closer to the viewer = drawn later.
  depth(x, y) {
    const [rx, ry] = rotateQuarter(x - this.cx, y - this.cy, this.rotation);
    return rx + ry;
  }

  // Is a surface with world-space normal n visible?
  facing([nx, ny, nz]) {
    const [rx, ry] = rotateQuarter(nx, ny, this.rotation);
    return rx + ry + nz / this.zScale > 1e-9;
  }

  // Scene point -> world (x, y) on the z = 0 plane (undoing the warp by a
  // few fixed-point steps; it is smooth and small, so this converges fast).
  unproject(sx, sy) {
    const a = sx / (COS30 * this.tile);
    const b = sy / (SIN30 * this.tile);
    const [dx, dy] = rotateQuarter((a + b) / 2, (b - a) / 2, -this.rotation);
    const q = [dx + this.cx, dy + this.cy];
    if (!this.warp) return q;
    let p = q;
    for (let i = 0; i < 4; i++) {
      const [wx, wy] = this.warp(p[0], p[1]);
      p = [p[0] + (q[0] - wx), p[1] + (q[1] - wy)];
    }
    return p;
  }

  // Screen radii of a ground circle with world radius r.
  groundEllipse(r) {
    return [r * Math.SQRT2 * COS30 * this.tile, r * Math.SQRT2 * SIN30 * this.tile];
  }

  clientToScene(px, py) {
    return [(px - this.panX) / this.zoom, (py - this.panY) / this.zoom];
  }

  get transform() {
    return `translate(${this.panX} ${this.panY}) scale(${this.zoom})`;
  }

  zoomAt(px, py, factor) {
    const next = Math.min(this.maxZoom, Math.max(this.minZoom, this.zoom * factor));
    const k = next / this.zoom;
    this.panX = px - (px - this.panX) * k;
    this.panY = py - (py - this.panY) * k;
    this.zoom = next;
  }

  centerOn(x, y, vw, vh) {
    const [sx, sy] = this.project(x, y, 0);
    this.panX = vw / 2 - sx * this.zoom;
    this.panY = vh / 2 - sy * this.zoom;
  }

  // Rotate the view around whatever is currently at the centre of the screen.
  rotate(dir, vw, vh) {
    const [sx, sy] = this.clientToScene(vw / 2, vh / 2);
    const [wx, wy] = this.unproject(sx, sy);
    this.rotation = (this.rotation + dir + 4) % 4;
    this.centerOn(wx, wy, vw, vh);
  }
}
