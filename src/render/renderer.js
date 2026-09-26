// SVG renderer. The scene is split into layers, each rebuilt only when the
// world events that affect it fire. Layer order (back to front):
//
//   terrain  – contour lines (grey, index lines labelled; only while
//              `contours` is on) and water hatching; in its own
//              <svg id="ground"> underneath the map
//   grid     – the main dots (shown while building, see styles.css)
//   frame    – map border with coordinate ticks (STYLE.frame)
//   subgrid  – the dense footpath dots (only visible while drawing footpaths)
//   lots     – flat ground drawing of structures and their surroundings
//              (lawns, paving, parking lines); built together with objects
//   markers  – ground indicators (unconnected buildings…)
//   paths    – footpaths
//   rails    – railways: the map symbol, a solid line with dashes inside
//   roads    – roads + driveways (for buildings without surroundings);
//              over the railways, so level crossings read as road
//   parked   – parked cars (hollow squares) in parking lots
//   trains   – carriages (squares) coupled by a line
//   agents   – moving dots; sit under objects so buildings hide them correctly
//   objects  – structures + features, depth sorted together
//   overlay  – tool previews, hover
//
// To add a layer: add its name to LAYERS, write render<Name>(), and mark it
// dirty from the events that should refresh it.
//
// Objects (and their ground drawing in `lots`) are kept per structure /
// feature: a change redraws only the objects near it, then re-sorts.
//
// New objects are sketched in and removed ones erased (see draw.js): an
// erased object's elements stay as a ghost until the pen is done with them.
// A building that changes (level, look, type) is erased and drawn anew.
// Roads, footpaths and railways do the same per segment (see ink.js).
//
// Detail levels: the <svg> gets class lod-0/1/2 from the zoom, and CSS hides
// elements tagged d1 / d2 (see Painter).

import { THEME } from '../theme.js';
import { STYLE } from './style.js';
import { Painter, LOOK, wobble } from './painter.js';
import { VEHICLES, vehicleSVG, modelFor, headingIndex } from './vehicles.js';
import { bodyFor, walkerSVG, cyclistSVG } from './people.js';
import { drawIn, eraseOut, drawEnabled, DRAW, growScale, shrinkScale } from './draw.js';
import { chainEdges, edgeCurve, streetKerbPairs, railParts, roadEdges, roadway, keepRuns } from '../roads/geometry.js';
import { edgeKey } from '../roads/network.js';
import { InkLayer } from './ink.js';
import { stationTracks } from '../../structures/station.js';
import { STRUCTURE_TYPES, levelOf, drawSeed, yardOf, joinSides, joinedRow } from '../../structures/index.js';
import { YARDS } from '../../structures/yards.js';
import { drawPlot } from '../../structures/plots.js';
import { rotateQuarter } from '../core/grid.js';
import { pointInPolygon } from '../core/geom2d.js';
import { fitYard, fitSite, freeTest, pathIndex } from './lots.js';
import { densify } from './warp.js';
import { FEATURE_TYPES } from '../../features/index.js';
import { ELEVATION, makeElevation, contours } from '../terrain/elevation.js';

const LAYERS = ['terrain', 'frame', 'grid', 'subgrid', 'lots', 'markers', 'paths', 'rails', 'roads', 'parked', 'trains', 'agents', 'objects', 'overlay'];
const TOP = ['objects', 'overlay']; // in the #objects <svg>, see the constructor
const SVGNS = 'http://www.w3.org/2000/svg';
// Moving the camera (see placeView): ms it must rest before the map is
// redrawn, and how far past each window edge the map is drawn.
const VIEW_SETTLE = 150;
const OVERSCAN = 0.25;
const r2 = (n) => Math.round(n * 100) / 100;

// Lakes (Renderer.renderWater): disc radius around each water dot and how
// softly neighbouring discs blend (higher = less), the sampling step, and
// depths of the shoreline and the waterlines inside it (grid units).
const WATER = { radius: 0.62, soft: 5, step: 0.08, lines: [0, 0.06, 0.14, 0.26] };

// Short code for a map, shown in the frame corner and the stats box.
export const mapCode = (seed) => (seed % 46656).toString(36).toUpperCase().padStart(3, '0');

// Half-size of a building's ground area around each of its dots.
const STRUCTURE_PAD = 0.45;
// Kerbs open this much wider than a footpath coming in, each side (grid units).
const PATH_OPENING = 0.012;
const FEATURE_PAD = 0.4; // forest trees stand in clumps around their dot

export class Renderer {
  constructor(svg, ground, { world, camera, agents, trains, parking, config }) {
    this.svg = svg;
    this.ground = ground;
    // Buildings, trees and the overlay sit in their own <svg> on top (its
    // own GPU layer, like the ground): moving people and trains repaint only
    // #world under them, not the far heavier building drawings.
    this.top = svg.parentNode.querySelector('#objects');
    this.parking = parking;
    this.world = world;
    this.camera = camera;
    this.agents = agents;
    this.config = config;
    this.agentEls = new Map();
    this.agentGhosts = new Set(); // agents gone indoors, shrinking at their last spot
    this.agentsShown = false;     // the first agents drawn are already there
    this.trains = trains;
    this.trainEls = new Map();
    this.lastOverlay = null;
    this.objs = new Map();       // key ('s12' / 'f7') -> { g, lg, bounds }
    this.objsDirty = new Set();  // keys to redraw
    this.objsAll = true;         // redraw every object
    this.order = [];
    this.born = new Map();       // key -> ms its drawing started (null: not drawn yet), while sketched in
    this.dying = new Set();      // keys removed since the last redraw, to erase
    this.ghosts = new Map();     // key -> entry being erased, with `until` (ms)
    this.lodLevel = -1;
    this.deferView = true;  // move on the GPU while the camera moves (placeView)
    this.showAgents = true; // (both switchable in the temporary debug panel)
    this.contours = STYLE.contours;

    ground.innerHTML = '<g class="scene"><g class="layer-terrain"></g></g>';
    svg.innerHTML = `
      <defs>
        <pattern id="hatch-water" patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(-40)">
          <line class="hatch" x1="0" y1="2.5" x2="5" y2="2.5"/>
        </pattern>
      </defs>
      <g class="scene">${LAYERS.filter((l) => !TOP.includes(l) && l !== 'terrain').map((l) => `<g class="layer-${l}"></g>`).join('')}</g>`;
    this.top.innerHTML = `<g class="scene">${TOP.map((l) => `<g class="layer-${l}${l === 'overlay' ? ' overlay' : ''}"></g>`).join('')}</g>`;
    const svgOf = (l) => (l === 'terrain' ? ground : TOP.includes(l) ? this.top : svg);
    this.scenes = [ground, svg, this.top].map((s) => s.querySelector('.scene'));
    this.layers = Object.fromEntries(LAYERS.map((l) => [l, svgOf(l).querySelector(`.layer-${l}`)]));
    this.ink = {
      roads: new InkLayer(this.layers.roads, ['driveway', 'road', 'kerb', 'road-exit']),
      paths: new InkLayer(this.layers.paths, ['footpath']),
      rails: new InkLayer(this.layers.rails, ['rail-exit', 'rail-buffer', 'rail', 'rail-dash']),
    };
    this.buildOrder = new Map(); // network layer -> Map dot -> its place in the last build, for the pen

    this.dirty = new Set();
    this.invalidate();

    const on = (type, ...layers) => world.events.on(type, () => layers.forEach((l) => this.dirty.add(l)));
    const near = (s) => this.touchAround(world.nodesOf(s).map((n) => world.grid.xy(n)));
    for (const type of ['structure:added', 'structure:removed', 'structure:changed']) {
      on(type, 'markers', 'roads', 'rails'); // stations draw tracks with the rails
      world.events.on(type, (s) => {
        this.objsDirty.add(`s${s.id}`);
        near(s); // neighbours' plots, sites and yards depend on it
      });
    }
    for (const type of ['feature:added', 'feature:removed']) world.events.on(type, (f) => this.objsDirty.add(`f${f.id}`));
    for (const k of ['s', 'f']) {
      const kind = k === 's' ? 'structure' : 'feature';
      world.events.on(`${kind}:added`, (o) => this.born.set(`${k}${o.id}`, null));
      world.events.on(`${kind}:removed`, (o) => this.dying.add(`${k}${o.id}`));
    }
    on('roads:changed', 'roads', 'markers');
    on('paths:changed', 'paths', 'markers');
    on('rails:changed', 'rails');
    for (const type of ['roads:changed', 'paths:changed', 'rails:changed']) {
      world.events.on(type, (e) => {
        if (e?.nodes && e.layer) this.buildOrder.set(e.layer, new Map(e.nodes.map((n, i) => [n, i])));
        if (e?.nodes) this.touchAround(e.nodes.map((n) => e.layer.pos(n)), 2); // curves reach further
        else this.objsAll = true;
      });
    }
    on('parking:changed', 'parked');
    on('terrain:changed', 'terrain', 'grid', 'subgrid', 'paths', 'rails', 'roads', 'markers');
    world.events.on('terrain:changed', () => {
      this.objsAll = true;
      this.contourLines = null; // water breaks them
    });
  }

