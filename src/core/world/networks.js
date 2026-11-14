// Roads, footpaths, railways and fences (World methods; see world.js):
// built and removed, the railways smoothed, bridges over water, lanes,
// kerbs and sidewalks.

import { CONFIG } from '../../config.js';
import { edgeKey } from '../../roads/network.js';
import { validateRoute } from '../../roads/routing.js';
import { STRUCTURE_TYPES } from '../../../structures/index.js';
import { smoothLine } from '../geom2d.js';
import { meanderPaths } from '../../roads/meander.js';
import { traceWays } from '../../roads/dotView.js';

export class WorldNetworks {
  // Where a footpath runs at dense dot f: wandering a little off its dots,
  // with the lie of the ground (roads/meander.js), found again whenever
  // what it keeps to changes.
  pathPos(f) {
    const { path, road, rail, fence } = this.networks;
    const key = `${path.version}|${road.version}|${rail.version}|${fence.version}|${this.structureVersion ?? 0}|${this.lanes.size}`;
    if (this._pathPos?.key !== key) this._pathPos = { key, pos: meanderPaths(this) };
    return this._pathPos.pos.get(f) ?? path.dot(f);
  }

  // Where a railway runs at dense dot f. Track drawn as a staircase of
  // dense dots (bends of 45° close together) is smoothed along each run
  // into one even curve: the dots where the line just passes through are
  // fitted with the line that bends least while staying near them
  // (smoothLine), none more than MAX_SHIFT off its dot – a dot that would
  // be is held at that distance and the rest fitted round it, so the curve
  // has no kink there. Junctions, ends, bridges and the track in front of
  // stations stay put, and the curve leaves them in line with the track
  // carrying on beyond (straight stretches stay straight). Trains, the
  // drawing and level crossings all use these positions; the rules
  // (sharpest bend, straight bridges) use the dots.
  railPos(f) {
    const layer = this.networks.rail;
    const key = `${layer.version}|${this.structureVersion ?? 0}`;
    if (this._railPos?.key !== key) this._railPos = { key, pos: this.smoothRails() };
    return this._railPos.pos.get(f) ?? layer.dot(f);
  }

