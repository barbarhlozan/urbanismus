// Roads, footpaths, railways and fences (Renderer methods; see renderer.js):
// their lines worked out on the ground as ink items, drawn on the GPU
// (gl/lines.js) with the pen's timing kept per layer (ink.js); and the
// bridges where they cross water.

import { THEME, mixColour } from '../../theme.js';
import { wobble } from '../painter.js';
import { fenceGates } from '../../sim/pastures.js';
import { churchyards, GRAVE } from '../../sim/churchyards.js';
import { edgeCurve, fillet, measurePolyline, pointAt, subPolyline, streetKerbs, pathJoins, JOIN_REACH, railParts, roadEdges, roadway, keepRuns, offsetPolyline } from '../../roads/geometry.js';
import { edgeKey } from '../../roads/network.js';
import { stationTracks } from '../../../structures/station.js';
import { STRUCTURE_TYPES } from '../../../structures/index.js';
import { wander } from '../../../structures/plots.js';
import { pathIndex } from '../lots.js';
import { zebraCrossings } from '../../roads/furniture.js';
import { wayOutlines } from '../../roads/wayOutline.js';
import { trodden, ROAD } from '../dirtPath.js';
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
  const byWay = new Map(exits.map((e) => [e.way, e.dir]));
  return (n) => byWay.get(n) ?? null;
}