  // Rebuild everything (e.g. after a camera rotation).
  invalidate() {
    for (const l of LAYERS) if (l !== 'agents' && l !== 'overlay' && l !== 'objects' && l !== 'lots') this.dirty.add(l);
    this.objsAll = true;
    this.lastOverlay = null;
    for (const ink of Object.values(this.ink ?? {})) ink.clearErasing(); // drawn for the old view
  }

  // Mark structures within `r` dots of any of the world points for redraw.
  // Plots, sites and yards only look at directly neighbouring dots, so 1 is
  // enough for structure changes.
  touchAround(points, r = 1) {
    const { world } = this;
    for (const [px, py] of points) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const n = world.grid.nodeAt(px + dx, py + dy);
          const s = n >= 0 ? world.structureAt(n) : null;
          if (s) this.objsDirty.add(`s${s.id}`);
        }
      }
    }
  }

  frame(overlaySVG) {
    this.placeView();
    // labels that keep their screen size divide by this (styles.css); set
    // only on their layers, as a change restyles everything below it
    if (this.drawn.zoom !== this.zoomVar) {
      this.zoomVar = this.drawn.zoom;
      for (const l of ['terrain', 'frame']) this.layers[l].style.setProperty('--z', this.zoomVar);
    }
    this.updateLod(this.drawn.zoom);
    for (const layer of this.dirty) this[`render${layer[0].toUpperCase()}${layer.slice(1)}`]?.();
    this.dirty.clear();
    for (const ink of Object.values(this.ink)) if (ink.busy) ink.tick();
    if (this.objsAll || this.objsDirty.size) this.renderObjects();
    if (this.ghosts.size) this.reapGhosts();
    if (this.showAgents) {
      this.renderAgents();
      this.renderTrains();
    } else {
      this.agentsShown = false;
      for (const el of this.agentGhosts) el.remove();
      this.agentGhosts.clear();
      for (const els of [this.agentEls, this.trainEls]) {
        els.forEach((el) => el.remove());
        els.clear();
      }
    }
    if (overlaySVG !== this.lastOverlay) {
      this.layers.overlay.innerHTML = overlaySVG;
      this.lastOverlay = overlaySVG;
    }
  }

  project(x, y, z = 0) {
    return this.camera.project(x, y, this.world.terrain.heightAt(x, y) + z);
  }

  // `sway`: the line belongs to the road network and gets its hand-drawn
  // wobble (see wobble() in painter.js).
  pathData(lines, dense = true, sway = false) {
    return this.screenLines(lines, dense, sway).map((pts) => pts.map(([sx, sy], i) => `${i ? 'L' : 'M'}${r2(sx)} ${r2(sy)}`).join('')).join('');
  }

  // The same as lists of screen points.
  screenLines(lines, dense = true, sway = false) {
    sway = sway && LOOK.roads > 0;
    // under a warp or relief (or the sway), long straight pieces get extra points so they bend too
    if ((this.camera.warp || this.camera.lift || sway) && dense) lines = lines.map((pts) => densify(pts));
    return lines.map((pts) => pts.map(([x, y]) => {
      if (sway) {
        const [dx, dy] = wobble(x, y);
        [x, y] = [x + dx, y + dy];
      }
      return this.project(x, y);
    }));
  }

  groundEllipse(x, y, r, cls) {
    const [sx, sy] = this.project(x, y);
    const [rx, ry] = this.camera.groundEllipse(r);
    return `<ellipse class="${cls}" cx="${r2(sx)}" cy="${r2(sy)}" rx="${r2(rx)}" ry="${r2(ry)}"/>`;
  }

  // ----- layers -----

  renderTerrain() {
    this.layers.terrain.innerHTML = (this.contours ? this.renderContours() : '') + this.renderWater();
  }

  // Lakes as on a hand-drawn map: a shoreline, and inside it "waterlines"
  // that follow the shore, further apart towards the middle, plus a few
  // short ripples out on open water. The shore is a contour of a smooth
  // depth field – each water dot a disc, blended with a soft maximum, so
  // neighbouring dots merge into one rounded lake.
  renderWater() {
    const { grid, terrain } = this.world;
    const cells = [];
    for (let i = 0; i < grid.size; i++) if (terrain.isWater(i)) cells.push(grid.xy(i));
    if (!cells.length) return '';
    const { radius, soft, step, lines } = WATER;
    const xs = cells.map((c) => c[0]), ys = cells.map((c) => c[1]);
    const [x0, y0] = [Math.min(...xs) - 1.5, Math.min(...ys) - 1.5];
    const nx = Math.ceil((Math.max(...xs) + 1.5 - x0) / step) + 1, ny = Math.ceil((Math.max(...ys) + 1.5 - y0) / step) + 1;
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
    // The waterlines follow the true distance to the shore (the blended
    // depth dips between dots, which would break them into islands): a
    // two-pass chamfer distance over the samples, from the land ones.
    const depth = (k) => (sum[k] > 0 ? Math.log(sum[k]) / soft : -1);
    const dist = new Float32Array(nx * ny);
    for (let k = 0; k < dist.length; k++) dist[k] = depth(k) > 0 ? Infinity : 0;
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
    // the chamfer steps show as stairs in the lines: soften it a little
    for (let pass = 0; pass < 3; pass++) {
      const prev = dist.slice();
      for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
        const k = j * nx + i;
        if (prev[k] === 0) continue;
        dist[k] = (prev[k] * 4 + prev[k - 1] + prev[k + 1] + prev[k - nx] + prev[k + nx]) / 8;
      }
    }
    // mapped so that the waterlines fall on whole numbers (0 = the shore);
    // on land the (negative) depth, so the shore itself stays smooth
    const field = (x, y) => {
      const k = Math.round((y - y0) / step) * nx + Math.round((x - x0) / step);
      const d = depth(k);
      if (d <= 0) return Math.max(d / lines[1], -0.5);
      const t = dist[k];
      for (let n = 1; n < lines.length; n++) if (t < lines[n]) return n - 1 + (t - lines[n - 1]) / (lines[n] - lines[n - 1]);
      return lines.length - 0.5;
    };
    const box = [x0, y0, x0 + (nx - 1) * step, y0 + (ny - 1) * step];
    let shore = '', inner = '', innermost = '';
    for (const c of contours(field, box, { step, interval: 1, index: 99 })) {
      const d = this.pathData([c.points], false);
      if (c.level === 0) shore += d;
      else if (c.level < lines.length - 1) inner += d;
      else innermost += d;
    }
    // ripples: short strokes along the screen's horizontal, on water well
    // away from the shore, some dots only
    const ripples = [];
    for (const [cx, cy] of cells) {
      if ((Math.imul(cx * 73 + cy * 151, 0x9e3779b1) >>> 28) > 6) continue;
      if (dist[Math.round((cy - y0) / step) * nx + Math.round((cx - x0) / step)] < lines[lines.length - 1] * 2) continue;
      const k = 0.12 + ((cx * 7 + cy * 3) % 5) * 0.02;
      ripples.push([[cx - k, cy + k], [cx + k, cy - k]]);
    }
    const path = (d, cls) => (d ? `<path class="${cls}" d="${d}"/>` : '');
    return path(shore, 'shore') + path(inner, 'waterline') + path(innermost, 'waterline far') + path(this.pathData(ripples), 'waterline ripple');
  }

  setContours(on) {
    this.contours = on;
    this.dirty.add('terrain');
  }

  // Contour lines out to the map frame, broken over water. Index lines are
  // brighter and carry their height now and then.
  renderContours() {
    const { grid, terrain } = this.world;
    const m = 1.2; // same margin as the frame
    if (!this.contourLines) {
      const elev = makeElevation(this.world.seed);
      const wet = (x, y) => {
        const n = grid.nodeAt(Math.round(x), Math.round(y));
        return n >= 0 && terrain.isWater(n) && Math.hypot(x - Math.round(x), y - Math.round(y)) < 0.75;
      };
      this.contourLines = contours(elev, [-m, -m, grid.width - 1 + m, grid.height - 1 + m], ELEVATION, wet);
    }
    const tiers = [[], [], []];
    let labels = '';
    const every = 9; // grid steps of line between labels
    for (const c of this.contourLines) {
      tiers[c.tier].push(c.points);
      if (c.tier) continue;
      let run = every / 2;
      for (let i = 1; i < c.points.length; i++) {
        const [ax, ay] = c.points[i - 1], [bx, by] = c.points[i];
        run += Math.hypot(bx - ax, by - ay);
        if (run < every) continue;
        run = 0;
        const [sx, sy] = this.project(bx, by);
        labels += `<text class="contour-label" x="${r2(sx)}" y="${r2(sy)}">${c.level}</text>`;
      }
    }
    // thinned out with distance like the rest of the detail (d1 / d2)
    const line = (lines, cls) => lines.length ? `<path class="${cls}" d="${this.pathData(lines, false)}"/>` : '';
    return line(tiers[2], 'contour d2') + line(tiers[1], 'contour d1') + line(tiers[0], 'contour index') + `<g class="d1">${labels}</g>`;
  }

  renderFrame() {
    if (!STYLE.frame) {
      this.layers.frame.innerHTML = '';
      return;
    }
    const { grid, seed } = this.world;
    const [w, h] = [grid.width, grid.height];
    const m = 1.2; // margin around the outermost dots
    const [x0, y0, x1, y1] = [-m, -m, w - 1 + m, h - 1 + m];
    const border = this.pathData([[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]);
    const inner = this.pathData([[[x0 + 0.35, y0 + 0.35], [x1 - 0.35, y0 + 0.35], [x1 - 0.35, y1 - 0.35], [x0 + 0.35, y1 - 0.35], [x0 + 0.35, y0 + 0.35]]]);

    // ticks and coordinates every 5 dots along each edge
    const ticks = [];
    let labels = '';
    const label = (x, y, text) => {
      const [sx, sy] = this.project(x, y);
      labels += `<text class="frame-label" x="${r2(sx)}" y="${r2(sy)}">${text}</text>`;
    };
    for (let x = 0; x < w; x += 5) {
      ticks.push([[x, y0], [x, y0 - 0.3]], [[x, y1], [x, y1 + 0.3]]);
      label(x, y0 - 0.9, x);
      label(x, y1 + 0.9, x);
    }
    for (let y = 0; y < h; y += 5) {
      ticks.push([[x0, y], [x0 - 0.3, y]], [[x1, y], [x1 + 0.3, y]]);
      label(x0 - 0.9, y, y);
      label(x1 + 0.9, y, y);
    }
    label(x0 + 1.2, y0 - 0.9, `MAP-${mapCode(seed)}`);
    this.layers.frame.innerHTML =
      `<path class="frame" d="${border}"/><path class="frame thin" d="${inner}"/>` +
      `<path class="frame" d="${this.pathData(ticks)}"/>${labels}`;
  }

  renderGrid() {
    const { grid, terrain } = this.world;
    let out = '';
    for (let i = 0; i < grid.size; i++) {
      if (terrain.isWater(i)) continue;
      const [sx, sy] = this.project(...grid.xy(i));
      out += `<circle class="grid-dot" cx="${r2(sx)}" cy="${r2(sy)}" r="${THEME.gridDotRadius}"/>`;
    }
    this.layers.grid.innerHTML = out;
  }

  renderSubgrid() {
    const { world } = this;
    const { fine, terrain } = world;
    let out = '';
    for (let f = 0; f < fine.size; f++) {
      const [fx, fy] = fine.xy(f);
      if (fx % 2 === 0 && fy % 2 === 0) continue; // main dots are drawn by the grid layer
      if (world.coarseAround(f).some((c) => terrain.isWater(c))) continue;
      const [sx, sy] = this.project(fx / 2, fy / 2);
      out += `<circle class="fine-dot" cx="${r2(sx)}" cy="${r2(sy)}" r="${THEME.fineDotRadius}"/>`;
    }
    this.layers.subgrid.innerHTML = out;
  }

  renderMarkers() {
    const { world } = this;
    let out = '';
    for (const s of world.structures.values()) {
      if (world.isServed(s)) continue;
      const size = Math.sqrt(world.nodesOf(s).length);
      out += this.groundEllipse(...world.centerOf(s), 0.42 * size, 'unconnected');
    }
    this.layers.markers.innerHTML = out;
  }

  // Network linework as ink items (see ink.js): `add(key, cls, line, a, b)`
  // for each piece, a / b the dots it runs between, for the pen's order.
  inkItems(sway) {
    const items = [];
    const add = (key, cls, line, a, b) => {
      const [pts] = this.screenLines([line], true, sway);
      if (pts.length > 1) items.push({ key, cls, pts, a, b });
    };
    return { items, add };
  }

  // Where a new piece comes in the pen's run along the last build of `layer`:
  // segments in the order their dots were built, drawn from the earlier dot;
  // map exits after the segment reaching them – or first, drawn inward, when
  // the build started there.
  rankOf(layer) {
    const order = this.buildOrder.get(layer);
    this.buildOrder.delete(layer);
    if (!order) return () => null;
    return ({ a, b, cls }) => {
      const ia = order.get(a), ib = order.get(b);
      if (ia == null && ib == null) return null;
      if (a === b) { // a map exit: its track, then the fade (-exit)
        const fade = cls.endsWith('-exit');
        return ia === 0 && order.size > 1 ? { rank: fade ? -1 : -0.5, flip: true } : { rank: ia + (fade ? 0.5 : 0), flip: false };
      }
      return { rank: Math.min(ia ?? Infinity, ib ?? Infinity), flip: ia != null && ib != null && ia > ib };
    };
  }

  renderPaths() {
    const layer = this.world.networks.path;
    const { items, add } = this.inkItems(true);
    // Footpaths as two narrow edges, like small roads (roadEdges), stopping
    // where the roadway starts: at a plain road's edge, at a street's kerb
    // (its sidewalk carries on). Dead ends are closed, but not where a
    // path runs on into a park or square as its walkway.
    const { world } = this;
    const onRoad = roadway(world, this.config.road);
    const intoSite = (n) => world.coarseAround(n).some((c) => STRUCTURE_TYPES[world.structureAt(c)?.type]?.site);
    for (const { key, line, a, b } of roadEdges(layer, this.config.path, this.config.path.edge, [], (n) => !intoSite(n))) {
      keepRuns(line, (q) => !onRoad(q)).forEach((run, i) => add(`p${key}${i ? `:${i}` : ''}`, 'footpath', run, a, b));
    }
    this.ink.paths.update(items, { rankOf: this.rankOf(layer) });
  }

  renderRails() {
    const { world } = this;
    const layer = world.networks.rail;
    const { edges, exits, buffers } = railParts(layer, this.config.rail, world.railExits());
    const { items, add } = this.inkItems(false);
    // the dashes are a second line over the same track
    for (const { a, b, line } of edges) for (const cls of ['rail', 'rail-dash']) add(`${cls}${edgeKey(a, b)}`, cls, line, a, b);
    for (const { node, line, fade } of exits) {
      for (const cls of ['rail', 'rail-dash']) add(`${cls}x${node}`, cls, line, node, node);
      add(`fade${node}`, 'rail-exit', fade, node, node);
    }
    for (const { node, line } of buffers) add(`b${node}`, 'rail-buffer', line, node, node);
    // stations' own tracks, drawn with the line so they meet it exactly
    for (const s of world.structures.values()) {
      const def = STRUCTURE_TYPES[s.type];
      stationTracks(world, s, def).forEach(({ line, buffer }, i) => {
        for (const cls of ['rail', 'rail-dash']) add(`${cls}s${s.id}.${i}`, cls, line, s.node, s.node);
        if (!buffer) return;
        const [ax, ay] = line[line.length - 2], [bx, by] = line[line.length - 1];
        const l = Math.hypot(bx - ax, by - ay) || 1;
        const nx = (-(by - ay) / l) * 0.12, ny = ((bx - ax) / l) * 0.12;
        add(`bs${s.id}.${i}`, 'rail-buffer', [[bx + nx, by + ny], [bx - nx, by - ny]], s.node, s.node);
      });
    }
    this.ink.rails.update(items, { rankOf: this.rankOf(layer) });
  }

  renderRoads() {
    const { world } = this;
    const layer = world.networks.road, curve = this.config.road;
    const { items, add } = this.inkItems(true);

    // Driveways: from the building edge at its door to the road's edge.
    for (const s of world.structures.values()) {
      if (this.yardFrame(s) || STRUCTURE_TYPES[s.type]?.site) continue; // these reach the road themselves
      const access = world.accessInfo(s);
      if (!access) continue;
      const [dx, dy] = world.grid.xy(access.door);
      const [rx, ry] = world.grid.xy(access.road);
      const len = Math.hypot(rx - dx, ry - dy);
      const t = STRUCTURE_PAD / len, u = 1 - curve.edge / len;
      add(`d${s.id}`, 'driveway', [[dx + (rx - dx) * t, dy + (ry - dy) * t], [dx + (rx - dx) * u, dy + (ry - dy) * u]]);
    }

    // The road as its two edges, with corners at junctions, rounded dead
    // ends, and at map exits carried on past the edge, then faded out.
    for (const { key, kind, line, a, b } of roadEdges(layer, curve, curve.edge, world.roadExits())) {
      add(`r${key}`, kind === 'fade' ? 'road-exit' : 'road', line, a, b);
    }

    // kerbs, open where a footpath comes in
    const paths = pathIndex(world, this.config);
    const open = (q) => paths.distance(q, this.config.path.edge + PATH_OPENING) === Infinity;
    for (const { a, b, lines } of streetKerbPairs(world, curve, curve.kerb)) {
      lines.forEach((line, i) => {
        keepRuns(line, open).forEach((run, j) => add(`k${i}${edgeKey(a, b)}${j ? `:${j}` : ''}`, 'kerb', run, a, b));
      });
    }
    this.ink.roads.update(items, { rankOf: this.rankOf(layer) });
  }

  // Pan and zoom. Redrawing the SVGs at a new view re-lays-out and repaints
  // every element, too slow to do on every frame of a pan or zoom. So while
  // the camera moves, the last drawing (`drawn`) is only shifted / stretched
  // on the GPU with a CSS transform on their wrapper (#view), and redrawn
  // when the camera rests –
  // or early, when the moved drawing would no longer cover the window. It
  // reaches OVERSCAN of the window past each edge, so there is picture to
  // slide into. (Mid-zoom the stretched lines look a little soft; they
  // sharpen when the zoom rests.)
  placeView() {
    const cam = this.camera, now = performance.now();
    const W = innerWidth, H = innerHeight;
    if (W !== this.winW || H !== this.winH) {
      [this.winW, this.winH] = [W, H];
      [this.ox, this.oy] = [Math.round(W * OVERSCAN), Math.round(H * OVERSCAN)];
      Object.assign(this.svg.parentNode.style, { left: `${-this.ox}px`, top: `${-this.oy}px`, width: `${W + 2 * this.ox}px`, height: `${H + 2 * this.oy}px`, transformOrigin: `${this.ox}px ${this.oy}px` });
      this.drawn = null;
    }
    const view = `${cam.zoom} ${cam.panX} ${cam.panY}`;
    if (view !== this.lastView) {
      this.lastView = view;
      this.movedAt = now;
    }
    const d = this.drawn;
    let css = '';
    if (!d || d.view !== view) {
      const k = d ? cam.zoom / d.zoom : 1;
      const tx = d ? cam.panX - k * d.panX : 0, ty = d ? cam.panY - k * d.panY : 0;
      const { ox, oy } = this;
      const covered = tx - k * ox <= 0 && ty - k * oy <= 0 && tx + k * (W + ox) >= W && ty + k * (H + oy) >= H;
      if (d && covered && this.deferView && now - this.movedAt < VIEW_SETTLE) {
        css = `translate(${tx}px, ${ty}px) scale(${k})`;
      } else {
        this.drawn = { view, zoom: cam.zoom, panX: cam.panX, panY: cam.panY };
        const t = `translate(${cam.panX + ox} ${cam.panY + oy}) scale(${cam.zoom})`;
        for (const scene of this.scenes) scene.setAttribute('transform', t);
      }
    }
    if (css !== this.css) {
      this.css = css;
      // on the wrapper, not the SVGs: a transform on an <svg> itself makes
      // Chrome recompute every non-scaling stroke in it
      this.svg.parentNode.style.transform = css;
    }
  }

  updateLod(z) {
    const { medium, far } = this.config.render.lod;
    // parked cars switch between dots and models (src/render/vehicles.js)
    const close = z >= VEHICLES.minZoom;
    if (close !== this.carsClose) {
      this.carsClose = close;
      this.dirty.add('parked');
    }
    const level = z >= medium ? 0 : z >= far ? 1 : 2;
    if (level === this.lodLevel) return;
    for (const s of [this.svg, this.ground, this.top]) {
      s.classList.remove(`lod-${this.lodLevel}`);
      s.classList.add(`lod-${level}`);
    }
    this.lodLevel = level;
  }

  renderObjects() {
    const { world } = this;
    let keys = this.objsDirty;
    if (this.objsAll) {
      keys = new Set(this.objs.keys());
      for (const id of world.structures.keys()) keys.add(`s${id}`);
      for (const id of world.features.keys()) keys.add(`f${id}`);
    } else {
      // a street front shares one lift (buildStructure): redraw whole rows
      for (const key of [...keys]) {
        const s = key[0] === 's' && world.structures.get(Number(key.slice(1)));
        if (s) for (const o of joinedRow(world, s)) keys.add(`s${o.id}`);
      }
    }
    this.free = freeTest(world, this.config);
    if (this.objsAll) this.reapGhosts(true); // drawn for the old view

    const now = performance.now();
    const animate = drawEnabled();
    // a whole new map (or a big batch) just appears
    const fresh = [...this.born].filter(([, t]) => t === null).length;
    const drawing = animate && fresh <= DRAW.cap;
    const erasing = animate && this.dying.size <= DRAW.cap;
    const sketch = [];
    let swaps = 0;
    for (const [key, t] of this.born) if (t !== null && now - t > DRAW.max * DRAW.speed) this.born.delete(key);
    let orderChanged = false;
    for (const key of keys) {
      const id = Number(key.slice(1));
      const built = key[0] === 's' ? this.buildStructure(world.structures.get(id)) : this.buildFeature(world.features.get(id));
      let entry = this.objs.get(key);
      if (!built) {
        if (entry) {
          this.objs.delete(key);
          if (erasing && this.dying.has(key)) {
            // erase from where the pen got to, if it was still drawing it in
            const t = this.born.get(key);
            this.ghosts.set(key, entry);
            sketch.push({ entry, reverse: true, drawnFor: t == null ? Infinity : now - t });
          } else {
            entry.g.remove();
            entry.lg.remove();
            orderChanged = true;
          }
        }
        this.born.delete(key);
        if (key[0] === 's') this.parking.spots.delete(id);
        continue;
      }
      if (!entry) {
        entry = { key, g: document.createElementNS(SVGNS, 'g'), lg: document.createElementNS(SVGNS, 'g') };
        this.layers.lots.appendChild(entry.lg);
        this.objs.set(key, entry);
        orderChanged = true;
      }
      const s = key[0] === 's' && world.structures.get(id);
      const sig = s && `${s.type}|${s.level}|${s.seed}`;
      if (sig !== entry.sig && entry.sig && animate && swaps < DRAW.cap && !this.born.has(key)) {
        // the old drawing is erased as a ghost, the new one drawn after it
        swaps++;
        this.ghosts.set(`${key}~${now}`, { g: entry.g, lg: entry.lg, bounds: entry.bounds });
        sketch.push({ entry: this.ghosts.get(`${key}~${now}`), reverse: true, drawnFor: Infinity, then: key });
        entry.g = document.createElementNS(SVGNS, 'g');
        entry.lg = entry.lg.parentNode.insertBefore(document.createElementNS(SVGNS, 'g'), entry.lg.nextSibling);
        this.born.set(key, now);
        orderChanged = true;
      }
      entry.sig = sig;
      entry.g.innerHTML = built.svg;
      entry.lg.innerHTML = built.ground;
      const b = built.bounds;
      if (!entry.bounds || ['minX', 'maxX', 'minY', 'maxY'].some((k) => entry.bounds[k] !== b[k])) orderChanged = true;
      entry.bounds = b;
      if (this.born.has(key)) {
        if (!drawing) this.born.delete(key);
        else {
          if (this.born.get(key) === null) this.born.set(key, now);
          if (!sketch.some((k) => k.then === key)) sketch.push({ entry, key });
        }
      }
    }
    this.objsDirty = new Set();
    this.objsAll = false;
    this.dying.clear();

    if (orderChanged) {
      const order = isoSort([...this.objs.values(), ...this.ghosts.values()].map((e) => ({ ...e.bounds, entry: e }))).map((i) => i.entry);
      const same = order.length === this.order.length && order.every((e, i) => e === this.order[i]);
      if (!same) for (const e of order) this.layers.objects.appendChild(e.g);
      this.order = order;
    }

    // after the DOM is in place: the pen needs computed styles and lengths
    const tile = this.camera.tile;
    sketch.sort((a, b) => !!b.reverse - !!a.reverse); // erasing first: a swap waits for it
    for (const { entry, key, reverse, drawnFor, then } of sketch) {
      const groups = [entry.lg, entry.g];
      if (reverse) {
        const left = eraseOut(groups, { drawn: drawnFor, tile, speed: then ? DRAW.swap : 1 });
        entry.until = now + left;
        if (then) {
          // the new drawing starts when the old one is half erased
          this.born.set(then, now + left / 2);
          sketch.push({ entry: this.objs.get(then), key: then });
        }
      } else if (drawIn(groups, { elapsed: now - this.born.get(key), tile }) <= 0) {
        this.born.delete(key); // done
      }
    }
    this.renderParked();
  }

  // Drop erased objects whose pen is done (all of them with `all`).
  reapGhosts(all = false) {
    const now = performance.now();
    for (const [key, e] of this.ghosts) {
      if (!all && now < e.until) continue;
      e.g.remove();
      e.lg.remove();
      this.ghosts.delete(key);
    }
  }

  // Local free-space test for a painter (footpaths and roads keep clear).
  attachFree(painter) {
    painter.free = (x, y, r) => this.free(...painter.toWorld(x, y), r);
    return painter;
  }

  buildFeature(f) {
    if (!f) return null;
    const def = FEATURE_TYPES[f.type];
    if (!def) return null;
    const { world, camera } = this;
    const [nx, ny] = world.grid.xy(f.node);
    const x = nx + f.ox;
    const y = ny + f.oy;
    // seeded per feature, so each tree has its own shape
    const painter = new Painter(camera, { x, y, z: world.terrain.heightAt(x, y) }, 0, Math.imul(f.id, 2654435761) ^ f.node);
    painter.rigid = [x, y];
    def.draw(painter, f);
    return { svg: painter.toSVG(), ground: '', bounds: this.viewBounds([[x, y]], FEATURE_PAD) };
  }

  buildStructure(s) {
    if (!s) return null;
    const def = STRUCTURE_TYPES[s.type];
    if (!def) return null;
    const { world, camera } = this;
    const [x, y] = world.grid.xy(s.node);
    const z = world.terrain.heightAt(x, y);
    const painter = this.attachFree(new Painter(camera, { x, y, z }, world.facingRotation(s.type, s.node, s.rotation), drawSeed(s)));
    // the building, its yard and plot move with the relief as one piece, so
    // they stay square on slopes (see Camera.project) – and so does a whole
    // street front of buildings sharing walls, so the walls still meet
    const row = joinedRow(world, s).map((o) => world.centerOf(o));
    const rigid = [row.reduce((a, p) => a + p[0], 0) / row.length, row.reduce((a, p) => a + p[1], 0) / row.length];
    painter.rigid = rigid;
    const points = world.nodesOf(s).map((n) => world.grid.xy(n));
    if (def.site) {
      const site = world.siteArea(s.type, s.node, s.rotation);
      painter.setSite(fitSite(world, this.config, site));
      painter.setSitePaths(world.sitePaths(s));
      const [x0, y0, x1, y1] = site.rect;
      points.push([x0 + STRUCTURE_PAD, y0 + STRUCTURE_PAD], [x1 - STRUCTURE_PAD, y1 - STRUCTURE_PAD]);
    }
    painter.join = joinSides(world, s);
    levelOf(def, s).draw(painter, s);
    const core = painter.bounds;

    // Front yard between the building and its road.
    const frame = this.yardFrame(s);
    const yard = frame && fitYard(world, this.config, frame);
    let yardWorld = null;
    if (yard) {
      const [dx, dy] = yard.origin;
      const yp = this.attachFree(new Painter(camera, { x: dx, y: dy, z: world.terrain.heightAt(dx, dy) }, yard.rotation, drawSeed(s) ^ 0x5bd1e995));
      yp.rigid = rigid;
      yp.lod = 1;
      YARDS[yard.style].draw(yp, yard, s);
      if (yp.spots.length) this.parking.setSpots(s, yp.spots);
      else this.parking.spots.delete(s.id);
      painter.merge(yp);
      yardWorld = yard.outline.map(([lx, ly]) => yp.toWorld(lx, ly));
      for (const [lx, ly] of [[yard.x0, yard.y0], [yard.x1, yard.y0]]) points.push(yp.toWorld(lx, ly));
    } else {
      this.parking.spots.delete(s.id);
    }

    // Plot: sides and back.
    const plotDef = { ...def.plot, ...levelOf(def, s).plot };
    if (plotDef.props && core) {
      const pp = this.attachFree(new Painter(camera, { x, y, z }, 0, drawSeed(s) ^ 0x2c1b3c6d));
      pp.rigid = rigid;
      pp.lod = 1;
      drawPlot(pp, this.plotFor(s, plotDef, painter, core, yardWorld));
      painter.merge(pp);
    }

    return { svg: painter.toSVG(), ground: painter.toGroundSVG(), bounds: this.viewBounds(points, STRUCTURE_PAD) };
  }

  // The plot around a structure, in world axes relative to its anchor dot.
  plotFor(s, plotDef, painter, core, yardWorld) {
    const { world } = this;
    const [ax, ay] = world.grid.xy(s.node);
    const pts = world.nodesOf(s).map((n) => world.grid.xy(n));
    const xs = pts.map((p) => p[0] - ax), ys = pts.map((p) => p[1] - ay);
    const cell = [Math.min(...xs) - 0.5, Math.min(...ys) - 0.5, Math.max(...xs) + 0.5, Math.max(...ys) + 0.5];

    // Building footprint as drawn (painter's local bounds -> anchor-relative world axes).
    const corners = [[core[0], core[1]], [core[2], core[3]]].map(([lx, ly]) => {
      const [wx, wy] = painter.toWorld(lx, ly);
      return [wx - ax, wy - ay];
    });
    const bx0 = Math.min(corners[0][0], corners[1][0]), bx1 = Math.max(corners[0][0], corners[1][0]);
    const by0 = Math.min(corners[0][1], corners[1][1]), by1 = Math.max(corners[0][1], corners[1][1]);
    const yardLocal = yardWorld?.map(([wx, wy]) => [wx - ax, wy - ay]);

    const onBuilding = (x, y, r) => x > bx0 - r - 0.03 && x < bx1 + r + 0.03 && y > by0 - r - 0.03 && y < by1 + r + 0.03;
    const inYard = (x, y) => yardLocal && pointInPolygon([x, y], yardLocal);
    const water = (x, y) => {
      const n = world.grid.nodeAt(ax + x, ay + y);
      return n < 0 || world.terrain.isWater(n);
    };

    // Boundary sides: this plot draws its +x and +y sides, and the -x / -y
    // sides only where no other structure is next door (they draw those).
    const [x0, y0, x1, y1] = cell;
    const neighbourAt = (dx, dy) => pts.some(([px, py]) => {
      const n = world.grid.nodeAt(px + dx, py + dy);
      const o = n >= 0 ? world.structureAt(n) : null;
      return o && o.id !== s.id;
    });
    const sides = [[[x1, y0], [x1, y1]], [[x0, y1], [x1, y1]]];
    if (!neighbourAt(-1, 0)) sides.push([[x0, y0], [x0, y1]]);
    if (!neighbourAt(0, -1)) sides.push([[x0, y0], [x1, y0]]);

    return {
      style: plotDef.props,
      boundary: plotDef.boundary,
      kinds: plotDef.kinds,
      density: plotDef.density,
      cell,
      sides,
      inside: (x, y, r) =>
        x - r > x0 && x + r < x1 && y - r > y0 && y + r < y1 &&
        !onBuilding(x, y, r) && !inYard(x, y) && !water(x, y),
      onLine: (x, y) => !onBuilding(x, y, 0.02) && !inYard(x, y) && !water(x, y),
    };
  }

  renderParked() {
    const { world, parking } = this;
    const r = THEME.agentRadius;
    // close up car models (src/render/vehicles.js) nosed into their stalls,
    // further out square dots
    const close = this.camera.zoom >= VEHICLES.minZoom;
    let out = '';
    for (const [id, spots] of parking.spots) {
      const s = world.structures.get(id);
      if (!s) continue;
      for (const [x, y, angle = 0] of spots.slice(0, parking.count(s))) {
        const [sx, sy] = this.project(x, y, close ? 0 : 0.02);
        if (close) {
          const { name, hand } = modelFor(`${id}:${r2(x)}:${r2(y)}`);
          out += `<g class="parked-car" transform="translate(${r2(sx)} ${r2(sy)})">${vehicleSVG(this.camera, name, headingIndex(angle), hand)}</g>`;
        } else {
          out += `<rect class="parked" x="${r2(sx - r)}" y="${r2(sy - r)}" width="${2 * r}" height="${2 * r}"/>`;
        }
      }
    }
    this.layers.parked.innerHTML = out;
  }

  // Where and how a structure's surroundings are drawn, or null.
  // Local frame: door dot at (0, 0), road towards -y (see structures/yards.js).
  // Without a road they face the building's footpath, or else its front as
  // placed, and leave out the car park (yardOf).
  yardFrame(s) {
    const { world } = this;
    const nodes = world.nodesOf(s);
    const def = STRUCTURE_TYPES[s.type];
    const front = world.frontFor(nodes) ?? this.placedFront(s, nodes);
    if (front.road < 0 && def.access !== 'any') return null; // stations, industry: only towards a road
    const style = yardOf(def, s, { cars: front.road >= 0 });
    if (!style) return null;

    const [fx, fy] = front.dir;
    const rotation = fx === 1 ? 1 : fx === -1 ? 3 : fy === 1 ? 2 : 0;
    const [dx, dy] = world.grid.xy(front.door);

    // How deep the yard can be: right up to a road, less if the dot in
    // front is open ground, none if something else is there.
    const ahead = world.grid.offset(front.door, fx, fy);
    if (ahead < 0) return null;
    let y0;
    if (world.hasRoad(ahead)) y0 = -0.86;
    else if (!world.structureAt(ahead) && !world.terrain.isWater(ahead)) y0 = -0.62;
    else return null;

    // Width: all footprint dots in the door's row, along the road.
    const xs = world.nodesOf(s)
      .map((n) => { const [x, y] = world.grid.xy(n); return rotateQuarter(x - dx, y - dy, -rotation); })
      .filter(([, ly]) => ly === 0)
      .map(([lx]) => lx);

    return {
      style,
      origin: [dx, dy],
      rotation,
      x0: Math.min(...xs) - 0.45,
      x1: Math.max(...xs) + 0.45,
      y0,
      y1: -0.34,
    };
  }

  // Front of a structure with neither road nor footpath: its local -y as
  // placed, the door in the middle of that row.
  placedFront(s, nodes) {
    const { world } = this;
    const dir = rotateQuarter(0, -1, world.facingRotation(s.type, s.node, s.rotation));
    const row = nodes.filter((n) => !nodes.includes(world.grid.offset(n, dir[0], dir[1])));
    return { door: row[Math.floor(row.length / 2)], dir, road: -1 };
  }

  // Ground rectangle of an object in view-aligned axes (both grow towards the viewer).
  viewBounds(points, pad) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of points) {
      const [rx, ry] = this.camera.rotated(x, y);
      minX = Math.min(minX, rx - pad);
      maxX = Math.max(maxX, rx + pad);
      minY = Math.min(minY, ry - pad);
      maxY = Math.max(maxY, ry + pad);
    }
    return { minX, maxX, minY, maxY };
  }

  // Trains: a filled square per carriage, coupled by a line; lowered
  // barriers across roads at closed level crossings. Carriages beyond
  // where the exits fade out are left out.
  renderTrains() {
    const bars = this.pathData(this.trains.barriers());
    if (bars !== this.lastBarriers) {
      this.lastBarriers = bars;
      this.barrierEl ??= this.layers.trains.appendChild(document.createElementNS(SVGNS, 'path'));
      this.barrierEl.setAttribute('class', 'barrier');
      this.barrierEl.setAttribute('d', bars);
    }
    const { grid } = this.world;
    const m = 1.9;
    const onMap = ([x, y]) => x > -m && y > -m && x < grid.width - 1 + m && y < grid.height - 1 + m;
    const seen = new Set();
    for (const t of this.trains.visible()) {
      seen.add(t.id);
      let el = this.trainEls.get(t.id);
      if (!el) {
        el = document.createElementNS(SVGNS, 'g');
        el.setAttribute('class', 'train');
        this.layers.trains.appendChild(el);
        this.trainEls.set(t.id, el);
      }
      this.placeTrain(el, t.points.map((p, i) => ({ i, p })).filter(({ p }) => onMap(p)));
    }
    for (const [id, el] of this.trainEls) {
      if (!seen.has(id)) {
        el.remove();
        this.trainEls.delete(id);
      }
    }
  }

  // People and vehicles grow out of the building they leave and shrink back
  // into the one they reach (a car parking, a walker getting into a car…).
  renderAgents() {
    const seen = new Set();
    const now = performance.now();
    const pop = drawEnabled() && this.agentsShown;
    for (const a of this.agents.visible()) {
      seen.add(a.id);
      const kind = a.truck ? 'truck' : a.trip.mode === 'drive' ? 'car' : a.trip.mode === 'cycle' ? 'cyclist' : 'walker';
      let el = this.agentEls.get(a.id);
      if (el && el.dataset.kind !== kind) {
        this.agentGone(el, now, pop);
        el = null;
      }
      if (!el) {
        el = agentShape(kind, a.id);
        el.born = pop ? now : -Infinity;
        this.layers.agents.appendChild(el);
        this.agentEls.set(a.id, el);
      }
      const k = growScale(now - el.born);
      if (kind === 'truck') {
        this.placeTruck(el, a);
        scaleAgent(el, k);
        continue;
      }
      const [wx, wy] = wobble(a.x, a.y); // on the swaying road
      const [sx, sy] = this.project(a.x + wx, a.y + wy, 0.04);
      if (kind === 'car') this.placeCar(el, a);
      // facing left: mirrored
      const mirror = kind !== 'car' && this.placePerson(el, a, kind, sx);
      el.at0 = `translate(${r2(sx)} ${r2(sy)})${mirror ? ' scale(-1 1)' : ''}`;
      scaleAgent(el, k);
    }
    for (const [id, el] of this.agentEls) {
      if (!seen.has(id)) {
        this.agentGone(el, now, pop);
        this.agentEls.delete(id);
      }
    }
    for (const el of this.agentGhosts) {
      const k = shrinkScale(now - el.gone);
      if (k > 0) scaleAgent(el, k);
      else {
        el.remove();
        this.agentGhosts.delete(el);
      }
    }
    this.agentsShown = true;
  }

  agentGone(el, now, pop) {
    if (!pop) return el.remove();
    el.gone = now;
    this.agentGhosts.add(el);
  }

  // A train: close up a locomotive and coaches (src/render/vehicles.js),
  // each turned along the track and drawn back to front, further out a line
  // of square dots. `cars`: [{ i (index in the train), p: [x, y, dx, dy] }].
  placeTrain(el, cars) {
    const cam = this.camera;
    if (cam.zoom < VEHICLES.minZoom) {
      if (el.dataset.key !== 'dot') {
        el.dataset.key = 'dot';
        el.innerHTML = '<path/>';
      }
      const r = THEME.carriageRadius;
      const pts = cars.map(({ p: [x, y] }) => this.project(x, y, 0.04));
      let d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${r2(x)} ${r2(y)}`).join('');
      for (const [x, y] of pts) d += rect(x - r, y - r, 2 * r, 2 * r);
      el.firstChild.setAttribute('d', d);
      return;
    }
    const len = r2(this.config.trains.carSpacing - 0.02);
    const order = cars
      .map(({ i, p: [x, y, dx, dy] }) => ({ i, x, y, h: headingIndex(Math.atan2(dy, dx)), depth: cam.depth(x, y) }))
      .sort((a, b) => a.depth - b.depth);
    const key = `${cam.rotation}|${order.map((c) => `${c.i}:${c.h}`).join(',')}`;
    if (el.dataset.key !== key) {
      el.dataset.key = key;
      el.innerHTML = order.map((c) => `<g>${vehicleSVG(cam, `${c.i ? 'coach' : 'loco'}:${len}`, c.h, c.i % VEHICLES.hands)}</g>`).join('');
    }
    order.forEach((c, k) => {
      const [sx, sy] = this.project(c.x, c.y, 0);
      el.children[k].setAttribute('transform', `translate(${r2(sx)} ${r2(sy)})`);
    });
  }

  // A truck: close up a cab and a trailer (src/render/vehicles.js), the cab
  // facing the way it moves, the trailer towards the cab, so the truck bends
  // at corners; further out two square dots coupled like carriages.
  placeTruck(el, a) {
    const cam = this.camera;
    const [wx, wy] = wobble(a.x, a.y), [vx, vy] = wobble(a.tx, a.ty); // on the swaying road
    const cab = [a.x + wx, a.y + wy], trailer = [a.tx + vx, a.ty + vy];
    const [sx, sy] = this.project(...cab, 0.04), [tx, ty] = this.project(...trailer, 0.04);
    const pull = Math.hypot(cab[0] - trailer[0], cab[1] - trailer[1]) > 1e-4 ? headingIndex(Math.atan2(cab[1] - trailer[1], cab[0] - trailer[0])) : null;
    if (el.at) {
      const dx = a.x - el.at[0], dy = a.y - el.at[1];
      if (dx * dx + dy * dy > 1e-8) el.heading = headingIndex(Math.atan2(dy, dx));
    }
    el.at = [a.x, a.y];
    if (cam.zoom < VEHICLES.minZoom) {
      if (el.dataset.key !== 'dot') {
        el.dataset.key = 'dot';
        el.innerHTML = '<path/>';
      }
      const r = THEME.truckRadius;
      el.firstChild.setAttribute('d', `M${r2(sx)} ${r2(sy)}L${r2(tx)} ${r2(ty)}` + rect(sx - r, sy - r, 2 * r, 2 * r) + rect(tx - r, ty - r, 2 * r, 2 * r));
      return;
    }
    const cabH = el.heading ?? pull ?? 0, trailerH = pull ?? cabH;
    const hand = (el.model ??= modelFor(a.id)).hand;
    const cabFirst = cam.depth(...cab) < cam.depth(...trailer); // the one further back first
    const key = `${cam.rotation}|${cabH}|${trailerH}|${cabFirst}`;
    if (el.dataset.key !== key) {
      el.dataset.key = key;
      const parts = [`<g>${vehicleSVG(cam, 'cab', cabH, hand)}</g>`, `<g>${vehicleSVG(cam, 'trailer', trailerH, hand)}</g>`];
      el.innerHTML = cabFirst ? parts.join('') : parts.reverse().join('');
    }
    const [c, t] = cabFirst ? el.children : [el.children[1], el.children[0]];
    c.at0 = `translate(${r2(sx)} ${r2(sy)})`; // set by scaleAgent
    t.at0 = `translate(${r2(tx)} ${r2(ty)})`;
  }

  // Fill a walker's or cyclist's group: close up a pen figure
  // (src/render/people.js), further out a plain mark. Returns whether it
  // should be mirrored (walking to the left of the screen). `sx`: its screen x.
  placePerson(el, a, kind, sx) {
    const cam = this.camera;
    if (el.at) {
      const dx = a.x - el.at[0], dy = a.y - el.at[1];
      if (dx * dx + dy * dy > 1e-8) el.heading = headingIndex(Math.atan2(dy, dx));
      if (Math.abs(sx - el.sx) > 1e-3) el.left = sx < el.sx;
    }
    el.at = [a.x, a.y];
    el.sx = sx;
    const close = cam.zoom >= VEHICLES.minZoom;
    const body = (el.body ??= bodyFor(a.id));
    const heading = el.heading ?? 0;
    const key = !close ? 'dot' : kind === 'cyclist' ? `c${body}|${heading}|${cam.rotation}` : `w${body}`;
    if (el.dataset.key !== key) {
      el.dataset.key = key;
      el.innerHTML = !close ? `<path d="${personMark(kind, a.id)}"/>`
        : kind === 'cyclist' ? cyclistSVG(cam, heading, body) : walkerSVG(body);
    }
    // cyclists' wheels already follow the way they ride
    return close && kind === 'walker' && !!el.left;
  }

  // Fill a car's group: close up a model (src/render/vehicles.js) facing the
  // way it last moved, further out a square dot. Redrawn only when that changes.
  placeCar(el, a) {
    if (el.at) {
      const dx = a.x - el.at[0], dy = a.y - el.at[1];
      if (dx * dx + dy * dy > 1e-8) el.heading = headingIndex(Math.atan2(dy, dx));
    }
    el.at = [a.x, a.y];
    const close = this.camera.zoom >= VEHICLES.minZoom;
    const model = (el.model ??= modelFor(a.id));
    const heading = el.heading ?? 0;
    const key = close ? `${model.name}|${heading}|${this.camera.rotation}` : 'dot';
    if (el.dataset.key === key) return;
    el.dataset.key = key;
    const r = THEME.agentRadius;
    el.innerHTML = close ? vehicleSVG(this.camera, model.name, heading, model.hand) : `<path d="${rect(-r, -r, 2 * r, 2 * r)}"/>`;
  }
}

// Moving dots, each drawn around its origin: cars are squares, pedestrians
// an upright half-width rectangle standing on it, cyclists a small triangle
// – drawn by hand, so each one's corners sit a little differently (from the
// agent's id).
// Place an agent's group at its spot (`at0`, set by renderAgents / placeTruck)
// at size k, scaled about its foot. A truck far out is one absolute path and
// fades instead.
function scaleAgent(el, k) {
  const s = k === 1 ? '' : ` scale(${Math.max(0, k).toFixed(3)})`;
  if (el.dataset.kind !== 'truck') return el.setAttribute('transform', el.at0 + s);
  const dot = el.dataset.key === 'dot';
  const opacity = dot && k < 1 ? Math.max(0, k).toFixed(3) : ''; // cleared when zoomed in mid-way
  if (el.style.opacity !== opacity) el.style.opacity = opacity;
  if (!dot) for (const c of el.children) if (c.at0) c.setAttribute('transform', c.at0 + s);
}

const rect = (x, y, w, h) => `M${r2(x)} ${r2(y)}h${r2(w)}v${r2(h)}h${r2(-w)}z`;

function triangle(r, id) {
  const j = (k) => (((Math.imul(id + 1, 0x9e3779b1) >>> (k * 5)) & 31) / 31 - 0.5) * r * 0.35;
  const pts = [[j(0), -r * 1.15 + j(1)], [r + j(2), r * 0.75 + j(3)], [-r + j(4), r * 0.75 + j(5)]];
  return `M${pts.map(([x, y]) => `${r2(x)} ${r2(y)}`).join('L')}z`;
}

export function agentShape(kind, id = 0) {
  // a group, filled with a mark, a figure or a model by renderAgents
  const el = document.createElementNS(SVGNS, 'g');
  el.dataset.kind = kind;
  el.setAttribute('class', `agent ${kind}`);
  if (kind === 'walker' || kind === 'cyclist') el.innerHTML = `<path d="${personMark(kind, id)}"/>`;
  return el;
}

// The plain mark for a walker (upright rectangle) or cyclist (triangle).
function personMark(kind, id) {
  const r = kind === 'cyclist' ? THEME.cyclistRadius : THEME.walkerRadius;
  return kind === 'cyclist' ? triangle(r * 1.2, id) : rect(-r / 2, -2 * r, r, 2 * r);
}

// Painter's-algorithm order for objects with rectangular ground areas of any
// size. A is behind B when A lies entirely on the far side of B along either
// view axis. Only pairs that overlap on screen matter; the rest keep a rough
// back-to-front order. Resolved with a depth-first topological sort.
function isoSort(items) {
  for (const it of items) {
    it.key = it.minX + it.maxX + it.minY + it.maxY;
    it.left = it.minX - it.maxY;   // horizontal screen extent (in view units)
    it.right = it.maxX - it.minY;
    it.behind = [];
  }
  items.sort((a, b) => a.key - b.key);

  // Only pairs overlapping horizontally on screen can conflict: sweep over
  // items sorted by their left edge.
  const byLeft = items.slice().sort((a, b) => a.left - b.left);
  for (let i = 0; i < byLeft.length; i++) {
    const a = byLeft[i];
    for (let j = i + 1; j < byLeft.length && byLeft[j].left < a.right; j++) {
      const b = byLeft[j];
      if (a.maxX <= b.minX || a.maxY <= b.minY) b.behind.push(a);
      else if (b.maxX <= a.minX || b.maxY <= a.minY) a.behind.push(b);
    }
  }

  const out = [];
  const state = new Map(); // 1 = visiting, 2 = done
  const visit = (it) => {
    if (state.has(it)) return;
    state.set(it, 1);
    for (const b of it.behind) visit(b);
    state.set(it, 2);
    out.push(it);
  };
  items.forEach(visit);
  return out;
}
