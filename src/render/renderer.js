// SVG renderer. The scene is split into layers, each rebuilt only when the
// world events that affect it fire. Layer order (back to front):
//
//   terrain  – water hatching (later: contour lines, fields, shorelines)
//   frame    – map border with coordinate ticks (style option)
//   grid     – the main dots
//   subgrid  – the dense footpath dots (only visible while drawing footpaths)
//   lots     – flat ground drawing of structures and their surroundings
//              (lawns, paving, parking lines); built together with objects
//   markers  – ground indicators (unconnected buildings…)
//   paths    – footpaths
//   roads    – roads + driveways (for buildings without surroundings)
//   parked   – parked cars (hollow dots) in parking lots
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
// Detail levels: the <svg> gets class lod-0/1/2 from the zoom, and CSS hides
// elements tagged d1 / d2 (see Painter).

import { THEME } from '../theme.js';
import { Painter } from './painter.js';
import { networkPolylines } from '../roads/geometry.js';
import { STRUCTURE_TYPES, levelOf, drawSeed, yardOf } from '../../structures/index.js';
import { YARDS } from '../../structures/yards.js';
import { drawPlot } from '../../structures/plots.js';
import { rotateQuarter } from '../core/grid.js';
import { pointInPolygon } from '../core/geom2d.js';
import { fitYard, fitSite, freeTest } from './lots.js';
import { densify } from './warp.js';
import { FEATURE_TYPES } from '../../features/index.js';

const LAYERS = ['terrain', 'frame', 'grid', 'subgrid', 'lots', 'markers', 'paths', 'roads', 'parked', 'agents', 'objects', 'overlay'];
const SVGNS = 'http://www.w3.org/2000/svg';
const r2 = (n) => Math.round(n * 100) / 100;

// Half-size of a building's ground area around each of its dots.
const STRUCTURE_PAD = 0.45;
const FEATURE_PAD = 0.12;

export class Renderer {
  constructor(svg, { world, camera, agents, parking, style, config }) {
    this.svg = svg;
    this.style = style;
    this.parking = parking;
    this.world = world;
    this.camera = camera;
    this.agents = agents;
    this.config = config;
    this.agentEls = new Map();
    this.lastOverlay = null;
    this.objs = new Map();       // key ('s12' / 'f7') -> { g, lg, bounds }
    this.objsDirty = new Set();  // keys to redraw
    this.objsAll = true;         // redraw every object
    this.order = [];
    this.lodLevel = -1;

    svg.innerHTML = `
      <defs>
        <pattern id="hatch-water" patternUnits="userSpaceOnUse" width="10" height="5">
          <line class="hatch" x1="0" y1="2.5" x2="10" y2="2.5"/>
        </pattern>
        <filter id="glow" x="-200%" y="-200%" width="500%" height="500%">
          <feGaussianBlur stdDeviation="1.6" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <g class="scene">${LAYERS.map((l) => `<g class="layer-${l}${l === 'overlay' ? ' overlay' : ''}"></g>`).join('')}</g>`;
    this.scene = svg.querySelector('.scene');
    this.layers = Object.fromEntries(LAYERS.map((l) => [l, svg.querySelector(`.layer-${l}`)]));

    this.dirty = new Set();
    this.invalidate();

    const on = (type, ...layers) => world.events.on(type, () => layers.forEach((l) => this.dirty.add(l)));
    const near = (s) => this.touchAround(world.nodesOf(s).map((n) => world.grid.xy(n)));
    for (const type of ['structure:added', 'structure:removed', 'structure:changed']) {
      on(type, 'markers', 'roads');
      world.events.on(type, (s) => {
        this.objsDirty.add(`s${s.id}`);
        near(s); // neighbours' plots, sites and yards depend on it
      });
    }
    for (const type of ['feature:added', 'feature:removed']) world.events.on(type, (f) => this.objsDirty.add(`f${f.id}`));
    on('roads:changed', 'roads', 'markers');
    on('paths:changed', 'paths', 'markers');
    for (const type of ['roads:changed', 'paths:changed']) {
      world.events.on(type, (e) => {
        if (e?.nodes) this.touchAround(e.nodes.map((n) => e.layer.pos(n)), 2); // curves reach further
        else this.objsAll = true;
      });
    }
    on('parking:changed', 'parked');
    on('terrain:changed', 'terrain', 'grid', 'subgrid', 'paths', 'roads', 'markers');
    world.events.on('terrain:changed', () => (this.objsAll = true));
  }

