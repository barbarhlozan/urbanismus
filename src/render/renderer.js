// SVG renderer. The scene is split into layers, each rebuilt only when the
// world events that affect it fire. Layer order (back to front):
//
//   terrain  – contour lines (grey, index lines labelled; only while
//              `contours` is on), the brows (where a hill turns away out
//              of sight, brows.js; always), the rock faces (rocks.js),
//              faint lines on slopes too steep to build on (steep.js;
//              outside the terrain view) and water hatching; in its own
//              <svg id="ground"> underneath the map
//   meadow   – grass and wild flowers on open ground (meadow.js), in
//              chunks rebuilt near a change and culled with the view
//   lots     – flat ground drawing of structures and their surroundings
//              (lawns, paving, parking lines); built together with objects
//   paths    – footpaths
//   rails    – railways: the map symbol, a solid line with dashes inside;
//              close up the track itself (trackItems)
//   roads    – roads + driveways (for buildings without surroundings);
//              over the railways, so level crossings read as road
//   shadows  – the hatched shadows buildings cast on the ground
//              (shadows.js); built together with objects, over the roads
//              so a shadow runs on across the street
//   parked   – parked cars (hollow squares) in parking lots
//   trains   – one railcar each (an oblong)
//   agents   – moving dots; sit under objects so buildings hide them correctly
//   mist     – mist lying in the valleys (mist.js): paper over everything
//              below it; what stands in it is cut by its own cover
//   objects  – structures, features and street lamps, depth sorted together
//   overlay  – tool previews, hover
//
// To add a layer: add its name to LAYERS, write render<Name>(), and mark it
// dirty from the events that should refresh it.
//
// This file keeps the set-up, the frame loop and what everything shares;
// the rest of Renderer's methods are in ./renderer/, by topic: terrain.js
// (meadow, contours, brows, water), networks.js (roads, paths, rails,
// fences), objects.js and plots.js (structures, trees, lamps and their
// ground), light.js (sun, shadows, night), nature.js (forest, mist, smoke,
// fire), movers.js (trains, people, cars, animals) and view.js (panning,
// turning, level of detail). Each is a class whose methods are copied onto
// Renderer.prototype (below the class), so they all share `this`.
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

import { THEME, mixColour } from '../theme.js';
import { STYLE } from './style.js';
import { LOOK, wobble } from './painter.js';
import { GLLines } from './gl/lines.js';
import { GLMovers } from './gl/movers.js';
import { GLShadows } from './gl/shadows.js';
import { GLNight } from './gl/night.js';
import { InkLayer } from './ink.js';
import { ParticleCanvas } from './particles.js';
import { FireCanvas } from './fire.js';
import { STRUCTURE_TYPES } from '../../structures/index.js';
import { SPREAD } from '../../structures/plots.js';
import { densify } from './warp.js';
import { MEADOW } from './meadow.js';
import { SUN_FREE } from './sunFree.js';
import { MAP_PATTERNS } from './patterns.js';
import { SVGNS, VIEW_SETTLE, GL_LINES, TERRAIN_LINES, NO_COVER, r2 } from './renderer/shared.js';
import { TerrainDrawing } from './renderer/terrain.js';
import { NetworkDrawing } from './renderer/networks.js';
import { ViewMotion } from './renderer/view.js';
import { ObjectDrawing } from './renderer/objects.js';
import { PlotDrawing } from './renderer/plots.js';
import { LightDrawing } from './renderer/light.js';
import { NatureDrawing } from './renderer/nature.js';
import { MoverDrawing } from './renderer/movers.js';

// (gallery.html and others import these from here)
export { agentShape } from './marks.js';
export { mergeRuns } from './order.js';

const LAYERS = ['terrain', 'meadow', 'lots', 'forest', 'hillshade', 'shadows', 'parked', 'trains', 'agents', 'mist', 'objects', 'overlay'];
const TOP = ['mist', 'objects', 'overlay']; // in the #objects <svg>, see the constructor

