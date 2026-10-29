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
import { MIST, mistLevel, mistSurface, mistSVG, mistHatch, coverSVG, mistIn, mistOut } from './mist.js';
import { Painter, LOOK, wobble } from './painter.js';
import { VEHICLES, vehicleSVG, modelFor, truckFor, headingIndex } from './vehicles.js';
import { PEOPLE, bodyFor, walkerSVG, cyclistSVG, canoeSVG, canoeMarkSVG } from './people.js';
import { DEER, deerSVG, deerMark } from './deer.js';
import { LIVESTOCK, livestockSVG, livestockMark } from './livestock.js';
import { fenceGates } from '../sim/pastures.js';
import { drawIn, eraseOut, drawEnabled, DRAW, growScale, shrinkScale } from './draw.js';
import { GLLines } from './gl/lines.js';
import { GLMovers } from './gl/movers.js';
import { GLShadows } from './gl/shadows.js';
import { GLNight } from './gl/night.js';
import { GLObjects } from './gl/objects.js';
import { chainEdges, edgeCurve, fillet, measurePolyline, pointAt, subPolyline, streetKerbs, pathJoins, JOIN_REACH, railParts, roadEdges, roadway, keepRuns, offsetPolyline } from '../roads/geometry.js';
import { edgeKey } from '../roads/network.js';
import { InkLayer } from './ink.js';
import { AGENT_STYLES, shapesOf, shape } from './agentCanvas.js';
import { ParticleCanvas } from './particles.js';
import { FireCanvas } from './fire.js';
import { signsAt, signSVG, flashSVG, litLight } from './crossings.js';
import { stationTracks } from '../../structures/station.js';
import { STRUCTURE_TYPES, drawSeed, yardOf, joinSides, joinedRow, tiltOf, roadFront, courtSides } from '../../structures/index.js';
import { drawCourt } from '../../structures/courts.js';
import { drawRuin } from '../../structures/ruin.js';
import { YARDS } from '../../structures/yards.js';
import { drawPlot, boundaryChance, wander, SPREAD, SPREAD_DENSITY } from '../../structures/plots.js';
import { rotateQuarter, ORTHO } from '../core/grid.js';
import { pointInPolygon } from '../core/geom2d.js';
import { fitYard, fitSite, siteEdges, freeTest, pathIndex, railIndex, plotClaim } from './lots.js';
import { zebraCrossings, streetLamp, FURNITURE } from '../roads/furniture.js';
import { lamp } from '../../structures/kit.js';
import { networkPolylines } from '../roads/geometry.js';
import { SegmentIndex } from '../core/geom2d.js';
import { trodden } from './dirtPath.js';
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
import { mergeRuns, isoSort } from './order.js';
import { Camera } from './camera.js';
import { SUN, DAY, sunFor, sunOfHour, hourAt } from './shadows.js';
import { HILL_SHADOWS, hillShade, hillShadeRings } from './hillShadows.js';
import { lampPool, headBeam } from './lights.js';
import { SUN_FREE, sunStyle } from './sunFree.js';
import { treeLightSector } from '../../features/trees.js';
import { findForests, forestSVG } from './forest.js';

// (gallery.html and others import these from here)
export { agentShape } from './marks.js';
export { mergeRuns } from './order.js';

