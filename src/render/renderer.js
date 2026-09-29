// SVG renderer. The scene is split into layers, each rebuilt only when the
// world events that affect it fire. Layer order (back to front):
//
//   terrain  – contour lines (grey, index lines labelled; only while
//              `contours` is on) and water hatching; in its own
//              <svg id="ground"> underneath the map
//   grid     – the main dots (shown while building, see styles.css)
//   frame    – map border with coordinate ticks (STYLE.frame)
//   meadow   – grass and wild flowers on open ground (meadow.js), in
//              chunks rebuilt near a change and culled with the view
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
//   objects  – structures, features and street lamps, depth sorted together
//   overlay  – tool previews, hover
//
// To add a layer: add its name to LAYERS, write render<Name>(), and mark it
// dirty from the events that should refresh it.
//
// Objects (and their ground drawing in `lots`) are kept per structure /
// feature / street segment (its lamp): a change redraws only the objects
// near it, then re-sorts. Keys: 's12' structure, 'f7' feature, 'k3-4'
// the street from road dot 3 to 4.
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
import { VEHICLES, vehicleSVG, modelFor, truckFor, headingIndex } from './vehicles.js';
import { bodyFor, walkerSVG, cyclistSVG } from './people.js';
import { drawIn, eraseOut, drawEnabled, DRAW, growScale, shrinkScale } from './draw.js';
import { chainEdges, edgeCurve, streetKerbPairs, railParts, roadEdges, roadway, keepRuns } from '../roads/geometry.js';
import { edgeKey } from '../roads/network.js';
import { InkLayer } from './ink.js';
import { AgentCanvas, AGENT_STYLES, shapesOf, shape } from './agentCanvas.js';
import { stationTracks } from '../../structures/station.js';
import { STRUCTURE_TYPES, levelOf, drawSeed, yardOf, joinSides, joinedRow, tiltOf } from '../../structures/index.js';
import { YARDS } from '../../structures/yards.js';
import { drawPlot } from '../../structures/plots.js';
import { rotateQuarter, ORTHO } from '../core/grid.js';
import { mulberry32 } from '../core/random.js';
import { pointInPolygon } from '../core/geom2d.js';
import { fitYard, fitSite, freeTest, pathIndex, railIndex } from './lots.js';
import { zebraCrossings, streetLamp, FURNITURE } from '../roads/furniture.js';
import { lamp } from '../../structures/kit.js';
import { networkPolylines } from '../roads/geometry.js';
import { SegmentIndex } from '../core/geom2d.js';
import { densify } from './warp.js';
import { FEATURE_TYPES } from '../../features/index.js';
import { ELEVATION, contours } from '../terrain/elevation.js';
import { findBridges, makeDeck, bridgeLines, hiddenUnder } from './bridges.js';
import { MEADOW, meadowGround, chunkSVG } from './meadow.js';

const LAYERS = ['terrain', 'frame', 'meadow', 'grid', 'subgrid', 'lots', 'markers', 'paths', 'rails', 'roads', 'parked', 'trains', 'agents', 'objects', 'overlay'];
const TOP = ['objects', 'overlay']; // in the #objects <svg>, see the constructor
const SVGNS = 'http://www.w3.org/2000/svg';
// Moving the camera (see placeView): ms it must rest before the map is
// redrawn, and how far past each window edge the map is drawn.
const VIEW_SETTLE = 150;
const OVERSCAN = 0.25;
const r2 = (n) => Math.round(n * 100) / 100;

// Contour lines drawn by hand (pencil()), per tier (index line, every
// other line, the rest): stroke lengths, the gap or overlap where the pen
// starts again, how far a stroke strays from the true line (grid units),
// and the share of strokes left out, so the minor lines read lighter.
const PENCIL = [
  { len: [3, 6], gap: [-0.12, 0.08], drift: 0.025, skip: 0 },
  { len: [1.5, 4], gap: [-0.1, 0.18], drift: 0.035, skip: 0.08 },
  { len: [1, 3], gap: [-0.08, 0.25], drift: 0.04, skip: 0.2 },
];

// A polyline (world) as pencil strokes: pieces of random length along it,
// each drifting a little to one side and back, with a small gap or overlap
// where the next one starts, some left out. Seeded by the line itself, so
// the same terrain always comes out the same.
function pencil(points, level, { len, gap, drift, skip }) {
  if (points.length < 2) return [];
  const rnd = mulberry32(Math.imul(level + 1, 0x9e3779b1) ^ Math.round(points[0][0] * 97) ^ Math.round(points[0][1] * 131));
  const range = ([a, b]) => a + rnd() * (b - a);
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  const total = cum[cum.length - 1];
  // point and unit normal at arc length s
  const at = (s) => {
    let lo = 1, hi = cum.length - 1; // first i with cum[i] >= s
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < s) lo = mid + 1; else hi = mid;
    }
    const i = lo;
    const [ax, ay] = points[i - 1], [bx, by] = points[i];
    const l = cum[i] - cum[i - 1] || 1, t = Math.min(1, Math.max(0, (s - cum[i - 1]) / l));
    return [ax + (bx - ax) * t, ay + (by - ay) * t, -(by - ay) / l, (bx - ax) / l];
  };
  const out = [];
  let s = rnd() * len[0] * 0.5;
  while (s < total) {
    const e = Math.min(total, s + range(len));
    if (rnd() >= skip) {
      // a stroke: off the line by d0 at its start, d1 at its end, bowing between
      const d0 = (rnd() - 0.5) * 2 * drift, d1 = (rnd() - 0.5) * 2 * drift, bow = (rnd() - 0.5) * 2 * drift;
      const n = Math.max(2, Math.ceil((e - s) / 0.2));
      const stroke = [];
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const [x, y, nx, ny] = at(s + (e - s) * t);
        const d = d0 + (d1 - d0) * t + bow * Math.sin(Math.PI * t);
        stroke.push([x + nx * d, y + ny * d]);
      }
      out.push(stroke);
    }
    s = e + range(gap);
  }
  return out;
}

// Lakes (Renderer.renderWater): the furthest the shore reaches from a water
// dot (under 1, so dry dots stay dry) and how softly neighbouring dots'
// reach blends (higher = less), metres of elevation counted as one grid
// step of depth, the sampling step; `wave`: the two short strokes in the
// middle of a lake – shown from this far from the shore in, this long per
// grid unit of it (at most `max`), this far apart (grid units).
const WATER = { radius: 0.75, soft: 5, metres: 6, step: 0.08, wave: { from: 0.45, length: 0.7, max: 1.6, gap: 0.09 } };