// The squash of a building pointed at (Renderer.markHovered): how long, the
// share of it spent going down, and how much it's pressed down and spread.
const SQUASH = { ms: 300, down: 0.3, press: 0.07, spread: 0.035 };

export class Renderer {
  constructor(svg, ground, { world, camera, agents, trains, boats, deer, livestock, parking, config }) {
    this.svg = svg;
    this.ground = ground;
    // Buildings, trees and the overlay sit in their own <svg> on top, in
    // their own wrapper (#view-top), over the canvas with the moving people
    // and trains (gl/movers.js). See styles.css.
    this.top = document.getElementById('objects');
    // the parked cars in an <svg> of their own over the shadows' canvas
    // (gl/shadows.js), in the map's wrapper
    this.parkedSvg = document.getElementById('parked');
    this.wrappers = [svg.parentNode, this.top.parentNode];
    this.pen = GLMovers.make(document.getElementById('agents'));
    // over the buildings: carriages nothing nearer could hide (see screened)
    this.penTop = GLMovers.make(document.getElementById('trains-top'));
    // over those: chimney smoke (particles.js, smokeFrame)
    this.smoke = new ParticleCanvas(document.getElementById('smoke'));
    // and over them a building on fire (fire.js, fireFrame)
    this.fire = new FireCanvas(document.getElementById('fire'), world);
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
    this.rebuildQueue = new Set(); // object keys to redraw for a new level of detail (rebandObjects)
    this.rebuildOrder = null; // the same, nearest the middle last, once the view has settled (frame)
    this.rebuildCost = 1;     // ms that redrawing one of them took lately (frame)
    this.landing = new Set();   // object keys a turn rested on before they were drawn there (landFrame)
    this.landingOrder = null;
    this.hiddenKinds = new Set(); // TEMPORARY (debug panel): objects hidden by key letter, 's' buildings, 'f' trees, 'k' street lamps…
    this.contours = STYLE.contours;
    this.meadow = new Map();        // chunk key 'cx,cy' -> { g, box, svg, shown }
    this.meadowDirty = new Set();   // chunk keys to rebuild
    this.mistRisen = 0;             // how far up the mist is, 0–1 (setMist)

    ground.innerHTML = '<g class="scene"><g class="layer-terrain"></g></g>';
    svg.innerHTML = `
      <defs>${MAP_PATTERNS}</defs>
      <g class="scene">${LAYERS.filter((l) => !TOP.includes(l) && l !== 'terrain' && l !== 'parked').map((l) => `<g class="layer-${l}"></g>`).join('')}</g>`;
    this.parkedSvg.innerHTML = '<g class="scene"><g class="layer-parked"></g></g>';
    this.top.innerHTML = `<g class="scene">${TOP.map((l) => `<g class="layer-${l}${l === 'overlay' ? ' overlay' : ''}"></g>`).join('')}</g>`;
    const svgOf = (l) => (l === 'terrain' ? ground : l === 'parked' ? this.parkedSvg : TOP.includes(l) ? this.top : svg);
    this.svgs = [svg, ground, this.top, this.parkedSvg];
    this.scenes = [ground, svg, this.parkedSvg, this.top].map((s) => s.querySelector('.scene'));
    this.layers = Object.fromEntries(LAYERS.map((l) => [l, svgOf(l).querySelector(`.layer-${l}`)]));
    // the shadows: the hills' shapes (hillShadows.js) and the lamps' pools
    // left out of them, kept in a mask the browser never paints, and a
    // group for each object holding what it casts (gl/shadows.js
    // castInto) – the paper's strokes are drawn through them all with
    // WebGL (gl/shadows.js), the same strokes for all, so where a tree
    // stands in a hill's shadow the two are one; the layers 'shadows' and
    // 'hillshade' are the mask's groups
    const veil = this.layers.shadows;
    veil.innerHTML = '<mask id="shade-mask" class="shade-mask" maskUnits="userSpaceOnUse"><g class="hill-shapes"></g><g class="shade-shapes"></g><g class="lights-cut"></g></mask>';
    this.shadeVeil = veil;
    this.glShadows = GLShadows.make(document.getElementById('shade-canvas'), veil);
    this.layers.shadows = veil.querySelector('.shade-shapes');
    this.layers.hillshade.remove();
    this.layers.hillshade = veil.querySelector('.hill-shapes');
    // the night (gl/night.js), on two canvases drawn every frame
    // (renderNightCanvases): a grey and a sheet of the paper's strokes on
    // the ground, under the cars and trains, and over the objects, only
    // where they stand (their outlines, Painter.covers) – each leaving out
    // the lights (renderLights): the ground's the lamps' pools and the
    // windows' light (glGround), the objects' their outlines and lights in
    // order (glCover); the lamps' pools are cut out of the shadows' masks
    // too (lightCuts). While the view turns the objects go without.
    // the map's drawings hold for any sun (sunFree.js): a stylesheet shows
    // what the light has now (updateSunStyle)
    SUN_FREE.on = true;
    this.sunCss = document.head.appendChild(document.createElement('style'));
    this.sunCss.id = 'sun-free';
    this.makeGlObjects();
    this.makeGlMirrors();
    this.glNight = ['night-ground', 'night-top'].map((id) => GLNight.make(document.getElementById(id)));
    if (this.glNight.some((n) => !n)) this.glNight = null;
    this.glGround = [];
    this.glCover = NO_COVER;
    this.nightGrey = 0; // the grey as shown, easing to this.gloom
    this.lightCuts = [...veil.querySelectorAll('.lights-cut')];
    // hover rings and tags on their way out, over the overlay (see letGo)
    this.leaving = this.layers.overlay.parentNode.appendChild(document.createElementNS(SVGNS, 'g'));
    this.leaving.setAttribute('class', 'overlay leaving');
    // the roads, footpaths, railways and fences on the GPU (gl/lines.js),
    // their pen's timing in ink layers (ink.js)
    this.glLines = GLLines.make(document.getElementById('map-gl'));
    // …and the terrain's lines, under the world's layers, so they turn with
    // the roads over the hills (renderTerrain): their styles asked of
    // shapes with their classes, never drawn
    this.glTerrain = GLLines.make(document.getElementById('terrain-gl'));
    if (this.glTerrain) {
      this.terrainProbe = this.ground.appendChild(document.createElementNS(SVGNS, 'g'));
      this.terrainProbe.innerHTML = Object.values(TERRAIN_LINES).map((cls) => `<path class="${cls}"/>`).join('');
    }
    this.ink = {
      roads: new InkLayer(['road-wash', 'road-wash-exit', 'driveway', 'road', 'kerb', 'zebra', 'road-exit', 'bridge', 'bridge-post']),
      paths: new InkLayer(['path-wash', 'footpath', 'bridge', 'bridge-post']),
      rails: new InkLayer(['rail-exit', 'rail-buffer', 'rail', 'rail-dash', 'track-bed', 'track-sleeper', 'track-rail', 'track-exit', 'bridge', 'bridge-post']),
      fences: new InkLayer(['fence-post', 'fence-pillar', 'fence']),
    };
    this.buildOrder = new Map(); // network layer -> Map dot -> its place in the last build, for the pen

    this.dirty = new Set();
    this.viewOnly = new Set(); // objects to redraw only for a new view of the same town (land)
    this.parkedEls = new Map(); // structure id -> { g, html }, its parked cars
    this.parkedDirty = new Set(); // structure ids whose cars changed
    this.invalidate();

    const on = (type, ...layers) => world.events.on(type, () => layers.forEach((l) => this.dirty.add(l)));
    const near = (s) => {
      const points = world.nodesOf(s).map((n) => world.grid.xy(n));
      this.touchAround(points);
      this.touchAround(points, 3, true); // gardens spreading round it (plotFor)
    };
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
        this.touchAround([[f.x, f.y]], 2, true); // gardens spreading round it
        this.forests = null; // found again (forestState)
        this.dirty.add('forest');
        this.touchMeadow([[f.x, f.y]]);
      });
    }
    for (const k of ['s', 'f']) {
      const kind = k === 's' ? 'structure' : 'feature';
      world.events.on(`${kind}:added`, (o) => this.born.set(`${k}${o.id}`, null));
      world.events.on(`${kind}:removed`, (o) => this.dying.add(`${k}${o.id}`));
    }
    on('roads:changed', 'roads');
    // road marks: whether a building is reached, and where its mark goes
    // fences: gaps where roads and railways cross them
    on('fences:changed', 'fences');
    on('paths:changed', 'fences'); // (gates)
    on('roads:changed', 'fences');
    on('rails:changed', 'fences');
    // street lamps: new streets get theirs drawn in, gone ones erased
    for (const type of ['roads:changed', 'paths:changed', 'rails:changed']) world.events.on(type, () => this.touchStreets());
    on('paths:changed', 'paths');
    on('fences:changed', 'paths'); // (a gate holds the footpath to its dot, roads/meander.js)
    on('rails:changed', 'rails');
    on('roads:changed', 'rails'); // the track stops at level crossings
    on('paths:changed', 'rails');
    for (const type of ['roads:changed', 'paths:changed']) world.events.on(type, () => (this.roadLines = null));
    // the railway's and footpaths' lines on the ground (railItems,
    // pathItems): level crossings, stations' tracks, parks and squares
    for (const type of ['rails:changed', 'roads:changed', 'paths:changed', 'fences:changed', 'terrain:changed', 'structure:added', 'structure:removed', 'structure:changed']) {
      world.events.on(type, () => (this.railLines = this.pathLines = null));
    }
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
    on('terrain:changed', 'terrain', 'meadow', 'paths', 'rails', 'roads', 'fences');
    world.events.on('terrain:changed', () => {
      this.worldStamp = null; // (the lines on the ground in world space, worldLine)
      this.objsAll = this.worldAll = true; // (not just the view: draw them all now)
      this.roadLines = null;
      this.contourLines = null; // water breaks them
      this.steepLines = null;
      this.waterLines = null;
      this.brows = null;
      this.groundRange = null;
      this.dirty.add('mist');
    });
  }

  // Rebuild everything (e.g. after a camera rotation).
  invalidate() {
    this.roadLines = this.railLines = this.pathLines = null;
    this.worldStamp = null;
    for (const l of LAYERS) if (l !== 'agents' && l !== 'overlay' && l !== 'objects' && l !== 'lots' && l !== 'shadows') this.dirty.add(l);
    for (const l of GL_LINES) this.dirty.add(l); // (drawn with WebGL: no layer of their own)
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

  // A building's own drawing – its walls, roofs and windows – without its
  // yard and plot (Painter.merge's `aside`: garden, sheds, fences, cars)
  // or any tree, which are drawn in among its parts, nearer or further.
  // [] when it isn't drawn.
  buildingParts(key) {
    const g = this.objs.get(key)?.g;
    return g?.isConnected ? [...g.children].filter((el) => !el.matches('.aside, .sway, .glyph, .tree')) : [];
  }

  // Where a building's own drawing is on screen (window px: left, top,
  // right, bottom), or null when it isn't drawn.
  buildingBox(key) {
    let box = null;
    const gl = this.glObjects, cam = this.camera;
    for (const el of this.buildingParts(key)) {
      // (with WebGL the drawing isn't laid out: its box from gl/objects.js)
      const b = gl?.boxOf(el);
      const r = b ? { left: cam.panX + cam.zoom * b[0], top: cam.panY + cam.zoom * b[1], width: cam.zoom * (b[2] - b[0]), height: cam.zoom * (b[3] - b[1]) } : el.getBoundingClientRect();
      if (b) Object.assign(r, { right: r.left + r.width, bottom: r.top + r.height });
      if (!r.width && !r.height) continue;
      box = box ? { left: Math.min(box.left, r.left), top: Math.min(box.top, r.top), right: Math.max(box.right, r.right), bottom: Math.max(box.bottom, r.bottom) }
        : { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    }
    return box;
  }

  // The building under the pointer (an objs key, 's12', or null): it gives
  // a little squash as the pointer comes onto it – pressed down from the
  // roof and spreading a touch, standing on its ground, then back up,
  // settling without a bounce – once each time it's pointed at, so it reads
  // as something to click. Only the building: its garden stands still.
  // Its parts are drawn in among the yard's, so each is squashed on its
  // own about the same point, the middle of the building's base. Not while
  // it slides in a turn of the view. Set by main.js; frame() applies it.
  markHovered() {
    const key = this.hovered ?? null;
    if (key === this.hoveredKey) return;
    this.hoveredKey = key;
    const entry = key ? this.objs.get(key) : null;
    if (!entry || entry.slid || entry.shown === false || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const parts = this.buildingParts(key);
    let x0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const el of parts) {
      const gb = this.glObjects?.boxOf(el); // (with WebGL: not laid out)
      const b = gb ? { x: gb[0], y: gb[1], width: gb[2] - gb[0], height: gb[3] - gb[1] } : el.getBBox();
      if (!b.width && !b.height) continue;
      x0 = Math.min(x0, b.x); x1 = Math.max(x1, b.x + b.width); y1 = Math.max(y1, b.y + b.height);
    }
    if (!(x1 > x0)) return;
    const px = r2((x0 + x1) / 2), py = r2(y1);
    const start = performance.now();
    const run = (entry.squash = {});
    const step = (now) => {
      if (entry.squash !== run) return; // (pointed at again: the new one goes on)
      const t = Math.min(1, (now - start) / SQUASH.ms);
      // down quickly, easing in to the deepest point, then slowly back up
      const f = t < SQUASH.down ? 1 - (1 - t / SQUASH.down) ** 2 : (1 - (t - SQUASH.down) / (1 - SQUASH.down)) ** 2;
      const k3 = (n) => Math.round(n * 1000) / 1000;
      const sx = k3(1 + SQUASH.spread * f), sy = k3(1 - SQUASH.press * f);
      const tf = t < 1 ? `translate(${px} ${py}) scale(${sx} ${sy}) translate(${-px} ${-py})` : null;
      for (const el of parts) tf ? el.setAttribute('transform', tf) : el.removeAttribute('transform');
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
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
    for (const ink of Object.values(this.ink)) if (ink.busy) ink.tick();
    // mid-turn the map is drawn by turnFrame: what else changes meanwhile
    // waits until the view rests
    if (this.turning) this.turnFrame();
    else {
      if (this.camera.angle !== this.styleAngle) this.updateSunStyle(); // (the trees' light on screen turns with the view)
      this.followSun();
      for (const layer of this.dirty) this[`render${layer[0].toUpperCase()}${layer.slice(1)}`]?.();
      this.dirty.clear();
      if (this.meadowDirty.size) this.renderMeadow(this.meadowDirty);
      if (this.parkedDirty.size) this.renderParked(this.parkedDirty);
      // a new level of detail: the objects in sight, as many as fit in
      // config.render.rebuildBudget ms by what they took so far (rebandObjects),
      // once the view has settled – each batch repaints the whole objects layer
      let batch = this.landFrame();
      if (this.rebuildQueue.size && !this.objsAll && performance.now() - this.movedAt > VIEW_SETTLE) {
        this.rebuildOrder ??= this.nearestLast(this.rebuildQueue);
        const n = Math.max(1, Math.floor(this.config.render.rebuildBudget / this.rebuildCost));
        while (batch < n && this.rebuildOrder.length) {
          const key = this.rebuildOrder.pop();
          this.rebuildQueue.delete(key);
          const e = this.objs.get(key);
          if (!e?.stale) continue;
          this.objsDirty.add(key);
          if (e.redetail && !e.bandStale) this.viewOnly.add(key); // (its views still hold)
          batch++;
        }
      }
      if (this.objsAll || this.objsDirty.size) {
        const t0 = performance.now();
        const n = this.objsDirty.size;
        this.renderObjects();
        if (batch) this.rebuildCost += ((performance.now() - t0) / n - this.rebuildCost) * 0.3;
        this.viewOnly.clear();
        this.preparedAt = null;
      }
      if (this.objsPlace) this.placeObjects();
      this.schedulePrepare();
      if (this.drafting && performance.now() - this.movedAt > VIEW_SETTLE) this.endDraft();
      // (drawn first, shown once its drawing is back: renderShadeCanvas)
      if (this.shadesOff && !this.rebuildQueue.size && !this.landing.size && performance.now() - this.movedAt > VIEW_SETTLE) {
        if (this.shadesComing && (this.glShadows?.current ?? true)) this.showShadows();
        else this.shadesComing = true;
      }
    }
    if (this.ghosts.size) this.reapGhosts();
    const now = performance.now();
    this.renderNightCanvases(Math.min(0.1, (now - (this.nightAt ?? now)) / 1000));
    this.nightAt = now;
    if (this.showAgents) {
      this.pen.begin(this.camera, this.strokeK);
      this.penTop.begin(this.camera, this.strokeK);
      // at night what moves is drawn in the main ink gone over to the
      // secondary, as the map (setSun)
      const pal = (this.inkShown ?? 0) > 0.005 ? { ...THEME.palette, main: mixColour(THEME.palette.main, THEME.palette.detail, this.inkShown) } : null;
      if (pal) this.pen.pal = this.penTop.pal = pal;
      this.smoke.pal = pal; // (the chimneys' smoke too, smokeFrame)
      this.renderBoats();  // on the water, under everything else that moves
      this.renderAnimals();
      this.renderTrains(); // under the people and cars (or over everything)
      this.renderAgents();
      this.pen.end(); // (drawn at the frame's end, gl/movers.js)
      this.penTop.end();
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
    this.markHovered();
    this.renderShadeCanvas();
    this.renderGlLines();
    this.renderGlTerrain();
    this.renderGlObjects();
    this.renderGlMirrors();
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

  // A line as screenLines has it short of the view: on the ground in world
  // space – the sway, the deck, the relief and the warp in, so the camera
  // alone places it (gl/lines.js). [[x, y, z]…]; kept per line while the
  // terrain and the bridges are the same (the ground lines are kept too,
  // groundLines).
  worldLine(line, sway = false, deck = false) {
    sway = sway && LOOK.roads > 0;
    const cam = this.camera, onDeck = deck ? this.bridgeState().deck : null;
    const stamp = `${this.bridgeKey}|${sway}|${deck}`;
    if (this.worldStamp !== stamp) {
      this.worldStamp = stamp;
      this.worldCache = new WeakMap();
    }
    const kept = this.worldCache.get(line);
    if (kept) return kept;
    let pts = line;
    if ((cam.warp || cam.lift || sway || onDeck) && !(pts[0]?.length > 2)) pts = densify(pts);
    const out = pts.map(([x, y, z]) => {
      let h = z ?? (onDeck ? onDeck(x, y) : 0);
      if (sway) {
        const [dx, dy] = wobble(x, y);
        [x, y] = [x + dx, y + dy];
      }
      if (cam.lift) h += cam.lift(x, y);
      if (cam.warp) [x, y] = cam.warp(x, y);
      return [x, y, h];
    });
    this.worldCache.set(line, out);
    return out;
  }
}

// Renderer's methods are kept by topic in ./renderer/ – each file a class
// whose methods are copied onto Renderer.prototype here (all share `this`).
for (const part of [TerrainDrawing, NetworkDrawing, ViewMotion, ObjectDrawing, PlotDrawing, LightDrawing, NatureDrawing, MoverDrawing]) {
  for (const key of Object.getOwnPropertyNames(part.prototype)) {
    if (key !== 'constructor') Object.defineProperty(Renderer.prototype, key, Object.getOwnPropertyDescriptor(part.prototype, key));
  }
}

export { TREE_SWAY } from './renderer/shared.js';