  smoothRails() {
    // STIFF: how hard the fit resists bending; dots inside a straight run of
    // at least LONG steps, EASE steps from its ends, are held HOLD times
    // harder (the track keeps to them instead of swinging out before a bend)
    const STIFF = 10, MAX_SHIFT = 0.25, LONG = 8, EASE = 3, HOLD = 20;
    const layer = this.networks.rail;
    const graph = layer.graph;
    const pinned = new Set();
    for (const s of this.structures.values()) {
      if (!STRUCTURE_TYPES[s.type]?.railStop) continue;
      for (const n of this.nodesOf(s)) {
        const [x, y] = this.grid.xy(n);
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            if (this.fine.inBounds(2 * x + dx, 2 * y + dy)) pinned.add(this.fine.index(2 * x + dx, 2 * y + dy));
          }
        }
      }
    }
    const free = (f) => graph.degree(f) === 2 && !pinned.has(f) && !layer.bridge.water(f);
    const pos = new Map();
    for (const f of graph.nodes()) pos.set(f, layer.dot(f));

    // the run's dots fitted, the over-shifted ones held at MAX_SHIFT
    const fit = (nodes, fixed) => {
      const dots = nodes.map((n) => layer.dot(n));
      const want = dots.map((p) => [...p]);
      fixed = [...fixed];
      const weight = dots.map(() => 1);
      const step = (k) => [dots[k + 1][0] - dots[k][0], dots[k + 1][1] - dots[k][1]];
      for (let i = 0, j; i < dots.length - 1; i = j) {
        const [sx, sy] = step(i);
        for (j = i + 1; j < dots.length - 1 && step(j)[0] === sx && step(j)[1] === sy; j++);
        if (j - i >= LONG) for (let k = i + EASE; k <= j - EASE; k++) weight[k] = HOLD;
      }
      let p = smoothLine(want, fixed, STIFF, weight);
      for (let round = 0; round < 8; round++) {
        let held = false;
        p.forEach(([x, y], i) => {
          const [dx, dy] = dots[i], d = Math.hypot(x - dx, y - dy);
          if (fixed[i] || d <= MAX_SHIFT) return;
          want[i] = [dx + ((x - dx) * MAX_SHIFT) / d, dy + ((y - dy) * MAX_SHIFT) / d];
          fixed[i] = held = true;
        });
        if (!held) break;
        p = smoothLine(want, fixed, STIFF, weight);
      }
      return p;
    };
    // beyond a fixed end: the neighbour the track runs straightest on to
    const beyond = (end, inner) => {
      const [ex, ey] = layer.dot(end), [ix, iy] = layer.dot(inner);
      let best = null, most = -Infinity;
      for (const m of graph.neighbors(end)) {
        if (m === inner) continue;
        const [mx, my] = layer.dot(m);
        const along = ((ex - ix) * (mx - ex) + (ey - iy) * (my - ey)) / Math.hypot(mx - ex, my - ey);
        if (along > most) [best, most] = [m, along];
      }
      return best;
    };

    const done = new Set();
    for (const f of graph.nodes()) {
      if (!free(f) || done.has(f)) continue;
      // the run of free dots through f, out to a fixed dot each way
      const walk = (first) => {
        const out = [];
        for (let prev = f, cur = first; ; ) {
          out.push(cur);
          if (cur === f || !free(cur)) return out;
          done.add(cur);
          const next = [...graph.neighbors(cur)].find((m) => m !== prev);
          [prev, cur] = [cur, next];
        }
      };
      done.add(f);
      const [a, b] = [...graph.neighbors(f)];
      const ahead = walk(a);
      if (ahead[ahead.length - 1] === f) {
        // a loop with nothing fixed on it: fitted three times round, the
        // middle time kept
        const loop = [f, ...ahead.slice(0, -1)], m = loop.length;
        const p = fit([...loop, ...loop, ...loop], new Array(3 * m).fill(false));
        loop.forEach((n, i) => pos.set(n, p[m + i]));
        continue;
      }
      const nodes = [...walk(b).reverse(), f, ...ahead];
      const head = beyond(nodes[0], nodes[1]), tail = beyond(nodes[nodes.length - 1], nodes[nodes.length - 2]);
      if (head != null) nodes.unshift(head);
      if (tail != null) nodes.push(tail);
      const p = fit(nodes, nodes.map((n, i) => !free(n) || (i === 0 && head != null) || (i === nodes.length - 1 && tail != null)));
      nodes.forEach((n, i) => {
        if (free(n)) pos.set(n, p[i]);
      });
    }
    // (rounds run out: no dot further than MAX_SHIFT all the same)
    for (const f of done) {
      const [x, y] = layer.dot(f), [px, py] = pos.get(f);
      const d = Math.hypot(px - x, py - y);
      if (d > MAX_SHIFT) pos.set(f, [x + ((px - x) * MAX_SHIFT) / d, y + ((py - y) * MAX_SHIFT) / d]);
    }
    return pos;
  }

  // Bridges for roads and railways (NetworkLayer.bridge): over river dots,
  // `span` of them at most; `taken(n)`: the other network is there.
  bridgeRule(span, taken) {
    return {
      water: (n) => this.terrain.isWater(n),
      river: (n) => this.terrain.isRiver(n),
      span,
      taken,
    };
  }

  // After part of a network is removed: bridges it cut (water dots no
  // longer reaching land at both ends) go too – the whole span. Returns the
  // dots removed.
  pruneBridges(layer, touched) {
    const { bridge, graph } = layer;
    if (!bridge) return [];
    const gone = [];
    const seen = new Set();
    for (const start of touched) {
      if (seen.has(start) || !graph.hasNode(start) || !bridge.water(start)) continue;
      const span = [start], ends = new Set();
      seen.add(start);
      for (let k = 0; k < span.length; k++) {
        for (const m of graph.neighbors(span[k])) {
          if (!bridge.water(m)) ends.add(m);
          else if (!seen.has(m)) { seen.add(m); span.push(m); }
        }
      }
      if (ends.size >= 2) continue;
      for (const n of span) graph.removeNode(n);
      gone.push(...span, ...ends);
    }
    return gone;
  }

  // ---------- the ways and their dot view ----------

  // Rebuilds a layer's dots (and, for roads, the street sets) from the
  // ways – see world.js, `ways`.
  refreshNetwork(kind) {
    const layer = this.networks[kind];
    const view = traceWays(this.ways, kind, layer.grid, layer.scale);
    layer.graph = view.graph;
    layer.version++;
    if (kind === 'road') {
      this.sidewalks = view.sidewalks;
      this.lanes = view.lanes;
      this.laneWalks = view.laneWalks;
    }
  }

  // Makes the ways of a kind what its dots (and street sets) now say –
  // for the changes still worked out dot by dot (building and removing
  // with the dot tool, streets, undo): each dot step a way edge, its
  // street, lane and kerbs as the edge's attributes. Then the dot view
  // is rebuilt from the ways, so the two can't drift apart.
  syncWays(kind) {
    const layer = this.networks[kind], ways = this.ways, graph = layer.graph;
    const dotOf = (id) => { const n = ways.nodes.get(id); return layer.nodeAt(n.x, n.y); };
    const steps = new Map(), nodeAt = new Map();
    for (const e of ways.edges.values()) {
      if (e.kind !== kind) continue;
      const a = dotOf(e.a), b = dotOf(e.b);
      nodeAt.set(a, e.a);
      nodeAt.set(b, e.b);
      steps.set(edgeKey(a, b), { e, a, b });
    }
    for (const { e, a, b } of steps.values()) if (!graph.hasEdge(a, b)) ways.removeEdge(e.id);
    const nodeFor = (d) => {
      const id = nodeAt.get(d);
      if (id && ways.nodes.has(id)) return id;
      const n = ways.addNode(...layer.dot(d));
      nodeAt.set(d, n.id);
      return n.id;
    };
    for (const [a, b] of graph.edges()) {
      const key = edgeKey(a, b), had = steps.get(key);
      if (!had || !ways.edges.has(had.e.id)) {
        ways.addEdge(nodeFor(a), nodeFor(b), [layer.dot(a), layer.dot(b)], { kind, ...this.stepAttrs(kind, a, b) });
        continue;
      }
      const want = this.stepAttrs(kind, had.a, had.b), e = had.e;
      if (e.lane !== want.lane || e.street !== want.street || e.walks !== want.walks) {
        delete e.lane; delete e.street; delete e.walks;
        Object.assign(e, want);
        ways.version++;
      }
    }
    this.refreshNetwork(kind);
  }

  // Lays a way along `line` (its centre line, from roads/curves.js) –
  // Ways.insert: joining, splitting and crossing what it meets – and
  // rebuilds the dots of every kind it touched. The drawing tool's way
  // in (step 5 of the switch); the dot tool still goes by buildNetwork.
  layWay(line, props = {}) {
    this.history.touch();
    const before = new Map([...this.ways.edges.values()].map((e) => [e.id, e.kind]));
    const result = this.ways.insert(line, props);
    if (!result.ok) return result;
    const kinds = new Set(result.edges.map((e) => e.kind));
    for (const [id, kind] of before) if (!this.ways.edges.has(id)) kinds.add(kind);
    for (const kind of kinds) {
      if (!this.networks[kind]) continue;
      this.refreshNetwork(kind);
      const layer = this.networks[kind];
      this.events.emit(layer.event, { layer, nodes: [...layer.graph.nodes()], ...(kind === 'road' ? { sidewalks: true } : {}) });
    }
    return result;
  }

  // A road step's attributes from the street sets, seen from dot a to b.
  stepAttrs(kind, a, b) {
    if (kind !== 'road') return {};
    const key = edgeKey(a, b), out = {};
    if (this.lanes.has(key)) {
      out.lane = true;
      const sides = this.laneWalks.get(key);
      if (sides) out.walks = a < b ? sides : ((sides & 1) << 1) | ((sides & 2) >> 1);
    } else if (this.sidewalks.has(key)) out.street = true;
    return out;
  }

  hasRoad(node) {
    return this.roads.hasNode(node);
  }

  // Railway on the main dot `node`.
  hasRail(node) {
    return this.rails.hasNode(this.coarseToFine(node));
  }

  // Railway on the dense dots at or right round main dot `node` (where it
  // would run into a building standing there).
  railNear(node) {
    const [x, y] = this.grid.xy(node);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (this.fine.inBounds(2 * x + dx, 2 * y + dy) && this.rails.hasNode(this.fine.index(2 * x + dx, 2 * y + dy))) return true;
      }
    }
    return false;
  }

  // Main-dot segment a–b as its two dense-grid steps: [[fa, mid], [mid, fb]].
  fineSegment(a, b) {
    const fa = this.coarseToFine(a), fb = this.coarseToFine(b);
    const [ax, ay] = this.fine.xy(fa), [bx, by] = this.fine.xy(fb);
    const mid = this.fine.index((ax + bx) / 2, (ay + by) / 2);
    return [[fa, mid], [mid, fb]];
  }

  // Railway along road segment a–b (on the dense dots it covers).
  railAlong(a, b) {
    return this.fineSegment(a, b).some(([f, g]) => this.rails.hasEdge(f, g));
  }

  // A road on dense dot f: on its dot, or through it halfway along a segment.
  roadAtFine(f) {
    const around = this.coarseAround(f);
    if (around.length === 1) return this.roads.hasNode(around[0]);
    if (around.length === 2) return this.roads.hasEdge(around[0], around[1]);
    return this.roads.hasEdge(around[0], around[3]) || this.roads.hasEdge(around[1], around[2]);
  }

  // `nodes` is an ordered list of adjacent nodes on that layer's grid.
  // Roads come in three widths, and drawing one over another converts it:
  // `street` builds roads with sidewalks (and their lamps), `lane`
  // single-track lanes, neither a plain road. A street narrowed to a lane
  // keeps a sidewalk each side.
  buildNetwork(kind, nodes, { lane = false, street = false } = {}) {
    const layer = this.networks[kind];
    const check = validateRoute(layer, nodes, { lane });
    if (!check.ok) return check;
    this.history.touch();
    for (const n of nodes) {
      // a railway clears the trees along its way, also between dots
      if (kind === 'rail') this.coarseAround(n).forEach((c) => this.clearFeaturesAt(c));
      const c = layer.coarseOf(n);
      if (c >= 0) this.clearFeaturesAt(c);
    }
    let walks = false;
    for (let i = 0; i < nodes.length - 1; i++) {
      layer.graph.addEdge(nodes[i], nodes[i + 1]);
      if (kind !== 'road') continue;
      const key = edgeKey(nodes[i], nodes[i + 1]);
      if (lane) {
        if (this.sidewalks.delete(key)) this.laneWalks.set(key, 3);
        this.lanes.add(key);
        continue;
      }
      if (this.lanes.delete(key)) walks = this.laneWalks.delete(key) || walks;
      if (street ? !this.sidewalks.has(key) : this.sidewalks.has(key)) walks = true;
      if (street) this.sidewalks.add(key);
      else this.sidewalks.delete(key);
    }
    this.syncWays(kind);
    this.events.emit(layer.event, { layer, nodes, sidewalks: walks || undefined });
    return check;
  }

  removeNetworkAt(kind, node) {
    const layer = this.networks[kind];
    if (!layer.graph.hasNode(node)) return false;
    this.history.touch();
    const nodes = [node, ...layer.graph.neighbors(node)];
    layer.graph.removeNode(node);
    nodes.push(...this.pruneBridges(layer, nodes));
    if (kind === 'road') {
      for (const set of [this.sidewalks, this.lanes, this.laneWalks]) {
        // (keys(): laneWalks is a Map, the others Sets)
        for (const k of [...set.keys()]) if (!this.roads.hasEdge(...k.split('-').map(Number))) set.delete(k);
      }
    }
    this.syncWays(kind);
    this.events.emit(layer.event, { layer, nodes });
    return true;
  }

  // ---------- streets (roads with sidewalks) ----------

  // The road segment covering the dense-grid step (fx, fy) -> (gx, gy), or
  // null. A road segment spans three dense dots: its two ends and its middle.
  roadOn(fx, fy, gx, gy) {
    const even = (x, y) => x % 2 === 0 && y % 2 === 0;
    const [end, mid] = even(fx, fy) ? [[fx, fy], [gx, gy]] : [[gx, gy], [fx, fy]];
    if (!even(...end) || even(...mid)) return null;
    const ax = end[0] / 2, ay = end[1] / 2;
    const bx = mid[0] - ax, by = mid[1] - ay;
    if (!this.grid.inBounds(ax, ay) || !this.grid.inBounds(bx, by)) return null;
    const a = this.grid.index(ax, ay);
    const b = this.grid.index(bx, by);
    return this.roads.hasEdge(a, b) ? [a, b] : null;
  }

  hasSidewalk(a, b) {
    return this.sidewalks.has(edgeKey(a, b));
  }

  isLane(a, b) {
    return this.lanes.has(edgeKey(a, b));
  }

  // Does side s (0 left, 1 right of the way from the lower dot, as in
  // roadEdges' keys) of road segment [a, b] have a sidewalk?
  hasKerb(a, b, s) {
    const key = edgeKey(a, b);
    return this.sidewalks.has(key) || !!((this.laneWalks.get(key) ?? 0) & (1 << s));
  }

  // Road dot where only lanes meet.
  laneOnly(node) {
    const ms = [...this.roads.neighbors(node)];
    return ms.length > 0 && ms.every((m) => this.isLane(node, m));
  }

  // Half the width of the road at a dot: its widest segment there.
  roadHalfWidth(node) {
    return this.laneOnly(node) ? CONFIG.lane.edge : CONFIG.road.edge;
  }

  // Road segments at a road dot with sidewalks (streets, lanes with one).
  sidewalksAt(node) {
    return [...this.roads.neighbors(node)].filter((m) => this.hasSidewalk(node, m) || this.laneWalks.has(edgeKey(node, m))).map((m) => [node, m]);
  }

  setSidewalks(edges, on) {
    this.history.touch();
    let changed = false;
    for (const [a, b] of edges) {
      const key = edgeKey(a, b);
      if (!on && this.laneWalks.delete(key)) changed = true;
      if (on === this.sidewalks.has(key) || (on && (!this.roads.hasEdge(a, b) || this.lanes.has(key)))) continue;
      if (on) this.sidewalks.add(key);
      else this.sidewalks.delete(key);
      changed = true;
    }
    if (!changed) return false;
    const layer = this.networks.road;
    this.syncWays('road');
    this.events.emit(layer.event, { layer, nodes: edges.flat(), sidewalks: true });
    return true;
  }

  buildRoad(nodes, options) {
    return this.buildNetwork('road', nodes, options);
  }

  removeRoadAt(node) {
    return this.removeNetworkAt('road', node);
  }
}
