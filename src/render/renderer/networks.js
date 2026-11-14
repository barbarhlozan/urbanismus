// Roads, footpaths, railways and fences (Renderer methods; see renderer.js):
// their lines worked out on the ground as ink items, drawn on the GPU
// (gl/lines.js) with the pen's timing kept per layer (ink.js); and the
// bridges where they cross water.

import { THEME, mixColour } from '../../theme.js';
import { wobble } from '../painter.js';
import { fenceGates } from '../../sim/pastures.js';
import { edgeCurve, fillet, measurePolyline, pointAt, subPolyline, streetKerbs, pathJoins, JOIN_REACH, railParts, roadEdges, roadway, keepRuns, offsetPolyline } from '../../roads/geometry.js';
import { edgeKey } from '../../roads/network.js';
import { stationTracks } from '../../../structures/station.js';
import { STRUCTURE_TYPES } from '../../../structures/index.js';
import { wander } from '../../../structures/plots.js';
import { pathIndex } from '../lots.js';
import { zebraCrossings } from '../../roads/furniture.js';
import { wayOutlines } from '../../roads/wayOutline.js';
import { trodden } from '../dirtPath.js';
import { findBridges, makeDeck, bridgeLines } from '../bridges.js';
import { hashKey, COS30, STRUCTURE_PAD } from './shared.js';

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
// exitDir for wayOutlines: a way end on a map exit's dot -> its direction.
function wayExits(world, layer, exits) {
  const byDot = new Map(exits.map((e) => [e.node, e.dir]));
  return (n) => {
    const p = world.ways.nodes.get(n), d = layer.nodeAt(p.x, p.y);
    if (!byDot.has(d)) return null;
    const [x, y] = layer.dot(d);
    return Math.hypot(x - p.x, y - p.y) < 0.3 ? byDot.get(d) : null;
  };
}

// Kerbs open this much wider than a footpath coming in, each side (grid units).
const PATH_OPENING = 0.012;

export class NetworkDrawing {
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
    // the centre lines, for the painted schemes' wash (gl/lines.js)
    for (const e of world.ways.edges.values()) if (e.kind === 'path') add(`pw${e.id}`, 'path-wash', e.pts);
    const dot = (n) => { const p = world.ways.nodes.get(n); return layer.nodeAt(p.x, p.y); };
    const joinAt = [...joined.values()].map((j) => layer.pos(j.fine));
    const keep = (q) => !onRoad(q) && joinAt.every((at) => Math.hypot(q[0] - at[0], q[1] - at[1]) >= JOIN_REACH - 1e-3);
    for (const { key, kind, line, a, b } of wayOutlines(world.ways, {
      keep: (e) => e.kind === 'path', width: () => this.config.path.edge, dot,
      capAt: (n) => !intoSite(dot(n)) && !joined.has(dot(n)),
    })) {
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
    const { exits, buffers } = railParts(layer, this.config.rail, world.railExits());
    const tracks = []; // for the track close up (trackItems)
    // the dashes are a second line over the same track; each way's own curve
    const dot = (n) => { const p = world.ways.nodes.get(n); return layer.nodeAt(p.x, p.y); };
    for (const e of world.ways.edges.values()) {
      if (e.kind !== 'rail') continue;
      const [a, b] = [dot(e.a), dot(e.b)];
      for (const cls of ['rail', 'rail-dash']) add(`${cls}w${e.id}`, cls, e.pts, a, b);
      tracks.push({ key: `w${e.id}`, line: e.pts, a, b });
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
      if (STRUCTURE_TYPES[s.type]?.driveway === false) continue; // houses: no path drawn to the road
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
      // (from the ways' own curves, junctions as one shape: wayOutline.js)
      const lane = this.config.lane;
      // dead ends a footpath carries on from: open, narrowing into it
      const joins = this.pathJoins();
      const exits = wayExits(world, layer, world.roadExits());
      const dot = (n) => { const p = world.ways.nodes.get(n); return layer.nodeAt(p.x, p.y); };
      for (const { key, kind, line, a, b } of wayOutlines(world.ways, {
        keep: (e) => e.kind === 'road', width: (e) => (e.lane ? lane.edge : curve.edge),
        exitDir: exits, capAt: (n) => !joins.has(dot(n)), taper: lane.taper, dot,
      })) {
        add(`r${key}`, kind === 'fade' ? 'road-exit' : 'road', line, a, b);
      }
      for (const [n, { line }] of joins) line.forEach((pts, i) => add(`rj${n}:${i}`, 'road', pts, n, n));
      // its centre lines, for the painted schemes' wash (gl/lines.js)
      for (const e of world.ways.edges.values()) if (e.kind === 'road') add(`rw${e.id}`, 'road-wash', e.pts);
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
}
