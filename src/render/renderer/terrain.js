// The ground under the town (Renderer methods; see renderer.js): the meadow's
// grass, contour lines and the faint lines on steep slopes, the brows and rock
// faces, the hills' shadows, and the water – its lines on the GPU, its washes
// in the SVG.

import { THEME } from '../../theme.js';
import { keepRuns } from '../../roads/geometry.js';
import { ORTHO } from '../../core/grid.js';
import { mulberry32 } from '../../core/random.js';
import { SegmentIndex } from '../../core/geom2d.js';
import { ELEVATION, contours } from '../../terrain/elevation.js';
import { sketchPolyline, seedOf } from '../sketch.js';
import { hiddenUnder } from '../bridges.js';
import { MEADOW, meadowGround, chunkSVG } from '../meadow.js';
import { PENCIL, CONTOUR_CHUNK, chunked, cut, pencil } from '../pencil.js';
import { BROWS, visibility, browLines, browRuns, hiddenAt } from '../brows.js';
import { rockLines, ROCK_LOOK } from '../rocks.js';
import { STEEP_LINES, steepLines } from '../steep.js';
import { SUN, sunFor } from '../shadows.js';
import { HILL_SHADOWS, hillShade, hillShadeRings } from '../hillShadows.js';
import { SVGNS, TERRAIN_LINES, COS30, r2 } from './shared.js';

// Lakes (Renderer.renderWater): the furthest the shore reaches from a water
// dot (under 1, so dry dots stay dry) and how softly neighbouring dots'
// reach blends (higher = less), metres of elevation counted as one grid
// step of depth, the sampling step; `ripple`: the small waves all over
// lakes and rivers, as in a photo (photo.js ripple) – their places about
// `gap` apart, only those at least `room` from the shore, a share `keep`
// of them; about `len` long (grid units, shorter where the shore is near),
// as high as `rise` of their length, `tilt` askew of level at most.
const WATER = { radius: 0.75, soft: 5, metres: 6, step: 0.08, ripple: { gap: 0.4, room: 0.12, keep: 0.55, len: 0.3, rise: 0.11, tilt: 0.12 } };

export class TerrainDrawing {
  // ----- layers -----

  // The meadow, all chunks (the layer was marked dirty: a new view, new
  // terrain) or just `keys`. A chunk's markup is only swapped when it
  // changed, so rebuilding around a change touches little of the page.
  renderMeadow(keys = null) {
    const { world } = this;
    const { width, height } = world.grid;
    const c = MEADOW.chunk;
    if (!keys) {
      keys = new Set();
      for (let cy = 0; cy * c < height; cy++) for (let cx = 0; cx * c < width; cx++) keys.add(`${cx},${cy}`);
    }
    const ground = meadowGround(world, this.config);
    for (const key of keys) this.drawChunk(key, ground);
    this.meadowDirty.clear();
    this.cullMeadow();
  }

  // One chunk of the meadow ('cx,cy'), at the camera's angle as it is.
  drawChunk(key, ground) {
    const { world, camera } = this;
    const { width, height } = world.grid;
    const c = MEADOW.chunk;
    const [cx, cy] = key.split(',').map(Number);
    if (cx < 0 || cy < 0 || cx * c >= width || cy * c >= height) return;
    let chunk = this.meadow.get(key);
    if (!chunk) {
      chunk = { g: this.layers.meadow.appendChild(document.createElementNS(SVGNS, 'g')), svg: null, shown: true };
      this.meadow.set(key, chunk);
    }
    const svg = chunkSVG(world, ground, cx * c, cy * c, (x, y) => this.project(x, y), camera.tile);
    if (svg !== chunk.svg) chunk.g.innerHTML = chunk.svg = svg;
    if (chunk.turned) chunk.g.removeAttribute('transform');
    chunk.turned = false;
    chunk.angle = camera.angle;
    const x0 = cx * c - 0.5, y0 = cy * c - 0.5, x1 = x0 + c, y1 = y0 + c;
    chunk.box = this.sceneBox([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], 0, 0.3);
  }

  // Hide the meadow chunks outside the drawn view (as cull() does objects).
  cullMeadow() {
    if (!this.viewBox) return;
    for (const chunk of this.meadow.values()) {
      const show = !chunk.box || !this.cullOn || this.inView(chunk.box);
      if (show === chunk.shown) continue;
      chunk.shown = show;
      chunk.g.style.display = show ? '' : 'none';
    }
  }