// Short code for a map, shown in the frame corner and the stats box.
// a, b, … z, aa, ab, … – a chessboard's files, for maps wider than eight
const fileName = (i) => (i >= 26 ? fileName(Math.floor(i / 26) - 1) : '') + String.fromCharCode(97 + (i % 26));

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
    // Buildings, trees and the overlay sit in their own <svg> on top, in
    // their own wrapper (#view-top), over the canvas with the moving people
    // and trains (agentCanvas.js). See styles.css.
    this.top = document.getElementById('objects');
    this.wrappers = [svg.parentNode, this.top.parentNode];
    this.pen = new AgentCanvas(document.getElementById('agents'));
    // over the buildings: carriages nothing nearer could hide (see screened)
    this.penTop = new AgentCanvas(document.getElementById('trains-top'));
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
    this.cullOn = true;     // hide objects outside the view (cull)
    this.contours = STYLE.contours;
    this.meadow = new Map();        // chunk key 'cx,cy' -> { g, box, svg, shown }
    this.meadowDirty = new Set();   // chunk keys to rebuild

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
    // hover rings and tags on their way out, over the overlay (see letGo)
    this.leaving = this.layers.overlay.parentNode.appendChild(document.createElementNS(SVGNS, 'g'));
    this.leaving.setAttribute('class', 'overlay leaving');
    this.ink = {
      roads: new InkLayer(this.layers.roads, ['driveway', 'road', 'kerb', 'zebra', 'road-exit', 'bridge', 'bridge-post']),
      paths: new InkLayer(this.layers.paths, ['footpath', 'bridge', 'bridge-post']),
      rails: new InkLayer(this.layers.rails, ['rail-exit', 'rail-buffer', 'rail', 'rail-dash', 'bridge', 'bridge-post']),
    };
    this.buildOrder = new Map(); // network layer -> Map dot -> its place in the last build, for the pen

    this.dirty = new Set();
    this.parkedEls = new Map(); // structure id -> { g, html }, its parked cars
    this.parkedDirty = new Set(); // structure ids whose cars changed
    this.invalidate();

    const on = (type, ...layers) => world.events.on(type, () => layers.forEach((l) => this.dirty.add(l)));
    const near = (s) => this.touchAround(world.nodesOf(s).map((n) => world.grid.xy(n)));
    for (const type of ['structure:added', 'structure:removed', 'structure:changed']) {
      on(type, 'markers', 'roads', 'rails'); // stations draw tracks with the rails
      world.events.on(type, (s) => {
        this.objsDirty.add(`s${s.id}`);
        near(s); // neighbours' plots, sites and yards depend on it
        this.touchMeadow(world.nodesOf(s).map((n) => world.grid.xy(n)));
      });
    }
    for (const type of ['feature:added', 'feature:removed']) {
      world.events.on(type, (f) => {
        this.objsDirty.add(`f${f.id}`);
        this.touchMeadow([world.grid.xy(f.node)]);
      });
    }
    for (const k of ['s', 'f']) {
      const kind = k === 's' ? 'structure' : 'feature';
      world.events.on(`${kind}:added`, (o) => this.born.set(`${k}${o.id}`, null));
      world.events.on(`${kind}:removed`, (o) => this.dying.add(`${k}${o.id}`));
    }
    on('roads:changed', 'roads', 'markers');
    // street lamps: new streets get theirs drawn in, gone ones erased
    for (const type of ['roads:changed', 'paths:changed', 'rails:changed']) world.events.on(type, () => this.touchStreets());
    on('paths:changed', 'paths', 'markers');
    on('rails:changed', 'rails');
    for (const type of ['roads:changed', 'paths:changed']) world.events.on(type, () => (this.roadLines = null));
    // bridges come and go with the networks; the water breaks under them
    for (const type of ['roads:changed', 'paths:changed', 'rails:changed']) {
      world.events.on(type, () => {
        // (only when the bridges changed: the water is costly to draw)
        this.bridgeState();
        if (this.bridgeKey !== this.waterBridges) this.dirty.add('terrain');
      });
    }
    for (const type of ['roads:changed', 'paths:changed', 'rails:changed']) {
      world.events.on(type, (e) => {
        if (e?.nodes && e.layer) this.buildOrder.set(e.layer, new Map(e.nodes.map((n, i) => [n, i])));
        if (e?.nodes) {
          const points = e.nodes.map((n) => e.layer.pos(n));
          this.touchAround(points, 2); // curves reach further
          this.touchMeadow(points);
        } else {
          this.objsAll = this.worldAll = true;
          this.dirty.add('meadow');
        }
      });
    }
    // a car parking redraws only its own lot (renderParked)
    world.events.on('parking:changed', (s) => this.parkedDirty.add(s.id));
    on('terrain:changed', 'terrain', 'meadow', 'grid', 'subgrid', 'paths', 'rails', 'roads', 'markers');
    world.events.on('terrain:changed', () => {
      this.objsAll = this.worldAll = true; // (not just the view: draw them all now)
      this.roadLines = null;
      this.contourLines = null; // water breaks them
      this.waterLines = null;
    });
  }

  // Rebuild everything (e.g. after a camera rotation).
  invalidate() {
    this.roadLines = null; // drawn for the old view
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

  // Mark the meadow chunks within 2 dots of any of the world points for
  // rebuilding (curves, plots and yards reach that far).
  touchMeadow(points) {
    const c = MEADOW.chunk, r = 2;
    for (const [x, y] of points) {
      for (let cy = Math.floor((y - r) / c); cy <= Math.floor((y + r) / c); cy++) {
        for (let cx = Math.floor((x - r) / c); cx <= Math.floor((x + r) / c); cx++) this.meadowDirty.add(`${cx},${cy}`);
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
    if (this.meadowDirty.size) this.renderMeadow(this.meadowDirty);
    for (const ink of Object.values(this.ink)) if (ink.busy) ink.tick();
    if (this.parkedDirty.size) this.renderParked(this.parkedDirty);
    if (this.objsAll || this.objsDirty.size) this.renderObjects();
    if (this.ghosts.size) this.reapGhosts();
    if (this.showAgents) {
      this.pen.begin(this.camera);
      this.penTop.begin(this.camera);
      this.renderTrains(); // under the people and cars (or over everything)
      this.renderAgents();
    } else {
      this.agentsShown = false;
      this.pen.clear();
      this.penTop.clear();
      this.agentGhosts.clear();
      this.agentEls.clear();
      this.trainEls.clear();
    }
    if (overlaySVG !== this.lastOverlay) {
      this.letGo(overlaySVG);
      this.layers.overlay.innerHTML = overlaySVG;
      this.lastOverlay = overlaySVG;
      this.keepAnimating();
    }
  }

  // Hover rings and tags that the next overlay no longer has don't just
  // vanish: a ring is rubbed out from where the pen started, a tag fades.
  // They're moved out of the overlay, frozen where their entrance got to.
  letGo(nextSVG) {
    const next = new Set([...nextSVG.matchAll(/data-anim="([^"]*)"/g)].map((m) => m[1]));
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    for (const el of this.layers.overlay.querySelectorAll('[data-anim]')) {
      if (next.has(el.dataset.anim)) continue;
      const cs = getComputedStyle(el);
      const ring = el.classList.contains('hover');
      const len = parseFloat(cs.getPropertyValue('--len'));
      const from = ring ? parseFloat(cs.strokeDashoffset) : parseFloat(cs.opacity);
      if (still || (ring ? from >= len - 1 : from < 0.01)) continue; // never got drawn
      el.style.animation = 'none';
      this.leaving.appendChild(el);
      const frames = ring
        ? [{ strokeDashoffset: `${from}px` }, { strokeDashoffset: `${-len}px` }]
        : [{ opacity: from }, { opacity: 0 }];
      el.animate(frames, { duration: ring ? 220 : 150, easing: 'ease-in', fill: 'forwards' })
        .finished.then(() => el.remove(), () => el.remove());
    }
  }

  // The overlay is rebuilt whenever it changes (every frame of a pan), which
  // would restart its CSS animations. Anything marked data-anim picks up
  // where the element with the same key left off; a new key starts afresh.
  keepAnimating() {
    const now = document.timeline.currentTime;
    const starts = new Map();
    for (const el of this.layers.overlay.querySelectorAll('[data-anim]')) {
      const key = el.dataset.anim;
      const start = this.animStarts?.get(key) ?? starts.get(key) ?? now;
      starts.set(key, start);
      for (const a of el.getAnimations()) a.startTime = start;
    }
    this.animStarts = starts;
  }

  project(x, y, z = 0) {
    return this.camera.project(x, y, this.world.terrain.heightAt(x, y) + z);
  }

  // For what travels the networks: up on a bridge's deck where there is one.
  projectDeck(x, y, z = 0) {
    return this.project(x, y, z + this.bridgeState().deck(x, y));
  }

  // The bridges (render/bridges.js) with their deck, found again when a
  // network changes. { key, list, deck }.
  bridgeState() {
    const { networks, terrain } = this.world;
    const key = `${networks.road.version}|${networks.rail.version}|${networks.path.version}|${this.world.sidewalks.size}|${this.world.lanes.size}|${terrain.rivers.length}`;
    if (this.bridges?.key !== key) {
      const list = terrain.rivers.length ? findBridges(this.world) : [];
      this.bridges = { key, list, deck: makeDeck(list, this.camera.lift) };
      this.bridgeKey = list.map((b) => `${b.kind}${b.a}${b.b}`).join('|');
    }
    return this.bridges;
  }

  // A network's bridges as ink items (railings, piers, truss), with `add`
  // from inkItems().
  addBridges(kind, add) {
    const { list, deck } = this.bridgeState();
    list.filter((b) => b.kind === kind).forEach((b, i) => {
      bridgeLines(b, deck, (n) => this.camera.facing(n)).forEach(({ cls, line }, j) => add(`br${kind}${b.a}${b.b}.${j}`, cls, line));
    });
  }

  // `sway`: the line belongs to the road network and gets its hand-drawn
  // wobble (see wobble() in painter.js).
  pathData(lines, dense = true, sway = false) {
    return this.screenLines(lines, dense, sway).map((pts) => pts.map(([sx, sy], i) => `${i ? 'L' : 'M'}${r2(sx)} ${r2(sy)}`).join('')).join('');
  }

  // The same as lists of screen points.
  // `deck`: lift the lines onto bridge decks (the networks). Points given
  // as [x, y, z] keep their own height instead (bridge railings and piers).
  screenLines(lines, dense = true, sway = false, deck = false) {
    sway = sway && LOOK.roads > 0;
    const onDeck = deck ? this.bridgeState().deck : null;
    // under a warp or relief (or the sway), long straight pieces get extra points so they bend too
    if ((this.camera.warp || this.camera.lift || sway || onDeck) && dense) lines = lines.map((pts) => (pts[0]?.length > 2 ? pts : densify(pts)));
    if (this.camera.clip) lines = lines.flatMap((pts) => this.camera.clip(pts, false));
    return lines.map((pts) => pts.map(([x, y, z]) => {
      const lift = z ?? (onDeck ? onDeck(x, y) : 0);
      if (sway) {
        const [dx, dy] = wobble(x, y);
        [x, y] = [x + dx, y + dy];
      }
      return this.project(x, y, lift);
    }));
  }

  groundEllipse(x, y, r, cls) {
    const [sx, sy] = this.project(x, y);
    const [rx, ry] = this.camera.groundEllipse(r);
    return `<ellipse class="${cls}" cx="${r2(sx)}" cy="${r2(sy)}" rx="${r2(rx)}" ry="${r2(ry)}"/>`;
  }

  // ----- layers -----

  // The meadow, all chunks (the layer was marked dirty: a new view, new
  // terrain) or just `keys`. A chunk's markup is only swapped when it
  // changed, so rebuilding around a change touches little of the page.
  renderMeadow(keys = null) {
    const { world, camera } = this;
    const { width, height } = world.grid;
    const c = MEADOW.chunk;
    if (!keys) {
      keys = new Set();
      for (let cy = 0; cy * c < height; cy++) for (let cx = 0; cx * c < width; cx++) keys.add(`${cx},${cy}`);
    }
    const ground = meadowGround(world, this.config);
    const project = (x, y) => this.project(x, y);
    for (const key of keys) {
      const [cx, cy] = key.split(',').map(Number);
      if (cx < 0 || cy < 0 || cx * c >= width || cy * c >= height) continue;
      let chunk = this.meadow.get(key);
      if (!chunk) {
        chunk = { g: this.layers.meadow.appendChild(document.createElementNS(SVGNS, 'g')), svg: null, shown: true };
        this.meadow.set(key, chunk);
      }
      const svg = chunkSVG(world, ground, cx * c, cy * c, project, camera.tile);
      if (svg !== chunk.svg) chunk.g.innerHTML = chunk.svg = svg;
      const x0 = cx * c - 0.5, y0 = cy * c - 0.5, x1 = x0 + c, y1 = y0 + c;
      chunk.box = this.sceneBox([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], 0, 0.3);
    }
    this.meadowDirty.clear();
    this.cullMeadow();
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

  renderTerrain() {
    this.layers.terrain.innerHTML = (this.contours ? this.renderContours() : '') + this.renderWater();
  }

  // Lakes as on a hand-drawn map: a single shoreline, and in the middle of
  // a bigger lake two short strokes for the water. The shore is the elevation contour at
  // the lake's surface – so it curves with the land, like the contour lines
  // around it – kept within reach of the water dots, so the lake covers
  // exactly its dots. A river's banks are a set distance from its
  // centreline instead (terrain/rivers.js), out to the map frame. Each
  // body of water is worked out on its own, over just its own box.
  renderWater() {
    const { world } = this;
    const { list: bridges, deck } = this.bridgeState();
    this.waterBridges = this.bridgeKey; // drawn broken under these (see the constructor)
    // The lines in world units, traced once per terrain (the costly part)…
    if (!this.waterLines) {
      this.waterLines = { shore: [], bank: [], wave: [] };
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
    // …then broken where a bridge deck passes over, and put on screen
    const { shore, bank, wave } = this.waterLines;
    const hidden = bridges.length ? hiddenUnder(bridges, deck, this.camera) : null;
    const open = (lines) => (hidden ? lines.flatMap((pts) => keepRuns(pts, (q) => !hidden(...q), 0.04)) : lines);
    const path = (lines, cls) => (lines.length ? `<path class="${cls}" d="${this.pathData(lines, false)}"/>` : '');
    return path(open(shore), 'shore') + path(open(bank), 'bank') + path(wave, 'wave');
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

  // One body of water's shore (a river's: banks) and waves, appended to `out`.
  // `below(x, y)`: grid units inside the shore (negative on land), kept
  // within reach of the water dots. With `river` (its field) it is worked
  // out to the map frame, past the dots at the edges.
  renderWaterBody(cells, below, out, river = null) { // (out: lines in world units, by class)
    const { radius, soft, step, wave } = WATER;
    const { width, height } = this.world.grid;
    const xs = cells.map((c) => c[0]), ys = cells.map((c) => c[1]);
    let [x0, y0, x1, y1] = [Math.min(...xs) - 1.5, Math.min(...ys) - 1.5, Math.max(...xs) + 1.5, Math.max(...ys) + 1.5];
    if (river) {
      const m = 1.2; // same margin as the frame
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
    for (const c of contours(field, box, { step, interval: 1, index: 99 })) {
      if (c.level === 0) out[river ? 'bank' : 'shore'].push(c.points);
    }
    if (river) return;
    // Waves: at the point furthest from the shore (a two-pass chamfer
    // distance from the land samples), along the lake's long axis.
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
    let best = 0;
    for (let j = ny - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) {
      const k = j * nx + i;
      if (i < nx - 1) relax(k, k + 1, step);
      if (j < ny - 1) {
        relax(k, k + nx, step);
        if (i < nx - 1) relax(k, k + nx + 1, diag);
        if (i > 0) relax(k, k + nx - 1, diag);
      }
      if (dist[k] > dist[best]) best = k;
    }
    const r = dist[best];
    if (!(r >= wave.from)) return;
    const cx = x0 + (best % nx) * step, cy = y0 + Math.floor(best / nx) * step;
    // long axis: the main direction of the dots' spread
    const mx = cells.reduce((s, c) => s + c[0], 0) / cells.length, my = cells.reduce((s, c) => s + c[1], 0) / cells.length;
    let sxx = 0, syy = 0, sxy = 0;
    for (const [x, y] of cells) { sxx += (x - mx) ** 2; syy += (y - my) ** 2; sxy += (x - mx) * (y - my); }
    const a = Math.atan2(2 * sxy, sxx - syy) / 2, ux = Math.cos(a), uy = Math.sin(a);
    const len = Math.min(r * wave.length * 2, wave.max);
    const stroke = (along, off, l) => {
      const px = cx + ux * along - uy * off, py = cy + uy * along + ux * off;
      return [[px - ux * l / 2, py - uy * l / 2], [px + ux * l / 2, py + uy * l / 2]];
    };
    out.wave.push(stroke(0, 0, len), stroke(len * 0.12, wave.gap, len * 0.6));
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
      const elev = this.world.elevation, river = this.world.riverField;
      const wet = (x, y) => {
        if (river && river.depth(x, y) > 0) return true;
        const n = grid.nodeAt(Math.round(x), Math.round(y));
        return n >= 0 && terrain.isWater(n) && Math.hypot(x - Math.round(x), y - Math.round(y)) < 0.75;
      };
      this.contourLines = contours(elev, [-m, -m, grid.width - 1 + m, grid.height - 1 + m], ELEVATION, wet);
      // drawn by hand: each line as a run of pencil strokes (see pencil())
      this.contourStrokes = [[], [], []];
      for (const c of this.contourLines) this.contourStrokes[c.tier].push(...pencil(c.points, c.level, PENCIL[c.tier]));
    }
    const tiers = this.contourStrokes;
    let labels = '';
    const every = 9; // grid steps of line between labels
    for (const c of this.contourLines) {
      if (c.tier) continue;
      let run = every / 2;
      for (let i = 1; i < c.points.length - 1; i++) {
        const [ax, ay] = c.points[i - 1], [bx, by] = c.points[i];
        run += Math.hypot(bx - ax, by - ay);
        if (run < every) continue;
        run = 0;
        // written along the line, the right way up
        const [sx, sy] = this.project(bx, by);
        const [px, py] = this.project(...c.points[i - 1]), [qx, qy] = this.project(...c.points[i + 1]);
        let angle = (Math.atan2(qy - py, qx - px) * 180) / Math.PI;
        if (angle > 90) angle -= 180;
        if (angle < -90) angle += 180;
        labels += `<text class="contour-label" transform="translate(${r2(sx)} ${r2(sy)}) rotate(${Math.round(angle)})">${c.level}</text>`;
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

    // ticks every 5 dots along each edge; the bands between them are named
    // like a chessboard's squares: files a, b, c… across, ranks counting up
    // from the bottom edge
    const STEP = 5;
    const ticks = [];
    let labels = '';
    const label = (x, y, text) => {
      const [sx, sy] = this.project(x, y);
      labels += `<text class="frame-label" x="${r2(sx)}" y="${r2(sy)}">${text}</text>`;
    };
    const mid = (a, n) => (a + Math.min(a + STEP, n - 1)) / 2; // centre of the band from a
    const ranks = Math.ceil(h / STEP);
    for (let x = 0; x < w; x += STEP) {
      ticks.push([[x, y0], [x, y0 - 0.3]], [[x, y1], [x, y1 + 0.3]]);
      const file = fileName(x / STEP);
      label(mid(x, w), y0 - 0.9, file);
      label(mid(x, w), y1 + 0.9, file);
    }
    for (let y = 0; y < h; y += STEP) {
      ticks.push([[x0, y], [x0 - 0.3, y]], [[x1, y], [x1 + 0.3, y]]);
      const rank = ranks - y / STEP;
      label(x0 - 0.9, mid(y, h), rank);
      label(x1 + 0.9, mid(y, h), rank);
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
    if (out !== this.markersHTML) this.layers.markers.innerHTML = this.markersHTML = out;
  }

  // Network linework as ink items (see ink.js): `add(key, cls, line, a, b)`
  // for each piece, a / b the dots it runs between, for the pen's order.
  inkItems(sway) {
    const items = [];
    const add = (key, cls, line, a, b) => {
      // (one line, or its parts in front of a photo camera)
      for (const pts of this.screenLines([line], true, sway, true)) if (pts.length > 1) items.push({ key, cls, pts, a, b });
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
    this.ink.paths.update(this.pathItems(), { rankOf: this.rankOf(this.world.networks.path) });
  }

  // The footpaths' ink items (for the current camera).
  pathItems() {
    const layer = this.world.networks.path;
    const { items, add } = this.inkItems(true);
    // Footpaths as two narrow edges, like small roads (roadEdges), stopping
    // where the roadway starts: at a plain road's edge, at a street's kerb
    // (its sidewalk carries on). Dead ends are closed, but not where a
    // path runs on into a park or square as its walkway.
    const { world } = this;
    const onRoad = roadway(world, this.config.road, this.config.lane);
    const intoSite = (n) => world.coarseAround(n).some((c) => STRUCTURE_TYPES[world.structureAt(c)?.type]?.site);
    for (const { key, line, a, b } of roadEdges(layer, this.config.path, this.config.path.edge, [], (n) => !intoSite(n))) {
      keepRuns(line, (q) => !onRoad(q)).forEach((run, i) => add(`p${key}${i ? `:${i}` : ''}`, 'footpath', run, a, b));
    }
    this.addBridges('path', add);
    return items;
  }

  renderRails() {
    this.ink.rails.update(this.railItems(), { rankOf: this.rankOf(this.world.networks.rail) });
  }

  railItems() {
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
    this.addBridges('rail', add);
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
    return items;
  }

  renderRoads() {
    this.ink.roads.update(this.roadItems(), { rankOf: this.rankOf(this.world.networks.road) });
  }

  // `cache`: keep the road and kerb lines between calls (the map's own
  // camera only).
  roadItems(cache = true) {
    const { world } = this;
    const layer = world.networks.road, curve = this.config.road;
    const { items, add } = this.inkItems(true);
    // The road and kerb lines depend on the networks only, not on the
    // buildings (which redraw the roads for their driveways): kept until
    // a network, the terrain or the view changes.
    const cached = cache ? this.roadLines : null;

    // Driveways: from the building edge at its door to the road's edge.
    for (const s of world.structures.values()) {
      if (this.yardFrame(s) || STRUCTURE_TYPES[s.type]?.site) continue; // these reach the road themselves
      const access = world.accessInfo(s);
      if (!access) continue;
      const [dx, dy] = world.grid.xy(access.door);
      const [rx, ry] = world.grid.xy(access.road);
      const len = Math.hypot(rx - dx, ry - dy);
      const t = STRUCTURE_PAD / len, u = 1 - world.roadHalfWidth(access.road) / len;
      add(`d${s.id}`, 'driveway', [[dx + (rx - dx) * t, dy + (ry - dy) * t], [dx + (rx - dx) * u, dy + (ry - dy) * u]]);
    }

    if (cached) items.push(...cached);
    else {
      const from = items.length;
      // The road as its two edges, with corners at junctions, rounded dead
      // ends, and at map exits carried on past the edge, then faded out.
      // Lanes are narrower, and widen into the road where they meet one.
      const lane = this.config.lane;
      const width = (a, b) => (world.isLane(a, b) ? lane.edge : curve.edge);
      for (const { key, kind, line, a, b } of roadEdges(layer, curve, width, world.roadExits(), undefined, lane.taper)) {
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
      // zebra crossings where streets meet a junction
      for (const { node, a, b, stripes } of zebraCrossings(world, curve)) {
        stripes.forEach((line, i) => add(`z${node}:${edgeKey(a, b)}.${i}`, 'zebra', line, a, b));
      }
      this.addBridges('road', add);
      if (cache) this.roadLines = items.slice(from);
    }
    return items;
  }

  // Pan and zoom. Redrawing the SVGs at a new view re-lays-out and repaints
  // every element, too slow to do on every frame of a pan or zoom. So while
  // the camera moves, the last drawing (`drawn`) is only shifted / stretched
  // on the GPU with a CSS transform on their wrappers (.view), and redrawn
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
      for (const w of this.wrappers) Object.assign(w.style, { left: `${-this.ox}px`, top: `${-this.oy}px`, width: `${W + 2 * this.ox}px`, height: `${H + 2 * this.oy}px`, transformOrigin: `${this.ox}px ${this.oy}px` });
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
        // the drawn area (the window and the overscan past it) in scene px
        this.viewBox = [(-ox - cam.panX) / cam.zoom, (-oy - cam.panY) / cam.zoom, (W + ox - cam.panX) / cam.zoom, (H + oy - cam.panY) / cam.zoom];
        this.cull();
        this.cullMeadow();
      }
    }
    if (css !== this.css) {
      this.css = css;
      // on the wrapper, not the SVGs: a transform on an <svg> itself makes
      // Chrome recompute every non-scaling stroke in it
      for (const w of this.wrappers) w.style.transform = css;
    }
  }

  updateLod(z) {
    const { medium, far } = this.config.render.lod;
    // meadow detail tiers (meadow.js), on its own layer: a class on the
    // whole <svg> would restyle everything in it
    const tier = z >= MEADOW.close ? 2 : z >= medium ? 1 : 0;
    if (tier !== this.meadowTier) {
      this.layers.meadow.classList.remove(`mz${this.meadowTier}`);
      this.layers.meadow.classList.add(`mz${tier}`);
      this.meadowTier = tier;
    }
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
    this.objsDirty = new Set(); // (cull() may add to it while we go)
    // Only the view changed (rotation…): objects out of sight are just
    // placed, and drawn once they come into view (cull()).
    const lazy = this.objsAll && !this.worldAll && this.cullOn;
    if (this.objsAll) {
      keys = new Set(this.objs.keys());
      for (const id of world.structures.keys()) keys.add(`s${id}`);
      for (const id of world.features.keys()) keys.add(`f${id}`);
      for (const key of world.sidewalks) keys.add(`k${key}`);
    } else {
      // a street front shares one lift (buildStructure): redraw whole rows
      for (const key of [...keys]) {
        const s = key[0] === 's' && world.structures.get(Number(key.slice(1)));
        if (s) for (const o of joinedRow(world, s)) keys.add(`s${o.id}`);
      }
    }
    this.free = freeTest(world, this.config);
    this.lampRoom = null; // (buildStreet: worked out again when needed)
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
      let entry = this.objs.get(key);
      if (lazy && entry?.at && !this.born.has(key) && this.exists(key)) {
        const { bounds, box } = this.placeOf(entry.at);
        if (!this.inView(box)) {
          if (['minX', 'maxX', 'minY', 'maxY'].some((k) => entry.bounds[k] !== bounds[k])) orderChanged = true;
          Object.assign(entry, { bounds, box, stale: true });
          this.cull([entry]);
          continue;
        }
      }
      const built = key[0] === 's' ? this.buildStructure(world.structures.get(id))
        : key[0] === 'f' ? this.buildFeature(world.features.get(id))
          : this.buildStreet(key.slice(1));
      if (!built) {
        if (entry) {
          this.objs.delete(key);
          if (erasing && this.dying.has(key) && entry.shown !== false) {
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
      if (sig !== entry.sig && entry.sig && animate && swaps < DRAW.cap && !this.born.has(key) && entry.shown !== false) {
        // the old drawing is erased as a ghost, the new one drawn after it
        swaps++;
        this.ghosts.set(`${key}~${now}`, { g: entry.g, lg: entry.lg, bounds: entry.bounds, box: entry.box, shown: entry.shown });
        entry.shown = undefined; // new elements below
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
      entry.box = built.box;
      entry.at = built.at;
      entry.stale = false;
      this.cull([entry]);
      if (this.born.has(key) && !entry.shown) this.born.delete(key); // out of sight: no pen
      if (this.born.has(key)) {
        if (!drawing) this.born.delete(key);
        else {
          if (this.born.get(key) === null) this.born.set(key, now);
          if (!sketch.some((k) => k.then === key)) sketch.push({ entry, key });
        }
      }
    }
    this.objsAll = this.worldAll = false;
    this.dying.clear();

    if (orderChanged) {
      const order = isoSort([...this.objs.values(), ...this.ghosts.values()].map((e) => ({ ...e.bounds, entry: e }))).map((i) => i.entry);
      placeInOrder(this.layers.objects, order.map((e) => e.g));
      this.order = order;
    }

    // after the DOM is in place: the pen needs computed styles and lengths
    const tile = this.camera.tile, scale = this.drawn.zoom;
    sketch.sort((a, b) => !!b.reverse - !!a.reverse); // erasing first: a swap waits for it
    for (const { entry, key, reverse, drawnFor, then } of sketch) {
      const groups = [entry.lg, entry.g];
      if (reverse) {
        const left = eraseOut(groups, { drawn: drawnFor, tile, scale, speed: then ? DRAW.swap : 1 });
        entry.until = now + left;
        if (then) {
          // the new drawing starts when the old one is half erased
          this.born.set(then, now + left / 2);
          sketch.push({ entry: this.objs.get(then), key: then });
        }
      } else if (drawIn(groups, { elapsed: now - this.born.get(key), tile, scale }) <= 0) {
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

  // Is the thing an object key stands for still there?
  exists(key) {
    const { world } = this;
    if (key[0] === 'k') return world.sidewalks.has(key.slice(1));
    return (key[0] === 's' ? world.structures : world.features).has(Number(key.slice(1)));
  }

  // Street lamps come and go with the streets (and move for footpaths
  // and railways): redraw every street's, sketching in the new ones.
  touchStreets() {
    const { world } = this;
    for (const key of world.sidewalks) {
      const k = `k${key}`;
      if (!this.objs.has(k)) this.born.set(k, null);
      this.objsDirty.add(k);
    }
    for (const k of this.objs.keys()) {
      if (k[0] !== 'k' || world.sidewalks.has(k.slice(1))) continue;
      this.dying.add(k);
      this.objsDirty.add(k);
    }
  }

  // A street segment's lamp (roads/furniture.js), or null where it has none.
  buildStreet(key) {
    const out = this.paintStreet(key);
    if (!out) return null;
    const { painter, x, y } = out;
    return { svg: mergeRuns(painter.toSVG()), ground: '', ...this.placeOf({ points: [[x, y]], pad: 0.05, top: painter.top }) };
  }

  // The painters behind buildStreet / buildFeature / buildStructure, for any
  // camera (the photo camera too, see photo.js). `live`: the map's own
  // drawing, which also updates the parking spots.
  paintStreet(key, camera = this.camera) {
    const { world, config } = this;
    if (!world.sidewalks.has(key)) return null;
    if (!this.lampRoom) {
      const paths = pathIndex(world, config), rails = railIndex(world, config);
      const clear = FURNITURE.lamp.clear;
      this.lampRoom = {
        clear: (q) => paths.distance(q, clear) === Infinity && rails.distance(q, clear) === Infinity,
        roads: new SegmentIndex(networkPolylines(world.networks.road, config.road)),
      };
    }
    const [a, b] = key.split('-').map(Number);
    const at = streetLamp(world, config.road, a, b, this.lampRoom.clear, this.lampRoom.roads);
    if (!at) return null;
    const [x, y] = at;
    const painter = new Painter(camera, { x, y, z: world.terrain.heightAt(x, y) }, 0, a * 7919 + b);
    painter.rigid = [x, y];
    lamp(painter, 0, 0);
    return { painter, x, y };
  }

  buildFeature(f) {
    const out = this.paintFeature(f);
    if (!out) return null;
    const { painter, x, y } = out;
    return { svg: mergeRuns(painter.toSVG()), ground: '', ...this.placeOf({ points: [[x, y]], pad: FEATURE_PAD, top: painter.top }) };
  }

  paintFeature(f, camera = this.camera) {
    if (!f) return null;
    const def = FEATURE_TYPES[f.type];
    if (!def) return null;
    const { world } = this;
    const [nx, ny] = world.grid.xy(f.node);
    const x = nx + f.ox;
    const y = ny + f.oy;
    // seeded per feature, so each tree has its own shape
    const painter = new Painter(camera, { x, y, z: world.terrain.heightAt(x, y) }, 0, Math.imul(f.id, 2654435761) ^ f.node);
    painter.rigid = [x, y];
    def.draw(painter, f);
    return { painter, x, y };
  }

  buildStructure(s) {
    const out = this.paintStructure(s);
    if (!out) return null;
    const { painter, points } = out;
    return { svg: mergeRuns(painter.toSVG()), ground: mergeRuns(painter.toGroundSVG()), ...this.placeOf({ points, pad: STRUCTURE_PAD, top: painter.top }) };
  }

  paintStructure(s, camera = this.camera) {
    if (!s) return null;
    const def = STRUCTURE_TYPES[s.type];
    if (!def) return null;
    const { world } = this;
    const live = camera === this.camera;
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
    painter.setTilt(tiltOf(def, s, painter.join));
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
      if (live && yp.spots.length) this.parking.setSpots(s, yp.spots);
      else if (live) this.parking.spots.delete(s.id);
      painter.merge(yp);
      yardWorld = yard.outline.map(([lx, ly]) => yp.toWorld(lx, ly));
      for (const [lx, ly] of [[yard.x0, yard.y0], [yard.x1, yard.y0]]) points.push(yp.toWorld(lx, ly));
    } else if (live) {
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
    return { painter, points };
  }

  // The plot around a structure, in world axes relative to its anchor dot.
  plotFor(s, plotDef, painter, core, yardWorld) {
    const { world } = this;
    const [ax, ay] = world.grid.xy(s.node);
    const pts = world.nodesOf(s).map((n) => world.grid.xy(n));
    const xs = pts.map((p) => p[0] - ax), ys = pts.map((p) => p[1] - ay);
    const cell = [Math.min(...xs) - 0.5, Math.min(...ys) - 0.5, Math.max(...xs) + 0.5, Math.max(...ys) + 0.5];

    // Building footprint as drawn (painter's local bounds -> anchor-relative
    // world axes; all four corners, as a tilted building is turned).
    const corners = [[core[0], core[1]], [core[2], core[1]], [core[2], core[3]], [core[0], core[3]]].map(([lx, ly]) => {
      const [wx, wy] = painter.toWorld(lx, ly);
      return [wx - ax, wy - ay];
    });
    const bx0 = Math.min(...corners.map((c) => c[0])), bx1 = Math.max(...corners.map((c) => c[0]));
    const by0 = Math.min(...corners.map((c) => c[1])), by1 = Math.max(...corners.map((c) => c[1]));
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

  // Parked cars, a group per lot. `ids`: only these lots (a car came or
  // went), else all of them.
  renderParked(ids = null) {
    const { world, parking } = this;
    const r = THEME.agentRadius;
    // close up car models (src/render/vehicles.js) nosed into their stalls,
    // further out square dots
    const close = this.camera.zoom >= VEHICLES.minZoom;
    const lots = ids ? [...ids].filter((id) => parking.spots.has(id)) : [...parking.spots.keys()];
    for (const id of ids ?? this.parkedEls.keys()) {
      if (parking.spots.has(id)) continue;
      this.parkedEls.get(id)?.g.remove();
      this.parkedEls.delete(id);
    }
    for (const id of lots) {
      const s = world.structures.get(id);
      const spots = parking.spots.get(id);
      let out = '';
      if (s) {
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
      let el = this.parkedEls.get(id);
      if (!el) {
        el = { g: this.layers.parked.appendChild(document.createElementNS(SVGNS, 'g')), html: '' };
        this.parkedEls.set(id, el);
      }
      if (el.html !== out) el.g.innerHTML = el.html = out;
    }
    this.parkedDirty.clear();
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

  // An object's place in the current view, from where it stands in the
  // world (`at`: its points, `pad` around them and the height `top` it is
  // drawn to – none of which change with the view): its ground bounds for
  // the depth order and its box on screen for cull().
  placeOf(at) {
    return { at, bounds: this.viewBounds(at.points, at.pad), box: this.sceneBox(at.points, at.pad + 0.1, at.top) };
  }

  // Where an object may draw, in scene px: its ground area (world points
  // `pad` around) on screen, raised by the height it was drawn to, plus a
  // margin for what leans out (tree crowns, overshooting strokes) – for
  // cull(), so it errs on the large side.
  sceneBox(points, pad, top = 0) {
    const t = this.camera.tile;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [px, py] of points) {
      for (const [dx, dy] of [[-pad, -pad], [pad, -pad], [pad, pad], [-pad, pad]]) {
        const [sx, sy] = this.project(px + dx, py + dy);
        x0 = Math.min(x0, sx); x1 = Math.max(x1, sx);
        y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
      }
    }
    return [x0 - t, y0 - top * this.camera.zScale * t - 2 * t, x1 + t, y1 + t];
  }

  // Hide the objects (and their ground drawing) that lie outside the drawn
  // view: the browser then skips them when the view is redrawn (every
  // shape's line width is kept constant on screen, so every shown one has
  // to be laid out and painted again at each new zoom) and when the detail
  // level changes. All of them, or just `entries`.
  cull(entries = [...this.objs.values(), ...this.ghosts.values()]) {
    if (!this.viewBox) return;
    for (const e of entries) {
      const show = !e.box || !this.cullOn || this.inView(e.box);
      if (show === e.shown) continue;
      e.shown = show;
      if (show && e.stale) this.objsDirty.add(e.key); // drawn for an old view: redraw (renderObjects)
      e.g.style.display = e.lg.style.display = show ? '' : 'none';
    }
  }

  // Does a scene box overlap the drawn view?
  inView(b) {
    const v = this.viewBox;
    return !v || (b[0] < v[2] && b[2] > v[0] && b[1] < v[3] && b[3] > v[1]);
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
  // where the exits fade out are left out. The trains go on the canvas
  // (agentCanvas.js), the barriers, which rarely change, stay in the SVG.
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
      if (!el) this.trainEls.set(t.id, el = {});
      this.placeTrain(el, t.points.map((p, i) => ({ i, p })).filter(({ p }) => onMap(p)));
    }
    for (const id of this.trainEls.keys()) if (!seen.has(id)) this.trainEls.delete(id);
  }

  // People and vehicles grow out of the building they leave and shrink back
  // into the one they reach (a car parking, a walker getting into a car…).
  // Each agent keeps a little record (`el`) of what it looks like: its
  // shapes, where it stands, which way it faces.
  renderAgents() {
    const seen = new Set();
    const now = performance.now();
    const pop = drawEnabled() && this.agentsShown;
    for (const a of this.agents.visible()) {
      seen.add(a.id);
      const kind = a.bus ? 'bus' : a.truck ? 'truck' : a.trip.mode === 'drive' ? 'car' : a.trip.mode === 'cycle' ? 'cyclist' : 'walker';
      let el = this.agentEls.get(a.id);
      if (el && el.kind !== kind) {
        this.agentGone(el, now, pop);
        el = null;
      }
      if (!el) {
        el = { kind, born: pop ? now : -Infinity };
        this.agentEls.set(a.id, el);
      }
      const k = growScale(now - el.born);
      if (kind === 'truck' || kind === 'bus') {
        this.placeVehicle(el, a, kind === 'bus' ? 'bus' : truckFor(a.id));
        this.drawAgent(el, k);
        continue;
      }
      const [wx, wy] = wobble(a.x, a.y); // on the swaying road
      const [sx, sy] = this.projectDeck(a.x + wx, a.y + wy, 0.04);
      if (kind === 'car') this.placeCar(el, a);
      // facing left: mirrored
      el.mirror = kind !== 'car' && this.placePerson(el, a, kind, sx);
      el.sx = sx;
      el.sy = sy;
      this.drawAgent(el, k);
    }
    for (const [id, el] of this.agentEls) {
      if (!seen.has(id)) {
        this.agentGone(el, now, pop);
        this.agentEls.delete(id);
      }
    }
    for (const el of this.agentGhosts) {
      const k = shrinkScale(now - el.gone);
      if (k > 0) this.drawAgent(el, k);
      else this.agentGhosts.delete(el);
    }
    this.agentsShown = true;
  }

  agentGone(el, now, pop) {
    if (!pop) return;
    el.gone = now;
    this.agentGhosts.add(el);
  }

  // Draw an agent at size k, scaled about its foot. A truck or bus far out
  // is one path in scene coordinates and fades instead.
  drawAgent(el, k) {
    const pen = this.pen;
    if (el.kind !== 'truck' && el.kind !== 'bus') return pen.draw(el.shapes, el.sx, el.sy, k, el.mirror);
    if (el.key === 'dot') {
      if (el.path && pen.onScreen(el.dot[0], el.dot[1])) pen.drawScene(AGENT_STYLES.truck, el.path, k < 1 ? Math.max(0, k) : 1);
      return;
    }
    for (const p of el.parts) pen.draw(p.shapes, p.sx, p.sy, k);
  }

  // A train: close up a locomotive and coaches (src/render/vehicles.js),
  // each turned along the track and drawn back to front, further out a line
  // of square dots. `cars`: [{ i (index in the train), p: [x, y, dx, dy] }].
  // Each carriage goes on the canvas over the buildings (penTop) unless
  // something nearer could hide it (screened), else on the one under them.
  placeTrain(el, cars) {
    const cam = this.camera, pen = this.pen;
    if (!cars.length) return;
    const penFor = (x, y) => (this.screened(x, y) ? pen : this.penTop);
    if (cam.zoom < VEHICLES.minZoom) {
      const r = THEME.carriageRadius;
      const pts = cars.map(({ p: [x, y] }) => this.projectDeck(x, y, 0.04));
      if (!pts.some(([x, y]) => pen.onScreen(x, y))) return;
      const under = new Path2D(), over = new Path2D();
      pts.forEach(([x, y], i) => (i ? under.lineTo(x, y) : under.moveTo(x, y)));
      cars.forEach(({ p }, i) => {
        const [x, y] = pts[i];
        (penFor(p[0], p[1]) === pen ? under : over).rect(x - r, y - r, 2 * r, 2 * r);
      });
      pen.drawScene(AGENT_STYLES.train, under);
      this.penTop.drawScene(AGENT_STYLES.train, over);
      return;
    }
    const len = r2(this.config.trains.carSpacing - 0.02);
    const order = cars
      .map(({ i, p: [x, y, dx, dy] }) => ({ i, x, y, h: headingIndex(Math.atan2(dy, dx)), depth: cam.depth(x, y) }))
      .sort((a, b) => a.depth - b.depth);
    const key = `${cam.rotation}|${order.map((c) => `${c.i}:${c.h}`).join(',')}`;
    if (el.key !== key) {
      el.key = key;
      el.shapes = order.map((c) => shapesOf(vehicleSVG(cam, `${c.i ? 'coach' : 'loco'}:${len}`, c.h, c.i % VEHICLES.hands)));
    }
    order.forEach((c, k) => {
      const [sx, sy] = this.projectDeck(c.x, c.y, 0);
      penFor(c.x, c.y).draw(el.shapes[k], sx, sy);
    });
  }

  // Could a building or tree nearer the camera than (x, y), within a couple
  // of dots in front of it, hide what stands there?
  screened(x, y) {
    const { world, camera } = this;
    const [ax, ay] = camera.rotated(x, y);
    const gx0 = Math.round(x), gy0 = Math.round(y);
    for (let gy = gy0 - 2; gy <= gy0 + 2; gy++) {
      for (let gx = gx0 - 2; gx <= gx0 + 2; gx++) {
        if (!world.grid.inBounds(gx, gy)) continue;
        const n = world.grid.index(gx, gy);
        if (!world.structureAtNode.has(n) && !world.featureAt(n)) continue;
        const [rx, ry] = camera.rotated(gx, gy);
        if (rx + ry > ax + ay + 0.35 && Math.abs(rx - ry - (ax - ay)) < 1.3) return true;
      }
    }
    return false;
  }

  // A bus or truck: close up one rigid model `name` (src/render/vehicles.js)
  // between its front (a.x / a.y) and back (a.tx / a.ty), turned the way it
  // goes; further out a long box.
  placeVehicle(el, a, name) {
    const cam = this.camera;
    const [wx, wy] = wobble(a.x, a.y), [vx, vy] = wobble(a.tx, a.ty); // on the swaying road
    const front = [a.x + wx, a.y + wy], back = [a.tx + vx, a.ty + vy];
    if (Math.hypot(front[0] - back[0], front[1] - back[1]) > 1e-4) el.heading = headingIndex(Math.atan2(front[1] - back[1], front[0] - back[0]));
    const [sx, sy] = this.projectDeck((front[0] + back[0]) / 2, (front[1] + back[1]) / 2, 0.04);
    if (cam.zoom < VEHICLES.minZoom) {
      el.key = 'dot';
      el.dot = [sx, sy];
      if (!this.pen.onScreen(sx, sy)) return;
      const [ax, ay] = this.projectDeck(...front, 0.04), [bx, by] = this.projectDeck(...back, 0.04);
      const r = THEME.truckRadius, l = Math.hypot(ax - bx, ay - by) || 1;
      const ux = ((ax - bx) / l) * r, uy = ((ay - by) / l) * r; // along, half a square
      const path = el.path = new Path2D();
      path.moveTo(ax + ux - uy, ay + uy + ux);
      path.lineTo(ax + ux + uy, ay + uy - ux);
      path.lineTo(bx - ux + uy, by - uy - ux);
      path.lineTo(bx - ux - uy, by - uy + ux);
      path.closePath();
      return;
    }
    const heading = el.heading ?? 0;
    const hand = (el.model ??= modelFor(a.id)).hand;
    const key = `${cam.rotation}|${heading}|${name}`;
    if (el.key !== key) {
      el.key = key;
      el.body = { shapes: shapesOf(vehicleSVG(cam, name, heading, hand)) };
    }
    Object.assign(el.body, { sx, sy });
    el.parts = [el.body];
  }

  // A walker's or cyclist's shapes: close up a pen figure
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
    const close = cam.zoom >= VEHICLES.minZoom;
    const body = (el.body ??= bodyFor(a.id));
    const heading = el.heading ?? 0;
    const key = !close ? 'dot' : kind === 'cyclist' ? `c${body}|${heading}|${cam.rotation}` : `w${body}`;
    if (el.key !== key) {
      el.key = key;
      el.shapes = !close ? [shape(kind, personMark(kind, a.id))]
        : shapesOf(kind === 'cyclist' ? cyclistSVG(cam, heading, body) : walkerSVG(body));
    }
    // cyclists' wheels already follow the way they ride
    return close && kind === 'walker' && !!el.left;
  }

  // A car's shapes: close up a model (src/render/vehicles.js) facing the
  // way it last moved, further out a square dot. Rebuilt only when that changes.
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
    if (el.key === key) return;
    el.key = key;
    el.shapes = close ? shapesOf(vehicleSVG(this.camera, model.name, heading, model.hand)) : (CAR_MARK ??= [shape('car', carMark())]);
  }
}

// The plain mark for a car far out: a square dot.
let CAR_MARK = null;
const carMark = () => {
  const r = THEME.agentRadius;
  return rect(-r, -r, 2 * r, 2 * r);
};

// Moving dots, each drawn around its origin: cars are squares, pedestrians
// an upright half-width rectangle standing on it, cyclists a small triangle
// – drawn by hand, so each one's corners sit a little differently (from the
// agent's id).
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

// Fewer elements for the same drawing: a run of neighbouring <path>s of the
// same class that draw lines only – no fill (ln, glyph, gnd), or one in
// the stroke's own colour (ink) – becomes one <path> with all their
// subpaths. Nothing else is drawn between them, so it looks the same, and
// the page has far fewer elements to style, lay out and repaint (a city
// has tens of thousands of these). Filled faces are left alone: each
// one's fill must cover the lines drawn before it. Tree glyphs (all one
// colour, no fill) take turns by class – trunk, limb, leaf… – so between
// other elements they are gathered by class, whatever their order.
const RUN = /<path d="(M[^"]*)" class="([^"]*)"\/>/g;
const LINES = /(^| )(ln|glyph|gnd)( |$)/;
export function mergeRuns(svg) {
  let out = '', last = 0;
  const runs = new Map(); // class -> path data, in order of first use
  const flush = () => {
    for (const [cls, d] of runs) out += `<path d="${d}" class="${cls}"/>`;
    runs.clear();
  };
  for (const m of svg.matchAll(RUN)) {
    if (m.index !== last) {
      flush();
      out += svg.slice(last, m.index);
    }
    last = m.index + m[0].length;
    const cls = m[2];
    if (!LINES.test(cls) || cls.includes('filled')) {
      flush();
      out += m[0];
      continue;
    }
    // other line classes merge only with the one right before them
    const glyph = cls.startsWith('glyph');
    if (!runs.has(cls) && runs.size && !(glyph && [...runs.keys()].every((k) => k.startsWith('glyph')))) flush();
    else if (!glyph && runs.size > 1) flush();
    runs.set(cls, (runs.get(cls) ?? '') + m[1]);
  }
  flush();
  return out + svg.slice(last);
}

// Put `parent`'s children `els` in this order, moving as few as possible:
// the longest run of them already in order stays, the rest are moved in
// around it. (Moving an element makes the browser restyle and lay it out
// again, and there are thousands of buildings.)
export function placeInOrder(parent, els) {
  const at = new Map();
  let i = 0;
  for (let c = parent.firstChild; c; c = c.nextSibling) at.set(c, i++);
  // longest increasing subsequence of the current positions (patience sort)
  const tails = [], prev = new Array(els.length);
  els.forEach((el, k) => {
    const p = at.get(el);
    if (p === undefined) return;
    let lo = 0, hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (at.get(els[tails[mid]]) < p) lo = mid + 1; else hi = mid;
    }
    prev[k] = lo ? tails[lo - 1] : -1;
    tails[lo] = k;
  });
  const keep = new Set();
  for (let k = tails.length ? tails[tails.length - 1] : -1; k >= 0; k = prev[k]) keep.add(els[k]);
  // back to front: each one goes right before the one after it
  let next = null;
  for (let k = els.length - 1; k >= 0; k--) {
    const el = els[k];
    if (!keep.has(el) && (el.parentNode !== parent || el.nextSibling !== next)) parent.insertBefore(el, next);
    next = el;
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
