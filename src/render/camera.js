// Isometric camera. World space: x/y along the grid, z up, one grid step = 1.
// "Scene" space: projected pixels before pan/zoom (the renderer applies pan +
// zoom as a single transform, so panning never re-renders, see
// Renderer.placeView).
//
// The view turns freely: `angle` (radians) turns the world about the middle
// of the map before the isometric projection. `rotation` is the nearest
// quarter turn, which new buildings face (facingViewer) and in whose axes
// solids are put in order (quarter(), skew). All depth ordering and back-face
// culling goes through depth() and facing(), so it stays correct at any angle.

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
    this.angle = 0;
    this.spin = null; // a turn let go, coasting to a stop: { at: [px, py], left: radians still to go }
    this.panX = 0;
    this.panY = 0;
    this.cx = (grid.width - 1) / 2;
    this.cy = (grid.height - 1) / 2;
    this.warp = null; // optional (x, y) -> [x, y] distortion (render/warp.js)
    this.lift = null; // optional (x, y) -> extra height, the terrain relief (render/warp.js)
  }

  // The view's turn in radians. At a quarter turn the sine and cosine are
  // exact, so the four classic views draw just as they always have.
  get angle() {
    return this._angle;
  }

  set angle(a) {
    const turn = Math.PI * 2;
    this._angle = ((a % turn) + turn) % turn;
    const q = this._angle / (Math.PI / 2);
    const r = Math.round(q);
    if (Math.abs(q - r) < 1e-9) {
      this._angle = (r % 4) * (Math.PI / 2);
      [this._cos, this._sin] = [[1, 0], [0, 1], [-1, 0], [0, -1]][r % 4];
    } else {
      [this._cos, this._sin] = [Math.cos(this._angle), Math.sin(this._angle)];
    }
    this._quarter = r % 4;
    // what is left over past that quarter, -45° to 45°
    const skew = this._angle - this._quarter * (Math.PI / 2);
    this.skew = skew > Math.PI ? skew - turn : skew;
  }

  // The nearest quarter turn, 0..3.
  get rotation() {
    return this._quarter;
  }

  set rotation(r) {
    this.angle = (r * Math.PI) / 2;
  }

  // A world direction (or an offset from the middle) in view axes, and back.
  toView(x, y) {
    return [x * this._cos - y * this._sin, x * this._sin + y * this._cos];
  }

  toWorld(rx, ry) {
    return [rx * this._cos + ry * this._sin, -rx * this._sin + ry * this._cos];
  }

  // A world position in the axes of the nearest quarter turn. Ground areas
  // square to the grid stay square in them, and at any angle both axes lead
  // towards the viewer (skew is at most 45° either way): one area entirely
  // on the far side of another along either axis is behind it. The painter's
  // order works in these (order.js, Painter).
  quarter(x, y) {
    return rotateQuarter(x - this.cx, y - this.cy, this._quarter);
  }

  // How a box in quarter() axes shows: [depth, screen x] per unit of each
  // axis, as [[da, db], [sa, sb]] (at no skew [[1, 1], [1, -1]]).
  quarterView() {
    const c = Math.cos(this.skew), s = Math.sin(this.skew);
    return [[c + s, c - s], [c - s, -(c + s)]];
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
    const [rx, ry] = this.toView(x - this.cx, y - this.cy);
    return [
      (rx - ry) * COS30 * this.tile,
      (rx + ry) * SIN30 * this.tile - z * this.zScale * this.tile,
    ];
  }

  // World position in view-aligned axes (both grow towards the viewer).
  rotated(x, y) {
    return this.toView(x - this.cx, y - this.cy);
  }

  // The structure rotation that turns a building's front (local -y) to the
  // viewer – towards the bottom left of the screen – in the nearest quarter
  // turn of this view.
  facingViewer() {
    return (1 - this.rotation + 4) % 4;
  }

  // Larger = closer to the viewer = drawn later.
  depth(x, y) {
    const [rx, ry] = this.toView(x - this.cx, y - this.cy);
    return rx + ry;
  }

  // Is a surface with world-space normal n visible?
  facing([nx, ny, nz]) {
    const [rx, ry] = this.toView(nx, ny);
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
    const d = this.toWorld(1, 1);  // away from the viewer: +1 px down the screen per tile px
    const e = this.toWorld(1, -1); // across: 2 cos30 tile px sideways
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
    const [dx, dy] = this.toWorld((a + b) / 2, (b - a) / 2);
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
    this.keepInBounds();
  }

  centerOn(x, y, vw, vh) {
    const [sx, sy] = this.project(x, y, 0);
    this.panX = vw / 2 - sx * this.zoom;
    this.panY = vh / 2 - sy * this.zoom;
    this.keepInBounds();
  }

  // Turn the view by `da` radians around the ground under the screen point
  // (px, py), which stays where it is.
  turnAt(px, py, da) {
    const [wx, wy] = this.unprojectFlat(...this.clientToScene(px, py));
    this.angle += da;
    const [rx, ry] = this.toView(wx - this.cx, wy - this.cy);
    this.panX = px - (rx - ry) * COS30 * this.tile * this.zoom;
    this.panY = py - (rx + ry) * SIN30 * this.tile * this.zoom;
    this.keepInBounds();
  }

  // Let a turn go at `v` radians per second around the screen point `at`:
  // it carries on a little, slowing to a stop (coast), and comes to rest on
  // a step of the view's turn (Camera.STEP), where the map keeps its
  // drawings ready (Renderer.turnFrame) – however slowly it was let go.
  letGo(at, v) {
    const { min, max, ease } = Camera.SPIN;
    v = Math.abs(v) > min ? Math.sign(v) * Math.min(max, Math.abs(v)) : 0;
    const to = Math.round((this.angle + v * ease) / Camera.STEP) * Camera.STEP;
    this.spin = { at, left: to - this.angle };
  }

  // One frame of a coasting turn (`dt` seconds): it slows evenly, as a
  // turntable left to itself, and lands without coming back. The last
  // hair of the way (SPIN.near) it is simply there.
  coast(dt) {
    if (!this.spin) return;
    const { at, left } = this.spin;
    const near = Math.abs(left) < Camera.SPIN.near;
    const da = near ? left : left * (1 - Math.exp(-dt / Camera.SPIN.ease));
    this.turnAt(...at, da);
    this.spin.left -= da;
    if (near) {
      this.angle = Math.round(this.angle / Camera.STEP) * Camera.STEP; // (exactly)
      this.spin = null;
    }
  }

  // The step of the turn the view rests on (0 … 360° / STEP), or null
  // between steps.
  step() {
    const k = this.angle / Camera.STEP;
    return Math.abs(k - Math.round(k)) < 1e-9 ? Math.round(k) % Math.round((Math.PI * 2) / Camera.STEP) : null;
  }

  // ---- keeping the map in view ----
  //
  // The middle of the screen stays over the map, or over a strip of paper
  // around it: up to FREE of the screen's shorter side past the last dots
  // freely, then the drag gets heavier and stops after about EASE more. The
  // map is a square in world space, so x and y are kept apart and it holds
  // the same in every rotation. A gentle stop, nothing springs back.

  // The window size (main.js, also on resize); keeps the view in bounds.
  setViewport(vw, vh) {
    this.viewport = [vw, vh];
    this.keepInBounds();
  }

  // Paper allowed past the map's edge, in grid steps at this zoom:
  // [free, free + ease].
  margins() {
    const side = Math.min(...this.viewport) / (this.tile * this.zoom);
    return [Camera.FREE * side, (Camera.FREE + Camera.EASE) * side];
  }

  // The flat ground point in the middle of the screen.
  middle() {
    const [vw, vh] = this.viewport;
    return this.unprojectFlat(...this.clientToScene(vw / 2, vh / 2));
  }

  // Put the flat ground point (x, y) in the middle of the screen.
  setMiddle(x, y) {
    const [vw, vh] = this.viewport;
    const a = (x - this.cx), b = (y - this.cy);
    const [rx, ry] = this.toView(a, b);
    this.panX = vw / 2 - (rx - ry) * COS30 * this.tile * this.zoom;
    this.panY = vh / 2 - (rx + ry) * SIN30 * this.tile * this.zoom;
  }

  // Pan by (dx, dy) screen pixels (a drag), heavier towards the limit.
  pan(dx, dy) {
    if (!this.viewport) {
      this.panX += dx;
      this.panY += dy;
      return;
    }
    const before = this.middle();
    this.panX += dx;
    this.panY += dy;
    const after = this.middle();
    const [free, most] = this.margins();
    const ease = most - free;
    const hi = [2 * this.cx, 2 * this.cy]; // the last dots
    const out = [0, 1].map((k) => {
      const v = before[k], step = after[k] - v;
      // how far past the free strip, on the side it's heading to
      const over = step < 0 ? -free - v : v - hi[k] - free;
      if (over + Math.abs(step) <= 0) return after[k];
      // dv/du = 1 - over / ease: slows the closer it gets, never reaches
      // the end (taken in small pieces so it's the same however it's split)
      let left = Math.abs(step), o = over, moved = 0;
      if (o < 0) { moved = Math.min(left, -o); left -= moved; o += moved; }
      moved += Math.max(0, ease - o) * (1 - Math.exp(-left / ease));
      return v + Math.sign(step) * moved;
    });
    this.setMiddle(...out);
    this.keepInBounds();
  }

  // The hard limit (after zooming, resizing, turning): the middle of the
  // screen goes no further than the end of the margin.
  keepInBounds() {
    if (!this.viewport) return;
    const [, most] = this.margins();
    const [x, y] = this.middle();
    const cx = Math.min(2 * this.cx + most, Math.max(-most, x));
    const cy = Math.min(2 * this.cy + most, Math.max(-most, y));
    if (cx !== x || cy !== y) this.setMiddle(cx, cy);
  }
}

Camera.FREE = 0.1;  // of the screen's shorter side: paper past the edge before the drag gets heavier
Camera.EASE = 0.12; // ...and how much further it slows to a stop
// Turning the view: radians per px of a right-button drag across the
// screen; a twist of two fingers turns it as far as they turn, once they
// have turned `dead` radians (so a pinch doesn't turn the map by the way).
// A turn let go carries on, slowing over `ease` seconds, as far as it
// would going at more than `min` radians per second; a flick sets it going
// at most `max` (so it carries on a quarter turn at the most). Within
// `near` radians of where it stops, it is there.
Camera.TURN = { px: 0.005, dead: 0.12 };
Camera.SPIN = { ease: 0.22, min: 0.05, max: 6, near: 0.0005 };
// The view comes to rest on steps of its turn this far apart (2°): a
// quarter turn is a whole number of them.
Camera.STEP = Math.PI / 90;