  // (`lines`: the terrain's lines as items on the ground for the GPU,
  // renderGlTerrain, left out of the SVG)
  renderTerrain() {
    const lines = this.glTerrain ? [] : null;
    this.layers.terrain.innerHTML = (this.contours ? this.renderContours(lines) : this.renderSteep(lines)) + this.renderBrows(lines) + this.renderWater(lines);
    if (!lines) return;
    // (the same lines as last time – a turn landing redraws the brows – kept
    // as they are on the GPU, not built again)
    const was = this.terrainLines;
    if (was?.length === lines.length && lines.every((l, i) => l.pts === was[i].pts && l.cls === was[i].cls)) return;
    this.terrainLines = lines;
    this.glTerrain.setLayer('terrain', lines, Object.keys(TERRAIN_LINES));
  }

  // Lines of the terrain (world units) as items for gl/lines.js, `cls` one
  // of TERRAIN_LINES: on the ground as pathData puts them – the relief and
  // the warp in each point, so the camera alone places them. Kept per line.
  terrainItems(out, lines, cls) {
    const cam = this.camera, { terrain } = this.world;
    if (this.terrainPts?.lift !== cam.lift || this.terrainPts.warp !== cam.warp) this.terrainPts = { lift: cam.lift, warp: cam.warp, of: new WeakMap() };
    for (const pts of lines) {
      let ground = this.terrainPts.of.get(pts);
      if (!ground) {
        ground = pts.map(([x, y]) => {
          const z = terrain.heightAt(x, y) + (cam.lift ? cam.lift(x, y) : 0);
          return cam.warp ? [...cam.warp(x, y), z] : [x, y, z];
        });
        this.terrainPts.of.set(pts, ground);
      }
      if (ground.length > 1) out.push({ key: `t${out.length}`, cls, pts: ground });
    }
  }

  // The pens and colours of the terrain's lines as styles.css has them now
  // (the scheme, the level of detail, --stroke, the night's ink), asked of
  // the probe's shapes only when one of those changes.
  terrainStyles() {
    const { palette } = THEME;
    const key = `${document.documentElement.className}|${this.ground.getAttribute('class')}|${this.strokeK}|${this.inkSet ?? 0}|${palette.detail}|${palette.bg}|${palette.main}`;
    if (this.terrainLook?.key === key) return this.terrainLook;
    const styles = {};
    [...this.terrainProbe.children].forEach((el, i) => {
      const cs = getComputedStyle(el);
      styles[Object.keys(TERRAIN_LINES)[i]] = { width: parseFloat(cs.strokeWidth) || 0, colour: cs.stroke, shown: cs.display !== 'none' && cs.stroke !== 'none' };
    });
    return (this.terrainLook = { key, styles });
  }

  // The shadows the hills cast (hillShadows.js): the shade and its
  // outlines worked out once per sun and relief, projected for each turn of
  // the view (the last few kept, as the brows'), as shapes in the hills'
  // mask (the shadows' layer, see the constructor).
  renderHillshade() {
    const { camera, world } = this;
    const el = this.layers.hillshade;
    if (!HILL_SHADOWS.on || !SUN.on || !SUN.hatch || this.contours) {
      el.innerHTML = '';
      return;
    }
    const m = 1.2; // (as the contours)
    const box = [-m, -m, world.grid.width - 1 + m, world.grid.height - 1 + m];
    const key = `${SUN.azimuth}|${SUN.length}`;
    const relief = world.relief();
    if (this.hills?.key !== key || this.hills.relief !== relief || this.hills.lift !== camera.lift) {
      const shade = hillShade(this.groundHeight(), box, sunFor(camera));
      this.hills = { key, relief, lift: camera.lift, rings: hillShadeRings(shade, box, this.wetAt()), views: new Map() };
    }
    let view = this.hills.views.get(camera.angle);
    if (view == null) {
      const d = this.hills.rings.length ? this.pathData(this.hills.rings, false) : '';
      // (and its rings laid flat with their heights, for the GPU: so mid-turn
      // it is raised over the hills as they are – gl/shadows.js)
      view = { svg: d ? `<path class="shade" fill-rule="evenodd" d="${d}"/>` : '', ground: this.hills.rings.map((ring) => ring.map(([x, y]) => this.flatPoint(x, y))) };
      if (this.hills.views.size >= 6) this.hills.views.delete(this.hills.views.keys().next().value);
      this.hills.views.set(camera.angle, view);
    }
    el.innerHTML = view.svg;
    if (el.firstElementChild) el.firstElementChild.ground = view.ground;
  }