  // Rebuild everything (e.g. after a camera rotation).
  invalidate() {
    for (const l of LAYERS) if (l !== 'agents' && l !== 'overlay' && l !== 'objects' && l !== 'lots') this.dirty.add(l);
    this.objsAll = true;
    this.lastOverlay = null;
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
    this.scene.setAttribute('transform', this.camera.transform);
    this.updateLod();
    // anything static about to change? (parked cars are drawn live in pixel mode)
    const changed = [...this.dirty].some((l) => l !== 'parked') || this.objsAll || this.objsDirty.size > 0;
    for (const layer of this.dirty) this[`render${layer[0].toUpperCase()}${layer.slice(1)}`]?.();
    this.dirty.clear();
    if (this.objsAll || this.objsDirty.size) this.renderObjects();
    if (changed) this.version = (this.version ?? 0) + 1;
    this.renderAgents();
    if (overlaySVG !== this.lastOverlay) {
      this.layers.overlay.innerHTML = overlaySVG;
      this.lastOverlay = overlaySVG;
    }
  }

  project(x, y, z = 0) {
    return this.camera.project(x, y, this.world.terrain.heightAt(x, y) + z);
  }

  pathData(lines) {
    // under a map warp, long straight pieces get extra points so they bend too
    if (this.camera.warp) lines = lines.map((pts) => densify(pts));
    return lines.map((pts) => pts.map(([x, y], i) => {
      const [sx, sy] = this.project(x, y);
      return `${i ? 'L' : 'M'}${r2(sx)} ${r2(sy)}`;
    }).join('')).join('');
  }

  groundEllipse(x, y, r, cls) {
    const [sx, sy] = this.project(x, y);
    const [rx, ry] = this.camera.groundEllipse(r);
    return `<ellipse class="${cls}" cx="${r2(sx)}" cy="${r2(sy)}" rx="${r2(rx)}" ry="${r2(ry)}"/>`;
  }

  // ----- layers -----

  renderTerrain() {
    const { grid, terrain } = this.world;
    let out = '';
    for (let i = 0; i < grid.size; i++) {
      if (terrain.isWater(i)) out += this.groundEllipse(...grid.xy(i), 0.72, 'water');
    }
    this.layers.terrain.innerHTML = out;
  }

