// SVG renderer. The scene is split into layers, each rebuilt only when the
// world events that affect it fire. Layer order (back to front):
//
//   terrain  – contour lines (grey, index lines labelled; only while
//              `contours` is on), the brows (where a hill turns away out
//              of sight, brows.js; always), the rock faces (rocks.js),
//              faint lines on slopes too steep to build on (steep.js;
//              outside the terrain view) and water hatching; in its own
//              <svg id="ground"> underneath the map
//   grid     – the main dots (shown while building, see styles.css)
//   meadow   – grass and wild flowers on open ground (meadow.js), in
//              chunks rebuilt near a change and culled with the view
//   subgrid  – the dense footpath dots (only visible while drawing footpaths)
//   lots     – flat ground drawing of structures and their surroundings
//              (lawns, paving, parking lines); built together with objects
//   paths    – footpaths
//   rails    – railways: the map symbol, a solid line with dashes inside
//   roads    – roads + driveways (for buildings without surroundings);
//              over the railways, so level crossings read as road
//   shadows  – cast shadows of structures and features, as hatching
//              (shadows.js); built together with objects, over the roads
//              so a shadow runs on across the street
//   parked   – parked cars (hollow squares) in parking lots
//   trains   – carriages (squares) coupled by a line
//   agents   – moving dots; sit under objects so buildings hide them correctly
//   objects  – structures, features and street lamps, depth sorted together
//   overlay  – tool previews, hover
//
// To add a layer: add its name to LAYERS, write render<Name>(), and mark it
// dirty from the events that should refresh it.
//
// Objects (and their ground drawing in `lots`, their shadow in `shadows`)
// are kept per structure /
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
import { PEOPLE, bodyFor, walkerSVG, cyclistSVG, canoeSVG, canoeMarkSVG } from './people.js';
import { DEER, deerSVG, deerMark } from './deer.js';
import { LIVESTOCK, livestockSVG, livestockMark } from './livestock.js';
import { fenceGates } from '../sim/pastures.js';
import { drawIn, eraseOut, drawEnabled, DRAW, growScale, shrinkScale } from './draw.js';
import { chainEdges, edgeCurve, fillet, measurePolyline, pointAt, subPolyline, streetKerbs, pathJoins, JOIN_REACH, railParts, roadEdges, roadway, keepRuns } from '../roads/geometry.js';
import { edgeKey } from '../roads/network.js';
import { InkLayer } from './ink.js';
import { AgentCanvas, AGENT_STYLES, shapesOf, shape } from './agentCanvas.js';
import { signsAt, signSVG, flashSVG, litLight } from './crossings.js';
import { stationTracks } from '../../structures/station.js';
import { STRUCTURE_TYPES, drawSeed, yardOf, joinSides, joinedRow, tiltOf, roadFront } from '../../structures/index.js';
import { YARDS } from '../../structures/yards.js';
import { drawPlot, boundaryChance, wander, SPREAD, SPREAD_DENSITY } from '../../structures/plots.js';
import { rotateQuarter, ORTHO } from '../core/grid.js';
import { pointInPolygon } from '../core/geom2d.js';
import { fitYard, fitSite, freeTest, pathIndex, railIndex, plotClaim, roundSides } from './lots.js';
import { zebraCrossings, streetLamp, FURNITURE } from '../roads/furniture.js';
import { lamp } from '../../structures/kit.js';
import { networkPolylines } from '../roads/geometry.js';
import { SegmentIndex } from '../core/geom2d.js';
import { densify } from './warp.js';
import { FEATURE_TYPES } from '../../features/index.js';
import { ELEVATION, contours } from '../terrain/elevation.js';
import { sketchPolyline, seedOf } from './sketch.js';
import { findBridges, makeDeck, bridgeLines, hiddenUnder } from './bridges.js';
import { MEADOW, meadowGround, chunkSVG } from './meadow.js';
import { PENCIL, CONTOUR_CHUNK, chunked, cut, pencil } from './pencil.js';
import { BROWS, visibility, browLines, browRuns, hiddenAt } from './brows.js';
import { rockLines, ROCK_LOOK } from './rocks.js';
import { STEEP_LINES, steepLines } from './steep.js';
import { carMark, personMark } from './marks.js';
import { mergeRuns, placeInOrder, isoSort } from './order.js';
import { SUN, sunFor, shadowSVG, tierAt, groundSpacing, wallSpacing } from './shadows.js';
import { findForests, forestSVG } from './forest.js';

// (gallery.html and others import these from here)
export { agentShape } from './marks.js';
export { mergeRuns, placeInOrder } from './order.js';

