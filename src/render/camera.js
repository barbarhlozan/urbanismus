// Isometric camera. World space: x/y along the grid, z up, one grid step = 1.
// "Scene" space: projected pixels before pan/zoom (the renderer applies pan +
// zoom as a single transform, so panning never re-renders, see
// Renderer.placeView).
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
    this.lift = null; // optional (x, y) -> extra height, the terrain relief (render/warp.js)
  }

  // `at` (optional, world [x, y]): move the point by the relief and warp
  // found there instead of at the point itself – so a whole building moves
  // as one piece and stays square instead of bending with the ground.
  // `liftAt` takes the relief somewhere else than the warp (null: at the
  // point) – yards keep their building's warp but follow the ground.
  project(x, y, z = 0, at = null, liftAt = at) {
    if (this.lift) z += this.lift(...(liftAt ?? [x, y]));
    const [ax, ay] = at ?? [x, y];
    if (this.warp) {
      const [wx, wy] = this.warp(ax, ay);
      x += wx - ax;
      y += wy - ay;
    }
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

  // Scene point -> world (x, y) on the ground (z = 0 plus the relief): the
  // nearest ground along the line of sight. A steep hill can turn more than
  // a screen pixel per pixel (so simply undoing the lift step by step would
  // overshoot), and one screen point can cover a slope and the ground hidden
  // behind it. So the line of sight is walked from in front of the highest
  // ground backwards to where it first meets the surface, then narrowed
  // down. The warp is gentle: it moves the line sideways, a few times over.
  unproject(sx, sy) {
    const q = this.unprojectFlat(sx, sy);
    if (!this.warp && !this.lift) return q;
    const d = rotateQuarter(1, 1, -this.rotation);  // away from the viewer: +1 px down the screen per tile px
    const e = rotateQuarter(1, -1, -this.rotation); // across: 2 cos30 tile px sideways
    const [lo, hi] = this.lift?.range ?? [0, 0];
    const pad = this.warp ? 1 : 0.05;
    const from = hi * this.zScale + pad, to = lo * this.zScale - pad;
    const STEP = 0.02;
    let base = q, p = q;
    for (let k = 0; k < (this.warp ? 6 : 1); k++) {
      const at = (s) => [base[0] + d[0] * s, base[1] + d[1] * s];
      const front = (s) => this.project(...at(s))[1] > sy; // below the cursor on screen: in front of the ground
      let s = from;
      while (s > to && front(s - STEP)) s -= STEP;
      let a = s - STEP, b = s; // ground between a (behind) and b (in front)
      for (let i = 0; i < 14; i++) {
        const m = (a + b) / 2;
        if (front(m)) b = m; else a = m;
      }
      p = at((a + b) / 2);
      if (!this.warp) break;
      const ex = sx - this.project(...p)[0];
      if (Math.abs(ex) < 1e-3) break;
      const t = ex / (2 * COS30 * this.tile);
      base = [base[0] + e[0] * t, base[1] + e[1] * t];
    }
    return p;
  }

  // The plain inverse of project() on a flat, unwarped map.
  unprojectFlat(sx, sy) {
    const a = sx / (COS30 * this.tile);
    const b = sy / (SIN30 * this.tile);
    const [dx, dy] = rotateQuarter((a + b) / 2, (b - a) / 2, -this.rotation);
    return [dx + this.cx, dy + this.cy];
  }

  // Screen radii of a ground circle with world radius r.
  groundEllipse(r) {
    return [r * Math.SQRT2 * COS30 * this.tile, r * Math.SQRT2 * SIN30 * this.tile];
  }

  clientToScene(px, py) {
    return [(px - this.panX) / this.zoom, (py - this.panY) / this.zoom];
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