  renderFrame() {
    if (!this.style?.get('frame')) {
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
    label(x0 + 1.2, y0 - 0.9, `MAP-${(seed % 46656).toString(36).toUpperCase().padStart(3, '0')}`);
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

  renderPaths() {
    const d = this.pathData(networkPolylines(this.world.networks.path, this.config.path));
    this.layers.paths.innerHTML = d ? `<path class="footpath" d="${d}"/>` : '';
  }

  renderRoads() {
    const { world } = this;
    const roads = this.pathData(networkPolylines(world.networks.road, this.config.road));

    // Driveways: from the building edge at its door to the road dot.
    const drives = [];
    for (const s of world.structures.values()) {
      if (this.yardFrame(s) || STRUCTURE_TYPES[s.type]?.site) continue; // these reach the road themselves
      const access = world.accessInfo(s);
      if (!access) continue;
      const [dx, dy] = world.grid.xy(access.door);
      const [rx, ry] = world.grid.xy(access.road);
      const len = Math.hypot(rx - dx, ry - dy);
      const t = STRUCTURE_PAD / len;
      drives.push([[dx + (rx - dx) * t, dy + (ry - dy) * t], [rx, ry]]);
    }
    const driveways = this.pathData(drives);

    // Map exits: the road carries on past the edge, then fades out in dashes.
    const solid = [], fade = [];
    for (const { node, dir: [dx, dy] } of world.roadExits()) {
      const [x, y] = world.grid.xy(node);
      solid.push([[x, y], [x + dx * 0.8, y + dy * 0.8]]);
      fade.push([[x + dx * 0.8, y + dy * 0.8], [x + dx * 1.9, y + dy * 1.9]]);
    }
    const exits = this.pathData(solid);
    const fades = this.pathData(fade);

    this.layers.roads.innerHTML =
      (driveways ? `<path class="driveway" d="${driveways}"/>` : '') +
      (roads ? `<path class="road" d="${roads}${exits}"/>` : '') +
      (fades ? `<path class="road-exit" d="${fades}"/>` : '');
  }

  updateLod() {
    const { medium, far } = this.config.render.lod;
    const z = this.camera.zoom;
    const level = z >= medium ? 0 : z >= far ? 1 : 2;
    if (level === this.lodLevel) return;
    this.svg.classList.remove(`lod-${this.lodLevel}`);
    this.svg.classList.add(`lod-${level}`);
    this.lodLevel = level;
  }

  renderObjects() {
    const { world } = this;
    let keys = this.objsDirty;
    if (this.objsAll) {
      keys = new Set(this.objs.keys());
      for (const id of world.structures.keys()) keys.add(`s${id}`);
      for (const id of world.features.keys()) keys.add(`f${id}`);
    }
    this.free = freeTest(world, this.config);

    let orderChanged = false;
    for (const key of keys) {
      const id = Number(key.slice(1));
      const built = key[0] === 's' ? this.buildStructure(world.structures.get(id)) : this.buildFeature(world.features.get(id));
      let entry = this.objs.get(key);
      if (!built) {
        if (entry) {
          entry.g.remove();
          entry.lg.remove();
          this.objs.delete(key);
          orderChanged = true;
        }
        if (key[0] === 's') this.parking.spots.delete(id);
        continue;
      }
      if (!entry) {
        entry = { key, g: document.createElementNS(SVGNS, 'g'), lg: document.createElementNS(SVGNS, 'g') };
        this.layers.lots.appendChild(entry.lg);
        this.objs.set(key, entry);
        orderChanged = true;
      }
      entry.g.innerHTML = built.svg;
      entry.lg.innerHTML = built.ground;
      const b = built.bounds;
      if (!entry.bounds || ['minX', 'maxX', 'minY', 'maxY'].some((k) => entry.bounds[k] !== b[k])) orderChanged = true;
      entry.bounds = b;
    }
    this.objsDirty = new Set();
    this.objsAll = false;

    if (orderChanged) {
      const order = isoSort([...this.objs.values()].map((e) => ({ ...e.bounds, entry: e }))).map((i) => i.entry);
      const same = order.length === this.order.length && order.every((e, i) => e === this.order[i]);
      if (!same) for (const e of order) this.layers.objects.appendChild(e.g);
      this.order = order;
    }
    this.renderParked();
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
    const painter = new Painter(camera, { x, y, z: world.terrain.heightAt(x, y) });
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
    const points = world.nodesOf(s).map((n) => world.grid.xy(n));
    if (def.site) {
      const site = world.siteArea(s.type, s.node, s.rotation);
      painter.setSite(fitSite(world, this.config, site));
      painter.setSitePaths(world.sitePaths(s));
      const [x0, y0, x1, y1] = site.rect;
      points.push([x0 + STRUCTURE_PAD, y0 + STRUCTURE_PAD], [x1 - STRUCTURE_PAD, y1 - STRUCTURE_PAD]);
    }
    levelOf(def, s).draw(painter, s);
    const core = painter.bounds;

    // Front yard between the building and its road.
    const frame = this.yardFrame(s);
    const yard = frame && fitYard(world, this.config, frame);
    let yardWorld = null;
    if (yard) {
      const [dx, dy] = yard.origin;
      const yp = this.attachFree(new Painter(camera, { x: dx, y: dy, z: world.terrain.heightAt(dx, dy) }, yard.rotation, drawSeed(s) ^ 0x5bd1e995));
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
    let out = '';
    for (const [id, spots] of parking.spots) {
      const s = world.structures.get(id);
      if (!s) continue;
      for (const [x, y] of spots.slice(0, parking.count(s))) {
        const [sx, sy] = this.project(x, y, 0.02);
        out += `<circle class="parked" cx="${r2(sx)}" cy="${r2(sy)}" r="${r}"/>`;
      }
    }
    this.layers.parked.innerHTML = out;
  }

  // Where and how a structure's surroundings are drawn, or null.
  // Local frame: door dot at (0, 0), road towards -y (see structures/yards.js).
  yardFrame(s) {
    const { world } = this;
    const style = yardOf(STRUCTURE_TYPES[s.type], s);
    if (!style) return null;
    const access = world.accessInfo(s);
    if (!access) return null;

    const [dx, dy] = world.grid.xy(access.door);
    const [rx, ry] = world.grid.xy(access.road);
    const ox = Math.sign(rx - dx);
    const oy = Math.sign(ry - dy);
    const [fx, fy] = ox !== 0 ? [ox, 0] : [0, oy];
    const rotation = fx === 1 ? 1 : fx === -1 ? 3 : fy === 1 ? 2 : 0;

    // How deep the yard can be: right up to a road, less if the dot in
    // front is open ground, none if something else is there.
    const front = world.grid.offset(access.door, fx, fy);
    if (front < 0) return null;
    let y0;
    if (world.hasRoad(front)) y0 = -0.86;
    else if (!world.structureAt(front) && !world.terrain.isWater(front)) y0 = -0.62;
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

  renderAgents() {
    const seen = new Set();
    for (const a of this.agents.visible()) {
      seen.add(a.id);
      let el = this.agentEls.get(a.id);
      if (!el) {
        el = document.createElementNS(SVGNS, 'circle');
        this.layers.agents.appendChild(el);
        this.agentEls.set(a.id, el);
      }
      const onFoot = a.trip.mode !== 'drive';
      if (el.dataset.mode !== a.trip.mode) {
        el.dataset.mode = a.trip.mode;
        el.setAttribute('class', `agent ${onFoot ? 'walker' : 'car'}`);
        el.setAttribute('r', onFoot ? THEME.walkerRadius : THEME.agentRadius);
      }
      const [sx, sy] = this.project(a.x, a.y, 0.04);
      el.setAttribute('cx', r2(sx));
      el.setAttribute('cy', r2(sy));
    }
    for (const [id, el] of this.agentEls) {
      if (!seen.has(id)) {
        el.remove();
        this.agentEls.delete(id);
      }
    }
  }
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