// Where the footpaths' lines (their ways as drawn) cross the polyline
// `line`: the distances along it (wallItems' gateways).
function pathCrossings(world, line) {
  const out = [];
  const cum = measurePolyline(line).cum;
  for (const e of world.ways.edges.values()) {
    if (e.kind !== 'path') continue;
    const q = e.pts;
    for (let j = 1; j < q.length; j++) {
      const [cx, cy] = q[j - 1], [dx, dy] = q[j];
      for (let i = 1; i < line.length; i++) {
        const [ax, ay] = line[i - 1], [bx, by] = line[i];
        const rx = bx - ax, ry = by - ay, sx = dx - cx, sy = dy - cy;
        const den = rx * sy - ry * sx;
        if (Math.abs(den) < 1e-12) continue;
        const t = ((cx - ax) * sy - (cy - ay) * sx) / den, u = ((cx - ax) * ry - (cy - ay) * rx) / den;
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1) out.push(cum[i - 1] + t * (cum[i] - cum[i - 1]));
      }
    }
  }
  return out;
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

  renderWalls() {
    this.inkUpdate('walls', () => this.wallItems(), this.world.networks.wall);
  }

  // The churchyard walls' ink items (the 'wall' network): a low wall, its
  // top two lines under a pitched capping (a ridge between them), the
  // foot only on the side in sight, an upright where it turns away and at
  // its ends. Where a road or railway crosses there's a gap; where a
  // footpath does, an arched gateway a little taller than the wall
  // (sim/pastures.js fenceGates). Then the graves of every
  // churchyard closed all round (sim/churchyards.js), each a mound
  // outlined on the ground and a headstone, a cross or a rounded stone at
  // its head.
  wallItems() {
    const { world, camera } = this, layer = world.networks.wall, graph = layer.graph, C = this.config.wall;
    const { items, add } = this.inkItems(true);
    const gap = (f) => world.roadAtFine(f) || world.rails.hasNode(f);
    const ok = (a, b) => !gap(a) && !gap(b);
    const gates = fenceGates(world, graph);
    const sees = ([nx, ny]) => camera.facing([nx, ny, 0]);
    const t = C.thick / 2, h = C.height, G = C.gate, P = C.pier, gh = C.gateHeight;
    const z = (pts, zz) => pts.map(([x, y]) => [x, y, zz]);

    // the wall in chains of dot steps, unbroken where two meet end to end
    const deg = (n) => [...graph.neighbors(n)].filter((m) => ok(n, m)).length;
    const done = new Set(), chains = [];
    const follow = (start, next) => {
      const chain = [start];
      let [prev, n] = [start, next];
      for (;;) {
        done.add(edgeKey(prev, n));
        chain.push(n);
        if (n === start || deg(n) !== 2) break;
        const m = [...graph.neighbors(n)].find((m) => ok(n, m) && !done.has(edgeKey(n, m)));
        if (m == null) break;
        [prev, n] = [n, m];
      }
      chains.push(chain);
    };
    const starts = [...graph.nodes()].filter((n) => !gap(n));
    for (const n of starts) if (deg(n) !== 2) for (const m of graph.neighbors(n)) if (ok(n, m) && !done.has(edgeKey(n, m))) follow(n, m);
    // (what's left goes round: start it away from a gateway, if it can)
    for (const n of [...starts.filter((n) => !gates.at.has(n)), ...starts]) {
      for (const m of graph.neighbors(n)) if (ok(n, m) && !done.has(edgeKey(n, m))) follow(n, m);
    }

    chains.forEach((chain, ci) => {
      // its line, drifting a little, and how far along it each dot is
      const raw = [], at = [];
      for (let i = 1; i < chain.length; i++) {
        const part = edgeCurve(layer, C, chain[i - 1], chain[i]);
        for (const p of i === 1 ? part : part.slice(1)) raw.push(p);
        at.push(raw.length - 1);
      }
      const dense = [raw[0]];
      for (let k = 1; k < raw.length; k++) {
        const [p, q] = [raw[k - 1], raw[k]];
        const n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 0.1));
        for (let i = 1; i <= n; i++) dense.push([p[0] + ((q[0] - p[0]) * i) / n, p[1] + ((q[1] - p[1]) * i) / n]);
      }
      const curve = measurePolyline(dense.map((p) => wander(p, C.wander)));
      const len = curve.total;
      const closed = chain[0] === chain[chain.length - 1];
      const sAt = (i) => {
        if (i === 0) return 0;
        const r = measurePolyline(raw.slice(0, at[i - 1] + 1));
        return (r.total / (measurePolyline(raw).total || 1)) * len;
      };
      // the gateways: [from, to, middle] along it
      const gatesHere = [];
      chain.forEach((n, i) => {
        if (closed && i === chain.length - 1) return;
        if (gates.at.has(n)) gatesHere.push(sAt(i));
      });
      for (let i = 1; i < chain.length; i++) if (gates.across.has(edgeKey(chain[i - 1], chain[i]))) gatesHere.push((sAt(i - 1) + sAt(i)) / 2);
      // …each where the footpath's own line crosses the wall, not at the
      // wall's dot nearest to it: a path drawn freely passes between the dots
      if (gatesHere.length) {
        const crossings = pathCrossings(world, dense).map((s) => (s / (measurePolyline(dense).total || 1)) * len);
        gatesHere.forEach((s, k) => {
          const near = crossings.reduce((best, c) => (Math.abs(c - s) < Math.abs(best - s) ? c : best), Infinity);
          if (Math.abs(near - s) < 0.4) gatesHere[k] = near;
        });
        gatesHere.sort((p, q) => p - q);
        for (let k = gatesHere.length - 1; k > 0; k--) if (gatesHere[k] - gatesHere[k - 1] < 2 * (G + P)) gatesHere.splice(k, 1);
      }
      const blocks = gatesHere.map((s) => [Math.max(0, s - G - P), Math.min(len, s + G + P), s]).sort((p, q) => p[0] - q[0]);
      // the wall between them
      const runs = [];
      let s0 = 0, joined0 = false;
      for (const [b0, b1] of blocks) {
        if (b0 - s0 > 0.02) runs.push([s0, b0, joined0, true]);
        [s0, joined0] = [b1, true];
      }
      if (len - s0 > 0.02) runs.push([s0, len, joined0, false]);
      const [a, b] = [chain[0], chain[chain.length - 1]];
      const key = `w${ci}.${a}.${b}`;
      runs.forEach(([r0, r1, gateBefore, gateAfter], k) => {
        const loop = closed && !blocks.length;
        this.wallRun(add, `${key}.${k}`, subPolyline(curve, r0, r1), { loop, startEnd: !loop && !gateBefore, endEnd: !loop && !gateAfter, a, b, sees, z });
      });
      blocks.forEach(([b0, b1, s], k) => {
        const p0 = pointAt(curve, b0), p1 = pointAt(curve, b1);
        const ux0 = p1[0] - p0[0], uy0 = p1[1] - p0[1], ul = Math.hypot(ux0, uy0) || 1;
        const u = [ux0 / ul, uy0 / ul], nl = [-u[1], u[0]];
        const f = sees(nl) ? 1 : -1, n = [nl[0] * f, nl[1] * f];
        const off = (p, d, along = 0) => [p[0] + n[0] * d + u[0] * along, p[1] + n[1] * d + u[1] * along];
        const m = pointAt(curve, s), c0 = off(m, t + 0.005, -G), c1 = off(m, t + 0.005, G);
        const gk = `${key}.g${k}`, T = t + 0.005;
        // its top under the capping, and the capping's ends
        add(`${gk}t`, 'wall', z([off(p0, T), off(p1, T)], gh), a, b);
        add(`${gk}u`, 'wall', z([off(p0, -T), off(p1, -T)], gh), a, b);
        add(`${gk}r`, 'wall-cap', z([p0, p1], gh + C.cap), a, b);
        for (const [p, e] of [[p0, 0], [p1, 1]]) add(`${gk}e${e}`, 'wall-cap', [[...off(p, T), gh], [...p, gh + C.cap], [...off(p, -T), gh]], a, b);
        // its face: the ends above the wall either side, the foot, the way through
        const lowAt = (bb) => (bb > 0.02 && bb < len - 0.02) || closed ? h : 0;
        add(`${gk}l`, 'wall', [[...off(p0, T), lowAt(b0)], [...off(p0, T), gh]], a, b);
        add(`${gk}m`, 'wall', [[...off(p1, T), lowAt(b1)], [...off(p1, T), gh]], a, b);
        const spring = gh - 0.025 - G;
        const arch = (d, cls, id) => add(`${gk}${id}`, cls, [
          [...off(m, d, -G), 0],
          ...Array.from({ length: 9 }, (_, i) => {
            const ang = Math.PI - (i / 8) * Math.PI;
            return [...off(m, d, Math.cos(ang) * G), spring + Math.sin(ang) * G];
          }),
          [...off(m, d, G), 0],
        ], a, b);
        arch(T, 'wall', 'a');
        arch(-T, 'wall-cap', 'b');
        // (in a photo it stands solid, the way through left open)
        if (camera.ahead) {
          for (const d of [T, -T]) {
            add(`${gk}w${d > 0 ? 'f' : 'b'}`, 'wall-face', [
              [...off(p0, d), 0], [...off(m, d, -G), 0],
              ...Array.from({ length: 9 }, (_, i) => {
                const ang = Math.PI - (i / 8) * Math.PI;
                return [...off(m, d, Math.cos(ang) * G), spring + Math.sin(ang) * G];
              }),
              [...off(m, d, G), 0], [...off(p1, d), 0], [...off(p1, d), gh], [...off(p0, d), gh],
            ], a, b);
          }
          add(`${gk}wt`, 'wall-face', z([off(p0, T), off(p1, T), off(p1, -T), off(p0, -T)], gh), a, b);
          for (const [p, e] of [[p0, 0], [p1, 1]]) add(`${gk}we${e}`, 'wall-face', [[...off(p, T), 0], [...off(p, T), gh], [...off(p, -T), gh], [...off(p, -T), 0]], a, b);
        }
        add(`${gk}f0`, 'wall', [[...off(p0, T), 0], [...c0, 0]], a, b);
        add(`${gk}f1`, 'wall', [[...c1, 0], [...off(p1, T), 0]], a, b);
      });
    });

    // the graves
    const { w, d } = GRAVE;
    for (const g of churchyards(world).graves) {
      const n = layer.nodeAt(g.x, g.y), k = `gr${Math.round(g.x * 100)}.${Math.round(g.y * 100)}`;
      const { x, y } = g, yh = y + d - 0.004, xm = x + w / 2;
      add(k, 'grave', z([[x, y], [x + w, y], [x + w, y + d], [x, y + d], [x, y]], 0), n, n);
      if (g.kind === 'cross') {
        add(`${k}s`, 'grave-stone', [[xm, yh, 0], [xm, yh, g.h + 0.012]], n, n);
        add(`${k}c`, 'grave-stone', [[xm - 0.012, yh, g.h - 0.004], [xm + 0.012, yh, g.h - 0.004]], n, n);
      } else {
        const [l, r] = [x + 0.008, x + w - 0.008];
        const top = g.kind === 'round'
          ? Array.from({ length: 7 }, (_, i) => {
            const ang = Math.PI - (i / 6) * Math.PI;
            return [xm + Math.cos(ang) * (r - xm), yh, g.h - 0.01 + Math.sin(ang) * 0.012];
          })
          : [[l, yh, g.h], [r, yh, g.h]];
        add(`${k}s`, 'grave-stone', [[l, yh, 0], ...(g.kind === 'round' ? [[l, yh, g.h - 0.01]] : []), ...top, ...(g.kind === 'round' ? [[r, yh, g.h - 0.01]] : []), [r, yh, 0]], n, n);
      }
    }
    return items;
  }

  // One stretch of churchyard wall along `pts` (wallItems): its two top
  // lines and the capping's ridge, the foot on the side in sight, the
  // uprights where it turns away from the viewer and at its ends (unless
  // a gateway stands there).
  wallRun(add, key, pts, { loop, startEnd, endEnd, a, b, sees, z }) {
    if (pts.length < 2) return;
    const C = this.config.wall, t = C.thick / 2, h = C.height;
    const dir = (i) => {
      const [p, q] = [pts[i], pts[i + 1]], l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
      return [(q[0] - p[0]) / l, (q[1] - p[1]) / l];
    };
    const segs = pts.length - 1;
    const dirs = Array.from({ length: segs }, (_, i) => dir(i));
    // the offset line, mitred where it bends (at most twice as far out)
    const side = (s) => pts.map((p, i) => {
      const u0 = dirs[Math.max(0, i - 1)], u1 = dirs[Math.min(segs - 1, i)];
      let [mx, my] = [-(u0[1] + u1[1]) / 2, (u0[0] + u1[0]) / 2];
      const ml = Math.hypot(mx, my) || 1, cos = Math.max(0.5, (mx / ml) * -u1[1] + (my / ml) * u1[0]);
      return [p[0] + (mx / ml) * ((s * t) / cos), p[1] + (my / ml) * ((s * t) / cos)];
    });
    const L = side(1), R = side(-1);
    const close = (ps) => (loop ? [...ps, ps[0]] : ps);
    // in a photo (a perspective camera: either side may be in sight) it
    // stands solid, a piece at a time, so it hides what is behind it
    // (photo.js sorts the pieces by distance); both its feet are drawn and
    // the faces cover the one out of sight
    if (this.camera.ahead) {
      for (let i = 0; i < segs; i++) {
        for (const [S, id] of [[L, 'l'], [R, 'r']]) add(`${key}w${id}${i}`, 'wall-face', [[...S[i], 0], [...S[i + 1], 0], [...S[i + 1], h], [...S[i], h]], a, b);
        add(`${key}wt${i}`, 'wall-face', z([L[i], L[i + 1], R[i + 1], R[i]], h), a, b);
      }
      add(`${key}fl`, 'wall', z(close(L), 0), a, b);
      add(`${key}fr`, 'wall', z(close(R), 0), a, b);
      for (const i of [0, pts.length - 1]) {
        if ((i ? endEnd : startEnd)) add(`${key}we${i}`, 'wall-face', [[...L[i], 0], [...L[i], h], [...R[i], h], [...R[i], 0]], a, b);
      }
    }
    add(`${key}tl`, 'wall', z(close(L), h), a, b);
    add(`${key}tr`, 'wall', z(close(R), h), a, b);
    add(`${key}r`, 'wall-cap', z(close(pts), h + C.cap), a, b);
    // the foot, on the side in sight, segment by segment
    // (taken over a few pieces, and changing side only once the other is
    // clearly the one in sight: a wall running nearly straight away from
    // the viewer would otherwise flip at every wobble of the hand)
    const lean = ([nx, ny]) => {
      const v = this.camera.toView?.(nx, ny);
      return v ? v[0] + v[1] : sees([nx, ny]) ? 1 : -1;
    };
    const front = [];
    for (let i = 0; i < segs; i++) {
      const [p, q] = [pts[Math.max(0, i - 3)], pts[Math.min(pts.length - 1, i + 4)]];
      const l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
      const v = lean([-(q[1] - p[1]) / l, (q[0] - p[0]) / l]);
      front.push(i && Math.abs(v) < 0.2 ? front[i - 1] : v > 0 ? 1 : -1);
    }
    let run = null, k = 0;
    const flush = () => { if (run && run.pts.length > 1) add(`${key}f${k++}`, 'wall', z(run.pts, 0), a, b); run = null; };
    for (let i = 0; i < segs; i++) {
      const S = front[i] > 0 ? L : R;
      if (!run || run.side !== front[i]) { flush(); run = { side: front[i], pts: [S[i]] }; }
      run.pts.push(S[i + 1]);
    }
    if (loop && run && run.side === front[0]) run.pts.push((front[0] > 0 ? L : R)[1]);
    flush();
    // uprights: where it turns away (the outer corner in sight)
    for (let i = 1; i < segs; i++) {
      const [u, v] = [dirs[i - 1], dirs[i]], cross = u[0] * v[1] - u[1] * v[0];
      if (Math.abs(cross) < 0.3 && front[i - 1] === front[i]) continue;
      const outer = cross < 0 ? L : R;
      if ((cross < 0 ? 1 : -1) !== front[i - 1] && (cross < 0 ? 1 : -1) !== front[i]) continue;
      add(`${key}v${i}`, 'wall', [[...outer[i], 0], [...outer[i], h]], a, b);
    }
    // its ends: the capping's gable, and the end face if it's in sight
    for (const [end, i, u] of [[startEnd, 0, dirs[0].map((c) => -c)], [endEnd, pts.length - 1, dirs[segs - 1]]]) {
      if (!end) continue;
      const e = i ? 'e1' : 'e0';
      add(`${key}${e}c`, 'wall-cap', [[...L[i], h], [...pts[i], h + C.cap], [...R[i], h]], a, b);
      const fs = i ? front[segs - 1] : front[0];
      if (sees(u)) {
        add(`${key}${e}`, 'wall', [[...L[i], h], [...L[i], 0], [...R[i], 0], [...R[i], h]], a, b);
      } else {
        const S = fs > 0 ? L : R;
        add(`${key}${e}`, 'wall', [[...S[i], 0], [...S[i], h]], a, b);
      }
    }
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

  // The Painted schemes' roads and paths: a wash of colour as wide as the
  // way between its edges, a pale tone of the shade; null in the others.
  lineWash() {
    const { palette } = THEME;
    if (!palette.painted) return null;
    return {
      road: this.config.road.edge * 1.15, path: this.config.path.edge * 1.3,
      colour: mixColour(palette.bg, palette.shade, 0.3), alpha: 0.6,
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

    // Driveways: from the building edge at its door to the road's edge –
    // only for a type that asks for one (def.driveway: true). Buildings
    // stand in the grass; people walk to them however they like.
    for (const s of world.structures.values()) {
      if (this.yardFrame(s) || STRUCTURE_TYPES[s.type]?.site) continue; // these reach the road themselves
      if (STRUCTURE_TYPES[s.type]?.driveway !== true) continue;
      const access = world.accessInfo(s);
      if (!access) continue;
      const [dx, dy] = world.grid.xy(access.door);
      const [rx, ry] = world.grid.xy(access.road);
      const len = Math.hypot(rx - dx, ry - dy);
      const t = STRUCTURE_PAD / len, u = 1 - world.roadHalfWidth(access.road) / len;
      add(`d${s.id}`, 'driveway', [[dx + (rx - dx) * t, dy + (ry - dy) * t], [dx + (rx - dx) * u, dy + (ry - dy) * u]]);
    }

    this.groundLines('roadLines', ink, (add, addRuns) => {
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
        // the edges in the road's hand (dirtPath.js ROAD), the rounded
        // dead ends in one stroke, the fade at a map exit dashed
        if (kind === 'edge' || kind === 'corner') addRuns(`r${key}`, 'road', trodden(line, hashKey(`r${key}`), ROAD), a, b);
        else add(`r${key}`, kind === 'fade' ? 'road-exit' : 'road', line, a, b);
      }
      for (const [n, { line }] of joins) line.forEach((pts, i) => addRuns(`rj${n}:${i}`, 'road', trodden(pts, hashKey(`rj${n}:${i}`), ROAD), n, n));
      // its centre lines, for the painted schemes' wash (gl/lines.js)
      for (const e of world.ways.edges.values()) if (e.kind === 'road') add(`rw${e.id}`, 'road-wash', e.pts);
      // …carried on off the map at its exits, fading out (as the edges' 'road-exit')
      for (const { node, pos: [x, y], dir } of world.roadExits()) {
        add(`rwx${node}`, 'road-wash-exit', [[x, y], [x + dir[0] * 1.9, y + dir[1] * 1.9]], node, node);
      }

      // kerbs, rounding the corners, open where a footpath comes in
      const paths = pathIndex(world, this.config);
      const open = (q) => paths.distance(q, this.config.path.edge + PATH_OPENING) === Infinity;
      for (const { key, line, a, b } of streetKerbs(world, curve, lane, joins)) {
        keepRuns(line, open).forEach((run, j) => { const k = `k${key}${j ? `:${j}` : ''}`; addRuns(k, 'kerb', trodden(run, hashKey(k), ROAD), a, b); });
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