  // A world point on the ground as the view lies flat (scene px, the warp
  // in), and its height there in scene px (the relief and the ground's own):
  // [x, y, z], Renderer.project being [x, y - z].
  flatPoint(x, y) {
    const cam = this.camera;
    const z = (this.world.terrain.heightAt(x, y) + (cam.lift ? cam.lift(x, y) : 0)) * cam.zScale * cam.tile;
    const [wx, wy] = cam.warp ? cam.warp(x, y) : [x, y];
    const [rx, ry] = cam.toView(wx - cam.cx, wy - cam.cy);
    return [(rx - ry) * COS30 * cam.tile, (rx + ry) * 0.5 * cam.tile, z];
  }

  // What the camera sees of the ground, the brows (brows.js) and the rock
  // faces (rocks.js), worked out for each turn of the view and kept (the
  // last few turns, per relief: turning back to a view finds them ready);
  // as pencil strokes, a path per kind and chunk of the map.
  renderBrows(lines = null) {
    const { camera, world } = this;
    if (!BROWS.on || !camera.lift) return '';
    if (this.brows?.lift !== camera.lift) this.brows = { lift: camera.lift, views: new Map() };
    let view = this.brows.views.get(camera.angle);
    if (!view) {
      const { terrain, grid } = world;
      const m = 1.2; // (as the contours)
      const height = (x, y) => camera.lift(x, y) + terrain.heightAt(x, y);
      const vis = visibility(camera, height, [-m, -m, grid.width - 1 + m, grid.height - 1 + m]);
      const tiers = [[], [], []], runs = [[], [], []];
      browLines(vis, camera).forEach((line, n) => {
        for (const run of browRuns(line)) {
          const strokes = pencil(run.points, n, BROWS.pencil);
          tiers[run.tier].push(...strokes);
          // (and on the ground, for the GPU: browOnGround)
          for (const st of strokes) runs[run.tier].push(this.browOnGround(st, run.points));
        }
      });
      // the rock faces turned to the viewer (those turned away are brows)
      const rocks = rockLines(world, camera, height, [-0.5, -0.5, grid.width - 0.5, grid.height - 0.5], (x, y) => hiddenAt(vis, camera, x, y));
      const lips = rocks.lips.flatMap((l, n) => pencil(l, n, ROCK_LOOK.pencil));
      view = { tiers, runs, lips, faces: rocks.faces };
      if (this.brows.views.size >= 6) this.brows.views.delete(this.brows.views.keys().next().value);
      this.brows.views.set(camera.angle, view);
    }
    const paths = (lines, cls) => chunked(lines, CONTOUR_CHUNK).map((ls) => `<path class="${cls}" d="${this.pathData(ls, false)}"/>`).join('');
    // (the brows are already on the picture, in tiles)
    const t = camera.tile;
    const flat = (lines, cls) => chunked(lines, CONTOUR_CHUNK / 2).map((ls) => `<path class="${cls}" d="${ls.map((pts) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${r2(x * t)} ${r2(y * t)}`).join('')).join('')}"/>`).join('');
    const { tiers, lips, faces } = view;
    if (lines) {
      ['brow-light', 'brow', 'brow-outline'].forEach((cls, i) => view.runs[i].forEach((pts) => lines.push({ key: `t${lines.length}`, cls, pts })));
      this.terrainItems(lines, faces, 'rock-face');
      this.terrainItems(lines, lips, 'rock-lip');
      return '';
    }
    return flat(tiers[0], 'brow light') + flat(tiers[1], 'brow') + flat(tiers[2], 'brow outline') + paths(faces, 'rock-face') + paths(lips, 'rock-lip');
  }

  // A brow's pencil stroke (screen tiles, as the view is now) on the ground
  // in world space, for gl/lines.js: each point on its screen column (u)
  // where the brow it was drawn along lies on it (t, browLines: between the
  // run's points), raised to show just where it is drawn now – so a turn
  // carries it with its hill. [[x, y, z]…], z in grid units.
  browOnGround(stroke, run) {
    const cam = this.camera;
    return stroke.map(([X, Y]) => {
      let k = 1;
      while (k < run.length - 1 && run[k][0] < X) k++;
      const [x0, , t0] = run[k - 1], [x1, , t1] = run[k];
      const f = x1 !== x0 ? Math.min(1, Math.max(0, (X - x0) / (x1 - x0))) : 0;
      const u = X / COS30, t = t0 + (t1 - t0) * f;
      const [dx, dy] = cam.toWorld((t + u) / 2, (t - u) / 2);
      return [dx + cam.cx, dy + cam.cy, (t / 2 - Y) / cam.zScale];
    });
  }

  // Faint lines on the slopes too steep to build on (steep.js), traced once
  // per terrain; the terrain view has the full contour lines instead.
  renderSteep(lines = null) {
    if (!STEEP_LINES.on) return '';
    if (!this.steepLines) {
      const { grid } = this.world;
      const m = 1.2; // (as the contours)
      this.steepLines = steepLines(this.world, [-m, -m, grid.width - 1 + m, grid.height - 1 + m], this.wetAt());
    }
    if (lines) {
      this.terrainItems(lines, this.steepLines, 'steep');
      return '';
    }
    return chunked(this.steepLines, CONTOUR_CHUNK).map((ls) => `<path class="steep" d="${this.pathData(ls, false)}"/>`).join('');
  }

  // Is a world point on water (where the terrain's lines break)?
  wetAt() {
    const { grid, terrain } = this.world;
    const river = this.world.riverField;
    return (x, y) => {
      if (river && river.depth(x, y) > 0) return true;
      const n = grid.nodeAt(Math.round(x), Math.round(y));
      return n >= 0 && terrain.isWater(n) && Math.hypot(x - Math.round(x), y - Math.round(y)) < 0.75;
    };
  }

  // Lakes as on a hand-drawn map: a single shoreline, and in the middle of
  // a bigger lake two short strokes for the water. The shore is the elevation contour at
  // the lake's surface – so it curves with the land, like the contour lines
  // around it – kept within reach of the water dots, so the lake covers
  // exactly its dots. A river's banks are a set distance from its
  // centreline instead (terrain/rivers.js), out to the edge of the map. Each
  // body of water is worked out on its own, over just its own box.
  renderWater(lines = null) {
    const { list: bridges, deck } = this.bridgeState();
    this.waterBridges = this.bridgeKey; // drawn broken under these (see the constructor)
    // The lines in world units, traced once per terrain (the costly part)…
    // …then broken where a bridge deck passes over, and put on screen
    const { shore, bank, ripple } = this.traceWater();
    const hidden = bridges.length ? hiddenUnder(bridges, deck, this.camera) : null;
    const open = (lines) => (hidden ? lines.flatMap((pts) => keepRuns(pts, (q) => !hidden(...q), 0.04)) : lines);
    // a path per chunk of the map (as the contours): a river runs right across it
    const path = (lines, cls) => chunked(cut(lines, CONTOUR_CHUNK), CONTOUR_CHUNK).map((ls) => `<path class="${cls}" d="${this.pathData(ls, false)}"/>`).join('');
    // the ripples as short lines on the ground, level on the screen as the view rests
    const ripples = this.rippleLines(ripple, hidden);
    if (lines) {
      this.terrainItems(lines, open(shore), 'shore');
      this.terrainItems(lines, open(bank), 'bank');
      this.terrainItems(lines, ripples, 'wave');
      return this.washWater(shore);
    }
    return this.washWater(shore) + path(open(shore), 'shore') + path(open(bank), 'bank') + path(ripples, 'wave d1');
  }

  // The ripples on the water (their places the world's, traceWater) as
  // lines on the ground in world units: each a small wave, a crest and then
  // a trough, level on the screen at the view's angle as it is now. On the
  // GPU a turn carries them round with the water; once the view rests they
  // are made level again (land redraws the terrain). Kept while the angle
  // and the bridges stay the same, so the GPU keeps them too
  // (renderTerrain); left out under a bridge deck.
  rippleLines(spots, hidden) {
    const cam = this.camera, key = `${cam.angle}|${this.bridgeKey}`;
    if (this.ripples?.spots === spots && this.ripples.key === key) return this.ripples.lines;
    const { rise } = WATER.ripple;
    // the ground's directions on the screen, and back: the world offset of
    // an offset on the screen (scene px)
    const [ox, oy] = cam.project(cam.cx, cam.cy, 0), [ax, ay] = cam.project(cam.cx + 1, cam.cy, 0), [bx, by] = cam.project(cam.cx, cam.cy + 1, 0);
    const [jxx, jyx, jxy, jyy] = [ax - ox, ay - oy, bx - ox, by - oy], det = jxx * jyy - jxy * jyx;
    const back = (sx, sy) => [(jyy * sx - jxy * sy) / det, (jxx * sy - jyx * sx) / det];
    const lines = [];
    for (const { x, y, room, len, sign, tilt } of spots) {
      if (hidden?.(x, y)) continue;
      // as long on the screen as `len` (or the room there) along the ground
      const c = Math.cos(tilt), s = Math.sin(tilt), l = Math.min(len, room * 1.8) / Math.hypot(...back(c, s));
      const h = l * rise * sign * 3.5; // (a cubic's control points stand out about 3.5 times its height, as photo.js ripple)
      const p0 = [-c * l / 2, -s * l / 2], p1 = [-c * l / 6, -s * l / 6 - h], p2 = [c * l / 6, s * l / 6 + h], p3 = [c * l / 2, s * l / 2];
      const pts = [];
      for (let k = 0; k <= 8; k++) {
        const t = k / 8, u = 1 - t, w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
        const [dx, dy] = back(w[0] * p0[0] + w[1] * p1[0] + w[2] * p2[0] + w[3] * p3[0], w[0] * p0[1] + w[1] * p1[1] + w[2] * p2[1] + w[3] * p3[1]);
        pts.push([x + dx, y + dy]);
      }
      lines.push(pts);
    }
    this.ripples = { spots, key, lines };
    return lines;
  }

  // The watercolour scheme (html.wc) and the tone schemes (html.tone): the
  // water painted in under its lines – a lake filled turquoise inside its
  // shore, a river a turquoise wash along its course as wide as its banks
  // are apart where it is narrowest (styles.css .pond, .river-wash).
  washWater(shore) {
    if (!/\b(wc|tone|tint)\b/.test(document.documentElement.className)) return '';
    let out = '';
    if (shore.length) {
      const d = this.pathData(shore, false);
      out += `<path class="pond" d="${d}"/>`;
    }
    const [ax, ay] = this.camera.project(0, 0, 0), [bx, by] = this.camera.project(1, 0, 0);
    const unit = Math.hypot(bx - ax, by - ay);
    for (const r of this.world.terrain.rivers) {
      const d = this.pathData([r.points], true);
      const across = 2 * ((r.width ?? 0.35) + (r.vary ?? 0.8) * 0.3) * unit;
      out += `<path class="river-wash" d="${d}" style="stroke-width:${r2(across)}px"/>`;
    }
    return out;
  }

  // The water's lines in world units, { shore, bank, ripple }, traced once
  // per terrain (the costly part of renderWater); `ripple` the places of
  // the ripples ({ x, y, room, len, sign, tilt }, renderRipples).
  traceWater() {
    const { world } = this;
    if (!this.waterLines) {
      this.waterLines = { shore: [], bank: [], ripple: [] };
      const elev = world.elevation, field = world.riverField;
      for (const cells of this.waterBodies()) {
        if (field && world.terrain.isRiver(world.grid.nodeAt(...cells[0]))) {
          this.renderWaterBody(cells, (x, y) => field.depth(x, y), this.waterLines, field);
        } else {
          const level = this.waterLevel(cells, elev);
          this.renderWaterBody(cells, (x, y) => (level - elev(x, y)) / WATER.metres, this.waterLines);
        }
      }
    }
    return this.waterLines;
  }

  // The drawn water's edges (lake shores, river banks) as a SegmentIndex:
  // what plots stop at (plotFor). Rebuilt with the traced lines.
  shoreIndex() {
    const lines = this.traceWater();
    if (this.shores?.lines !== lines) this.shores = { lines, index: new SegmentIndex([...lines.shore, ...lines.bank]) };
    return this.shores.index;
  }

  // Water dots grouped into lakes (touching, diagonals too), as [[x, y]…] each.
  waterBodies() {
    const { grid, terrain } = this.world;
    const seen = new Uint8Array(grid.size);
    const bodies = [];
    for (let i = 0; i < grid.size; i++) {
      if (seen[i] || !terrain.isWater(i)) continue;
      const cells = [], stack = [i];
      seen[i] = 1;
      while (stack.length) {
        const n = stack.pop();
        cells.push(grid.xy(n));
        for (const m of grid.neighbors(n)) if (!seen[m] && terrain.isWater(m)) { seen[m] = 1; stack.push(m); }
      }
      bodies.push(cells);
    }
    return bodies;
  }

  // The height of a lake's surface: halfway from its highest dot up to the
  // lowest dry ground next to it (generate.js keeps lakes below their rim).
  waterLevel(cells, elev) {
    const { grid, terrain } = this.world;
    let top = -Infinity, rim = Infinity;
    for (const [x, y] of cells) {
      top = Math.max(top, elev(x, y));
      for (const [dx, dy] of ORTHO) {
        const n = grid.nodeAt(x + dx, y + dy);
        if (n >= 0 && !terrain.isWater(n)) rim = Math.min(rim, elev(x + dx, y + dy));
      }
    }
    return rim > top && rim < Infinity ? (top + rim) / 2 : top + 0.5;
  }

  // One body of water's shore (a river's: banks) and ripples, appended to `out`.
  // `below(x, y)`: grid units inside the shore (negative on land), kept
  // within reach of the water dots. With `river` (its field) it is worked
  // out to the edge of the map, past the dots at the edges.
  renderWaterBody(cells, below, out, river = null) { // (out: lines in world units, by class)
    const { radius, soft, step, ripple } = WATER;
    const { width, height } = this.world.grid;
    const xs = cells.map((c) => c[0]), ys = cells.map((c) => c[1]);
    let [x0, y0, x1, y1] = [Math.min(...xs) - 1.5, Math.min(...ys) - 1.5, Math.max(...xs) + 1.5, Math.max(...ys) + 1.5];
    if (river) {
      const m = 1.2; // margin around the outermost dots
      [x0, y0, x1, y1] = [Math.max(x0, -m), Math.max(y0, -m), Math.min(x1, width - 1 + m), Math.min(y1, height - 1 + m)];
      if (x0 < 0) x0 = -m;
      if (y0 < 0) y0 = -m;
      if (x1 > width - 1) x1 = width - 1 + m;
      if (y1 > height - 1) y1 = height - 1 + m;
    }
    const nx = Math.ceil((x1 - x0) / step) + 1, ny = Math.ceil((y1 - y0) / step) + 1;
    // soft maximum of the discs' depths (radius - distance): sum exp(soft * depth) per sample
    const sum = new Float32Array(nx * ny);
    const reach = Math.ceil((radius + 1) / step);
    for (const [cx, cy] of cells) {
      const ci = Math.round((cx - x0) / step), cj = Math.round((cy - y0) / step);
      for (let j = Math.max(0, cj - reach); j <= Math.min(ny - 1, cj + reach); j++) {
        for (let i = Math.max(0, ci - reach); i <= Math.min(nx - 1, ci + reach); i++) {
          sum[j * nx + i] += Math.exp(soft * (radius - Math.hypot(x0 + i * step - cx, y0 + j * step - cy)));
        }
      }
    }
    // depth below the shore, but no further out than the dots' reach (a
    // river needs none: its water dots are exactly those inside its banks)
    const wet = new Float32Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i, x = x0 + i * step, y = y0 + j * step;
      const reachDepth = river ? Infinity : sum[k] > 0 ? Math.log(sum[k]) / soft : -1;
      wet[k] = Math.min(reachDepth, below(x, y));
    }
    const box = [x0, y0, x0 + (nx - 1) * step, y0 + (ny - 1) * step];
    // on land the depth, inside a flat 0.5 (the shore alone is traced)
    // (clamped: the contour tracer may take one sample more than the box,
    // by rounding, which would wrap onto the next row)
    const sample = (x, y) => {
      const i = Math.min(Math.max(Math.round((x - x0) / step), 0), nx - 1);
      const j = Math.min(Math.max(Math.round((y - y0) / step), 0), ny - 1);
      return j * nx + i;
    };
    const field = (x, y) => Math.min(wet[sample(x, y)] / 0.06, 0.5);
    for (const c of contours(field, box, { step, interval: 1, index: 99, only: 0 })) out[river ? 'bank' : 'shore'].push(c.points);
    // Ripples: places on a jittered grid with room enough to the shore (a
    // two-pass chamfer distance from the land samples), seeded by the body
    // so they stay put however often it is traced.
    const dist = new Float32Array(nx * ny);
    for (let k = 0; k < dist.length; k++) dist[k] = wet[k] > 0 ? Infinity : 0;
    const diag = step * Math.SQRT2;
    const relax = (k, n, w) => { if (dist[n] + w < dist[k]) dist[k] = dist[n] + w; };
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (i > 0) relax(k, k - 1, step);
      if (j > 0) {
        relax(k, k - nx, step);
        if (i > 0) relax(k, k - nx - 1, diag);
        if (i < nx - 1) relax(k, k - nx + 1, diag);
      }
    }
    for (let j = ny - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) {
      const k = j * nx + i;
      if (i < nx - 1) relax(k, k + 1, step);
      if (j < ny - 1) {
        relax(k, k + nx, step);
        if (i < nx - 1) relax(k, k + nx + 1, diag);
        if (i > 0) relax(k, k + nx - 1, diag);
      }
    }
    const [sx, sy] = cells[0];
    const rnd = mulberry32(Math.imul(sx + 1, 73856093) ^ Math.imul(sy + 1, 19349663) ^ this.world.seed);
    const { gap } = ripple;
    for (let y = y0 + gap / 2; y < box[3]; y += gap) for (let x = x0 + gap / 2; x < box[2]; x += gap) {
      const px = x + (rnd() - 0.5) * gap * 0.8, py = y + (rnd() - 0.5) * gap * 0.8;
      const len = ripple.len * (0.6 + 0.8 * rnd()), sign = rnd() < 0.5 ? -1 : 1, tilt = (rnd() - 0.5) * 2 * ripple.tilt;
      const room = dist[sample(px, py)];
      if (room < ripple.room || rnd() > ripple.keep) continue;
      out.ripple.push({ x: px, y: py, room, len, sign, tilt });
    }
  }

  setContours(on) {
    this.contours = on;
    this.dirty.add('terrain');
  }

  // Contour lines out to the edge of the map, broken over water. Index lines
  // are brighter; the map's named hills have their tops marked.
  renderContours(lines = null) {
    const { grid } = this.world;
    const m = 1.2; // margin around the outermost dots
    if (!this.contourLines) {
      this.contourLines = contours(this.world.elevation, [-m, -m, grid.width - 1 + m, grid.height - 1 + m], ELEVATION, this.wetAt());
      // drawn by hand: each line as a run of pencil strokes (see pencil())
      this.contourStrokes = [[], [], []];
      for (const c of this.contourLines) this.contourStrokes[c.tier].push(...pencil(c.points, c.level, PENCIL[c.tier]));
    }
    const tiers = this.contourStrokes;
    // no heights along the lines: each named hill's top gets a little pen
    // triangle instead (its name and height show on hovering it, ui/annotations.js)
    let labels = '';
    for (const hill of this.world.hills) {
      const [sx, sy] = this.project(hill.x, hill.y);
      const t = 0.12 * this.camera.tile; // (at the map's scale)
      const mark = sketchPolyline([[sx - t, sy + t * 0.6], [sx, sy - t * 0.9], [sx + t, sy + t * 0.6], [sx - t, sy + t * 0.6]], seedOf(hill.x, hill.y), { k: 0.4 });
      labels += `<path class="summit" d="${mark}"/>`;
    }
    // thinned out with distance like the rest of the detail (d1 / d2); a
    // path per chunk of the map, not one across all of it, so drawing a
    // patch of the screen only goes through the lines near it
    if (lines) {
      this.terrainItems(lines, tiers[2], 'contour-d2');
      this.terrainItems(lines, tiers[1], 'contour-d1');
      this.terrainItems(lines, tiers[0], 'contour-index');
      return labels;
    }
    const line = (ls, cls) => chunked(ls, CONTOUR_CHUNK).map((c) => `<path class="${cls}" d="${this.pathData(c, false)}"/>`).join('');
    return line(tiers[2], 'contour d2') + line(tiers[1], 'contour d1') + line(tiers[0], 'contour index') + labels;
  }

  // The terrain's lines (renderTerrain), as the roads: exact at any angle,
  // mid-turn too.
  renderGlTerrain() {
    const gl = this.glTerrain;
    if (!gl || !this.drawn) return;
    const look = this.terrainStyles();
    gl.draw(this.glLineView(), { stroke: this.strokeK, palette: THEME.palette, fg: THEME.palette.main, styles: look.styles, stylesKey: look.key });
  }
}