const LAYERS = ['terrain', 'meadow', 'grid', 'subgrid', 'lots', 'forest', 'paths', 'rails', 'roads', 'fences', 'shadows', 'parked', 'trains', 'agents', 'objects', 'overlay'];
const TOP = ['objects', 'overlay']; // in the #objects <svg>, see the constructor
const SVGNS = 'http://www.w3.org/2000/svg';
// Moving the camera (see placeView): ms it must rest before the map is
// redrawn, and how far past each window edge the map is drawn.
const VIEW_SETTLE = 150;
// A drawn element (painter.js) carrying detail class d2, or d1 / d2 (atDetail).
const DETAIL_2 = /<(?:path|polygon|polyline|circle|ellipse|rect|line)\b[^>]*\bclass="[^"]*\bd2\b[^"]*"[^>]*\/>/g;
const DETAIL_1_2 = /<(?:path|polygon|polyline|circle|ellipse|rect|line)\b[^>]*\bclass="[^"]*\bd[12]\b[^"]*"[^>]*\/>/g;
const OVERSCAN = 0.25;
const r2 = (n) => Math.round(n * 100) / 100;

// Trees swaying in the wind (Renderer.swayTrees): at most `most` on screen
// at once, only at zoom `minZoom` or closer, updated `fps` times a second.
export const TREE_SWAY = { most: 60, minZoom: 1.2, fps: 30 };

// Lakes (Renderer.renderWater): the furthest the shore reaches from a water
// dot (under 1, so dry dots stay dry) and how softly neighbouring dots'
// reach blends (higher = less), metres of elevation counted as one grid
// step of depth, the sampling step; `wave`: the two short strokes in the
// middle of a lake – shown from this far from the shore in, this long per
// grid unit of it (at most `max`), this far apart (grid units).
const WATER = { radius: 0.75, soft: 5, metres: 6, step: 0.08, wave: { from: 0.45, length: 0.7, max: 1.6, gap: 0.09 } };


// Half-size of a building's ground area around each of its dots.
const STRUCTURE_PAD = 0.45;
// Kerbs open this much wider than a footpath coming in, each side (grid units).
const PATH_OPENING = 0.012;
const FEATURE_PAD = 0.4; // forest trees stand in clumps around their dot

export class Renderer {
  constructor(svg, ground, { world, camera, agents, trains, boats, deer, livestock, parking, config }) {
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
    this.boats = boats;
    this.boatBorn = new Map(); // canoe id -> when it appeared (ms; -Infinity: was there already)
    this.deer = deer;
    this.livestock = livestock;
    this.deerEls = new Map();  // deer, cow, sheep id -> { born, shapes, sx, sy, mirror } as last drawn
    this.deerGone = new Set(); // …and those shrinking away, with when they went
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
    this.constantStrokes = true; // line widths kept on screen as the zoom changes (updateStroke)
    this.rebuildQueue = [];   // object keys to redraw for a new level of detail, nearest the middle last (queueRebuild)
    this.rebuildCost = 1;     // ms that redrawing one of them took lately (frame)
    this.hiddenKinds = new Set(); // TEMPORARY (debug panel): objects hidden by key letter, 's' buildings, 'f' trees, 'k' street lamps…
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
      fences: new InkLayer(this.layers.fences, ['fence-post', 'fence-pillar', 'fence']),
    };
    this.buildOrder = new Map(); // network layer -> Map dot -> its place in the last build, for the pen

    this.dirty = new Set();
    this.parkedEls = new Map(); // structure id -> { g, html }, its parked cars
    this.parkedDirty = new Set(); // structure ids whose cars changed
    this.invalidate();

    const on = (type, ...layers) => world.events.on(type, () => layers.forEach((l) => this.dirty.add(l)));
    const near = (s) => {
      const points = world.nodesOf(s).map((n) => world.grid.xy(n));
      this.touchAround(points);
      this.touchAround(points, 3, true); // gardens spreading round it (plotFor)
    };
    // (the dots know what's on them: renderGrid)
    for (const type of ['structure:added', 'structure:removed', 'roads:changed', 'rails:changed']) on(type, 'grid');
    for (const type of ['structure:added', 'structure:removed', 'structure:changed']) {
      on(type, 'roads', 'rails'); // stations draw tracks with the rails
      world.events.on(type, (s) => {
        this.objsDirty.add(`s${s.id}`);
        near(s); // neighbours' plots, sites and yards depend on it
        this.touchMeadow(world.nodesOf(s).map((n) => world.grid.xy(n)));
      });
    }
    for (const type of ['feature:added', 'feature:removed']) {
      world.events.on(type, (f) => {
        this.objsDirty.add(`f${f.id}`);
        this.touchAround([world.grid.xy(f.node)], 2, true); // gardens spreading round it
        this.forests = null; // found again (forestState)
        this.dirty.add('forest');
        this.touchMeadow([world.grid.xy(f.node)]);
      });
    }
    for (const k of ['s', 'f']) {
      const kind = k === 's' ? 'structure' : 'feature';
      world.events.on(`${kind}:added`, (o) => this.born.set(`${k}${o.id}`, null));
      world.events.on(`${kind}:removed`, (o) => this.dying.add(`${k}${o.id}`));
    }
    on('roads:changed', 'roads');
    // fences: gaps where roads and railways cross them
    on('fences:changed', 'fences');
    on('paths:changed', 'fences'); // (gates)
    on('roads:changed', 'fences');
    on('rails:changed', 'fences');
    // street lamps: new streets get theirs drawn in, gone ones erased
    for (const type of ['roads:changed', 'paths:changed', 'rails:changed']) world.events.on(type, () => this.touchStreets());
    on('paths:changed', 'paths');
    on('rails:changed', 'rails');
    for (const type of ['roads:changed', 'paths:changed']) world.events.on(type, () => (this.roadLines = null));
    // the woods stop at roads and railways (forest.js)
    for (const type of ['roads:changed', 'rails:changed']) {
      world.events.on(type, () => {
        this.forests = null;
        this.dirty.add('forest');
      });
    }
    // bridges come and go with the networks; the water breaks under them
    for (const type of ['roads:changed', 'paths:changed', 'rails:changed']) {
      world.events.on(type, () => {
        // (only when the bridges changed: the water is costly to draw)
        this.bridgeState();
        if (this.bridgeKey !== this.waterBridges) this.dirty.add('terrain');
      });
    }
    for (const type of ['roads:changed', 'paths:changed', 'rails:changed', 'fences:changed']) {
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
    on('terrain:changed', 'terrain', 'meadow', 'grid', 'subgrid', 'paths', 'rails', 'roads', 'fences');
    world.events.on('terrain:changed', () => {
      this.objsAll = this.worldAll = true; // (not just the view: draw them all now)
      this.roadLines = null;
      this.contourLines = null; // water breaks them
      this.steepLines = null;
      this.waterLines = null;
      this.brows = null;
    });
  }

  // Rebuild everything (e.g. after a camera rotation).
  invalidate() {
    this.roadLines = null; // drawn for the old view
    for (const l of LAYERS) if (l !== 'agents' && l !== 'overlay' && l !== 'objects' && l !== 'lots' && l !== 'shadows') this.dirty.add(l);
    this.objsAll = true;
    this.lastOverlay = null;
    for (const ink of Object.values(this.ink ?? {})) ink.clearErasing(); // drawn for the old view
  }

  // Mark structures within `r` dots of any of the world points for redraw
  // (`spreading`: only those whose gardens spread, plotFor). Plots, sites
  // and yards only look at directly neighbouring dots, so 1 is enough for
  // structure changes – but a spreading garden looks further.
  touchAround(points, r = 1, spreading = false) {
    const { world } = this;
    for (const [px, py] of points) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const n = world.grid.nodeAt(px + dx, py + dy);
          const s = n >= 0 ? world.structureAt(n) : null;
          if (s && (!spreading || SPREAD[STRUCTURE_TYPES[s.type]?.plot?.props])) this.objsDirty.add(`s${s.id}`);
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

  // The building or tree about to be erased (an objs key, 's12' / 'f3', or
  // null): drawn in the secondary colour (.erasing in styles.css). Set by
  // the Erase tool; frame() puts the class on its drawing, which may have
  // been redrawn since.
  markErasing() {
    const entry = this.erasing ? this.objs.get(this.erasing) : null;
    const els = entry ? [entry.g, entry.lg] : [];
    if (this.erasingEls?.[0] === els[0] && this.erasingEls?.[1] === els[1]) return;
    for (const el of this.erasingEls ?? []) el.classList.remove('erasing');
    for (const el of els) el.classList.add('erasing');
    this.erasingEls = els;
  }

  frame(overlaySVG) {
    this.placeView();
    // labels that keep their screen size divide by this (styles.css); set
    // only on their layers, as a change restyles everything below it
    if (this.drawn.zoom !== this.zoomVar) {
      this.zoomVar = this.drawn.zoom;
      this.layers.terrain.style.setProperty('--z', this.zoomVar);
    }
    this.updateLod(this.drawn.zoom);
    for (const layer of this.dirty) this[`render${layer[0].toUpperCase()}${layer.slice(1)}`]?.();
    this.dirty.clear();
    if (this.meadowDirty.size) this.renderMeadow(this.meadowDirty);
    for (const ink of Object.values(this.ink)) if (ink.busy) ink.tick();
    if (this.parkedDirty.size) this.renderParked(this.parkedDirty);
    // a new level of detail: the objects in sight, as many as fit in
    // config.render.rebuildBudget ms by what they took so far (queueRebuild),
    // once the view has settled – each batch repaints the whole objects layer
    let batch = 0;
    if (this.rebuildQueue.length && !this.objsAll && performance.now() - this.movedAt > VIEW_SETTLE) {
      const n = Math.max(1, Math.floor(this.config.render.rebuildBudget / this.rebuildCost));
      while (batch < n && this.rebuildQueue.length) {
        const key = this.rebuildQueue.pop();
        if (!this.objs.get(key)?.stale) continue;
        this.objsDirty.add(key);
        batch++;
      }
    }
    if (this.objsAll || this.objsDirty.size) {
      const t0 = performance.now();
      const n = this.objsDirty.size;
      this.renderObjects();
      if (batch) this.rebuildCost += ((performance.now() - t0) / n - this.rebuildCost) * 0.3;
    }
    if (this.objsPlace) this.placeObjects();
    if (this.ghosts.size) this.reapGhosts();
    if (this.showAgents) {
      this.pen.begin(this.camera);
      this.penTop.begin(this.camera);
      this.renderBoats();  // on the water, under everything else that moves
      this.renderAnimals();
      this.renderTrains(); // under the people and cars (or over everything)
      this.renderAgents();
    } else {
      this.agentsShown = false;
      this.pen.clear();
      this.penTop.clear();
      this.agentGhosts.clear();
      this.agentEls.clear();
      this.trainEls.clear();
      this.deerEls.clear();
      this.deerGone.clear();
    }
    this.markErasing();
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
      const ghost = el.classList.contains('ghost-anim');
      const eraser = el.classList.contains('eraser-mark'); // shrinks away
      const len = parseFloat(cs.getPropertyValue('--len'));
      const from = ring ? parseFloat(cs.strokeDashoffset) : parseFloat(cs.opacity);
      if (still || (ring ? from >= len - 1 : from < 0.01)) continue; // never got drawn
      const scale = ghost ? new DOMMatrix(cs.transform).a : 1;
      el.style.animation = 'none';
      // a preview keeps its place: its parent group puts it there
      const moved = ghost ? el.parentNode : el;
      this.leaving.appendChild(moved);
      const frames = ring
        ? [{ strokeDashoffset: `${from}px` }, { strokeDashoffset: `${-len}px` }]
        : ghost
          ? [{ opacity: from, transform: `scale(${scale})` }, { opacity: 0, transform: 'scale(0.85)' }]
          : eraser
            ? [{ opacity: from, transform: 'none' }, { opacity: 0, transform: 'scale(0.3)' }]
            : [{ opacity: from }, { opacity: 0 }];
      el.animate(frames, { duration: ring ? 220 : ghost ? 130 : 150, easing: 'ease-in', fill: 'forwards' })
        .finished.then(() => moved.remove(), () => moved.remove());
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
  // network changes. { list, deck, and the counts it was found for }.
  // Every moving thing asks for its deck each frame (projectDeck), so the
  // counts are compared one by one rather than joined into a key string.
  bridgeState() {
    const { networks, terrain, sidewalks, lanes } = this.world;
    const b = this.bridges;
    if (b && b.road === networks.road.version && b.rail === networks.rail.version && b.path === networks.path.version
      && b.sidewalks === sidewalks.size && b.lanes === lanes.size && b.rivers === terrain.rivers.length) return b;
    const list = terrain.rivers.length ? findBridges(this.world) : [];
    this.bridges = {
      list, deck: makeDeck(list, this.camera.lift),
      road: networks.road.version, rail: networks.rail.version, path: networks.path.version,
      sidewalks: sidewalks.size, lanes: lanes.size, rivers: terrain.rivers.length,
    };
    this.bridgeKey = list.map((b) => `${b.kind}${b.a}${b.b}`).join('|');
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
    this.layers.terrain.innerHTML = (this.contours ? this.renderContours() : this.renderSteep()) + this.renderBrows() + this.renderWater();
  }

  // What the camera sees of the ground, the brows (brows.js) and the rock
  // faces (rocks.js), worked out for each rotation of the view and kept
  // (per rotation and relief: turning back to a view finds them ready); as
  // pencil strokes, a path per kind and chunk of the map.
  renderBrows() {
    const { camera, world } = this;
    if (!BROWS.on || !camera.lift) return '';
    if (this.brows?.lift !== camera.lift) this.brows = { lift: camera.lift, views: new Map() };
    let view = this.brows.views.get(camera.rotation);
    if (!view) {
      const { terrain, grid } = world;
      const m = 1.2; // (as the contours)
      const height = (x, y) => camera.lift(x, y) + terrain.heightAt(x, y);
      const vis = visibility(camera, height, [-m, -m, grid.width - 1 + m, grid.height - 1 + m]);
      const tiers = [[], [], []];
      browLines(vis, camera).forEach((line, n) => {
        for (const run of browRuns(line)) tiers[run.tier].push(...pencil(run.points, n, BROWS.pencil));
      });
      // the rock faces turned to the viewer (those turned away are brows)
      const rocks = rockLines(world, camera, height, [-0.5, -0.5, grid.width - 0.5, grid.height - 0.5], (x, y) => hiddenAt(vis, camera, x, y));
      const lips = rocks.lips.flatMap((l, n) => pencil(l, n, ROCK_LOOK.pencil));
      view = { tiers, lips, faces: rocks.faces };
      this.brows.views.set(camera.rotation, view);
    }
    const paths = (lines, cls) => chunked(lines, CONTOUR_CHUNK).map((ls) => `<path class="${cls}" d="${this.pathData(ls, false)}"/>`).join('');
    // (the brows are already on the picture, in tiles)
    const t = camera.tile;
    const flat = (lines, cls) => chunked(lines, CONTOUR_CHUNK / 2).map((ls) => `<path class="${cls}" d="${ls.map((pts) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${r2(x * t)} ${r2(y * t)}`).join('')).join('')}"/>`).join('');
    const { tiers, lips, faces } = view;
    return flat(tiers[0], 'brow light') + flat(tiers[1], 'brow') + flat(tiers[2], 'brow outline') + paths(faces, 'rock-face') + paths(lips, 'rock-lip');
  }

  // Faint lines on the slopes too steep to build on (steep.js), traced once
  // per terrain; the terrain view has the full contour lines instead.
  renderSteep() {
    if (!STEEP_LINES.on) return '';
    if (!this.steepLines) {
      const { grid } = this.world;
      const m = 1.2; // (as the contours)
      this.steepLines = steepLines(this.world, [-m, -m, grid.width - 1 + m, grid.height - 1 + m], this.wetAt());
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
    // a path per chunk of the map (as the contours): a river runs right across it
    const path = (lines, cls) => chunked(cut(lines, CONTOUR_CHUNK), CONTOUR_CHUNK).map((ls) => `<path class="${cls}" d="${this.pathData(ls, false)}"/>`).join('');
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
  // out to the edge of the map, past the dots at the edges.
  renderWaterBody(cells, below, out, river = null) { // (out: lines in world units, by class)
    const { radius, soft, step, wave } = WATER;
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

  // Contour lines out to the edge of the map, broken over water. Index lines
  // are brighter; the map's named hills have their tops marked.
  renderContours() {
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
    const line = (lines, cls) => chunked(lines, CONTOUR_CHUNK).map((ls) => `<path class="${cls}" d="${this.pathData(ls, false)}"/>`).join('');
    return line(tiers[2], 'contour d2') + line(tiers[1], 'contour d1') + line(tiers[0], 'contour index') + labels;
  }

  // The main dots, each marked with why nothing could be built on it, so
  // the tool in hand shows only the dots it can use (styles.css): `steep`
  // too steep for a building, `taken` a building, road or railway on it
  // (`house`: a building – lines can't go through those either).
  renderGrid() {
    const world = this.world, { grid, terrain } = world;
    let out = '';
    for (let i = 0; i < grid.size; i++) {
      if (terrain.isWater(i)) continue;
      const [sx, sy] = this.project(...grid.xy(i));
      const house = !!world.structureAt(i);
      const cls = (world.tooSteepToBuild(i) ? ' steep' : '')
        + (house || world.hasRoad(i) || world.hasRail(i) ? ' taken' : '') + (house ? ' house' : '');
      out += `<circle class="grid-dot${cls}" cx="${r2(sx)}" cy="${r2(sy)}" r="${THEME.gridDotRadius}"/>`;
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
    // footpaths carrying on from a road's dead end start where the road
    // has narrowed into them (see roadItems)
    const joined = new Map([...this.pathJoins().values()].map((j) => [j.fine, j]));
    const joinOf = (a, b) => joined.get(a)?.to === b ? joined.get(a) : joined.get(b)?.to === a ? joined.get(b) : null;
    for (const { key, kind, line, a, b } of roadEdges(layer, this.config.path, this.config.path.edge, [], (n) => !intoSite(n) && !joined.has(n))) {
      const j = kind === 'edge' && joinOf(a, b);
      const at = j && layer.pos(j.fine);
      const keep = j ? (q) => !onRoad(q) && Math.hypot(q[0] - at[0], q[1] - at[1]) >= JOIN_REACH - 1e-3 : (q) => !onRoad(q);
      keepRuns(line, keep).forEach((run, i) => add(`p${key}${i ? `:${i}` : ''}`, 'footpath', run, a, b));
    }
    this.addBridges('path', add);
    return items;
  }

  // Footpaths carrying on from roads' dead ends (roads/geometry.js),
  // found again when a network changes.
  pathJoins() {
    const { networks } = this.world;
    const key = `${networks.road.version}|${networks.path.version}|${this.world.lanes.size}`;
    if (this.joins?.key !== key) this.joins = { key, map: pathJoins(this.world, this.config.road, this.config.lane, this.config.path) };
    return this.joins.map;
  }

  renderFences() {
    this.ink.fences.update(this.fenceItems(), { rankOf: this.rankOf(this.world.networks.fence) });
  }

  // The fences' ink items, as the garden fences are drawn (kit.js
  // fenceAlong): a rail along the top, short posts close together.
  // Where a road or railway crosses there's a gap (the pasture is open);
  // where a footpath does, a gate (sim/pastures.js fenceGates): a pillar
  // on each side of the path, right at its edges (as the signs at a level
  // crossing, crossings.js), and the gate shut between them in line with
  // the fence – a frame with a brace across – so the pasture stays closed.
  fenceItems() {
    const { world } = this, layer = world.networks.fence, { post, rails, spacing, gate: G, cornerRadius, curveSamples, wander: amp } = this.config.fence;
    const drift = (p) => (amp ? wander(p, amp) : p);
    const { items, add } = this.inkItems(true);
    const gap = (f) => world.roadAtFine(f) || world.rails.hasNode(f);
    const gates = fenceGates(world);
    const lo = post * 0.25, hi = rails.at(-1), tall = post * 1.4;
    const leaf = (key, p, q, a, b) => {
      add(`${key}f`, 'fence', [[...p, lo], [...q, lo], [...q, hi], [...p, hi], [...p, lo]], a, b);
      add(`${key}b`, 'fence', [[...p, lo], [...q, hi]], a, b);
    };
    const gatePost = (key, [x, y], a, b) => add(key, 'fence-pillar', [[x, y, 0], [x, y, tall]], a, b);
    // (a post at a dot: where the fence runs through it – at a rounded corner
    // the middle of the curve, not the dot itself)
    const postAt = (n) => {
      const nb = [...layer.graph.neighbors(n)];
      if (nb.length !== 2 || !cornerRadius) return drift(layer.pos(n));
      return drift(fillet(layer.pos(nb[0]), layer.pos(n), layer.pos(nb[1]), cornerRadius, curveSamples)[curveSamples / 2]);
    };
    for (const n of layer.graph.nodes()) {
      if (gap(n) || gates.at.has(n)) continue;
      const [x, y] = postAt(n);
      add(`p${n}`, 'fence-post', [[x, y, 0], [x, y, post]], n, n);
    }
    const sides = new Map(); // gate dot -> where the fence pieces at it stop
    for (const [a, b] of layer.graph.edges()) {
      if (gap(a) || gap(b)) continue;
      const key = edgeKey(a, b);
      const curve = measurePolyline(edgeCurve(layer, this.config.fence, a, b));
      const len = curve.total, g = Math.min(0.45, G / len);
      const along = (t) => drift(pointAt(curve, t * len));
      // the stretches of rail, between the gates' openings
      const open = [];
      if (gates.at.has(a)) open.push([0, g]);
      if (gates.across.has(key)) open.push([0.5 - g, 0.5 + g]);
      if (gates.at.has(b)) open.push([1 - g, 1]);
      let t0 = 0;
      const runs = [];
      for (const [s0, s1] of open) {
        if (s0 > t0) runs.push([t0, s0]);
        t0 = s1;
      }
      if (t0 < 1) runs.push([t0, 1]);
      runs.forEach(([s0, s1], k) => {
        const run = k ? `.${k}` : '';
        // (cut up every little way, so it can drift along its length)
        const part = subPolyline(curve, s0 * len, s1 * len);
        const line = [part[0]];
        for (let k = 1; k < part.length; k++) {
          const [p, q] = [part[k - 1], part[k]];
          const n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 0.12));
          for (let i = 1; i <= n; i++) line.push([p[0] + ((q[0] - p[0]) * i) / n, p[1] + ((q[1] - p[1]) * i) / n]);
        }
        const wandered = line.map(drift);
        rails.forEach((z, i) => add(`r${key}.${i}${run}`, 'fence', wandered.map(([x, y]) => [x, y, z]), a, b));
        // posts between its ends, evenly (the ends: a dot's post or a gate's pillar)
        const steps = Math.max(1, Math.round(((s1 - s0) * len) / spacing));
        for (let i = 1; i < steps; i++) {
          const [x, y] = along(s0 + ((s1 - s0) * i) / steps);
          add(`q${key}${run}.${i}`, 'fence-post', [[x, y, 0], [x, y, post]], a, b);
        }
      });
      for (const [n, t] of [[a, g], [b, 1 - g]]) {
        if (!gates.at.has(n)) continue;
        if (!sides.has(n)) sides.set(n, []);
        sides.get(n).push(along(t));
        gatePost(`gp${n}.${key}`, along(t), a, b);
      }
      if (gates.across.has(key)) {
        const p = along(0.5 - g), q = along(0.5 + g);
        gatePost(`gp${key}a`, p, a, b);
        gatePost(`gp${key}b`, q, a, b);
        leaf(`g${key}`, p, q, a, b);
      }
    }
    for (const [n, ends] of sides) if (ends.length >= 2) leaf(`g${n}`, ends[0], ends[1], n, n);
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
      // dead ends a footpath carries on from: open, narrowing into it
      const joins = this.pathJoins();
      for (const { key, kind, line, a, b } of roadEdges(layer, curve, width, world.roadExits(), (n) => !joins.has(n), lane.taper)) {
        add(`r${key}`, kind === 'fade' ? 'road-exit' : 'road', line, a, b);
      }
      for (const [n, { line }] of joins) line.forEach((pts, i) => add(`rj${n}:${i}`, 'road', pts, n, n));

      // kerbs, rounding the corners, open where a footpath comes in
      const paths = pathIndex(world, this.config);
      const open = (q) => paths.distance(q, this.config.path.edge + PATH_OPENING) === Infinity;
      for (const { key, line, a, b } of streetKerbs(world, curve, lane, joins)) {
        keepRuns(line, open).forEach((run, j) => add(`k${key}${j ? `:${j}` : ''}`, 'kerb', run, a, b));
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
        this.updateStroke(cam.zoom);
        // the drawn area (the window and the overscan past it) in scene px
        this.viewBox = [(-ox - cam.panX) / cam.zoom, (-oy - cam.panY) / cam.zoom, (W + ox - cam.panX) / cam.zoom, (H + oy - cam.panY) / cam.zoom];
        this.cull();
        this.cullMeadow();
      }
    }
    if (css !== this.css) {
      this.css = css;
      // on the wrappers, not the SVGs: a transform on an <svg> itself
      // makes the browser lay it out again
      for (const w of this.wrappers) w.style.transform = css;
    }
  }

  // Line widths for the zoom `z` (--stroke in styles.css): 1 / z rounded to
  // a step of config.render.strokeStep, so lines keep about their width on
  // screen. Set only when the step changes – it restyles every line on the
  // map. With constantStrokes off (debug panel) lines scale with the map.
  // The widths are in device pixels, as Chrome drew the non-scaling strokes
  // the map had before: a 1.2 line is 1.2 pixels of a sharp screen, not 1.2
  // CSS px (twice as thick there).
  updateStroke(z) {
    const { strokeStep: step, lineWeight } = this.config.render;
    const k = this.constantStrokes ? (lineWeight * step ** -Math.round(Math.log(z) / Math.log(step))) / (devicePixelRatio || 1) : 1;
    if (k === this.strokeK) return;
    this.strokeK = k;
    for (const s of [this.svg, this.ground, this.top]) s.style.setProperty('--stroke', k);
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
    // far out the woods are one shape each (forest.js), their trees not drawn
    const woods = z < this.config.render.forest.zoom;
    if (woods !== this.woodsOn) {
      this.woodsOn = woods;
      this.dirty.add('forest');
      this.cull();
    }
    // forest trees: plainer crowns further out, redrawn when that changes
    const { trees } = this.config.render;
    const detail = z >= trees.medium ? 0 : z >= trees.far ? 1 : 2;
    if (detail !== this.treeDetail) {
      if (this.treeDetail !== undefined) this.queueRebuild((key) => key[0] === 'f');
      this.treeDetail = detail;
    }
    // shadow hatching: the stroke tiers that keep strokes apart on screen,
    // on the ground (sz) and on walls (sw) – when anything is hatched (a
    // class change on the map restyles all of it)
    const hatched = SUN.on && (SUN.walls === true || ['cast', 'hatch', 'scribble'].includes(SUN.ground));
    const tiers = hatched ? `sz-${tierAt(this.camera.tile * z, groundSpacing())} sw-${tierAt(this.camera.tile * z, wallSpacing())}` : this.shadeTiers;
    if (tiers !== this.shadeTiers) {
      for (const s of [this.svg, this.ground, this.top]) {
        if (this.shadeTiers) s.classList.remove(...this.shadeTiers.split(' '));
        s.classList.add(...tiers.split(' '));
      }
      this.shadeTiers = tiers;
    }
    const level = z >= medium ? 0 : z >= far ? 1 : 2;
    if (level === this.lodLevel) return;
    for (const s of [this.svg, this.ground, this.top]) {
      s.classList.remove(`lod-${this.lodLevel}`);
      s.classList.add(`lod-${level}`);
    }
    // the objects are drawn with this level's detail only (atDetail)
    if (this.lodLevel !== undefined) this.queueRebuild(() => true);
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
            entry.sg.remove();
            orderChanged = true;
          }
        }
        this.born.delete(key);
        if (key[0] === 's') this.parking.spots.delete(id);
        continue;
      }
      if (!entry) {
        entry = { key, g: document.createElementNS(SVGNS, 'g'), lg: document.createElementNS(SVGNS, 'g'), sg: document.createElementNS(SVGNS, 'g') };
        this.layers.lots.appendChild(entry.lg);
        this.layers.shadows.appendChild(entry.sg);
        this.objs.set(key, entry);
        orderChanged = true;
      }
      const s = key[0] === 's' && world.structures.get(id);
      const sig = s && `${s.type}|${s.seed}`;
      if (sig !== entry.sig && entry.sig && animate && swaps < DRAW.cap && !this.born.has(key) && entry.shown !== false) {
        // the old drawing is erased as a ghost, the new one drawn after it
        swaps++;
        this.ghosts.set(`${key}~${now}`, { g: entry.g, lg: entry.lg, sg: entry.sg, bounds: entry.bounds, box: entry.box, shown: entry.shown });
        entry.shown = undefined; // new elements below
        sketch.push({ entry: this.ghosts.get(`${key}~${now}`), reverse: true, drawnFor: Infinity, then: key });
        entry.g = document.createElementNS(SVGNS, 'g');
        entry.lg = entry.lg.parentNode.insertBefore(document.createElementNS(SVGNS, 'g'), entry.lg.nextSibling);
        entry.sg = entry.sg.parentNode.insertBefore(document.createElementNS(SVGNS, 'g'), entry.sg.nextSibling);
        this.born.set(key, now);
        orderChanged = true;
      }
      entry.sig = sig;
      entry.g.innerHTML = built.svg;
      entry.lg.innerHTML = built.ground;
      entry.shade = built.shade;
      entry.sg.innerHTML = this.shadowSVG(entry.shade);
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
      placeInOrder(this.layers.objects, order.filter((e) => e.shown !== false).map((e) => e.g)); // (out of sight: out of the page, see cull)
      this.order = order;
      this.objsPlace = false;
    }

    // after the DOM is in place: the pen needs computed styles and lengths
    const tile = this.camera.tile, scale = this.drawn.zoom;
    sketch.sort((a, b) => !!b.reverse - !!a.reverse); // erasing first: a swap waits for it
    for (const { entry, key, reverse, drawnFor, then } of sketch) {
      const groups = [entry.lg, entry.g, entry.sg];
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

  // The opening (main.js): the buildings and trees nearest the middle of
  // the screen are sketched in by the pen as the cover's edge passes over
  // them, the nearest first (DRAW.cap of them; the rest are there already).
  // `at(px)`: ms from now the edge is `px` screen pixels from the middle.
  sketchIntro(at) {
    if (!drawEnabled()) return;
    const { world, camera } = this;
    const cx = innerWidth / 2, cy = innerHeight / 2;
    const off = ([x, y]) => {
      const [sx, sy] = camera.project(x, y);
      return Math.hypot(sx * camera.zoom + camera.panX - cx, sy * camera.zoom + camera.panY - cy);
    };
    const near = [
      ...[...world.structures.values()].map((s) => [`s${s.id}`, off(world.centerOf(s))]),
      ...[...world.features.values()].map((f) => [`f${f.id}`, off(world.grid.xy(f.node))]),
    ].filter(([key, d]) => d < Math.hypot(cx, cy) && this.objs.get(key)?.shown !== false)
      .sort((a, b) => a[1] - b[1])
      .slice(0, DRAW.cap);
    const now = performance.now();
    for (const [key, d] of near) {
      this.born.set(key, now + at(d));
      this.objsDirty.add(key);
    }
  }

  // Drop erased objects whose pen is done (all of them with `all`).
  reapGhosts(all = false) {
    const now = performance.now();
    for (const [key, e] of this.ghosts) {
      if (!all && now < e.until) continue;
      e.g.remove();
      e.lg.remove();
      e.sg.remove();
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
    return { svg: mergeRuns(this.atDetail(painter.toSVG())), ground: '', shade: this.shadeOf(painter), ...this.placeOf({ points: [[x, y]], pad: 0.05, top: painter.top }) };
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
    const out = this.paintFeature(f, this.camera, this.treeDetail);
    if (!out) return null;
    const { painter, x, y } = out;
    return { svg: mergeRuns(this.atDetail(painter.toSVG())), ground: '', shade: this.shadeOf(painter), ...this.placeOf({ points: [[x, y]], pad: FEATURE_PAD, top: painter.top }) };
  }

  // A drawing without the details the current level hides (.lod-1 .d2,
  // .lod-2 .d1 in styles.css): left out rather than only hidden, as the
  // browser restyles and lays out hidden elements too. Changing the level
  // redraws the objects (updateLod, queueRebuild).
  atDetail(svg) {
    const level = this.lodLevel ?? 0;
    return level ? svg.replace(level >= 2 ? DETAIL_1_2 : DETAIL_2, '') : svg;
  }

  // Redraw the objects whose key passes test(key), for a new level of
  // detail: those in sight a batch per frame (config.render.rebuildPerFrame,
  // see frame()), the rest once they come into sight (stale, see cull()).
  // The middle of the window goes first: the queue is taken from its end.
  queueRebuild(test) {
    const queued = new Set(this.rebuildQueue);
    for (const [key, e] of this.objs) {
      if (!test(key)) continue;
      e.stale = true;
      if (e.shown !== false) queued.add(key);
    }
    const v = this.viewBox, cx = v ? (v[0] + v[2]) / 2 : 0, cy = v ? (v[1] + v[3]) / 2 : 0;
    const far = (key) => {
      const b = this.objs.get(key)?.box;
      return b ? Math.hypot((b[0] + b[2]) / 2 - cx, (b[1] + b[3]) / 2 - cy) : Infinity;
    };
    this.rebuildQueue = [...queued].map((key) => [far(key), key]).sort((a, b) => b[0] - a[0]).map(([, key]) => key);
  }

  paintFeature(f, camera = this.camera, detail = 0) {
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
    painter.detail = detail;
    def.draw(painter, f);
    return { painter, x, y };
  }

  buildStructure(s) {
    const out = this.paintStructure(s);
    if (!out) return null;
    const { painter, points } = out;
    return { svg: mergeRuns(this.atDetail(painter.toSVG())), ground: mergeRuns(this.atDetail(painter.toGroundSVG())), shade: this.shadeOf(painter), ...this.placeOf({ points, pad: STRUCTURE_PAD, top: painter.top }) };
  }

  // An object's shadow (shadows.js): what casts it and the feet of its
  // walls, in world points, and how its ground projects – kept on the object's entry, so the shadow alone
  // can be drawn again for another sun (renderShadows).
  shadeOf(painter) {
    return painter.casts.length || painter.feet.length ? { casts: painter.casts, feet: painter.feet, project: painter.groundProjector() } : null;
  }

  shadowSVG(shade) {
    return shade ? shadowSVG(shade, sunFor(this.camera)) : '';
  }

  // Every object's shadow drawn again from its casters, with SUN as it is
  // now – without repainting the objects (mark the layer dirty after a
  // change to SUN).
  renderShadows() {
    for (const e of this.objs.values()) e.sg.innerHTML = this.shadowSVG(e.shade);
  }

  paintStructure(s, camera = this.camera) {
    if (!s) return null;
    const def = STRUCTURE_TYPES[s.type];
    if (!def) return null;
    const { world } = this;
    const live = camera === this.camera;
    const [x, y] = world.grid.xy(s.node);
    const z = world.terrain.heightAt(x, y);
    const painter = this.attachFree(new Painter(camera, { x, y, z }, world.drawnRotation(s), drawSeed(s)));
    // the building moves with the relief as one piece, so it stays square on
    // slopes (see Camera.project) – and so does a whole street front of
    // buildings sharing walls, so the walls still meet. Its yard and plot (and
    // parks and squares) keep its warp but follow the ground (Painter.follow).
    const row = joinedRow(world, s).map((o) => world.centerOf(o));
    const rigid = [row.reduce((a, p) => a + p[0], 0) / row.length, row.reduce((a, p) => a + p[1], 0) / row.length];
    painter.rigid = rigid;
    painter.sways = live;
    const points = world.nodesOf(s).map((n) => world.grid.xy(n));
    if (def.site) {
      painter.follow = true; // parks and squares lie on the ground like yards
      const site = world.siteArea(s.type, s.node, s.rotation);
      painter.setSite(fitSite(world, this.config, site));
      painter.setSitePaths(world.sitePaths(s));
      const [x0, y0, x1, y1] = site.rect;
      points.push([x0 + STRUCTURE_PAD, y0 + STRUCTURE_PAD], [x1 - STRUCTURE_PAD, y1 - STRUCTURE_PAD]);
    }
    painter.join = joinSides(world, s);
    painter.setTilt(tiltOf(def, s, painter.join, world));
    painter.roadGap = world.nodesOf(s).length === 1 ? roadFront(world, s).gap : 1; // see busStop.js
    def.draw(painter, s);
    const core = painter.bounds;

    // Front yard between the building and its road.
    const frame = this.yardFrame(s);
    const yard = frame && { ...fitYard(world, this.config, frame), alone: this.isAlone(s) };
    let yardWorld = null;
    if (yard) {
      const [dx, dy] = yard.origin;
      const yp = this.attachFree(new Painter(camera, { x: dx, y: dy, z: world.terrain.heightAt(dx, dy) }, yard.rotation, drawSeed(s) ^ 0x5bd1e995));
      yp.setTilt(yard.tilt);
      yp.rigid = rigid;
      yp.sways = live;
      yp.follow = true;
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
    const plotDef = def.plot ?? {};
    if (plotDef.props && core) {
      const pp = this.attachFree(new Painter(camera, { x, y, z }, 0, drawSeed(s) ^ 0x2c1b3c6d));
      pp.setTilt(this.roadTurn(s)); // a plot turned with its building to a diagonal road
      pp.rigid = rigid;
      pp.sways = live;
      pp.follow = true;
      pp.lod = 1;
      const plot = this.plotFor(s, plotDef, painter, core, yardWorld);
      drawPlot(pp, plot);
      painter.merge(pp);
      if (plot.spread) points.push([x + plot.cell[0], y + plot.cell[1]], [x + plot.cell[2], y + plot.cell[3]]);
    }
    return { painter, points };
  }

  // How far a single-dot structure is turned to stand square to a road at
  // an angle to the grid (structures/index.js, roadFront) – its front yard
  // and plot turn with it. 0 for the rest.
  roadTurn(s) {
    return this.world.nodesOf(s).length === 1 ? roadFront(this.world, s).tilt : 0;
  }

  // No other building on any dot around a structure (diagonals too; parks
  // and squares don't count): standing alone, most go unfenced
  // (boundaryChance in structures/plots.js, the garden yard).
  // (touchAround redraws it when a neighbour comes or goes.)
  isAlone(s) {
    const { world } = this;
    for (const n of world.nodesOf(s)) {
      const [px, py] = world.grid.xy(n);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const m = world.grid.nodeAt(px + dx, py + dy);
          const o = m >= 0 ? world.structureAt(m) : null;
          if (o && o.id !== s.id && !STRUCTURE_TYPES[o.type]?.site) return false;
        }
      }
    }
    return true;
  }

  // The plot around a structure, in world axes relative to its anchor dot –
  // or, for one turned to its road (roadTurn), in axes turned with it: the
  // largest such square inside its dot, all four sides its own. A garden
  // (SPREAD) not turned also takes the empty ground round it (claimFor).
  plotFor(s, plotDef, painter, core, yardWorld) {
    const { world } = this;
    const [ax, ay] = world.grid.xy(s.node);
    const pts = world.nodesOf(s).map((n) => world.grid.xy(n));
    const xs = pts.map((p) => p[0] - ax), ys = pts.map((p) => p[1] - ay);
    const tilt = this.roadTurn(s);
    const [tc, ts] = [Math.cos(tilt), Math.sin(tilt)];
    const half = tilt ? 0.5 / (Math.abs(tc) + Math.abs(ts)) : 0.5;
    let cell = [Math.min(...xs) - half, Math.min(...ys) - half, Math.max(...xs) + half, Math.max(...ys) + half];
    // the plot's axes -> anchor-relative world axes (as Painter._turn)
    const toAnchor = tilt ? (x, y) => [x * tc - y * ts, x * ts + y * tc] : (x, y) => [x, y];

    // Building footprint as drawn (painter's local bounds -> anchor-relative
    // world axes; all four corners, as a tilted building is turned).
    const corners = [[core[0], core[1]], [core[2], core[1]], [core[2], core[3]], [core[0], core[3]]].map(([lx, ly]) => {
      const [wx, wy] = painter.toWorld(lx, ly);
      return [wx - ax, wy - ay];
    });
    const bx0 = Math.min(...corners.map((c) => c[0])), bx1 = Math.max(...corners.map((c) => c[0]));
    const by0 = Math.min(...corners.map((c) => c[1])), by1 = Math.max(...corners.map((c) => c[1]));
    const yardLocal = yardWorld?.map(([wx, wy]) => [wx - ax, wy - ay]);

    const onBuildingW = (x, y, r) => x > bx0 - r - 0.03 && x < bx1 + r + 0.03 && y > by0 - r - 0.03 && y < by1 + r + 0.03;
    const onBuilding = (x, y, r) => onBuildingW(...toAnchor(x, y), r);
    const inYard = (x, y) => yardLocal && pointInPolygon(toAnchor(x, y), yardLocal);
    const water = (x, y) => {
      const [wx, wy] = toAnchor(x, y);
      const n = world.grid.nodeAt(ax + wx, ay + wy);
      return n < 0 || world.terrain.isWater(n);
    };
    // (a road at a slant can cut across the plot's square: its fences stop short)
    const clear = (x, y) => {
      const [wx, wy] = toAnchor(x, y);
      return !this.free || this.free(ax + wx, ay + wy, 0.02);
    };
    const common = {
      style: plotDef.props,
      boundary: boundaryChance(plotDef, this.isAlone(s)),
      kinds: plotDef.kinds,
      density: plotDef.density,
    };

    // A garden spreading over the ground round it: the half-dot squares it
    // claims, its boundary where they meet anyone else's – or nobody's.
    const reach = !tilt && SPREAD[plotDef.props];
    if (reach) {
      const { owner, seen, draws } = this.claimFor(s, reach);
      const own = (x, y) => owner(Math.floor(2 * (ax + x)), Math.floor(2 * (ay + y))) === s.id;
      const quarters = [];
      for (const [px, py] of pts) {
        for (let j = 2 * (py - reach) - 1; j < 2 * (py + reach) + 1; j++) {
          for (let i = 2 * (px - reach) - 1; i < 2 * (px + reach) + 1; i++) {
            if (owner(i, j) === s.id && !quarters.some(([a, b]) => a === i && b === j)) quarters.push([i, j]);
          }
        }
      }
      cell = [
        Math.min(...quarters.map((q) => q[0])) / 2 - ax, Math.min(...quarters.map((q) => q[1])) / 2 - ay,
        Math.max(...quarters.map((q) => q[0])) / 2 + 0.5 - ax, Math.max(...quarters.map((q) => q[1])) / 2 + 0.5 - ay,
      ];
      // Boundary: each edge of a claimed square with someone else's (or
      // nobody's) beyond – but on the -x / -y sides not where a neighbour
      // draws it (it draws its +x / +y ones); runs along a line joined up.
      const runs = new Map(); // 'h|v line' -> [from…]
      for (const [i, j] of quarters) {
        for (const [di, dj] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
          const o = owner(i + di, j + dj);
          if (o === s.id) continue;
          if ((di < 0 || dj < 0) && o !== null && draws(o, i + di, j + dj)) continue;
          const key = di ? `v${i + (di > 0 ? 1 : 0)}` : `h${j + (dj > 0 ? 1 : 0)}`;
          if (!runs.has(key)) runs.set(key, []);
          runs.get(key).push(di ? j : i);
        }
      }
      const sides = [];
      for (const [key, from] of runs) {
        const at = Number(key.slice(1)) / 2;
        from.sort((a, b) => a - b);
        for (let k = 0; k < from.length;) {
          let e = k;
          while (e + 1 < from.length && from[e + 1] === from[e] + 1) e++;
          const a = from[k] / 2, b = from[e] / 2 + 0.5;
          sides.push(key[0] === 'v' ? [[at - ax, a - ay], [at - ax, b - ay]] : [[a - ax, at - ay], [b - ax, at - ay]]);
          k = e + 1;
        }
      }
      const reached = (x, y) => seen(ax + x, ay + y);
      const home = (x, y) => pts.some(([px, py]) => Math.abs(ax + x - px) <= 0.5 && Math.abs(ay + y - py) <= 0.5);
      const density = plotDef.density ?? 0.35;
      return {
        ...common,
        spread: true,
        densityAt: (x, y) => (home(x, y) ? density : density * SPREAD_DENSITY),
        cell,
        sides: roundSides(sides), // corners rounded
        inside: (x, y, r) =>
          own(x - r, y - r) && own(x + r, y - r) && own(x - r, y + r) && own(x + r, y + r) &&
          reached(x, y) && !onBuilding(x, y, r) && !inYard(x, y) && !water(x, y),
        onLine: (x, y) => !onBuilding(x, y, 0.02) && !inYard(x, y) && !water(x, y) && clear(x, y) && reached(x, y),
      };
    }

    // Boundary sides: this plot draws its +x and +y sides, and the -x / -y
    // sides only where a square plot is next door (it draws those); a turned
    // plot draws all four.
    const [x0, y0, x1, y1] = cell;
    const neighbourAt = (dx, dy) => pts.some(([px, py]) => {
      const n = world.grid.nodeAt(px + dx, py + dy);
      const o = n >= 0 ? world.structureAt(n) : null;
      return o && o.id !== s.id && !this.roadTurn(o);
    });
    const sides = [[[x1, y0], [x1, y1]], [[x0, y1], [x1, y1]]];
    if (tilt || !neighbourAt(-1, 0)) sides.push([[x0, y0], [x0, y1]]);
    if (tilt || !neighbourAt(0, -1)) sides.push([[x0, y0], [x1, y0]]);

    return {
      ...common,
      cell,
      sides,
      inside: (x, y, r) =>
        x - r > x0 && x + r < x1 && y - r > y0 && y + r < y1 &&
        !onBuilding(x, y, r) && !inYard(x, y) && !water(x, y),
      onLine: (x, y) => !onBuilding(x, y, 0.02) && !inYard(x, y) && !water(x, y) && clear(x, y),
    };
  }

  // Who has which half-dot square round a spreading plot (lots.js
  // plotClaim), from the structures that could want them; and
  // draws(id, i, j): does that structure's plot draw the boundary of its
  // square (i, j) – a square plot on its own dot, or a garden spreading.
  claimFor(s, reach) {
    const { world } = this;
    const far = 2 * reach + 1;
    const near = new Map();
    for (const n of world.nodesOf(s)) {
      const [px, py] = world.grid.xy(n);
      for (let dy = -far; dy <= far; dy++) {
        for (let dx = -far; dx <= far; dx++) {
          const m = world.grid.nodeAt(px + dx, py + dy);
          const o = m >= 0 ? world.structureAt(m) : null;
          if (o) near.set(o.id, o);
        }
      }
    }
    const claimant = (o) => {
      const nodes = world.nodesOf(o);
      const own = new Set(nodes);
      const front = new Set();
      const def = STRUCTURE_TYPES[o.type];
      const f = this.yardFrame(o) && (world.frontFor(nodes) ?? this.placedFront(o, nodes));
      if (f) {
        for (const n of nodes) {
          const m = world.grid.offset(n, f.dir[0], f.dir[1]);
          if (m >= 0 && !own.has(m)) front.add(m);
        }
      }
      const turned = this.roadTurn(o) !== 0;
      return { id: o.id, dots: nodes.map((n) => world.grid.xy(n)), spreads: !turned && !def?.site && !!SPREAD[def?.plot?.props], turned, front };
    };
    const all = [...near.values()].map(claimant);
    const me = all.find((c) => c.id === s.id);
    const claim = plotClaim(world, this.config, me, all.filter((c) => c !== me), reach);
    const byId = new Map(all.map((c) => [c.id, c]));
    const draws = (id, i, j) => {
      const c = byId.get(id);
      if (!c || c.turned) return false;
      if (c.spreads) return true;
      const cx = i / 2 + 0.25, cy = j / 2 + 0.25;
      return c.dots.some(([x, y]) => Math.round(cx) === x && Math.round(cy) === y);
    };
    return { ...claim, draws };
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
      tilt: this.roadTurn(s), // turned with its building (fitYard)
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
    const dir = rotateQuarter(0, -1, world.drawnRotation(s));
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
    // its shadow reaches out by its height along the sun, any way it falls
    const s = SUN.on ? top * SUN.length * t * 1.2 : 0;
    return [x0 - t - s, y0 - top * this.camera.zScale * t - 2 * t, x1 + t + s, y1 + t + s];
  }

  // Hide the objects (and their ground drawing) that lie outside the drawn
  // view: the browser then skips them when the view is redrawn (every
  // shape's line width is kept constant on screen, so every shown one has
  // to be laid out and painted again at each new zoom) and when the detail
  // level changes. All of them, or just `entries`.
  // The trees lean in the wind: each forest clump (feature) as a whole, and
  // each garden tree in a building's drawing (Painter.swayFrom) – sheared
  // about its foot, so the foot stays put and the top swings – by a few
  // sines over each other, their phase running across the map so gusts
  // roll through. `time` simulated seconds, `strength` how far a top leans
  // per height (config.weather.wind).
  //
  // Every lean repaints the map's whole object layer, so it is kept in
  // budget (TREE_SWAY): only trees on screen, at most `most` of them – a
  // share of those in view, picked by a hash of where each stands so the
  // same ones keep swaying as the view moves – only this close or closer,
  // and `fps` times a second.
  swayTrees(time, strength) {
    const S = TREE_SWAY;
    const on = strength > 0 && this.drawn.zoom >= S.minZoom;
    if (!on && this.swayIdle) return;
    if (on && time >= this.swayTime && time - this.swayTime < 1 / S.fps) return;
    this.swayTime = time;
    const units = [];
    for (const e of this.objs.values()) {
      if (!e.shown) continue;
      if (e.swayAt !== e.at) this.swayUnits(e);
      for (const u of e.sway) units.push(u);
    }
    const share = on ? Math.min(1, S.most / Math.max(1, units.length)) : 0;
    for (const u of units) {
      let k = 0;
      if (u.h < share) {
        const lean = strength * (0.6 * Math.sin(time * 1.3 - u.ph) + 0.3 * Math.sin(time * 2.9 - u.ph * 1.7 + 1.1) + 0.25);
        k = Math.round(lean * 400) / 400;
      }
      if (k === u.lean) continue;
      u.lean = k;
      if (k) u.el.setAttribute('transform', `matrix(1 0 ${k} 1 ${r2(-k * u.foot[1])} 0)`);
      else u.el.removeAttribute('transform');
    }
    this.swayIdle = !on;
  }

  // What leans in an object's drawing: a forest clump whole, or the garden
  // trees in a building's ({ el, foot, h: hash in [0, 1), ph: phase }).
  swayUnits(e) {
    e.swayAt = e.at;
    e.sway = [];
    const unit = (el, foot) => {
      const h = Math.abs(Math.sin(foot[0] * 12.9898 + foot[1] * 78.233) * 43758.5453) % 1;
      e.sway.push({ el, foot, h, ph: foot[0] * 0.03 + foot[1] * 0.05, lean: 0 });
    };
    if (e.key[0] === 'f') {
      const f = this.world.features.get(Number(e.key.slice(1)));
      if (!f) return;
      const [nx, ny] = this.world.grid.xy(f.node);
      unit(e.g, this.project(nx + f.ox, ny + f.oy));
    } else if (e.key[0] === 's') {
      for (const el of e.g.querySelectorAll('g.sway')) unit(el, el.dataset.foot.split(' ').map(Number));
    }
  }

  cull(entries = [...this.objs.values(), ...this.ghosts.values()]) {
    if (!this.viewBox) return;
    for (const e of entries) {
      const show = !this.hiddenKinds.has(e.key?.[0]) && !this.inWoods(e) && (!e.box || !this.cullOn || this.inView(e.box));
      if (show === e.shown) continue;
      e.shown = show;
      if (show && e.stale) this.objsDirty.add(e.key); // drawn for an old view: redraw (renderObjects)
      // out of sight is out of the page, not just hidden: the browser still
      // restyles hidden elements whenever the line widths change (--stroke)
      if (show) {
        this.layers.lots.appendChild(e.lg);
        this.layers.shadows.appendChild(e.sg);
        this.objsPlace = true; // its drawing goes back in its place (placeObjects)
      } else {
        e.g.remove();
        e.lg.remove();
        e.sg.remove();
      }
    }
  }

  // Is it a tree in a wood, while the woods are drawn as one shape each?
  inWoods(e) {
    return this.woodsOn && e.key?.[0] === 'f' && this.forestState().trees.has(Number(e.key.slice(1)));
  }

  // The woods (forest.js), found again after trees come or go.
  forestState() {
    if (!this.forests) {
      const { world, config } = this;
      const ways = new SegmentIndex([...networkPolylines(world.networks.road, config.road), ...networkPolylines(world.networks.rail, config.rail)]);
      this.forests = findForests(world, config.render.forest, ways);
      if (this.woodsOn) queueMicrotask(() => this.cull()); // trees that joined or left a wood
    }
    return this.forests;
  }

  renderForest() {
    const svg = this.woodsOn ? forestSVG(this.forestState(), (x, y) => this.project(x, y), this.config.render.forest, this.camera) : '';
    if (svg !== this.forestDrawn) this.layers.forest.innerHTML = this.forestDrawn = svg;
  }

  // Put the drawings of the objects in sight back in the objects layer, in
  // the painter's order (this.order): after cull() showed some again.
  placeObjects() {
    this.objsPlace = false;
    if (!this.order) return;
    const live = new Set([...this.objs.values(), ...this.ghosts.values()]);
    placeInOrder(this.layers.objects, this.order.filter((e) => e.shown !== false && live.has(e)).map((e) => e.g));
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

  // Trains: close up models, further out a filled square per carriage,
  // coupled by a line. Carriages beyond where the exits fade out are left
  // out. First the signs at level crossings (crossings.js), close up only:
  // under the trains, their flashing lights over everything.
  renderTrains() {
    if (this.camera.zoom >= VEHICLES.minZoom) this.renderCrossings();
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

  // Canoes (sim/boats.js): close up the boat and its crew (people.js),
  // further out its outline inked in. Under a bridge they're out of sight.
  // One put in by a house grows there, as people do out of a building.
  renderBoats() {
    if (!this.boats) return;
    const cam = this.camera, close = cam.zoom >= VEHICLES.minZoom;
    const { deck } = this.bridgeState();
    const now = performance.now(), pop = drawEnabled() && this.agentsShown;
    const seen = new Set();
    for (const b of this.boats.visible()) {
      seen.add(b.id);
      if (!this.boatBorn.has(b.id)) this.boatBorn.set(b.id, b.home && pop ? now : -Infinity);
      if (deck(b.x, b.y) > 0) continue;
      const [sx, sy] = this.project(b.x, b.y);
      if (!this.pen.onScreen(sx, sy)) continue;
      const heading = headingIndex(b.angle);
      const svg = close ? canoeSVG(cam, heading, b.crew.map((v) => v % PEOPLE.bodies), b.stroke) : canoeMarkSVG(cam, heading);
      this.pen.draw(shapesOf(svg), sx, sy, growScale(now - this.boatBorn.get(b.id)));
    }
    for (const id of this.boatBorn.keys()) if (!seen.has(id)) this.boatBorn.delete(id);
  }

  // Deer (sim/deer.js), cows and sheep (sim/livestock.js): close up the
  // pen figures (deer.js, livestock.js), mirrored to face the way they last
  // went, stepping as they walk; further out a low mark. They grow in where
  // they appear (deer among the trees they come out of) and shrink away
  // where they go.
  renderAnimals() {
    const cam = this.camera, close = cam.zoom >= VEHICLES.minZoom;
    const now = performance.now(), pop = drawEnabled() && this.agentsShown;
    const seen = new Set();
    const all = function* (systems) { for (const s of systems) if (s) yield* s.visible(); };
    for (const d of all([this.deer, this.livestock])) {
      seen.add(d.id);
      const farm = d.kind === 'cow' || d.kind === 'sheep';
      let el = this.deerEls.get(d.id);
      if (!el) this.deerEls.set(d.id, el = { born: pop ? now : -Infinity });
      const [sx, sy] = this.project(d.x, d.y);
      const stride = farm ? LIVESTOCK.stride : DEER.stride;
      const pose = d.pose !== 'walk' ? d.pose : Math.floor(d.walked / stride) % 2 ? 'step' : 'stand';
      const key = close ? `${d.kind}|${pose}|${d.variant}` : `m${d.kind}`;
      if (el.key !== key) {
        el.key = key;
        el.shapes = close ? shapesOf(farm ? livestockSVG(d.kind, pose, d.variant) : deerSVG(d.kind, pose, d.variant))
          : [shape('walker', farm ? livestockMark(d.kind) : deerMark(d.kind))];
      }
      const [fx] = this.project(d.x + Math.cos(d.facing) * 0.1, d.y + Math.sin(d.facing) * 0.1);
      if (Math.abs(fx - sx) > 1e-4) el.mirror = close && fx < sx;
      el.sx = sx;
      el.sy = sy;
      // bobbing as it walks, as the walkers do (placePerson): squashed
      // towards its feet a little at every step
      el.squash = d.pose === 'walk' && cam.zoom >= PEOPLE.bobZoom ? 1 - PEOPLE.bob * Math.abs(Math.sin((d.walked / stride) * Math.PI)) : 1;
      this.pen.draw(el.shapes, sx, sy, growScale(now - el.born), el.mirror, 0, el.squash);
    }
    for (const [id, el] of this.deerEls) {
      if (seen.has(id)) continue;
      this.deerEls.delete(id);
      if (pop) this.deerGone.add(Object.assign(el, { gone: now }));
    }
    for (const el of this.deerGone) {
      const k = shrinkScale(now - el.gone);
      if (k > 0) this.pen.draw(el.shapes, el.sx, el.sy, k, el.mirror, 0, el.squash);
      else this.deerGone.delete(el);
    }
  }

  // People and vehicles grow out of the building they leave and shrink back
  // into the one they reach (a car parking, a walker getting into a car…).
  // Each agent keeps a little record (`el`) of what it looks like: its
  // shapes, where it stands, which way it faces.
  renderAgents() {
    const now = performance.now();
    const pop = drawEnabled() && this.agentsShown;
    // the share of walkers under an umbrella (config.weather.people), the
    // same for everyone this frame
    this.umbrellas = this.config.weather?.people?.[this.world.weather?.kind]?.umbrellas ?? 0;
    const close = this.camera.zoom >= VEHICLES.minZoom;
    for (const a of this.agents.visible()) {
      const kind = a.bus ? 'bus' : a.truck ? 'truck' : a.trip.mode === 'drive' ? 'car' : a.trip.mode === 'cycle' ? 'cyclist' : 'walker';
      let el = this.agentEls.get(a.id);
      if (el && el.kind !== kind) {
        this.agentGone(el, now, pop);
        el = null;
      }
      if (!el) {
        el = agentEl(kind, pop ? now : -Infinity);
        this.agentEls.set(a.id, el);
      }
      el.seen = now; // (gone: not seen this frame)
      const k = growScale(now - el.born);
      if (kind === 'truck' || kind === 'bus') {
        this.placeVehicle(el, a, kind === 'bus' ? 'bus' : truckFor(a.id));
        this.drawAgent(el, k);
        continue;
      }
      const [wx, wy] = wobble(a.x, a.y); // on the swaying road
      const [sx, sy] = this.projectDeck(a.x + wx, a.y + wy, 0.04);
      // off screen: not placed (choosing a model, leaning it, stepping),
      // which zoomed in is most of the work; only where it is is kept, so
      // its ghost shrinks in the right place if it goes in meanwhile
      if (!this.pen.onScreen(sx, sy)) {
        el.sx = sx;
        el.sy = sy;
        continue;
      }
      if (kind === 'car') {
        this.placeCar(el, a);
        // further out a car is a square dot: leaning it wouldn't show, and
        // finding the lean is four projections per car per frame
        if (close) {
          const t = ((el.heading ?? 0) / VEHICLES.headings) * Math.PI * 2, ux = Math.cos(t) * 0.08, uy = Math.sin(t) * 0.08;
          el.shear = this.slopeShear([a.x + wx - ux, a.y + wy - uy], [a.x + wx + ux, a.y + wy + uy]);
        } else el.shear = 0;
      }
      // facing left: mirrored
      el.mirror = kind !== 'car' && this.placePerson(el, a, kind, sx);
      el.sx = sx;
      el.sy = sy;
      this.drawAgent(el, k);
    }
    for (const [id, el] of this.agentEls) {
      if (el.seen !== now) {
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
    if (!pop || !el.shapes && !el.parts) return; // (never placed: never seen)
    el.gone = now;
    this.agentGhosts.add(el);
  }

  // Draw an agent at size k, scaled about its foot. A truck or bus far out
  // is one path in scene coordinates and fades instead.
  drawAgent(el, k) {
    const pen = this.pen;
    if (el.kind !== 'truck' && el.kind !== 'bus') return pen.draw(el.shapes, el.sx, el.sy, k, el.mirror, el.shear ?? 0, el.squash ?? 1);
    if (el.key === 'dot') {
      if (el.path && pen.onScreen(el.dot[0], el.dot[1])) pen.drawScene(AGENT_STYLES.truck, el.path, k < 1 ? Math.max(0, k) : 1);
      return;
    }
    for (const p of el.parts) pen.draw(p.shapes, p.sx, p.sy, k, false, el.shear ?? 0);
  }

  // Vehicles are drawn level; on a slope this leans one from `back` to
  // `front` (world [x, y]) the way the ground does: the shear (y += k·x in
  // its drawing, about its middle) that lifts its front on screen by as much
  // more than its back as the ground (or a bridge deck) lifts it. Seen
  // nearly end-on it's left level.
  slopeShear(back, front) {
    const cam = this.camera;
    const [, ay] = this.projectDeck(...front), [, by] = this.projectDeck(...back);
    const [a0x, a0y] = cam.project(...front, 0), [b0x, b0y] = cam.project(...back, 0);
    const dx = a0x - b0x;
    if (Math.abs(dx) < 0.3 * Math.hypot(dx, a0y - b0y)) return 0;
    return Math.max(-1, Math.min(1, (ay - by - (a0y - b0y)) / dx));
  }

  // A train: close up a locomotive and coaches (src/render/vehicles.js),
  // each turned along the track and drawn back to front, further out a line
  // of square dots. `cars`: [{ i (index in the train), p: [x, y, dx, dy] }].
  // Signs at level crossings, and at closed road crossings their lights
  // flashing in turn.
  renderCrossings() {
    const cam = this.camera, t = performance.now() / 1000;
    const lit = litLight(t);
    for (const c of this.trains.crossingList()) {
      const closed = c.kind === 'road' && this.trains.closed.has(c.id);
      for (const sign of signsAt(c)) {
        const [sx, sy] = this.projectDeck(sign.x, sign.y, 0);
        if (!this.pen.onScreen(sx, sy)) continue;
        this.pen.draw(shapesOf(signSVG(cam, sign.heading, sign.kind)), sx, sy);
        if (closed) this.penTop.draw(shapesOf(flashSVG(cam, sign.heading, lit)), sx, sy);
      }
    }
  }

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
      .map(({ i, p: [x, y, dx, dy] }) => ({ i, x, y, a: Math.atan2(dy, dx), h: headingIndex(Math.atan2(dy, dx)), depth: cam.depth(x, y) }))
      .sort((a, b) => a.depth - b.depth);
    const key = `${cam.rotation}|${order.map((c) => `${c.i}:${c.h}`).join(',')}`;
    if (el.key !== key) {
      el.key = key;
      el.shapes = order.map((c) => shapesOf(vehicleSVG(cam, `${c.i ? 'coach' : 'loco'}:${len}`, c.h, c.i % VEHICLES.hands)));
    }
    const half = len / 2;
    order.forEach((c, k) => {
      const [sx, sy] = this.projectDeck(c.x, c.y, 0);
      const [ux, uy] = [Math.cos(c.a), Math.sin(c.a)];
      const shear = this.slopeShear([c.x - ux * half, c.y - uy * half], [c.x + ux * half, c.y + uy * half]);
      penFor(c.x, c.y).draw(el.shapes[k], sx, sy, 1, false, shear);
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
    el.shear = this.slopeShear(back, front);
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
    const body = (el.body ??= bodyFor(a.id));
    if (el.at) {
      const dx = a.x - el.at[0], dy = a.y - el.at[1];
      if (dx * dx + dy * dy > 1e-8) el.heading = headingIndex(Math.atan2(dy, dx));
      if (Math.abs(sx - el.sx) > 1e-3) el.left = sx < el.sx;
      // steps by the way walked, so one standing still stands still; each
      // starts on its own foot so a crowd doesn't bob in step
      el.walked = (el.walked ?? body / PEOPLE.bodies * PEOPLE.stride) + Math.hypot(dx, dy);
    }
    el.at = [a.x, a.y];
    el.squash = kind === 'walker' && cam.zoom >= PEOPLE.bobZoom && el.walked !== undefined
      ? 1 - PEOPLE.bob * Math.abs(Math.sin((el.walked / PEOPLE.stride) * Math.PI))
      : 1;
    const close = cam.zoom >= VEHICLES.minZoom;
    const heading = el.heading ?? 0;
    // in the rain most walkers (this.umbrellas, from config.weather.people)
    // put up an umbrella; who does is fixed per walker, so worked out once
    const share = this.umbrellas;
    const brolly = kind === 'walker' && share > 0 && ((el.brolly ??= bodyFor(`${a.id}u`)) + 0.5) / PEOPLE.bodies <= share;
    const key = !close ? 'dot' : kind === 'cyclist' ? `c${body}|${heading}|${cam.rotation}` : `w${body}${brolly ? 'u' : ''}`;
    if (el.key !== key) {
      el.key = key;
      el.shapes = !close ? [shape(kind, personMark(kind, a.id))]
        : shapesOf(kind === 'cyclist' ? cyclistSVG(cam, heading, body) : walkerSVG(body, brolly));
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

// What renderAgents keeps about one agent, with every field it may get set
// up front in one order (all undefined until then): read for thousands of
// agents every frame, records that grew their fields in different orders
// would make each read a slow lookup in the engine.
function agentEl(kind, born) {
  return {
    kind, born, seen: 0, gone: undefined, key: undefined, shapes: undefined, parts: undefined, body: undefined,
    model: undefined, brolly: undefined, at: undefined, heading: undefined, walked: undefined, left: undefined,
    squash: undefined, mirror: undefined, shear: undefined, sx: 0, sy: 0, dot: undefined, path: undefined,
  };
}