const SHORE_GAP = 0.06; // plots (props, fences) keep this clear of the drawn shore
const LAYERS = ['terrain', 'meadow', 'lots', 'forest', 'hillshade', 'shadows', 'parked', 'trains', 'agents', 'mist', 'objects', 'overlay'];
const TOP = ['mist', 'objects', 'overlay']; // in the #objects <svg>, see the constructor
const SVGNS = 'http://www.w3.org/2000/svg';
// Moving the camera (see placeView): ms it must rest before the map is
// redrawn, and how far past each window edge the map is drawn.
const VIEW_SETTLE = 150;
// A drawn element (painter.js) carrying detail class d2, or d1 / d2 (atDetail).
const DETAIL_2 = /<(?:path|polygon|polyline|circle|ellipse|rect|line)\b[^>]*\bclass="[^"]*\bd2\b[^"]*"[^>]*\/>/g;
const DETAIL_1_2 = /<(?:path|polygon|polyline|circle|ellipse|rect|line)\b[^>]*\bclass="[^"]*\bd[12]\b[^"]*"[^>]*\/>/g;
// Roof hatching (painter.js) in density tiers above n, for n = 0, 1, 2.
const ROOF_TIERS = [1, 2, 3].map((n) => new RegExp(`<(?:path|polyline)\\b[^>]*\\bclass="[^"]*\\brh[${n}-3]\\b[^"]*"[^>]*\\/>`, 'g'));
const ROOF_TIER_CLASS = / rh[1-3]\b/g;
// The bit of an object's band (Renderer.bandOf) set close up, from lod.near.
const NEAR = 64;
// The band an object is drawn with mid-turn, once the view has turned
// config.render.turnBare from where it rested (bandOf): without the
// close-up detail (level 1), its roof hatching thinned to tier 1 and a
// plainer crown, or less where its own band has less – drawn back in by
// the pen once it rests (land).
function bareOf(band) {
  const level = Math.max(1, (band >> 4) & 3), roof = Math.min(1, (band >> 2) & 3), tree = Math.max(1, band & 3);
  return (level << 4) | (roof << 2) | tree;
}
// An object's detail changes only once the zoom is this share past its
// threshold (Renderer.bandOf), so one resting on it doesn't switch to and fro.
const BAND_HOLD = 0.02;
const OVERSCAN = 0.25;
// While the view turns (Renderer.turnFrame): the layers turned as a sheet
// of paper, drawn anew once it rests, and the lines on the ground drawn at
// the turning angle every frame. Buildings, trees and lamps go their own way.
const SHEET = ['forest', 'mist', 'hillshade'];
const LINES = ['roads', 'paths', 'rails', 'fences'];
// …of which these are on the ground in world space (gl/lines.js): the
// camera turns them
const GL_LINES = ['paths', 'rails', 'roads', 'fences'];
// The terrain's lines on the GPU as well, in world space (renderGlTerrain),
// back to front, and the classes the SVG had for them, whose pens and
// colours they take (terrainStyles). The brows, worked out for the view,
// are put on the ground where they were drawn (browOnGround): a turn carries
// them with their hills until they are worked out again where it rests.
// What is drawn on the screen (the summits' marks, the water's washes)
// stays in its SVG.
const TERRAIN_LINES = {
  steep: 'steep', 'contour-d2': 'contour d2', 'contour-d1': 'contour d1', 'contour-index': 'contour index',
  'brow-light': 'brow light', brow: 'brow', 'brow-outline': 'brow outline', 'rock-face': 'rock-face', 'rock-lip': 'rock-lip',
  shore: 'shore', bank: 'bank', wave: 'wave',
};
// The steps of a whole turn (Camera.STEP); the views an object keeps of
// the steps it has been drawn at, at most (Renderer.swapIn); and ms the
// view must rest before those either side are made ready (prepareTurn).
const STEPS = Math.round((Math.PI * 2) / Camera.STEP);
const VIEWS = 12;
const PREPARE_REST = 1500;
const SETTLE_FADE = 260;
// An object's light shapes as path data, for the night's mask
// (renderLights), worked out once per drawing: its outline (Painter.covers)
// and each window's glow (a little larger than the pane) and the light it
// throws on the ground, all rings turned anticlockwise, so rings of one
// colour add up where they overlap.
function lightShapes(night, px) {
  if (night.d?.px === px) return night.d;
  const xy = ([x, y]) => `${r2(x)} ${r2(y)}`;
  const ring = (pts) => {
    let a = 0;
    for (let i = 0; i < pts.length; i++) a += pts[i][0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * pts[i][1];
    return `M${(a > 0 ? pts : [...pts].reverse()).map(xy).join('L')}Z`;
  };
  const grow = (pts, by) => {
    const cx = pts.reduce((t, p) => t + p[0], 0) / pts.length, cy = pts.reduce((t, p) => t + p[1], 0) / pts.length;
    return pts.map(([x, y]) => { const l = Math.hypot(x - cx, y - cy) || 1; return [x + ((x - cx) / l) * by, y + ((y - cy) / l) * by]; });
  };
  night.d = {
    px,
    cover: night.covers.map(ring).join(''),
    wins: night.wins.map((w) => ({ n: w.n, glow: ring(grow(w.pts, 0.04 * px)), spill: w.spill ? ring(w.spill) : '' })).sort((p, q) => p.n - q.n),
  };
  return night.d;
}

// A number from a key ('v12'), to seed by (a beam's shape, headlights).
const hashKey = (k) => [...String(k)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7);
// The densest tier of the paper's hatching (hatch.js) the shadows and the
// night keep at each level of detail: every line close up (3), every other
// further out, every 4th far out.
const SHADE_TIERS = [3, 2, 1];
const NO_COVER = [];
// Objects' box corners lifted and warped, per their points (sceneBox).
const BOX_CORNERS = new WeakMap();
// The steps of a turn either way whose drawings are made ready on the GPU
// as well (gl/objects.js), while the view rests.
const GL_AHEAD = 3; // (the objects' night while the view turns: none)
// Seconds the night's strokes take to be hatched in, a set at a time
// (renderNightCanvases); a share of the windows going out (or coming on)
// each second; ms the shadows take to be drawn anew as the sun moves
// (sweepShadows).
const NIGHT_IN = 2.4;
const INK_STEP = 0.1;
const INK_EVERY = 500;
const WINDOWS_BY = 0.06;
const SHADE_SWEEP = 1600;
// ms between the sun's moves between the day's steps (followSun)
const SUN_EVERY = 100;
// While the view turns the map is drawn in draft (goDraft): it leaves out
// the meadow's tufts, the parked cars and the buildings' and gardens' fine
// detail (styles.css, svg.draft), and the objects' shadows (cast for the
// view as it was, they would point the wrong way; the hills' stay, read
// again as it turns). Panning and zooming leave everything as it is:
// what is on the GPU is drawn anew cheaply, and the rest moves with the
// map. Once it rests the detail is back; the shadows wait until what the
// turn redraws is drawn (frame), then are hatched in in `steps`, `step`
// ms apart.
const DRAFT = { steps: 3, step: 80 };
const SWEEP_STEPS = 6; // ms the terrain as turned takes to fade, once the view rests (land)
const COS30 = Math.cos(Math.PI / 6);
// A closed outline, its points (gl/movers.js drawScene).
const outline = (pts) => ({ pts });
const r2 = (n) => Math.round(n * 100) / 100;

// The squash of a building pointed at (Renderer.markHovered): how long, the
// share of it spent going down, and how much it's pressed down and spread.
const SQUASH = { ms: 300, down: 0.3, press: 0.07, spread: 0.035 };
// An object's place among the others in when its detail changes
// (Renderer.bandOf): 0..1, seeded by its key ('s12', 'f7', 'k3-4').
// The shapes an object is drawn with, its garden and shadow (not the mist
// over it, coverMist).
function strokesOf(e) {
  return [e.lg, e.g].flatMap((g) => [...g.querySelectorAll('path,polygon,polyline,circle,ellipse,line,rect')]).filter((el) => !el.closest('.mist-cover'));
}
// Points every `step` along a polyline, from half a step in, with the
// direction there: [{ p, dir }] (a track's sleepers).
function spaced(pts, step) {
  const out = [];
  let s = step / 2;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const l = Math.hypot(bx - ax, by - ay);
    if (!l) continue;
    for (; s <= l; s += step) out.push({ p: [ax + ((bx - ax) * s) / l, ay + ((by - ay) * s) / l], dir: [(bx - ax) / l, (by - ay) / l] });
    s -= l;
  }
  return out;
}

function detailRank(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

// Trees swaying in the wind (Renderer.swayTrees): at most `most` on screen
// at once, only at zoom `minZoom` or closer, updated `fps` times a second
// (on twos, as drawn animation: each step repaints the objects whole).
export const TREE_SWAY = { most: 60, minZoom: 1.2, fps: 12 };

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
      <defs>
        <pattern id="hatch-water" patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(-40)">
          <line class="hatch" x1="0" y1="2.5" x2="5" y2="2.5"/>
        </pattern>
      </defs>
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
    const { world } = this;
    const { list: bridges, deck } = this.bridgeState();
    this.waterBridges = this.bridgeKey; // drawn broken under these (see the constructor)
    // The lines in world units, traced once per terrain (the costly part)…
    // …then broken where a bridge deck passes over, and put on screen
    const { shore, bank, wave } = this.traceWater();
    const hidden = bridges.length ? hiddenUnder(bridges, deck, this.camera) : null;
    const open = (lines) => (hidden ? lines.flatMap((pts) => keepRuns(pts, (q) => !hidden(...q), 0.04)) : lines);
    // a path per chunk of the map (as the contours): a river runs right across it
    const path = (lines, cls) => chunked(cut(lines, CONTOUR_CHUNK), CONTOUR_CHUNK).map((ls) => `<path class="${cls}" d="${this.pathData(ls, false)}"/>`).join('');
    if (lines) {
      this.terrainItems(lines, open(shore), 'shore');
      this.terrainItems(lines, open(bank), 'bank');
      this.terrainItems(lines, wave, 'wave');
      return this.washWater(shore);
    }
    return this.washWater(shore) + path(open(shore), 'shore') + path(open(bank), 'bank') + path(wave, 'wave');
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

  // The water's lines in world units, { shore, bank, wave }, traced once
  // per terrain (the costly part of renderWater).
  traceWater() {
    const { world } = this;
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

  // The main dots, each marked with why nothing could be built on it, so
  // the tool in hand shows only the dots it can use (styles.css): `steep`
  // too steep for a building, `taken` a building, road or railway on it
  // (`house`: a building – lines can't go through those either).
  // Network linework as ink items (see ink.js): `add(key, cls, line, a, b)`
  // for each piece, a / b the dots it runs between, for the pen's order.
  inkItems(sway) {
    const items = [];
    // (on the ground in world space: renderGlLines – but through a photo's
    // camera, a perspective one, projected into the picture: photo.js)
    const lines = this.camera.ahead ? (ls) => this.screenLines(ls, true, sway, true) : (ls) => ls.map((l) => this.worldLine(l, sway, true));
    const add = (key, cls, line, a, b) => {
      for (const pts of lines([line])) if (pts.length > 1) items.push({ key, cls, pts, a, b });
    };
    // several separate lines as one item (ink.js `runs`)
    const addRuns = (key, cls, ls, a, b) => {
      const runs = lines(ls).filter((pts) => pts.length > 1);
      if (runs.length) items.push({ key, cls, pts: runs[0], runs, a, b });
    };
    return { items, add, addRuns };
  }

  // A network's lines worked out on the ground, the same at any angle,
  // kept under `name` until reset (null) and only projected anew for each
  // view – every frame of a turn: `build(add, addRuns)` records them,
  // and they go to inkItems' `add` / `addRuns`. `cache` false: worked out
  // afresh and not kept.
  groundLines(name, { add, addRuns }, build, cache = true) {
    let lines = cache ? this[name] : null;
    if (!lines) {
      lines = [];
      build((...a) => lines.push([false, a]), (...a) => lines.push([true, a]));
      if (cache) this[name] = lines;
    }
    for (const [runs, a] of lines) (runs ? addRuns : add)(...a);
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
    this.inkUpdate('paths', () => this.pathItems(), this.world.networks.path);
  }

  // The footpaths' ink items (for the current camera).
  // Their lines are kept (pathLines, groundLines) until a network, a park
  // or square or the terrain changes; the bridges are found each time.
  pathItems() {
    const ink = this.inkItems(true);
    this.groundLines('pathLines', ink, (add, addRuns) => this.pathPieces(add, addRuns));
    this.addBridges('path', ink.add);
    return ink.items;
  }

  pathPieces(add, addRuns) {
    const layer = this.world.networks.path;
    // Footpaths as two narrow edges (roadEdges), stopping where the
    // roadway starts: at a plain road's edge, at a street's kerb (its
    // sidewalk carries on). Drawn as dirt paths are, not kerbs: each edge
    // in broken strokes that wander in and out (dirtPath.js), and a dead
    // end left open – the path just peters out.
    const { world } = this;
    const onRoad = roadway(world, this.config.road, this.config.lane);
    const intoSite = (n) => world.coarseAround(n).some((c) => STRUCTURE_TYPES[world.structureAt(c)?.type]?.site);
    // footpaths carrying on from a road's dead end start where the road
    // has narrowed into them (see roadItems)
    const joined = new Map([...this.pathJoins().values()].map((j) => [j.fine, j]));
    const joinOf = (a, b) => joined.get(a)?.to === b ? joined.get(a) : joined.get(b)?.to === a ? joined.get(b) : null;
    // the centre lines, for the painted schemes' wash (gl/lines.js)
    networkPolylines(layer, this.config.path).forEach((pts, i) => add(`pw${i}`, 'path-wash', pts));
    for (const { key, kind, line, a, b } of roadEdges(layer, this.config.path, this.config.path.edge, [], (n) => !intoSite(n) && !joined.has(n))) {
      const j = kind === 'edge' && joinOf(a, b);
      const at = j && layer.pos(j.fine);
      const keep = j ? (q) => !onRoad(q) && Math.hypot(q[0] - at[0], q[1] - at[1]) >= JOIN_REACH - 1e-3 : (q) => !onRoad(q);
      if (kind === 'end') continue;
      keepRuns(line, keep).forEach((run, i) => {
        const k = `p${key}${i ? `:${i}` : ''}`;
        if (kind === 'edge' || kind === 'corner') addRuns(k, 'footpath', trodden(run, hashKey(k)), a, b);
        else add(k, 'footpath', run, a, b);
      });
    }
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
    this.inkUpdate('fences', () => this.fenceItems(), this.world.networks.fence);
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
    this.inkUpdate('rails', () => this.railItems(), this.world.networks.rail);
  }

  // A network's ink layer given its items, on the ground in world space,
  // for gl/lines.js – the layer keeping the pen's timing (ink.js).
  inkUpdate(name, itemsOf, network) {
    const items = itemsOf();
    this.ink[name].update(items, { rankOf: this.rankOf(network) });
    this.glLines?.setLayer(name, items, this.ink[name].classes, this.ink[name]);
  }

  // The buildings, trees and lamps drawn with WebGL (gl/objects.js) from
  // their SVG, which stays in the page as the drawings' source, neither
  // styled nor laid out (display: none; the pen measures it through
  // gl/objects.js, draw.js) – on a canvas under the objects' <svg> (its
  // overlay over it).
  makeGlObjects() {
    const layer = this.layers.objects;
    this.glObjects = GLObjects.make(document.getElementById('objects-gl'), layer, this.top, this.sunCss);
    if (!this.glObjects) return;
    // (the drawings made ready for a turn kept on the GPU: those of the
    // nearest steps)
    this.glObjects.kept = () => {
      const out = new Set(), k = this.camera.step();
      for (const e of this.objs.values()) {
        for (const [j, v] of e.views ?? []) {
          const d = Math.min(Math.abs(j - k) % STEPS, STEPS - (Math.abs(j - k) % STEPS));
          if (d <= GL_AHEAD) out.add(v.g);
        }
      }
      return out;
    };
    layer.style.display = 'none';
    layer.classList.add('gl-drawn');
    // (the mist under them, and its covers over them, drawn alike)
    this.glObjects.watch(this.layers.mist, { under: true });
    this.layers.mist.style.display = 'none';
  }

  // The ground's and the world's layers drawn with WebGL as the objects
  // are (gl/objects.js), so their lines take the brush (brush.js): the
  // terrain (brows, rocks, steep slopes, shores, waves, ponds), the
  // meadow, the lots and the forest – each on a canvas just under its
  // <svg>, which stays in the page as their source with what is drawn
  // hidden (styles.css .gl-mirror), but for what WebGL can't draw: the
  // forest's hatched band, with its pattern and clip, over the rest as it
  // was (the forest the last of the world's layers).
  makeGlMirrors() {
    this.glMirrors = [];
    for (const [svg, names] of [[this.ground, ['terrain']], [this.svg, ['meadow', 'lots', 'forest']]]) {
      const canvas = document.createElement('canvas');
      canvas.className = 'map-canvas';
      svg.before(canvas);
      const layers = names.map((n) => this.layers[n]);
      const gl = GLObjects.make(canvas, layers[0], svg, this.sunCss);
      if (!gl) {
        canvas.remove();
        continue;
      }
      for (const l of layers.slice(1)) gl.watch(l);
      // (water in a pool, a mine's pit: hatched as the pattern hatch-water)
      if (SUN.hatch) gl.setTile({ ...SUN.hatch, angle: 320, gap: 5 / 32 }, 32, 0.6);
      for (const l of layers) l.classList.add('gl-mirror');
      this.glMirrors.push({ gl, layers });
    }
  }

  // The canvas the terrain's SVG is drawn on (makeGlMirrors), or null.
  groundMirror() {
    return this.glMirrors?.find((m) => m.layers[0] === this.layers.terrain)?.gl.canvas ?? null;
  }

  renderGlMirrors() {
    const d = this.drawn;
    if (!d) return;
    const view = { zoom: d.zoom, panX: d.panX, panY: d.panY, ox: this.ox, oy: this.oy, W: this.winW, H: this.winH };
    for (const { gl, layers } of this.glMirrors ?? []) gl.drawLayers(view, layers);
  }

  // The objects' groups put back in their layer (drawn with WebGL, which
  // keeps their order).
  placeObjectGroups(els) {
    const layer = this.layers.objects;
    for (const el of els) if (el.parentNode !== layer) layer.appendChild(el);
  }

  renderGlObjects() {
    const d = this.drawn;
    if (!this.glObjects || !d) return;
    this.glObjects.draw({ zoom: d.zoom, panX: d.panX, panY: d.panY, ox: this.ox, oy: this.oy, W: this.winW, H: this.winH }, this.order);
  }

  // The WebGL lines for the view the map's SVGs are drawn at (their wrapper
  // with its overscan: placeView) at the angle the view has reached – as
  // the SVG lines are drawn mid-turn.
  renderGlLines() {
    const gl = this.glLines, d = this.drawn;
    if (!gl || !d) return;
    const night = this.inkSet ?? 0;
    gl.draw(this.glLineView(), {
      stroke: this.strokeK, near: !!this.railsNear, far: this.lodLevel === 2, palette: THEME.palette,
      fg: night > 0.005 ? mixColour(THEME.palette.main, THEME.palette.detail, night) : THEME.palette.main,
      wash: this.lineWash(),
    });
  }

  // The view gl/lines.js draws for: the SVGs' (their wrapper with its
  // overscan, placeView) at the angle the view has reached.
  glLineView() {
    const d = this.drawn, cam = this.camera;
    return {
      zoom: d.zoom, panX: d.panX + this.ox, panY: d.panY + this.oy, cos: cam._cos, sin: cam._sin, angle: cam.angle, cx: cam.cx, cy: cam.cy,
      iso: [cam.tile * COS30, cam.tile * 0.5, cam.tile * cam.zScale], W: this.winW + 2 * this.ox, H: this.winH + 2 * this.oy,
    };
  }

  // The terrain's lines (renderTerrain), as the roads: exact at any angle,
  // mid-turn too.
  renderGlTerrain() {
    const gl = this.glTerrain;
    if (!gl || !this.drawn) return;
    const look = this.terrainStyles();
    gl.draw(this.glLineView(), { stroke: this.strokeK, palette: THEME.palette, fg: THEME.palette.main, styles: look.styles, stylesKey: look.key });
  }

  // The painted schemes' roads and paths (watercolour, Painted): a wash of
  // colour as wide as the way between its edges – sandy in the watercolour,
  // a pale tone of the shade in the Painted ones; null in the others.
  lineWash() {
    const { palette } = THEME;
    if (!palette.wash && !palette.painted) return null;
    return {
      road: this.config.road.edge * 1.15, path: this.config.path.edge * 1.3,
      colour: palette.wash ? '#cdb489' : mixColour(palette.bg, palette.shade, 0.3), alpha: palette.wash ? 0.55 : 0.6,
    };
  }

  // The railway's ink items. Its lines are kept (railLines, groundLines)
  // until a network, a station or the terrain changes – the close-up
  // track's bed and sleepers are costly (trackItems). Its bridges, drawn
  // for the side facing the view, are found each time.
  railItems() {
    const ink = this.inkItems(false);
    this.groundLines('railLines', ink, (add, addRuns) => this.railPieces(add, addRuns));
    this.addBridges('rail', ink.add);
    return ink.items;
  }

  // The railway's lines on the ground, to `add` / `addRuns` (inkItems).
  railPieces(add, addRuns) {
    const { world } = this;
    const layer = world.networks.rail;
    const { edges, exits, buffers } = railParts(layer, this.config.rail, world.railExits());
    const tracks = []; // for the track close up (trackItems)
    // the dashes are a second line over the same track
    for (const { a, b, line } of edges) {
      for (const cls of ['rail', 'rail-dash']) add(`${cls}${edgeKey(a, b)}`, cls, line, a, b);
      tracks.push({ key: edgeKey(a, b), line, a, b });
    }
    for (const { node, line, fade } of exits) {
      for (const cls of ['rail', 'rail-dash']) add(`${cls}x${node}`, cls, line, node, node);
      add(`fade${node}`, 'rail-exit', fade, node, node);
      tracks.push({ key: `x${node}`, line, a: node, b: node, fade });
    }
    for (const { node, line } of buffers) add(`b${node}`, 'rail-buffer', line, node, node);
    // stations' own tracks, drawn with the line so they meet it exactly
    for (const s of world.structures.values()) {
      const def = STRUCTURE_TYPES[s.type];
      stationTracks(world, s, def).forEach(({ line, buffer }, i) => {
        for (const cls of ['rail', 'rail-dash']) add(`${cls}s${s.id}.${i}`, cls, line, s.node, s.node);
        tracks.push({ key: `s${s.id}.${i}`, line, a: s.node, b: s.node });
        if (!buffer) return;
        const [ax, ay] = line[line.length - 2], [bx, by] = line[line.length - 1];
        const l = Math.hypot(bx - ax, by - ay) || 1;
        const nx = (-(by - ay) / l) * 0.12, ny = ((bx - ax) / l) * 0.12;
        add(`bs${s.id}.${i}`, 'rail-buffer', [[bx + nx, by + ny], [bx - nx, by - ny]], s.node, s.node);
      });
    }
    this.trackItems(tracks, add, addRuns);
  }

  // The railway close up (shown from zoom VEHICLES.minZoom on, the rails
  // layer's class `near`; the symbol further out): the ballast bed as two
  // thin edge lines, sleepers across it in the detail pen, two rails
  // (config.rail.track). `tracks`: [{ key, line, a, b, fade? }], the
  // network's segments first, then the stations' tracks. Where beds
  // overlap (junctions, switches) the edges inside another bed are left
  // out, so they run into one; a sleeper inside an earlier track's bed too.
  // At level crossings the bed and sleepers stop at the road; the rails
  // run on across it. Past the map edge (`fade`) only the rails, dashed.
  trackItems(tracks, add, addRuns) {
    const { bed, rail, sleeper, every } = this.config.rail.track;
    // the tracks' segments in cells, for the distances
    const CELL = 0.5, cells = new Map();
    const cellKey = (x, y) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
    tracks.forEach(({ line }, t) => {
      for (let i = 1; i < line.length; i++) {
        const [p, q] = [line[i - 1], line[i]];
        const seen = new Set();
        for (const [x, y] of [p, q, [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]]) {
          const k = cellKey(x, y);
          if (seen.has(k)) continue;
          seen.add(k);
          if (!cells.has(k)) cells.set(k, []);
          cells.get(k).push({ t, p, q, first: i === 1, last: i === line.length - 1 });
        }
      }
    });
    // within r of a track other than t (with `before`: an earlier one) –
    // nearest on its line, not at its very ends, so a segment carrying on
    // from where another ends doesn't count
    const inside = ([x, y], t, r, before = false) => {
      const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
      for (let i = cx - 1; i <= cx + 1; i++) for (let j = cy - 1; j <= cy + 1; j++) {
        for (const sg of cells.get(`${i},${j}`) ?? []) {
          if (sg.t === t || (before && sg.t > t)) continue;
          const [ex, ey] = [sg.q[0] - sg.p[0], sg.q[1] - sg.p[1]], l2 = ex * ex + ey * ey;
          if (!l2) continue;
          const u = ((x - sg.p[0]) * ex + (y - sg.p[1]) * ey) / l2;
          if ((u <= 0 && sg.first) || (u >= 1 && sg.last)) continue;
          const v = Math.max(0, Math.min(1, u));
          if (Math.hypot(sg.p[0] + ex * v - x, sg.p[1] + ey * v - y) < r) return true;
        }
      }
      return false;
    };
    // on the road at a level crossing (its width, a little more)
    const half = { road: this.config.road.edge, lane: this.config.lane.edge, path: this.config.path.edge };
    // (where the road is drawn: it sways, see wobble())
    const crossings = (this.trains?.crossingList() ?? []).map((c) => {
      const [wx, wy] = wobble(...c.pos);
      return { ...c, pos: [c.pos[0] + wx, c.pos[1] + wy] };
    });
    const onRoad = ([x, y], pad) => crossings.some(({ pos, dir, kind }) => {
      const [dx, dy] = [x - pos[0], y - pos[1]];
      return Math.abs(dx * dir[0] + dy * dir[1]) < 0.5 && Math.abs(dx * dir[1] - dy * dir[0]) < half[kind] + pad;
    });
    tracks.forEach(({ key, line, a, b, fade }, t) => {
      for (const side of [0, 1]) {
        const d = side ? -1 : 1;
        add(`tr${key}.${side}`, 'track-rail', offsetPolyline(line, d * rail), a, b);
        if (fade) add(`te${key}.${side}`, 'track-exit', offsetPolyline(fade, d * rail), a, b);
        const edge = keepRuns(offsetPolyline(line, d * bed), (p) => !inside(p, t, bed - 0.004) && !onRoad(p, 0.012));
        if (edge.length) addRuns(`tb${key}.${side}`, 'track-bed', edge, a, b);
      }
      const ties = [];
      for (const { p, dir } of spaced(line, every)) {
        if (onRoad(p, sleeper * 0.6) || inside(p, t, bed, true)) continue;
        const [nx, ny] = [-dir[1] * sleeper, dir[0] * sleeper];
        ties.push([[p[0] - nx, p[1] - ny], [p[0] + nx, p[1] + ny]]);
      }
      if (ties.length) addRuns(`ts${key}`, 'track-sleeper', ties, a, b);
    });
  }

  renderRoads() {
    this.inkUpdate('roads', () => this.roadItems(), this.world.networks.road);
  }

  // `cache`: keep the road and kerb lines between calls.
  roadItems(cache = true) {
    const { world } = this;
    const layer = world.networks.road, curve = this.config.road;
    const ink = this.inkItems(true), { items, add } = ink;
    // The road and kerb lines depend on the networks only, not on the
    // buildings (which redraw the roads for their driveways): kept on the
    // ground (roadLines, groundLines) until a network or the terrain
    // changes.

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

    this.groundLines('roadLines', ink, (add) => {
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
      // its centre lines, for the painted schemes' wash (gl/lines.js)
      networkPolylines(layer, curve).forEach((pts, i) => add(`rw${i}`, 'road-wash', pts));
      // …carried on off the map at its exits, fading out (as the edges' 'road-exit')
      for (const { node, dir } of world.roadExits()) {
        const [x, y] = layer.pos(node);
        add(`rwx${node}`, 'road-wash-exit', [[x, y], [x + dir[0] * 1.9, y + dir[1] * 1.9]], node, node);
      }

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
    }, cache);
    this.addBridges('road', add);
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
    const view = `${cam.zoom} ${cam.panX} ${cam.panY} ${cam.angle}`;
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
      // turning: drawn at the angle it has reached every frame (turnFrame),
      // while panning and zooming move the drawing as ever (a bare corner of
      // paper may show meanwhile); once the view rests, what is left is
      // drawn anew (land)
      const turned = d && d.angle !== cam.angle;
      if (d && (covered || turned) && this.deferView && now - this.movedAt < VIEW_SETTLE) {
        css = `translate(${tx}px, ${ty}px) scale(${k})`;
        if (turned) this.goDraft();
        if (turned && !this.turning) this.startTurn();
      } else {
        if (this.turning || turned) this.land();
        this.drawn = { view, zoom: cam.zoom, panX: cam.panX, panY: cam.panY, angle: cam.angle };
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

  // The ground drawn at angle `from` turned to angle `to`, in scene px:
  // about the middle of the map (the scene's origin), as in Camera.project,
  // without the relief. As an SVG transform.
  // (`css`: as a CSS transform, about the same point)
  sheet(from, to, css = false) {
    const c = COS30, a = to - from, cos = Math.cos(a), sin = Math.sin(a);
    // scene px -> view axes (the projection undone) -> turned -> scene px
    const inv = [[0.5 / c, 1], [-0.5 / c, 1]];
    const turn = [[cos, -sin], [sin, cos]];
    const proj = [[c, -c], [0.5, 0.5]];
    const mul = (p, q) => [0, 1].map((i) => [0, 1].map((j) => p[i][0] * q[0][j] + p[i][1] * q[1][j]));
    const m = mul(proj, mul(turn, inv));
    const sep = css ? ', ' : ' ';
    return `matrix(${[m[0][0], m[1][0], m[0][1], m[1][1], 0, 0].join(sep)})`;
  }

  // Where the middle of an object's ground shows at angle `a`, in scene px
  // (flat: the relief raises it the same at any angle).
  footAt(e, a) {
    const cam = this.camera;
    if (!e.mid) {
      const pts = e.at.points;
      const mid = [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
      e.mid = cam.warp ? cam.warp(...mid) : mid;
    }
    const x = e.mid[0] - cam.cx, y = e.mid[1] - cam.cy;
    const rx = x * Math.cos(a) - y * Math.sin(a), ry = x * Math.sin(a) + y * Math.cos(a);
    return [(rx - ry) * COS30 * cam.tile, (rx + ry) * 0.5 * cam.tile];
  }

  // The view starts turning: the hover marks (drawn for the camera as it
  // is) wait for it to end, and what is being erased goes at once.
  startTurn() {
    this.turning = true;
    this.landing.clear(); // (still behind: the turn draws them, turnFrame)
    this.landingOrder = null;
    this.sweep?.end(); // (the shadows as they are now)
    this.renderLights(); // (the lamps' alone, turning as a sheet; the windows' once the view rests)
    this.layers.overlay.style.visibility = 'hidden';
    this.reapGhosts(true);
  }

  // Turned far enough (config.render.turnBare): the objects go bare (bareOf)
  // for the rest of the turn – their facade detail hidden at once, and
  // each drawn bare at the steps it comes to – and get it back from the
  // pen once the view rests (land, renderObjects).
  goBare() {
    this.bare = true;
    for (const e of this.objs.values()) {
      if (e.bare || e.hidBare) continue;
      for (const g of [e.g, e.lg]) g.classList.add('bare');
      e.hidBare = 'bare';
    }
  }

  // One frame of a turn, at the angle the camera has reached. The ground
  // (SHEET) turns as a sheet of paper, exact on flat ground; the roads,
  // paths, railways, fences and parked cars on it are drawn at this angle.
  // Buildings, trees and lamps are drawn at the step of the turn (Camera.STEP)
  // nearest it, each with its garden and shadow: from the drawings each
  // keeps for the steps it has been drawn at (views, made ready while the
  // view rests: prepareTurn), or drawn now, as many as config.render.
  // turnBudget allows – buildings first, those furthest behind first. Each
  // slides the last hair to where it stands at this very angle; one not
  // drawn yet slides round upright as last drawn, until its turn. All of
  // that bare (goBare), and only once the view has turned config.render.
  // turnBare from where it rested: a nudge just slides them.
  turnFrame() {
    const cam = this.camera, a = cam.angle, t0 = performance.now();
    const k = Math.round(a / Camera.STEP) % STEPS;
    const turn = this.sheet(this.drawn.angle, a);
    for (const l of SHEET) this.layers[l].setAttribute('transform', turn);
    for (const el of this.lightCuts) el.setAttribute('transform', turn); // (as the lights)
    this.nightSheet = new DOMMatrix(this.sheet(this.drawn.angle, a, true)); // (and the ground's, gl/night.js)
    // the terrain, the largest of them, turned whole on the GPU: its <svg>
    // about the middle of the map as drawn (the scene's origin)
    const { ground } = this, d = this.drawn;
    ground.style.transformOrigin = `${d.panX + this.ox}px ${d.panY + this.oy}px`;
    ground.style.transform = this.sheet(d.angle, a, true);
    ground.style.willChange = 'transform';
    // (and the canvas its shapes are drawn on, gl/objects.js: what of the
    // terrain is drawn for the view, the brows and rocks, and the washes)
    const mirror = this.groundMirror();
    if (mirror) Object.assign(mirror.style, { transformOrigin: ground.style.transformOrigin, transform: ground.style.transform });
    if (this.linesAngle !== a) {
      for (const l of LINES) {
        if (GL_LINES.includes(l)) continue; // (on the GPU the camera turns them)
        this.ink[l]?.clearErasing();
        this[`render${l[0].toUpperCase()}${l.slice(1)}`]();
      }
      if (!this.drafting) this.renderParked(); // (left out of a draft, drawn once it rests: land)
      this.linesAngle = a;
    }
    // (changed meanwhile: its views are old, and it is drawn anew once at rest)
    for (const key of this.objsDirty) this.objs.get(key)?.views?.clear();
    // every object where it stands at this angle: what is in sight
    for (const e of this.objs.values()) {
      if (!e.at || e.placedAt === a) continue;
      Object.assign(e, this.placeOf(e.at));
      e.placedAt = a;
    }
    this.cull();
    if (!this.bare) {
      const off = Math.abs(Math.atan2(Math.sin(a - d.angle), Math.cos(a - d.angle)));
      if (off >= (this.config.render.turnBare * Math.PI) / 180) this.goBare();
    }
    const due = [];
    for (const e of this.bare ? this.objs.values() : []) {
      if (e.shown === false || e.k === k) continue;
      const view = !this.objsDirty.has(e.key) && e.views?.get(k);
      if (view) this.swapIn(e, view);
      else due.push(e);
    }
    const behind = (e) => {
      if (e.k == null) return Infinity;
      const d = Math.abs(e.k - k) % STEPS;
      return Math.min(d, STEPS - d) * (e.key[0] === 's' ? 4 : 1);
    };
    due.sort((p, q) => behind(q) - behind(p));
    // (the meadow's share kept back)
    const { turnBudget, turnMeadow } = this.config.render, budget = turnBudget - turnMeadow;
    // let go, it is coasting to the step it will rest on: everything in
    // sight is made ready there, buildings first, so it rests on what it
    // shows as it comes in
    const rest = cam.spin && this.bare ? ((Math.round((a + cam.spin.left) / Camera.STEP) % STEPS) + STEPS) % STEPS : null;
    if (rest !== null && rest !== k) {
      this.turnRest = rest;
      for (const kind of ['s', 'f', 'k']) {
        for (const e of this.objs.values()) {
          if (e.key[0] !== kind || e.shown === false || e.k === rest || e.views?.has(rest)) continue;
          if (performance.now() - t0 > budget) break;
          const view = this.buildView(e, rest);
          if (!view) continue;
          (e.views ??= new Map()).set(rest, view);
          this.keepViews(e);
        }
      }
    }
    // (coasting, all of it goes to the step it rests on; the steps passed
    // on the way are only seen for a moment)
    for (const e of rest !== null && rest !== k ? [] : due) {
      if (performance.now() - t0 > budget) break;
      const view = this.buildView(e, k);
      if (view) this.swapIn(e, view);
    }
    this.reorder(false);
    // the meadow: each chunk in sight turned as a sheet from where it was
    // drawn (its tufts lean a little meanwhile), and drawn at this angle,
    // the furthest behind first, for config.render.turnMeadow ms
    // (left out of a draft: drawn once it rests, land)
    const chunks = this.drafting ? [] : [...this.meadow.entries()].filter(([, c]) => c.shown && c.angle !== a);
    const off = (c) => Math.abs(Math.sin(((c.angle ?? this.drawn.angle) - a) / 2));
    chunks.sort((p, q) => off(q[1]) - off(p[1]));
    const m0 = performance.now();
    let meadow = null;
    for (const [key, c] of chunks) {
      if (performance.now() - m0 > turnMeadow || performance.now() - t0 > turnBudget) {
        c.g.setAttribute('transform', this.sheet(c.angle ?? this.drawn.angle, a));
        c.turned = true;
        continue;
      }
      this.drawChunk(key, (meadow ??= meadowGround(this.world, this.config)));
    }
    for (const e of this.objs.values()) {
      const slide = e.shown !== false && e.angle !== undefined && e.angle !== a;
      if (!slide && !e.slid) continue;
      e.slid = slide;
      e.slideT = '';
      if (slide) {
        const [x0, y0] = this.footAt(e, e.angle), [x1, y1] = this.footAt(e, a);
        e.slideT = `translate(${r2(x1 - x0)} ${r2(y1 - y0)})`;
      }
      this.placeGroups(e);
    }
  }

  // An object's groups where they show: moved by its slide mid-turn
  // (turnFrame), and a forest clump's drawing leaning in the wind as well
  // (swayTrees) – both in the one transform, so neither undoes the other.
  placeGroups(e) {
    const lean = e.sway?.[0]?.el === e.g ? e.sway[0].t : '';
    for (const g of [e.g, e.lg, e.sg]) {
      const t = [e.slideT, g === e.g ? lean : ''].filter(Boolean).join(' ');
      if (t) g.setAttribute('transform', t);
      else g.removeAttribute('transform');
    }
  }

  // An object's drawing at step `k` of the turn, bare (bareOf), its garden
  // and shadow, as a view to keep (swapIn), drawn off the page; null if it
  // is gone.
  buildView(e, k) {
    const cam = this.camera, live = cam.angle, id = Number(e.key.slice(1));
    cam.angle = k * Camera.STEP;
    this.drawBare = true;
    try {
      const built = e.key[0] === 's' ? this.buildStructure(this.world.structures.get(id))
        : e.key[0] === 'f' ? this.buildFeature(this.world.features.get(id))
          : this.buildStreet(e.key.slice(1));
      if (!built) return null;
      const [g, lg, sg] = [0, 1, 2].map(() => document.createElementNS(SVGNS, 'g'));
      g.innerHTML = built.svg;
      lg.innerHTML = built.ground;
      this.glShadows?.castInto(sg, built.shade);
      return { k, angle: cam.angle, bare: true, g, lg, sg, shade: built.shade, night: built.night, band: built.band, vents: built.vents?.length ? built.vents : null, ventsTurn: cam.angle, bounds: built.bounds, box: built.box, at: built.at };
    } finally {
      cam.angle = live;
      this.drawBare = false;
    }
  }

  // Put a view (buildView) in for the object's drawing, keeping the one it
  // had, if a bare one drawn at a step, for when the turn comes back to it.
  swapIn(e, view) {
    e.views ??= new Map();
    if (e.k != null && e.bare && !e.views.has(e.k)) {
      const { k, angle, bare, g, lg, sg, shade, night, band, vents, ventsTurn, bounds, box, at } = e;
      e.views.set(e.k, { k, angle, bare, g, lg, sg, shade, night, band, vents, ventsTurn, bounds, box, at });
    }
    e.views.delete(view.k);
    for (const n of ['g', 'lg', 'sg']) {
      e[n].removeAttribute('transform');
      // (shown on the GPU until the new one is built there: gl/objects.js)
      view[n].standIn = e[n].standIn ?? e[n];
      e[n].parentNode?.replaceChild(view[n], e[n]);
    }
    Object.assign(e, view);
    e.placedAt = view.angle;
    e.mid = null;
    e.slid = false;
    e.slideT = '';
    e.hide = e.hidBare = ''; // (classes on the groups swapped out)
    // a clump leaning in the wind leans as far in its new drawing, at once
    const lean = e.sway?.[0]?.e ? e.sway[0].lean : 0;
    if (lean) {
      this.swayUnits(e);
      const u = e.sway[0];
      if (u) Object.assign(u, { lean, t: `matrix(1 0 ${lean} 1 ${r2(-lean * u.foot[1])} 0)` });
      this.placeGroups(e);
    }
    this.keepViews(e);
    // (a view kept from before the mist came or went: covered as it is now)
    if (this.mistLevel != null || e.g.querySelector(':scope > .mist-cover') || e.g.mistUnderTo) this.coverMist(e);
  }

  // At most VIEWS kept for an object: those furthest from the step it shows
  // go first (never the one a coasting turn will rest on).
  keepViews(e) {
    if (e.views.size <= VIEWS) return;
    const far = (j) => (j === this.turnRest ? -1 : Math.min(Math.abs(j - e.k) % STEPS, STEPS - (Math.abs(j - e.k) % STEPS)));
    const keys = [...e.views.keys()].sort((p, q) => far(q) - far(p));
    for (const j of keys.slice(0, e.views.size - VIEWS)) e.views.delete(j);
  }

  // The painter's order of the objects as they now stand (isoSort): of all
  // of them, or mid-turn (`all` false) of those in sight only, the others
  // after them until the turn is over.
  reorder(all = true) {
    const live = [...this.objs.values(), ...this.ghosts.values()];
    const sorted = all ? live : live.filter((e) => e.shown !== false);
    const order = isoSort(sorted.map((e) => ({ ...e.bounds, entry: e })), this.camera.quarterView()).map((i) => i.entry);
    this.placeObjectGroups(order.filter((e) => e.shown !== false).map((e) => e.g));
    this.order = all ? order : order.concat(live.filter((e) => e.shown === false));
    this.orderAngle = this.camera.angle;
  }

  // While the view rests on a step of the turn, the views of the steps
  // either side (config.render.turnAhead each way, the nearest first,
  // buildings first) are made ready for the objects in sight, for at most
  // config.render.prepareBudget ms each frame, so a turn finds them drawn.
  // (in the browser's idle time between frames, as much as it has – never
  // holding a frame up; in a frame's budget where there's no such time)
  schedulePrepare() {
    if (typeof requestIdleCallback !== 'function') return this.prepareTurn();
    if (this.prepareIdle) return;
    this.prepareIdle = requestIdleCallback((deadline) => {
      this.prepareIdle = null;
      this.prepareTurn(Math.min(this.config.render.prepareBudget, deadline.timeRemaining() - 1));
    }, { timeout: 500 });
  }

  prepareTurn(budget = this.config.render.prepareBudget) {
    if (!(budget > 0)) return;
    const k = this.camera.step();
    if (k == null || this.turning || this.objsAll || this.objsDirty.size || performance.now() - this.movedAt < PREPARE_REST) return;
    if (this.preparedAt === k) return;
    const { turnAhead } = this.config.render, prepareBudget = budget;
    const t0 = performance.now();
    for (let d = 1; d <= turnAhead; d++) {
      for (const kind of ['s', 'f', 'k']) {
        for (const e of this.objs.values()) {
          if (e.key[0] !== kind || e.shown === false || e.k !== k) continue;
          for (const j of [(k + d) % STEPS, (k - d + STEPS) % STEPS]) {
            let view = e.views?.get(j);
            if (!view) {
              if (performance.now() - t0 > prepareBudget) return;
              view = this.buildView(e, j);
              if (!view) continue;
              (e.views ??= new Map()).set(j, view);
              this.keepViews(e);
            }
            // (with WebGL, the nearest steps' drawings made ready on the GPU too)
            if (this.glObjects && d <= GL_AHEAD && !this.glObjects.has(view.g)) {
              if (performance.now() - t0 > prepareBudget) return;
              this.glObjects.prebuild(view.g);
            }
          }
        }
      }
    }
    this.preparedAt = k; // (all ready: nothing to look for until something changes)
  }

  // The turn is over: the sheet drawn anew at the angle it rests at, and
  // whatever is still behind – from its views when it has one for this
  // step (so what was shown last is what stays), or drawn anew. What
  // shows bare (goBare) is drawn whole again, from the middle of the view
  // out (the rebuild queue in frame()), the pen putting the detail back.
  // What a turn rested on before it was drawn at that step (land): as many
  // as config.render.turnBudget allows by what they took so far, from the
  // middle out, each drawn anew while what it showed fades out over it,
  // where it showed it, rather than jumping. How many went to the redraw.
  landFrame() {
    if (!this.landing.size || this.objsAll) return 0;
    this.landingOrder ??= this.nearestLast(this.landing);
    const a = this.camera.angle, n = Math.max(1, Math.floor(this.config.render.turnBudget / this.rebuildCost));
    let batch = 0;
    while (batch < n && this.landingOrder.length) {
      const key = this.landingOrder.pop();
      this.landing.delete(key);
      const e = this.objs.get(key);
      if (!e || e.shown === false || e.angle === a || this.objsDirty.has(key)) continue;
      this.objsDirty.add(key);
      this.viewOnly.add(key);
      if (e.slid && drawEnabled()) {
        for (const g of ['g', 'lg', 'sg']) {
          const old = e[g];
          if (!old.parentNode) continue;
          e[g] = old.parentNode.insertBefore(document.createElementNS(SVGNS, 'g'), old);
          old.fade = { at: performance.now(), ms: SETTLE_FADE, from: 1, to: 0, ease: 'out' }; // (as gl/objects.js draws it)
          old.animate([{ opacity: 1 }, { opacity: 0 }], { duration: SETTLE_FADE, easing: 'ease-out', fill: 'forwards' }).finished.then(() => old.remove(), () => old.remove());
        }
      } else if (e.slid) {
        e.slideT = '';
        this.placeGroups(e);
      }
      e.slid = false;
      if (e.hidBare) for (const g of [e.g, e.lg]) g.classList.remove('bare');
      e.hidBare = '';
      batch++;
    }
    return batch;
  }

  land() {
    const bare = this.bare;
    this.turning = this.bare = false;
    this.turnRest = null;
    const a = this.camera.angle, k = this.camera.step();
    // the contours, water and brows as turned fade out over their drawing
    // anew: on slopes the sheet can only come near it
    const { ground } = this, terrain = this.layers.terrain;
    if (ground.style.transform && drawEnabled()) {
      const old = terrain.parentNode.insertBefore(terrain.cloneNode(true), terrain.nextSibling);
      old.setAttribute('transform', this.sheet(this.drawn.angle, a));
      old.animate([{ opacity: 1 }, { opacity: 0 }], { duration: SETTLE_FADE, easing: 'ease-out', fill: 'forwards' }).finished.then(() => old.remove(), () => old.remove());
    }
    Object.assign(ground.style, { transform: '', transformOrigin: '', willChange: '' });
    const mirror = this.groundMirror();
    if (mirror) Object.assign(mirror.style, { transform: '', transformOrigin: '' });
    this.dirty.add('terrain');
    for (const l of SHEET) {
      this.layers[l].removeAttribute('transform');
      this.dirty.add(l);
    }
    for (const el of this.lightCuts) el.removeAttribute('transform');
    this.nightSheet = null;
    if (this.linesAngle !== a) {
      for (const l of LINES) {
        this.ink[l]?.clearErasing();
        this.dirty.add(l);
      }
      this.dirty.add('parked');
    }
    this.linesAngle = null;
    for (const [key, c] of this.meadow) {
      if (c.angle === a) continue;
      if (c.turned) c.g.removeAttribute('transform');
      c.turned = false;
      this.meadowDirty.add(key);
    }
    for (const e of this.objs.values()) {
      if (e.at && e.placedAt !== a) {
        Object.assign(e, this.placeOf(e.at));
        e.placedAt = a;
      }
      const view = bare && e.angle !== a && k != null && !this.objsDirty.has(e.key) && e.views?.get(k);
      if (view) this.swapIn(e, view);
      else if (e.angle !== a) {
        e.stale = true;
        // not drawn here yet: drawn a few a frame, from the middle out,
        // showing meanwhile what it showed mid-turn (landFrame)
        if (e.shown !== false && !this.objsDirty.has(e.key)) {
          this.landing.add(e.key);
          this.landingOrder = null;
          continue;
        }
      }
      if (e.slid) {
        e.slideT = '';
        this.placeGroups(e);
      }
      e.slid = false;
      if (e.hidBare) {
        for (const g of [e.g, e.lg]) g.classList.remove('bare');
        e.hidBare = '';
      }
      if (e.bare && e.angle === a && !this.objsDirty.has(e.key)) {
        e.stale = true;
        if (e.shown !== false) {
          e.redetail = true;
          this.rebuildQueue.add(e.key);
          this.rebuildOrder = null;
        }
      }
    }
    this.reorder();
    this.preparedAt = null;
    this.lastOverlay = null;
    this.layers.overlay.style.visibility = '';
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
    for (const s of this.svgs) s.style.setProperty('--stroke', k);
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
    // parked cars switch between dots and models (src/render/vehicles.js),
    // railways between the map symbol and the track (trackItems)
    const close = z >= VEHICLES.minZoom;
    this.railsNear = close;
    if (close !== this.carsClose) {
      this.carsClose = close;
      this.dirty.add('parked');
    }
    // far out the woods are one shape each (forest.js), their trees not drawn
    this.updateWoods(z);
    if (this.farWoods.size) this.forestHatch(z);
    // each object's own detail (bandOf), redrawn where it changes
    if (z !== this.bandZoom) {
      this.bandZoom = z;
      this.rebandObjects();
    }
    // the map's level, for the rest of what's drawn with detail classes
    // (contours, the overlay); not the objects, which go by their own
    const level = z >= medium ? 0 : z >= far ? 1 : 2;
    if (level === this.lodLevel) return;
    for (const s of this.svgs) {
      s.classList.remove(`lod-${this.lodLevel}`);
      s.classList.add(`lod-${level}`);
    }
    this.lodLevel = level;

  }

  // An object's detail at zoom z, a number made of four parts: its level
  // (0 full, 1 without the facade detail, 2 bare; config.render.lod), the
  // densest tier of roof hatching it keeps (0–3, painter.js: strokes about
  // config.render.roofGap px apart on screen at least) and, for a tree,
  // how plain its crown is (config.render.trees), and for a building
  // whether its windows are drawn close up (NEAR). Each object crosses
  // these zooms a little sooner or later than the next – its own share of
  // them, from 1 − lod.spread to 1, seeded by its key – so a change goes
  // through the town over a stretch of zooms rather than all at once;
  // and only once the zoom is BAND_HOLD past, if it was drawn with `prev`.
  bandOf(key, z, prev) {
    const at = (zz) => {
      const { lod, trees, roofGap } = this.config.render;
      const r = 1 - lod.spread * detailRank(key);
      const level = (zz < lod.medium * r) + (zz < lod.far * r);
      // tier n keeps every 2^(3 − n)th stroke, LOOK.hatch apart
      let roof = 3;
      if (key[0] === 's') while (roof > 0 && LOOK.hatch * 2 ** (3 - roof) * this.camera.tile * zz < roofGap * r) roof--;
      const tree = key[0] === 'f' ? (zz < trees.medium * r) + (zz < trees.far * r) : 0;
      // a building's windows close up (Painter._window, LOOK.open)
      const near = key[0] === 's' && LOOK.open && zz >= lod.near * r ? 1 : 0;
      return [level, roof, tree, near];
    };
    const now = at(z);
    if (prev !== undefined) {
      const was = [(prev >> 4) & 3, (prev >> 2) & 3, prev & 3, prev & NEAR ? 1 : 0];
      const closer = at(z * (1 + BAND_HOLD)), further = at(z * (1 - BAND_HOLD));
      // each part only goes up with the zoom (roof) or down (level, tree)
      const keep = was[0] >= closer[0] && was[0] <= further[0]
        && was[1] <= closer[1] && was[1] >= further[1]
        && was[2] >= closer[2] && was[2] <= further[2]
        && was[3] <= closer[3] && was[3] >= further[3];
      if (keep) return prev;
    }
    return (now[3] ? NEAR : 0) | (now[0] << 4) | (now[1] << 2) | now[2];
  }

  // The zoom changed: objects whose detail (bandOf) changes with it are
  // redrawn – those in sight a batch per frame once the view has settled
  // (frame), the rest once they come into sight (stale, see cull()).
  rebandObjects() {
    const z = this.bandZoom;
    for (const [key, e] of this.objs) {
      if (e.band === undefined) continue;
      const band = this.bandOf(key, z, e.band);
      if (band !== e.band || e.hide) this.hideAhead(e, band);
      if (band !== e.band) {
        if (e.bandStale) continue;
        e.stale = e.bandStale = true;
        if (e.shown !== false) {
          this.rebuildQueue.add(key);
          this.rebuildOrder = null;
        }
      } else if (e.bandStale) {
        // back where it was drawn before it was redrawn (unless the sun
        // has moved since, setSun)
        e.bandStale = false;
        e.stale = !!e.sunStale;
      }
    }
  }

  // The facade detail an object's drawing has that `band` leaves out hides
  // at once (a class on its groups, styles.css), until it is redrawn
  // without it; what it lacks, and its roof hatching, wait for the redraw.
  hideAhead(e, band) {
    const level = (band >> 4) & 3;
    const hide = level > ((e.band >> 4) & 3) ? `lv${level}` : '';
    if (hide === (e.hide ?? '')) return;
    for (const g of [e.g, e.lg]) {
      if (e.hide) g.classList.remove(e.hide);
      if (hide) g.classList.add(hide);
    }
    e.hide = hide;
  }

  // Keys sorted by how far their objects are from the middle of the view,
  // the furthest first.
  nearestLast(keys) {
    const v = this.viewBox, cx = v ? (v[0] + v[2]) / 2 : 0, cy = v ? (v[1] + v[3]) / 2 : 0;
    const far = (key) => {
      const b = this.objs.get(key)?.box;
      return b ? Math.hypot((b[0] + b[2]) / 2 - cx, (b[1] + b[3]) / 2 - cy) : Infinity;
    };
    return [...keys].map((key) => [far(key), key]).sort((a, b) => b[0] - a[0]).map(([, key]) => key);
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
    if (this.lampsOn && [...keys].some((k) => k[0] === 'k')) this.dirty.add('lights'); // (lamps come and go)
    if ((this.dark || this.gloom) && keys.size) this.dirty.add('lights'); // (windows come and go, or are hidden anew)
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
    // (turned past its quarter, the view puts the same boxes in another order)
    let orderChanged = this.orderAngle !== this.camera.angle;
    for (const key of keys) {
      const id = Number(key.slice(1));
      let entry = this.objs.get(key);
      if (lazy && entry?.at && !this.born.has(key) && this.exists(key)) {
        const { bounds, box } = this.placeOf(entry.at);
        if (!this.inView(box)) {
          if (['minX', 'maxX', 'minY', 'maxY'].some((k) => entry.bounds[k] !== bounds[k])) orderChanged = true;
          Object.assign(entry, { bounds, box, stale: true, bandStale: false });
          if (!this.viewOnly.has(key)) entry.views?.clear(); // (drawn for another town or sun)
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
      const sig = s && `${s.type}|${s.seed}|${s.ruin ? 'ruin' : ''}`; // (burning down: the house rubbed out, the ruin drawn)
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
      // drawn bare for a turn (goBare), now whole: the pen draws in what
      // the bare drawing lacked
      const was = entry.redetail && entry.bare && animate && entry.shown !== false && !this.born.has(key) ? new Set(strokesOf(entry).map((el) => el.outerHTML)) : null;

      entry.g.innerHTML = built.svg;
      entry.lg.innerHTML = built.ground;
      entry.shade = built.shade;
      entry.night = built.night;
      this.glShadows?.castInto(entry.sg, entry.shade);
      if (was) {
        const only = new Set(strokesOf(entry).filter((el) => !was.has(el.outerHTML)));
        if (only.size) sketch.push({ entry, only });
      }
      entry.bare = entry.redetail = false;
      const b = built.bounds;
      if (!entry.bounds || ['minX', 'maxX', 'minY', 'maxY'].some((k) => entry.bounds[k] !== b[k])) orderChanged = true;
      entry.bounds = b;
      entry.box = built.box;
      entry.at = built.at;
      entry.mid = null;
      entry.angle = entry.placedAt = this.camera.angle;
      entry.stale = false;
      // drawn anew for the same town: the views it keeps still hold
      // (land); for a changed one they are old
      if (!this.viewOnly.has(key)) entry.views?.clear();
      entry.k = this.camera.step();
      entry.slid = false;
      entry.band = built.band;
      entry.vents = built.vents?.length ? built.vents : null;
      entry.ventsTurn = this.camera.angle;
      this.coverMist(entry);
      if (entry.hide) {
        for (const g of [entry.g, entry.lg]) g.classList.remove(entry.hide);
        entry.hide = '';
      }
      entry.stale = entry.bandStale = entry.sunStale = false;
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
      const order = isoSort([...this.objs.values(), ...this.ghosts.values()].map((e) => ({ ...e.bounds, entry: e })), this.camera.quarterView()).map((i) => i.entry);
      this.orderAngle = this.camera.angle;
      this.placeObjectGroups(order.filter((e) => e.shown !== false).map((e) => e.g)); // (out of sight: out of the page, see cull)
      this.order = order;
      this.objsPlace = false;
    }

    // after the DOM is in place: the pen needs computed styles and lengths
    const tile = this.camera.tile, scale = this.drawn.zoom;
    sketch.sort((a, b) => !!b.reverse - !!a.reverse); // erasing first: a swap waits for it
    for (const { entry, key, reverse, drawnFor, then, only } of sketch) {
      // (the shadow is shapes in a mask, not pen lines: it goes as the pen
      // starts erasing, and comes once the pen is done)
      const groups = [entry.lg, entry.g], sg = entry.sg;
      if (reverse) {
        sg.style.display = 'none';
        const left = eraseOut(groups, { drawn: drawnFor, tile, scale, speed: then ? DRAW.swap : 1 });
        entry.until = now + left;
        if (then) {
          // the new drawing starts when the old one is half erased
          this.born.set(then, now + left / 2);
          sketch.push({ entry: this.objs.get(then), key: then });
        }
      } else if (only) {
        drawIn(groups, { tile, scale, only, speed: DRAW.detail });
      } else {
        const left = drawIn(groups, { elapsed: now - this.born.get(key), tile, scale });
        if (left <= 0) this.born.delete(key); // done
        sg.style.display = left > 0 ? 'none' : '';
        if (left > 0) setTimeout(() => { sg.style.display = ''; }, left);
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
    const band = this.bandFor(`k${key}`), detail = this.drawBare ? bareOf(band) : band;
    return { band, detail, svg: mergeRuns(this.atDetail(painter.toSVG(), detail)), ground: '', shade: this.shadeOf(painter), night: this.nightOf(painter), ...this.placeOf({ points: [[x, y]], pad: 0.05, top: painter.top }) };
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
    const band = f && this.bandFor(`f${f.id}`), detail = this.drawBare ? bareOf(band) : band;
    const out = this.paintFeature(f, this.camera, detail & 3);
    if (!out) return null;
    const { painter, x, y } = out;
    return { band, detail, svg: mergeRuns(this.atDetail(painter.toSVG(), detail)), ground: '', shade: this.shadeOf(painter), night: this.nightOf(painter), ...this.placeOf({ points: [[x, y]], pad: FEATURE_PAD, top: painter.top }) };
  }

  // The detail (bandOf) an object is drawn with now: as it was drawn last
  // unless the zoom has moved on far enough.
  bandFor(key) {
    return this.bandOf(key, this.bandZoom ?? this.drawn.zoom, this.objs.get(key)?.band);
  }

  // A drawing without the details its band (bandOf) leaves out: the
  // elements tagged d2, or d1 / d2 (painter.js), and the denser tiers of
  // roof hatching – left out rather than hidden, as the browser restyles
  // and lays out hidden elements too. The tiers kept lose their tier
  // class, so each roof plane's strokes merge into one path again
  // (mergeRuns).
  atDetail(svg, band = 0) {
    const level = (band >> 4) & 3, roof = (band >> 2) & 3;
    if (level) svg = svg.replace(level >= 2 ? DETAIL_1_2 : DETAIL_2, '');
    if (roof < 3) svg = svg.replace(ROOF_TIERS[roof], '');
    return svg.replace(ROOF_TIER_CLASS, '');
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
    const band = this.bandFor(`s${s.id}`), detail = this.drawBare ? bareOf(band) : band;
    return { band, detail, svg: mergeRuns(this.atDetail(painter.toSVG(), detail)), ground: mergeRuns(this.atDetail(painter.toGroundSVG(), detail)), shade: this.shadeOf(painter), night: this.nightOf(painter), vents: painter.vents, ...this.placeOf({ points, pad: STRUCTURE_PAD, top: painter.top, anchor: painter.rigid }) };
  }

  // An object's shadow (shadows.js): the feet of its walls and the other
  // shapes it casts from, in world points, and how its ground projects –
  // kept on the object's entry, so the shadow alone can be drawn again for
  // another sun (renderShadows).
  nightOf(painter) {
    return { wins: painter.panes, covers: painter.covers() };
  }

  shadeOf(painter) {
    return painter.feet.length || painter.casts.length ? { feet: painter.feet, casts: painter.casts, project: painter.groundProjector() } : null;
  }

  // The day steps to step i (DAY.steps): the night or not (drawn over
  // everything, renderNight), how grey, the lamps and windows, and the
  // hills' shadows, drawn again for the sun as it is then (between the
  // steps the sun goes on by itself, followSun). Not mid-turn: false if
  // put off, to try again.
  setSun(i) {
    if (i == null || i === this.dayStep) return true;
    if (this.turning || this.bare) return false;
    const step = DAY.steps[i];
    this.dayStep = i;
    if (!!(step.gloom ?? 0) !== !!this.gloom) this.dirty.add('lights'); // (the objects' outlines, for the grey)
    this.gloom = step.gloom ?? 0;
    this.nightDepth = step.depth ?? 1;
    // the main ink going over to the secondary (styles.css --ink-night on
    // the map; the canvases', renderNightCanvases)
    this.inkNight = step.ink ?? 0;
    if ((step.windows ?? 0) !== this.litShare || !!step.night !== this.windowsDark) {
      this.litShare = step.windows ?? 0;
      this.windowsDark = !!step.night;
      this.dirty.add('lights');
    }
    if (!!step.lamps !== !!this.lampsOn) {
      this.lampsOn = !!step.lamps;
      this.dirty.add('lights');
    }
    const dark = step.night ? 1 : 0;
    if (dark !== this.dark) {
      this.dark = dark;
      this.dirty.add('lights');
    }
    const pos = step.night ? null : step.sun;
    const sun = pos == null ? 'none' : `${pos}|${step.length ?? ''}|${step.hills ?? ''}`;
    if (sun === this.sunAt) return true;
    this.sunAt = sun;
    this.sunPos = pos;
    SUN.on = pos != null;
    if (pos != null) [SUN.azimuth, SUN.length] = sunOfHour(this.hour()) ?? DAY.positions[pos];
    // (the first sun of all just is; the next ones are drawn in)
    const drawn = this.sunDrawn;
    this.sunDrawn = true;
    if (drawn && drawEnabled() && !this.shadesOff) this.sweepShadows(); // (out of sight while the view moves: they come back as they are)
    // nothing of the objects is drawn anew for it: their shadows are cast
    // on the GPU (gl/shadows.js), the stylesheet shows the walls' hatching
    // and the trees' shaded sides the light has now (sunFree.js), the pen
    // drawing in what comes into sight
    this.updateSunStyle(drawn && drawEnabled());
    this.dirty.add('hillshade');
    return true;
  }

  // The hour of the day (shadows.js DAY): the clock's, or where it is held.
  hour() {
    return DAY.on || DAY.held == null ? hourAt(this.world.time) : DAY.held;
  }

  // The sun going on between the day's steps (sunOfHour), a little at a
  // time: the objects' shadows follow it at once (cast on the GPU,
  // gl/shadows.js), the walls' hatching and the trees' shaded sides as
  // the light comes round to them (updateSunStyle); the hills' wait for
  // the next step (setSun). Not mid-turn.
  followSun() {
    if (this.turning || !SUN.on || this.dayStep == null) return;
    const now = performance.now();
    if (now - (this.sunFollowed ?? 0) < SUN_EVERY) return;
    this.sunFollowed = now;
    const at = sunOfHour(this.hour());
    if (!at || (at[0] === SUN.azimuth && at[1] === SUN.length)) return;
    [SUN.azimuth, SUN.length] = at;
    this.updateSunStyle(drawEnabled());
  }

  // The stylesheet for the sun and the view as they are (sunFree.js); with
  // `pen`, what it shows that it didn't is drawn in by the pen, on the
  // objects in sight.
  updateSunStyle(pen = false) {
    const sun = sunFor(this.camera), sector = treeLightSector(this.camera);
    this.styleAngle = this.camera.angle;
    // (written only when what it shows changes: each time restyles the drawings)
    const { css, shown } = sunStyle(sun, sector);
    if (css === this.sunStyleKey) return;
    this.sunStyleKey = css;
    const was = new Set(this.sunShown ?? []);
    this.sunShown = shown;
    this.sunCss.textContent = css;
    const fresh = shown.filter((s) => !was.has(s));
    if (!pen || !fresh.length || this.turning) return;
    const sel = fresh.join(', '), tile = this.camera.tile, scale = this.drawn.zoom;
    for (const e of this.objs.values()) {
      if (e.shown === false || !e.g?.isConnected || (e.box && !this.inView(e.box))) continue;
      const only = new Set(e.g.querySelectorAll(sel));
      if (only.size) drawIn([e.g], { tile, scale, only, speed: DRAW.detail });
    }
  }

  // The lights (lights.js), left out of the night (see the constructor).
  // On the ground: with the lamps on (DAY.steps `lamps`), a pool under
  // every street lamp, and at night the light a lit window low on its
  // wall throws on the ground before it – the objects, drawn over the
  // ground, hide what of it lies behind them. Over the objects, the night
  // is their outlines (Painter.covers), painted from the furthest to the
  // nearest (this.order), each with its own lights left out after it: the
  // windows lit (`windows`: so many tenths of them, by each window's
  // number, Painter._window), a hole a little larger than the pane, so its
  // own paper shows with a glow about it, and the lamps' heads – so a house
  // hides the windows behind it along its outline. The lamps' pools are cut
  // out of the shadows' masks too (lightCuts). Drawn again when the lamps
  // come on or go off, the share of windows changes, objects are drawn
  // anew, and once a turn of the view rests; while it turns, the objects'
  // night lies over everything (it can't follow them), and the ground's
  // pools turn as a sheet.
  renderLights() {
    const px = this.camera.tile;
    const project = (x, y, z) => this.project(x, y, z);
    const turning = this.turning || !this.order;
    const lit = this.dark && !turning ? Math.round((this.litShown ?? this.litShare ?? 0) * 100) : 0;
    this.litDrawn = Math.round((this.litShown ?? this.litShare ?? 0) * 100);
    const parts = []; // [light?, path data], in order
    const each = []; // (the same, one shape each: the GPU's, gl/night.js)
    const add = (light, d) => {
      if (!d) return;
      each.push([light, d]);
      const last = parts[parts.length - 1];
      if (last && last[0] === light) last[1] += d;
      else parts.push([light, d]);
    };
    let pools = '';
    const ground = []; // (the pools and the windows' light on the ground, one by one)
    const view = `${this.camera.angle}|${px}`;
    for (const e of turning ? this.objs.values() : this.order) {
      const lamp = this.lampsOn && e.key?.[0] === 'k' && e.at?.points?.[0];
      let head = '';
      if (lamp) {
        // (worked out once per view and lamp)
        if (e.lampD?.view !== view || e.lampD.at !== lamp) {
          const [pool, h] = lampPool(lamp[0], lamp[1], project, px);
          e.lampD = { view, at: lamp, pool, head: h };
        }
        pools += e.lampD.pool;
        if (e.lampD.pool) ground.push(e.lampD.pool);
        head = e.lampD.head;
      }
      if (turning) continue;
      const n = e.night && lightShapes(e.night, px);
      if (n?.cover) add(false, n.cover); // (by day too, for the night as it comes in or lifts)
      if (head) add(true, head);
      if (lit && n) {
        for (const w of n.wins) {
          if (w.n >= lit) continue;
          add(true, w.glow);
          if (w.spill) ground.push(w.spill);
        }
      }
    }
    this.glCover = each;
    this.glGround = ground;
    // (the shadows' masks, only when the pools change: a change repaints them)
    if (pools !== this.poolsCut) {
      this.poolsCut = pools;
      const cut = pools ? `<path class="light" d="${pools}"/>` : '';
      for (const el of this.lightCuts) el.innerHTML = cut;
    }
  }

  // The lights of what moves, at night (with the lamps on): a beam on the
  // ground ahead of every car, bus, lorry and train (lights.js headBeam),
  // as polygons in scene px, for the night's canvas to rub out
  // (renderNightGround) – over the map's drawing, under what moves and
  // under the buildings in front.
  headlights() {
    const out = [];
    if (!this.lampsOn || !this.showAgents) return out;
    const beam = (x, y, dx, dy, long, seed) => {
      const pts = headBeam(x, y, dx, dy, long, seed).map(([px, py]) => this.projectDeck(px, py, 0.02));
      if (pts.some(([sx, sy]) => this.pen.onScreen(sx, sy))) out.push(pts);
    };
    for (const a of this.agents.visible()) {
      if (!(a.bus || a.truck || a.trip?.mode === 'drive')) continue;
      let dx, dy;
      if (a.bus || a.truck) {
        const l = Math.hypot(a.x - a.tx, a.y - a.ty);
        if (l < 1e-4) continue;
        [dx, dy] = [(a.x - a.tx) / l, (a.y - a.ty) / l];
      } else {
        const h = this.agentEls.get(a.id)?.heading;
        if (h == null) continue;
        const t = (h / VEHICLES.headings) * Math.PI * 2;
        [dx, dy] = [Math.cos(t), Math.sin(t)];
      }
      const [wx, wy] = wobble(a.x, a.y);
      beam(a.x + wx + dx * 0.08, a.y + wy + dy * 0.08, dx, dy, false, typeof a.id === 'number' ? a.id : hashKey(a.id));
    }
    const half = this.config.trains.length / 2;
    for (const t of this.trains.visible()) {
      const [x, y, dx, dy] = t.points[0] ?? [];
      if (x == null) continue;
      const l = Math.hypot(dx, dy) || 1;
      beam(x + (dx / l) * half, y + (dy / l) * half, dx / l, dy / l, true, hashKey(String(t.id)));
    }
    return out;
  }

  // The sun has moved a step: the hills' shadows as they were stay, under
  // a ragged front that goes across the view the way a hand hatches
  // (across the lines), and the new ones come in behind it, over
  // SHADE_SWEEP ms – the old a copy of their sheet and masks, clipped to
  // what the front has not reached, the new clipped to what it has. (The
  // objects' follow the sun as it goes, followSun.) A sweep still going
  // ends at once.
  // The map in draft while the view turns (DRAFT)…
  goDraft() {
    this.hideShadows();
    if (this.drafting) return;
    this.drafting = true;
    for (const svg of this.svgs) svg.classList.add('draft');
  }

  // …its detail back as soon as it rests.
  endDraft() {
    this.drafting = false;
    for (const svg of this.svgs) svg.classList.remove('draft');
  }

  // The shadows (gl/shadows.js), for the view the SVGs were last drawn
  // at, fading with the weather as they do (--sun, main.js); the objects'
  // hidden while the view turns (hideShadows), hatched in once it rests.
  renderShadeCanvas() {
    const d = this.drawn;
    if (!d || !this.glShadows) return;
    const sun = this.svg.style.getPropertyValue('--sun');
    if (sun !== this.shadeSun) {
      this.shadeSun = sun;
      for (const el of [this.glShadows.canvas, this.parkedSvg]) el.style.setProperty('--sun', sun);
    }
    const look = {
      view: { zoom: d.zoom, panX: d.panX, panY: d.panY, angle: d.angle, ox: this.ox, oy: this.oy, W: this.winW, H: this.winH },
      hatch: SUN.hatch, tier: SHADE_TIERS[this.lodLevel ?? 0] ?? 1, px: this.camera.tile, stroke: this.strokeK,
    };
    // the sun the objects' shadows are cast by (gl/shadows.js castPieces):
    // its shift on the ground, and a shift on the ground on screen
    const cam = this.camera, [ux, uy] = cam.toView(1, 0), [vx, vy] = cam.toView(0, 1), T = cam.tile;
    const casting = {
      cast: SUN.on && SUN.hatch ? sunFor(cam).cast : [0, 0],
      iso: [(ux - uy) * COS30 * T, (ux + uy) * 0.5 * T, (vx - vy) * COS30 * T, (vx + vy) * 0.5 * T],
    };
    this.glShadows.draw({ ...look, hold: (this.shadesOff && !this.shadesComing) || this.turning, shown: this.shadesShown ?? 1, sun: casting });
  }

  hideShadows() {
    this.shadesComing = false;
    if (this.shadesOff) return;
    this.shadesOff = true;
    cancelAnimationFrame(this.shadesIn);
    this.sweep?.end();
    this.shadesShown = 0;
  }

  // The shadows hatched in again once the view rests and what it redraws
  // is drawn (frame).
  showShadows() {
    this.shadesOff = this.shadesComing = false;
    const { steps, step } = DRAFT;
    this.shadesShown = 1;
    if (!drawEnabled()) return;
    const start = performance.now();
    const next = () => {
      const i = Math.min(steps, Math.floor((performance.now() - start) / step) + 1);
      this.shadesShown = i / steps;
      if (i < steps) this.shadesIn = requestAnimationFrame(next);
    };
    next();
  }

  sweepShadows() {
    this.sweep?.end();
    const veil = this.shadeVeil, h = SUN.hatch;
    if (!veil || !h) return;
    const old = veil.cloneNode(true);
    for (const el of old.querySelectorAll('[id]')) el.id = `${el.id}-was`;
    for (const el of old.querySelectorAll('[fill^="url(#"], [mask^="url(#"]')) {
      for (const a of ['fill', 'mask']) {
        const v = el.getAttribute(a);
        if (v?.startsWith('url(#')) el.setAttribute(a, v.replace(/\)$/, '-was)'));
      }
    }
    veil.parentNode.insertBefore(old, veil);
    const defs = this.svg.querySelector('defs');
    defs.insertAdjacentHTML('beforeend', '<clipPath id="sweep-new" clipPathUnits="userSpaceOnUse"><path/></clipPath><clipPath id="sweep-old" clipPathUnits="userSpaceOnUse"><path/></clipPath>');
    const [pNew, pOld] = ['#sweep-new path', '#sweep-old path'].map((q) => defs.querySelector(q));
    veil.setAttribute('clip-path', 'url(#sweep-new)');
    old.setAttribute('clip-path', 'url(#sweep-old)');
    // the map in the front's axes: u along the hatching, v across it
    const a = ((h.angle + 90) * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a);
    // (across what is in view, so it is seen going all the way)
    const cam = this.camera, px = cam.tile, m = 80;
    const corners = [[-m, -m], [innerWidth + m, -m], [-m, innerHeight + m], [innerWidth + m, innerHeight + m]].map(([x, y]) => [(x - cam.panX) / cam.zoom, (y - cam.panY) / cam.zoom]);
    const us = corners.map(([x, y]) => -x * sn + y * c), vs = corners.map(([x, y]) => x * c + y * sn);
    const u0 = Math.min(...us), u1 = Math.max(...us), v0 = Math.min(...vs), v1 = Math.max(...vs);
    const jag = px * 0.9, n = Math.max(8, Math.ceil((u1 - u0) / (px * 0.7)));
    const off = Array.from({ length: n + 1 }, (_, i) => (hashKey(`sweep${i}`) % 1000) / 1000 * jag);
    const at = (u, v) => `${r2(v * c - u * sn)} ${r2(v * sn + u * c)}`;
    // in SWEEP_STEPS steps, as stop-motion: each moves the front over a
    // block of the view (and repaints the shadows whole)
    const start = performance.now();
    let shown = -1;
    const step = () => {
      const i = Math.min(SWEEP_STEPS, Math.floor(((performance.now() - start) / SHADE_SWEEP) * SWEEP_STEPS) + 1);
      if (i === shown) {
        this.sweep.raf = requestAnimationFrame(step);
        return;
      }
      shown = i;
      const t = i / SWEEP_STEPS, e = t * t * (3 - 2 * t);
      const f = v0 - jag + (v1 - v0 + 2 * jag) * e;
      const front = off.map((o, i) => [u0 + ((u1 - u0) * i) / n, f + o - jag / 2]);
      pNew.setAttribute('d', `M${at(u0, v0 - jag * 2)}L${at(u1, v0 - jag * 2)}${front.slice().reverse().map(([u, v]) => `L${at(u, v)}`).join('')}Z`);
      pOld.setAttribute('d', `M${at(u0, v1 + jag * 2)}L${at(u1, v1 + jag * 2)}${front.slice().reverse().map(([u, v]) => `L${at(u, v)}`).join('')}Z`);
      if (this.glShadows) this.glShadows.dirty.hills = this.glShadows.dirty.objects = true; // (the clips are outside the sheets they watch)
      if (t < 1) this.sweep.raf = requestAnimationFrame(step);
      else this.sweep.end();
    };
    this.sweep = {
      end: () => {
        cancelAnimationFrame(this.sweep?.raf);
        old.remove();
        veil.removeAttribute('clip-path');
        defs.querySelector('#sweep-new')?.remove();
        defs.querySelector('#sweep-old')?.remove();
        this.sweep = null;
      },
    };
    step();
  }

  // The night, every frame (gl/night.js): its grey easing to the
  // hour's (this.gloom, a little each frame), the paper's strokes at night
  // – every line close up, fewer further out, as the shadows' – and the
  // lights rubbed out: on the ground, the lamps' pools, the windows' light
  // and the beams of what moves; over the objects, their lit windows.
  renderNightCanvases(dt) {
    const { camera } = this, now = performance.now();
    this.inkShown = (this.inkShown ?? 0) + ((this.inkNight ?? 0) - (this.inkShown ?? 0)) * Math.min(1, dt / 1.6);
    if (Math.abs(this.inkShown - (this.inkNight ?? 0)) < 0.01) this.inkShown = this.inkNight ?? 0;
    // the map's main ink (styles.css --ink-night) in steps of INK_STEP, at
    // most every INK_EVERY ms – each change restyles the whole map
    const ink = Math.round(this.inkShown / INK_STEP) * INK_STEP;
    if (ink !== this.inkSet && (now - (this.inkAt ?? 0) > INK_EVERY || this.inkSet == null || this.inkShown === this.inkNight)) {
      this.inkSet = ink;
      this.inkAt = now;
      for (const el of this.svgs) el.style.setProperty('--ink-night', `${Math.round(ink * 100)}%`);
    }
    this.nightGrey += ((this.gloom ?? 0) - this.nightGrey) * Math.min(1, dt / 1.6);
    if (Math.abs(this.nightGrey - (this.gloom ?? 0)) < 0.004) this.nightGrey = this.gloom ?? 0;
    const pal = THEME.palette;
    // each set of the night's strokes hatched in (or rubbed out) over
    // NIGHT_IN seconds as the night deepens (or lifts)
    const want = [this.dark ? 1 : 0, this.dark && (this.nightDepth ?? 1) >= 2 ? 1 : 0, this.dark && (this.nightDepth ?? 1) >= 3 ? 1 : 0];
    this.reveal ??= [...want];
    this.reveal = this.reveal.map((r, i) => (r < want[i] ? Math.min(want[i], r + dt / NIGHT_IN) : Math.max(want[i], r - dt / NIGHT_IN)));
    // the windows going out (or coming on) one by one, not a tenth at once
    const target = this.litShare ?? 0;
    this.litShown = (this.litShown ?? target) + Math.max(-dt * WINDOWS_BY, Math.min(dt * WINDOWS_BY, target - (this.litShown ?? target)));
    if (Math.round(this.litShown * 100) !== this.litDrawn && now - (this.litAt ?? 0) > 150) {
      this.litAt = now;
      this.dirty.add('lights');
    }
    const look = {
      grey: this.nightGrey,
      colour: pal.detail,
      // (in steps, ten a second, as stop-motion: each step repaints both
      // canvases whole)
      reveal: this.reveal.map((r) => Math.round(r * NIGHT_IN * 10) / (NIGHT_IN * 10)),
      tier: SUN.hatch && this.reveal.some((r) => r > 0) ? SHADE_TIERS[this.lodLevel ?? 0] ?? 1 : -1,
      hatch: SUN.hatch,
      px: camera.tile,
      stroke: this.strokeK ?? 1,
    };
    const d = this.drawn;
    if (!this.glNight || !d) return;
    const view = { zoom: d.zoom, panX: d.panX, panY: d.panY, ox: this.ox, oy: this.oy, W: this.winW, H: this.winH };
    this.glNight[0].draw(view, { ...look, lights: this.glGround, sheet: this.nightSheet, beams: this.headlights() });
    // (while the view turns the objects' night can't follow them: they go
    // without, bare paper, as they are drawn bare – the lights on the ground stay)
    this.glNight[1].draw(view, { ...look, cover: this.turning ? NO_COVER : this.glCover });
  }

  // Every object's shadow drawn again from its feet, with SUN as it is
  // now – without repainting the objects (mark the layer dirty after a
  // change to SUN).
  renderShadows() {
    for (const e of this.objs.values()) this.glShadows?.castInto(e.sg, e.shade);
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
    const joined = joinedRow(world, s), row = joined.map((o) => world.centerOf(o));
    const rigid = [row.reduce((a, p) => a + p[0], 0) / row.length, row.reduce((a, p) => a + p[1], 0) / row.length];
    painter.rigid = rigid;
    // On uneven ground it stands level at the highest ground under it –
    // the whole row, so shared walls still meet – and its walls run on down
    // to the ground (Painter.relief). Not parks and squares (they follow it).
    const relief = camera.lift && !def.site ? (wx, wy) => camera.lift(wx, wy) - camera.lift(...rigid) : null;
    if (relief) {
      painter.relief = relief;
      painter.level = standLevel(world, joined, relief);
    }
    painter.sways = live;
    // windows close up (Painter._window): as the band it is drawn with
    if (live) painter.near = !!(this.bandFor(`s${s.id}`) & NEAR);
    // (what its band leaves out isn't drawn at all)
    const keep = (p) => {
      if (!live) return;
      const band = this.bandFor(`s${s.id}`), detail = this.drawBare ? bareOf(band) : band;
      p.keep = 2 - ((detail >> 4) & 3);
      p.keepTier = (detail >> 2) & 3;
    };
    keep(painter);
    const points = world.nodesOf(s).map((n) => world.grid.xy(n));
    if (def.site) {
      painter.follow = true; // parks and squares lie on the ground like yards
      const site = world.siteArea(s.type, s.node, s.rotation);
      painter.setSite(fitSite(world, this.config, site));
      painter.setSitePaths(siteEdges(world, this.config, world.sitePaths(s)));
      const [x0, y0, x1, y1] = site.rect;
      points.push([x0 + STRUCTURE_PAD, y0 + STRUCTURE_PAD], [x1 - STRUCTURE_PAD, y1 - STRUCTURE_PAD]);
    }
    painter.join = joinSides(world, s);
    painter.court = courtSides(world, s);
    painter.setTilt(tiltOf(def, s, painter.join, world));
    painter.roadGap = world.nodesOf(s).length === 1 ? roadFront(world, s).gap : 1; // see busStop.js
    if (s.ruin) drawRuin(painter, def); // burnt down (World.burnStructure)
    else def.draw(painter, s);
    const core = painter.bounds;

    // Courts: the walled yard beside a village house (structures/courts.js),
    // standing with it, not lying on the ground like the front yard.
    let courtWorld = [];
    if (core && (painter.court.left || painter.court.right)) {
      const cp = this.attachFree(new Painter(camera, { x, y, z }, world.drawnRotation(s), drawSeed(s) ^ 0x3c6ef372));
      cp.setTilt(painter.tilt);
      cp.rigid = rigid;
      cp.relief = relief;
      cp.level = painter.level;
      cp.sways = live;
      keep(cp);
      const body = painter.body ?? { x0: core[0], y0: core[1], x1: core[2], y1: core[3] };
      courtWorld = drawCourt(cp, painter.court, body).map((o) => o.map(([lx, ly]) => cp.toWorld(lx, ly)));
      painter.merge(cp, { aside: true });
    }

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
      keep(yp);
      YARDS[yard.style].draw(yp, yard, s);
      if (live && yp.spots.length) this.parking.setSpots(s, yp.spots);
      else if (live) this.parking.spots.delete(s.id);
      painter.merge(yp, { aside: true });
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
      keep(pp);
      const plot = this.plotFor(s, plotDef, painter, core, yardWorld, courtWorld);
      drawPlot(pp, plot);
      painter.merge(pp, { aside: true });
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
  plotFor(s, plotDef, painter, core, yardWorld, courtWorld = []) {
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
    const courtsLocal = courtWorld.map((o) => o.map(([wx, wy]) => [wx - ax, wy - ay]));
    // (the courts as well: no garden props or fences inside their walls)
    const inYard = (x, y) => (yardLocal && pointInPolygon(toAnchor(x, y), yardLocal)) || courtsLocal.some((o) => pointInPolygon(toAnchor(x, y), o));
    // (on a water dot – or across the drawn shore, which curves in over
    // the land dots round a lake: as seen from the nearest own dot)
    const shores = this.shoreIndex();
    const water = (x, y, r = 0) => {
      const [wx, wy] = toAnchor(x, y);
      const n = world.grid.nodeAt(ax + wx, ay + wy);
      if (n < 0 || world.terrain.isWater(n)) return true;
      let o = pts[0], od = Infinity;
      for (const p of pts) {
        const d = Math.hypot(ax + wx - p[0], ay + wy - p[1]);
        if (d < od) [o, od] = [p, d];
      }
      if (od < 1e-6) return false;
      const t = shores.cast(o, [(ax + wx - o[0]) / od, (ay + wy - o[1]) / od], od + SHORE_GAP + r);
      return t !== null;
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
        sides,
        inside: (x, y, r) =>
          own(x - r, y - r) && own(x + r, y - r) && own(x - r, y + r) && own(x + r, y + r) &&
          reached(x, y) && !onBuilding(x, y, r) && !inYard(x, y) && !water(x, y, r),
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
        !onBuilding(x, y, r) && !inYard(x, y) && !water(x, y, r),
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
    const cam = this.camera, t = cam.tile;
    // (the corners lifted and warped – the same at any angle: kept per
    // object's points while the relief and the warp stay, so a turn only
    // turns them)
    let byPad = BOX_CORNERS.get(points);
    if (byPad?.lift !== cam.lift || byPad.warp !== cam.warp || byPad.terrain !== this.world.terrain) {
      byPad = Object.assign(new Map(), { lift: cam.lift, warp: cam.warp, terrain: this.world.terrain });
      BOX_CORNERS.set(points, byPad);
    }
    let c = byPad.get(pad);
    if (!c) {
      c = new Float64Array(points.length * 12);
      let i = 0;
      for (const [px, py] of points) {
        for (const [dx, dy] of [[-pad, -pad], [pad, -pad], [pad, pad], [-pad, pad]]) {
          let x = px + dx, y = py + dy, z = this.world.terrain.heightAt(x, y);
          if (cam.lift) z += cam.lift(x, y);
          if (cam.warp) {
            const [wx, wy] = cam.warp(x, y);
            x = wx;
            y = wy;
          }
          c[i++] = x - cam.cx; c[i++] = y - cam.cy; c[i++] = z;
        }
      }
      byPad.set(pad, c);
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const cs = cam._cos, sn = cam._sin, kx = COS30 * t, ky = 0.5 * t, kz = cam.zScale * t;
    for (let i = 0; i < c.length; i += 3) {
      const rx = c[i] * cs - c[i + 1] * sn, ry = c[i] * sn + c[i + 1] * cs;
      const sx = (rx - ry) * kx, sy = (rx + ry) * ky - c[i + 2] * kz;
      if (sx < x0) x0 = sx;
      if (sx > x1) x1 = sx;
      if (sy < y0) y0 = sy;
      if (sy > y1) y1 = sy;
    }
    // its shadow reaches out along the sun as far as it is tall, any way it falls
    const s = SUN.on && SUN.hatch ? SUN.length * top * t * 1.2 : 0;
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
  // and `fps` times a second. While the view moves they hold still where
  // they lean: the drawing is moved on the GPU then (placeView), and a
  // lean would paint it all again.
  swayTrees(time, strength) {
    const S = TREE_SWAY;
    if (this.turning || performance.now() - this.movedAt < VIEW_SETTLE) return;
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
      u.t = k ? `matrix(1 0 ${k} 1 ${r2(-k * u.foot[1])} 0)` : '';
      if (u.e) this.placeGroups(u.e); // (a clump: with its slide, mid-turn)
      else if (u.t) u.el.setAttribute('transform', u.t);
      else u.el.removeAttribute('transform');
    }
    this.swayIdle = !on;
  }

  // What leans in an object's drawing: a forest clump whole, or the garden
  // trees in a building's ({ el, foot, h: hash in [0, 1), ph: phase }).
  swayUnits(e) {
    e.swayAt = e.at;
    e.sway = [];
    const unit = (el, foot, whole) => {
      const h = Math.abs(Math.sin(foot[0] * 12.9898 + foot[1] * 78.233) * 43758.5453) % 1;
      e.sway.push({ el, foot, h, ph: foot[0] * 0.03 + foot[1] * 0.05, lean: 0, t: '', e: whole });
    };
    if (e.key[0] === 'f') {
      const f = this.world.features.get(Number(e.key.slice(1)));
      if (!f) return;
      const [nx, ny] = this.world.grid.xy(f.node);
      unit(e.g, this.project(nx + f.ox, ny + f.oy), e);
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
      this.preparedAt = null; // (another in sight to make ready for a turn)
      // drawn for an old view: redraw (renderObjects; mid-turn turnFrame does)
      if (show && e.stale && !this.turning) this.objsDirty.add(e.key);
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

  // Is it a tree in a wood that is drawn as one shape?
  inWoods(e) {
    return this.farWoods?.size > 0 && e.key?.[0] === 'f' && this.farWoods.has(this.forestState().woodOf.get(Number(e.key.slice(1))));
  }

  // Which woods are drawn as one shape (forest.js) at zoom z: those it is
  // further out than config.render.forest.zoom for, each by its own share
  // of it (lod.spread, as the buildings' detail, bandOf), so the woods
  // don't all turn at once; and each only once the zoom is BAND_HOLD past.
  updateWoods(z) {
    const { forest, lod } = this.config.render;
    this.farWoods ??= new Set();
    if (z >= forest.zoom * (1 + BAND_HOLD) && !this.farWoods.size) return; // (not even found while close)
    const state = this.forestState();
    if (z === this.woodsZoom && state === this.woodsFor) return;
    this.woodsZoom = z;
    this.woodsFor = state;
    const far = new Set();
    for (const w of state.woods) {
      const at = forest.zoom * (1 - lod.spread * detailRank(`w${w.id}`));
      const was = this.farWoods.has(w.id);
      if (z < at * (was ? 1 + BAND_HOLD : 1 - BAND_HOLD)) far.add(w.id);
    }
    if (far.size === this.farWoods.size && [...far].every((id) => this.farWoods.has(id))) return;
    this.farWoods = far;
    this.dirty.add('forest');
    this.cull();
  }

  // The woods (forest.js), found again after trees come or go.
  forestState() {
    if (!this.forests) {
      const { world, config } = this;
      const ways = new SegmentIndex([...networkPolylines(world.networks.road, config.road), ...networkPolylines(world.networks.rail, config.rail)]);
      this.forests = findForests(world, config.render.forest, ways);
      if (this.farWoods?.size) queueMicrotask(() => { this.woodsZoom = null; this.updateWoods(this.drawn.zoom); this.cull(); }); // trees that joined or left a wood
    }
    return this.forests;
  }

  renderForest() {
    const state = this.farWoods?.size ? this.forestState() : null;
    const woods = state ? state.woods.filter((w) => this.farWoods.has(w.id)) : [];
    this.forestHatchAt = this.hatchScale(this.drawn.zoom);
    const svg = woods.length ? forestSVG({ woods, cover: state.cover }, (x, y) => this.project(x, y), this.config.render.forest, this.camera, this.config.render.forest.hatch / this.forestHatchAt) : '';
    if (svg !== this.forestDrawn) this.layers.forest.innerHTML = this.forestDrawn = svg;
  }

  // The woods' hatching keeps its spacing on screen (config.render.forest
  // .hatch px): the zoom in the steps the line widths go by (strokeStep),
  // and the pattern set again when it moves a step.
  hatchScale(z) {
    const step = this.config.render.strokeStep;
    return step ** Math.round(Math.log(z) / Math.log(step));
  }

  forestHatch(z) {
    const k = this.hatchScale(z);
    if (k === this.forestHatchAt) return;
    this.forestHatchAt = k;
    const pattern = this.layers.forest.querySelector('#forest-hatch');
    if (!pattern) return;
    const s = r2(this.config.render.forest.hatch / k);
    pattern.setAttribute('width', s);
    pattern.setAttribute('height', s);
    const line = pattern.firstElementChild;
    line.setAttribute('y1', s / 2);
    line.setAttribute('x2', s);
    line.setAttribute('y2', s / 2);
  }

  // Chimney smoke (particles.js) from the buildings in sight: `time`
  // simulated seconds, `env` the weather ({ wind, rain, mist }). Not from a
  // chimney under the mist, which hides it.
  smokeFrame(time, env) {
    if (!this.showAgents) return this.smoke.clear();
    const vents = [];
    const height = this.mistLevel != null ? this.groundHeight() : null;
    for (const e of this.objs.values()) {
      if (!e.vents || e.shown === false || e.ventsTurn !== this.camera.angle) continue;
      for (const v of e.vents) {
        if (height && (this.camera.lift?.(v.at[0], v.at[1]) ?? 0) + v.at[2] < this.mistLevel) continue;
        vents.push(v);
      }
    }
    this.smoke.frame(this.camera, this.strokeK, vents, time, env);
  }

  // A building on fire, burning out or put out (fire.js), drawn from its
  // windows and outline as drawn: `time` simulated seconds, `env` the weather.
  fireFrame(time, env) {
    this.fire.frame(this.camera, this.strokeK, (id) => this.objs.get(`s${id}`), time, env);
  }

  // The mist (weather 'mist', mist.js): `risen` 0 (none) to 1, in steps
  // (sim/weather.js mistRisen); each step draws it again.
  setMist(risen) {
    if (risen === this.mistRisen) return;
    this.mistRisen = risen;
    this.dirty.add('mist');
  }

  // The ground's height as drawn (the relief's lift and the terrain), and
  // its lowest and highest over the map, for the mist's top.
  groundHeight() {
    const { camera, world } = this;
    return (x, y) => (camera.lift?.(x, y) ?? 0) + world.terrain.heightAt(x, y);
  }

  mistTop() {
    const { grid } = this.world;
    if (!this.groundRange) {
      const height = this.groundHeight();
      let lo = Infinity, hi = -Infinity;
      for (let y = 0; y < grid.height; y += 0.5) for (let x = 0; x < grid.width; x += 0.5) { const h = height(x, y); lo = Math.min(lo, h); hi = Math.max(hi, h); }
      this.groundRange = [lo, hi];
    }
    return mistLevel(...this.groundRange, this.config.weather.mist, this.mistRisen);
  }

  // Each step of the mist rising or sinking comes in slowly over the last
  // (mistIn, mistOut) – the paper settling, the pen drawing its lines –
  // and so do the covers of what stands in it. Drawn again for another
  // reason (the view turned, the ground changed), it is just there.
  renderMist() {
    const { camera, world } = this;
    const level = this.mistRisen ? this.mistTop() : null;
    const animate = drawEnabled() && level !== this.mistLevel && this.mistLevel !== undefined;
    const seed = Math.round((level ?? 0) * 1000) ^ world.seed;
    let svg = '';
    // the paper's strokes it is filled with, as are its covers (gl/objects.js)
    if (level != null && SUN.hatch) {
      const { hatch, width } = mistHatch(SUN.hatch);
      this.glObjects?.setTile(hatch, camera.tile, width * camera.tile);
    }
    if (level != null) {
      const { grid } = world;
      const m = 1.2; // (as the contours: the ground is drawn a little past the map)
      const surface = mistSurface(camera, this.groundHeight(), [-m, -m, grid.width - 1 + m, grid.height - 1 + m], level);
      svg = mistSVG(surface, camera, world.seed);
    }
    const layer = this.layers.mist;
    if (animate) for (const old of layer.querySelectorAll(':scope > g:not(.leaving)')) mistOut(old, { seed });
    else layer.innerHTML = '';
    if (svg) {
      const g = layer.appendChild(document.createElementNS(SVGNS, 'g'));
      g.innerHTML = svg;
      if (animate) mistIn(g, { seed });
    }
    this.mistLevel = level;
    for (const e of this.objs.values()) this.coverMist(e, animate);
  }

  // What of an object is under the mist: covered over with paper and the
  // cut lumped (coverSVG), or all of it hidden – coming and going slowly
  // with `animate` (as the mist's own steps, renderMist).
  coverMist(e, animate = false) {
    animate &&= e.shown !== false;
    const seed = detailRank(e.key ?? '') * 1e9;
    for (const old of e.g.querySelectorAll(':scope > .mist-cover:not(.leaving)')) {
      if (animate) mistOut(old, { seed, owner: e.g });
      else old.remove();
    }
    if (!animate) for (const old of e.g.querySelectorAll(':scope > .mist-cover')) old.remove();
    const level = this.mistLevel;
    let svg = '';
    if (level != null && e.at) {
      const [ax, ay] = e.at.anchor ?? e.at.points[0];
      const height = this.groundHeight();
      svg = coverSVG(this.camera, e.at, height(ax, ay), height, level, seed);
    }
    const under = svg === 'under';
    if (under !== (e.g.mistUnderTo ?? e.g.classList.contains('mist-under'))) {
      // sinking out of sight or coming up again: it fades
      const g = e.g, ms = MIST.fade * 0.85;
      clearTimeout(g.mistUnder);
      g.mistUnderTo = under;
      if (animate) {
        g.fade = { at: performance.now(), ms, from: under ? 1 : 1 - MIST.paper, to: under ? 1 - MIST.paper : 1, ease: 'in-out' }; // (gl/objects.js)
        g.classList.remove('mist-under');
        g.mistUnder = setTimeout(() => {
          g.classList.toggle('mist-under', under);
          g.fade = null;
        }, ms);
      } else {
        g.fade = null;
        g.classList.toggle('mist-under', under);
      }
    }
    if (!svg || under) return;
    const g = document.createElementNS(SVGNS, 'g');
    g.setAttribute('class', 'mist-cover');
    g.innerHTML = svg;
    e.g.appendChild(g);
    if (animate) mistIn(g, { seed, owner: e.g });
  }

  // Put the drawings of the objects in sight back in the objects layer, in
  // the painter's order (this.order): after cull() showed some again.
  placeObjects() {
    this.objsPlace = false;
    if (!this.order) return;
    const live = new Set([...this.objs.values(), ...this.ghosts.values()]);
    this.placeObjectGroups(this.order.filter((e) => e.shown !== false && live.has(e)).map((e) => e.g));
  }

  // Does a scene box overlap the drawn view?
  inView(b) {
    const v = this.viewBox;
    return !v || (b[0] < v[2] && b[2] > v[0] && b[1] < v[3] && b[3] > v[1]);
  }

  // Ground rectangle of an object in the axes of the view's nearest quarter
  // turn (Camera.quarter: both lead towards the viewer), for isoSort.
  viewBounds(points, pad) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of points) {
      const [rx, ry] = this.camera.quarter(x, y);
      minX = Math.min(minX, rx - pad);
      maxX = Math.max(maxX, rx + pad);
      minY = Math.min(minY, ry - pad);
      maxY = Math.max(maxY, ry + pad);
    }
    return { minX, maxX, minY, maxY };
  }

  // Trains: close up the railcar's model, further out a filled oblong as
  // long as it. Railcars beyond where the exits fade out are left
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
        this.placeVehicle(el, a, kind === 'bus' ? 'bus' : a.engine ?? truckFor(a.id));
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

  // A train: close up the railcar (src/render/vehicles.js) turned along the
  // track, further out an oblong. `cars`: [{ i, p: [x, y, dx, dy] }], its
  // middle. It goes on the canvas over the buildings (penTop) unless
  // something nearer could hide it (screened), else on the one under them.
  placeTrain(el, cars) {
    const cam = this.camera, pen = this.pen;
    if (!cars.length) return;
    const penFor = (x, y) => (this.screened(x, y) ? pen : this.penTop);
    const len = r2(this.config.trains.length);
    if (cam.zoom < VEHICLES.minZoom) {
      const r = THEME.carriageRadius;
      for (const { p: [x, y, dx, dy] } of cars) {
        const half = len / 2 - 0.03;
        const [ax, ay] = this.projectDeck(x - dx * half, y - dy * half, 0.04);
        const [bx, by] = this.projectDeck(x + dx * half, y + dy * half, 0.04);
        if (!pen.onScreen(ax, ay) && !pen.onScreen(bx, by)) continue;
        // a band r either side of the line back to front, square ends
        const l = Math.hypot(bx - ax, by - ay) || 1;
        const [ux, uy] = [(bx - ax) / l, (by - ay) / l];
        const [nx, ny] = [-uy * r, ux * r];
        const path = outline([[ax - ux * r + nx, ay - uy * r + ny], [bx + ux * r + nx, by + uy * r + ny], [bx + ux * r - nx, by + uy * r - ny], [ax - ux * r - nx, ay - uy * r - ny]]);
        penFor(x, y).drawScene(AGENT_STYLES.train, path);
      }
      return;
    }
    const order = cars
      .map(({ i, p: [x, y, dx, dy] }) => ({ i, x, y, a: Math.atan2(dy, dx), h: headingIndex(Math.atan2(dy, dx)), depth: cam.depth(x, y) }))
      .sort((a, b) => a.depth - b.depth);
    const key = `${cam.angle}|${order.map((c) => `${c.i}:${c.h}`).join(',')}`;
    if (el.key !== key) {
      el.key = key;
      el.shapes = order.map((c) => shapesOf(vehicleSVG(cam, `railcar:${len}`, c.h, c.i % VEHICLES.hands)));
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
      el.path = outline([[ax + ux - uy, ay + uy + ux], [ax + ux + uy, ay + uy - ux], [bx - ux + uy, by - uy - ux], [bx - ux - uy, by - uy + ux]]);
      return;
    }
    const heading = el.heading ?? 0;
    const hand = (el.model ??= modelFor(a.id)).hand;
    const key = `${cam.angle}|${heading}|${name}`;
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
    const carry = kind === 'walker' ? a.carry : null; // (at a fire: a bucket, the hose)
    const key = !close ? 'dot' : kind === 'cyclist' ? `c${body}|${heading}|${cam.angle}` : `w${body}${brolly ? 'u' : ''}${carry ?? ''}`;
    if (el.key !== key) {
      el.key = key;
      el.shapes = !close ? [shape(kind, personMark(kind, a.id))]
        : shapesOf(kind === 'cyclist' ? cyclistSVG(cam, heading, body) : walkerSVG(body, brolly, carry));
    }
    // at a fire, facing it (or whoever they pass the bucket to)
    if (a.watch) el.left = this.projectDeck(a.watch[0], a.watch[1], 0.04)[0] < sx;
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
    const key = close ? `${model.name}|${heading}|${this.camera.angle}` : 'dot';
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

// The highest ground (relief, world -> lift) under the dots of the
// structures `row`, a little in from each dot's edge: where a building on
// uneven ground stands (Renderer.paintStructure).
const STAND_REACH = 0.35;
function standLevel(world, row, relief) {
  let hi = -Infinity;
  for (const o of row) {
    for (const n of world.nodesOf(o)) {
      const [x, y] = world.grid.xy(n);
      for (const dy of [-STAND_REACH, 0, STAND_REACH]) for (const dx of [-STAND_REACH, 0, STAND_REACH]) hi = Math.max(hi, relief(x + dx, y + dy));
    }
  }
  return hi;
}
