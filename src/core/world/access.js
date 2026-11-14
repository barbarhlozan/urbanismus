// How a structure meets the town (World methods; see world.js): its site
// and the ways out of it, which way it faces, and whether a road or path
// reaches it.

import { ORTHO, DIAG } from '../grid.js';
import { crossingsOf } from '../../roads/curves.js';
import { STRUCTURE_TYPES, footprintCenter, freeAnchor } from '../../../structures/index.js';

// freeAccess(): a road this near (from its centre line) a free building's
// side is its way in
const FREE_REACH = 0.9;

export class WorldAccess {
  // Middle of a structure in world coordinates.
  centerOf(s) {
    if (s.x != null && this.structures.get(s.id) === s) return [s.x, s.y];
    const pts = this.nodesOf(s).map((n) => this.grid.xy(n));
    return [
      pts.reduce((a, p) => a + p[0], 0) / pts.length,
      pts.reduce((a, p) => a + p[1], 0) / pts.length,
    ];
  }

  // The point a structure's own coordinates start from (its footprint's
  // [0, 0], the anchor), [x, y]: from its position and angle – the middle,
  // less the footprint's centre turned the way it stands – or its dot for
  // one not placed yet. (A building wider than a dot faces the way it was
  // placed, so its angle turns its footprint too; a one-dot one's centre
  // is its anchor.)
  anchorOf(s) {
    if (s.free) return freeAnchor(STRUCTURE_TYPES[s.type] ?? {}, s.x, s.y, s.angle);
    if (s.x == null || this.structures.get(s.id) !== s) return this.grid.xy(s.node);
    const [cx, cy] = footprintCenter(STRUCTURE_TYPES[s.type] ?? {}, Math.round(s.angle / (Math.PI / 2)) & 3);
    return [s.x - cx, s.y - cy];
  }

  // Where a structure meets the road: { door: footprint node, road: road
  // node, point: where on the road, doorPt: the door's own point }.
  // Straight neighbours are preferred over diagonal ones.
  accessInfo(s) {
    if (s.free) return this.freeAccess(s);
    return this.accessFor(this.nodesOf(s));
  }

  // A building placed freely: the road in front of it – the nearest road
  // point within FREE_REACH of the middle of its front (or, failing that,
  // of any side) – and the nearer end of that stretch of road as the dot
  // its people come and go by. { door: its dot, road } or null.
  freeAccess(s) {
    const [w, h] = this.outlineSize(s.type);
    const fx = Math.sin(s.angle), fy = -Math.cos(s.angle);
    const sides = [[fx * h / 2, fy * h / 2], [-fy * w / 2, fx * w / 2], [fy * w / 2, -fx * w / 2], [-fx * h / 2, -fy * h / 2]];
    for (const [dx, dy] of sides) {
      const road = this.nearestRoadPoint(s.x + dx, s.y + dy, FREE_REACH);
      if (!road) continue;
      const ends = road.edge.filter((n) => !this.terrain.isWater(n)); // not off a bridge
      if (!ends.length) continue;
      const [px, py] = road.point;
      const end = ends.sort((a, b) => Math.hypot(...this.grid.xy(a).map((v, i) => v - [px, py][i])) - Math.hypot(...this.grid.xy(b).map((v, i) => v - [px, py][i])))[0];
      // the door: as a one-dot house's middle, behind the middle of that side
      const l = Math.hypot(dx, dy) || 1, k = Math.max(0, l - 0.5) / l;
      return { door: s.node, road: end, point: [px, py], doorPt: [s.x + dx * k, s.y + dy * k] };
    }
    return null;
  }

  accessFor(nodes) {
    for (const dirs of [ORTHO, DIAG]) {
      for (const n of nodes) {
        for (const [dx, dy] of dirs) {
          const m = this.grid.offset(n, dx, dy);
          if (m >= 0 && this.hasRoad(m) && !this.terrain.isWater(m)) return { door: n, road: m, point: this.networks.road.pos(m), doorPt: this.grid.xy(n) }; // not off a bridge
        }
      }
    }
    return null;
  }

  // Ground a `site` structure (park, square) may fill, in world coordinates:
  //   rect   [x0, y0, x1, y1] – up to the road on sides facing a road, halfway
  //          to a neighbouring site structure (so they merge), else a margin
  //   inner  [x0, y0, x1, y1] – the footprint dots' extent
  //   road   [left, top, right, bottom] – which sides face a road
  // The renderer then fits road sides to the drawn road curves (render/lots.js).
  // A site placed freely (stage C, step 7: off the dots, still turned by
  // quarters) is measured from its own pose: siteAreaOf(s).
  siteAreaOf(s) {
    if (!s.free) return this.siteArea(s.type, s.node, s.rotation);
    const [x0, y0, x1, y1] = this.siteFrame(s);
    const reach = (x, y) => {
      if (x < -0.5 || y < -0.5 || x > this.grid.width - 0.5 || y > this.grid.height - 0.5) return 0.42;
      if (this.ways.edgeNear(x, y, 0.55, (e) => e.kind === 'road')) return 0.9;
      const o = this.structureAt(this.grid.nodeAt(x, y));
      return o && o.id !== s.id && STRUCTURE_TYPES[o.type]?.site ? 0.5 : 0.42;
    };
    // a side reaches as far as its farthest point does: points a unit out
    // along it, every half unit
    const along = (a, b) => { const out = []; for (let t = a; t <= b + 1e-6; t += 0.5) out.push(t); return out; };
    const side = (pts) => Math.max(...pts.map(([x, y]) => reach(x, y)));
    const ext = [
      side(along(y0, y1).map((t) => [x0 - 1, t])),
      side(along(x0, x1).map((t) => [t, y0 - 1])),
      side(along(y0, y1).map((t) => [x1 + 1, t])),
      side(along(x0, x1).map((t) => [t, y1 + 1])),
    ];
    return { rect: [x0 - ext[0], y0 - ext[1], x1 + ext[2], y1 + ext[3]], inner: [x0, y0, x1, y1], road: ext.map((e) => e > 0.8) };
  }

  // A site's frame [x0, y0, x1, y1]: the extent of its footprint's dot
  // centres – for one placed freely, the same worked out from its middle
  // and quarter turn.
  siteFrame(s) {
    if (!s.free) {
      const pts = this.nodesOf(s).map((n) => this.grid.xy(n));
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    }
    const [w, h] = this.outlineSize(s.type);
    const [W, H] = Math.round(s.angle / (Math.PI / 2)) & 1 ? [h, w] : [w, h];
    return [s.x - (W - 1) / 2, s.y - (H - 1) / 2, s.x + (W - 1) / 2, s.y + (H - 1) / 2];
  }

  siteArea(type, node, rotation = 0) {
    const pts = this.footprintNodes(type, node, rotation).map((n) => this.grid.xy(n));
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const reach = (x, y) => {
      if (!this.grid.inBounds(x, y)) return 0.42;
      const n = this.grid.index(x, y);
      if (this.hasRoad(n)) return 0.9;
      const o = this.structureAt(n);
      return o && STRUCTURE_TYPES[o.type]?.site ? 0.5 : 0.42;
    };
    const side = (dots) => Math.max(...dots.map(([x, y]) => reach(x, y)));
    const ext = [
      side(pts.filter(([x]) => x === x0).map(([x, y]) => [x - 1, y])),
      side(pts.filter(([, y]) => y === y0).map(([x, y]) => [x, y - 1])),
      side(pts.filter(([x]) => x === x1).map(([x, y]) => [x + 1, y])),
      side(pts.filter(([, y]) => y === y1).map(([x, y]) => [x, y + 1])),
    ];
    return {
      rect: [x0 - ext[0], y0 - ext[1], x1 + ext[2], y1 + ext[3]],
      inner: [x0, y0, x1, y1],
      road: ext.map((e) => e > 0.8),
    };
  }

  // Walkable paths through a site (park, square), joined at a hub in the
  // middle. There are exits only where something arrives, on the footpath
  // grid on the footprint's sides:
  //   - a footpath reaching the side (every one coming in; one running just
  //     along the side gets a single exit, the nearest to the middle)
  //   - a street (sidewalks) or lane along it: in the middle of the side –
  //     not for a park (def.streetWays false): its walkways start only where
  //     a footpath is brought to it
  //   - a neighbouring site: in the middle of the stretch they share, so
  //     their walkways meet – but only when that group of sites has a way
  //     in of its own
  // With none the site is left without walkways (see roads/siteWalks.js).
  //   { hub, hubPos, half, exits: [{ node, pos: [x, y], dir: [dx, dy], road, site }] }
  // node = fine-grid index; road = the street / lane dot it leads to, or -1;
  // site = the neighbouring site's id, or -1; half = half the footprint's
  // narrower side, plus half a dot (1x1: 0.5, 2x2: 1).
  sitePaths(s) {
    const own = this.siteExits(s);
    if (!own.exits.some((e) => e.site >= 0) || this.siteGroupOpen(s)) return own;
    return { ...own, exits: own.exits.filter((e) => e.site < 0) };
  }

  // Does the group of touching sites `s` belongs to have a way in (an exit
  // that isn't just to another site of the group)?
  siteGroupOpen(s) {
    const seen = new Set([s.id]);
    const queue = [s];
    while (queue.length) {
      const { exits } = this.siteExits(queue.pop());
      for (const e of exits) {
        if (e.site < 0) return true;
        if (seen.has(e.site)) continue;
        seen.add(e.site);
        const o = this.structures.get(e.site);
        if (o) queue.push(o);
      }
    }
    return false;
  }

  // A site's exits before sitePaths drops those to a closed group; cached
  // until the roads, footpaths or structures change.
  siteExits(s) {
    const stamp = `${this.networks.road.version}|${this.networks.path.version}|${this.structureVersion}`;
    if (this.siteCache?.stamp !== stamp) this.siteCache = { stamp, map: new Map() };
    const key = `${s.id}|${s.type}|${s.node}|${s.rotation}|${s.x}|${s.y}`; // (previews have no id of their own)
    const hit = this.siteCache.map.get(key);
    if (hit) return hit;
    if (s.free) {
      const out = this.freeSiteExits(s);
      this.siteCache.map.set(key, out);
      return out;
    }

    const pts = this.nodesOf(s).map((n) => this.grid.xy(n));
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const fineAt = (x, y) => (this.fine.inBounds(2 * x, 2 * y) ? this.fine.index(2 * x, 2 * y) : -1);
    const walkable = (n) => n >= 0 && this.hasRoad(n) && !this.terrain.isWater(n) &&
      [...this.roads.neighbors(n)].some((m) => this.hasSidewalk(n, m) || this.isLane(n, m));

    const exits = [];
    const add = (pos, dir, road, site) => {
      const node = fineAt(...pos);
      if (node < 0 || exits.some((e) => e.node === node)) return;
      exits.push({ node, pos, dir, road, site });
    };
    // each side: where along it (t) is which point on it
    const sides = [
      { dir: [-1, 0], at: (t) => [x0 - 0.5, t], span: [y0, y1] },
      { dir: [1, 0], at: (t) => [x1 + 0.5, t], span: [y0, y1] },
      { dir: [0, -1], at: (t) => [t, y0 - 0.5], span: [x0, x1] },
      { dir: [0, 1], at: (t) => [t, y1 + 0.5], span: [x0, x1] },
    ];
    for (const { dir: [dx, dy], at, span: [a, b] } of sides) {
      const mid = (a + b) / 2;
      // footpaths: coming in from outside, or else only running along (a
      // corner counts only for one coming in diagonally, from both sides)
      const arriving = [], along = [];
      for (let t = a - 0.5; t <= b + 0.5; t += 0.5) {
        const f = fineAt(...at(t));
        if (f < 0 || !this.paths.hasNode(f)) continue;
        const [fx, fy] = this.fine.xy(f);
        const corner = t < a || t > b;
        const [ox, oy] = !corner ? [0, 0] : dx ? [0, t < a ? -1 : 1] : [t < a ? -1 : 1, 0];
        const comes = [...this.paths.neighbors(f)].some((m) => {
          const [mx, my] = this.fine.xy(m);
          return (mx - fx) * dx + (my - fy) * dy > 0 && (!corner || (mx - fx) * ox + (my - fy) * oy > 0);
        });
        if (comes) arriving.push(t);
        else if (!corner) along.push(t);
      }
      const near = along.sort((p, q) => Math.abs(p - mid) - Math.abs(q - mid)).slice(0, 1);
      for (const t of arriving.length ? arriving : near) add(at(t), [dx, dy], -1, -1);
      // the dots just outside: a street or lane, neighbouring sites
      const outside = [];
      for (let t = a; t <= b; t++) {
        const [px, py] = at(t);
        outside.push({ t, n: this.grid.nodeAt(px + dx * 0.5, py + dy * 0.5) });
      }
      const road = STRUCTURE_TYPES[s.type]?.streetWays !== false && outside.find((o) => walkable(o.n));
      if (road) add(at(mid), [dx, dy], road.n, -1);
      const shared = new Map();
      for (const { t, n } of outside) {
        const o = n >= 0 ? this.structureAt(n) : null;
        if (!o || o.id === s.id || !STRUCTURE_TYPES[o.type]?.site) continue;
        if (!shared.has(o.id)) shared.set(o.id, []);
        shared.get(o.id).push(t);
      }
      for (const [id, ts] of shared) add(at((Math.min(...ts) + Math.max(...ts)) / 2), [dx, dy], -1, id);
    }
    const out = { hub: fineAt(cx, cy), hubPos: [cx, cy], half: Math.min(x1 - x0, y1 - y0) / 2 + 0.5, exits };
    this.siteCache.map.set(key, out);
    return out;
  }

  // siteExits for a site placed freely: found on the ways themselves, not
  // on the dots – footpaths crossing one of its sides, ending at one, or
  // (with neither) running along it; a street or lane along a side; a
  // neighbouring site. Each exit's node is the footpath dot it joins (or
  // the dense dot there), so walkers can route through.
  freeSiteExits(s) {
    const [x0, y0, x1, y1] = this.siteFrame(s);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const paths = this.networks.path;
    const exits = [];
    const nodeNear = ([x, y]) => {
      let best = -1, bd = 0.8;
      const [fx, fy] = [Math.round(2 * x), Math.round(2 * y)];
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (!this.fine.inBounds(fx + dx, fy + dy)) continue;
          const f = this.fine.index(fx + dx, fy + dy);
          if (!this.paths.hasNode(f)) continue;
          const [px, py] = paths.pos(f), d = Math.hypot(px - x, py - y);
          if (d < bd) [best, bd] = [f, d];
        }
      }
      return best >= 0 ? best : paths.nodeAt(x, y);
    };
    const add = (pos, dir, road, site, node = nodeNear(pos)) => {
      if (node < 0 || exits.some((e) => e.node === node)) return;
      exits.push({ node, pos, dir, road, site });
    };
    const walkable = (n) => n >= 0 && this.hasRoad(n) && !this.terrain.isWater(n) &&
      [...this.roads.neighbors(n)].some((m) => this.hasSidewalk(n, m) || this.isLane(n, m));
    const sides = [
      { dir: [-1, 0], at: (t) => [x0 - 0.5, t], span: [y0, y1] },
      { dir: [1, 0], at: (t) => [x1 + 0.5, t], span: [y0, y1] },
      { dir: [0, -1], at: (t) => [t, y0 - 0.5], span: [x0, x1] },
      { dir: [0, 1], at: (t) => [t, y1 + 0.5], span: [x0, x1] },
    ];
    const pathEdges = [...this.ways.edges.values()].filter((e) => e.kind === 'path');
    for (const { dir: [dx, dy], at, span: [a, b] } of sides) {
      const line = [at(a - 0.5), at(b + 0.5)];
      const tOf = ([x, y]) => (dx ? y : x);
      const arriving = [];
      let along = null;
      for (const e of pathEdges) {
        for (const c of crossingsOf(line, e.pts)) arriving.push(tOf(c.point));
        // an end at the side, coming from outside
        for (const [p, q] of [[e.pts[0], e.pts[1]], [e.pts[e.pts.length - 1], e.pts[e.pts.length - 2]]]) {
          const off = (p[0] - line[0][0]) * dx + (p[1] - line[0][1]) * dy, t = tOf(p);
          if (Math.abs(off) <= 0.3 && t >= a - 0.5 && t <= b + 0.5 && (q[0] - p[0]) * dx + (q[1] - p[1]) * dy > 0) arriving.push(t);
        }
        // running along: its nearest point to the side's middle
        for (const p of e.pts) {
          const off = Math.abs((p[0] - line[0][0]) * dx + (p[1] - line[0][1]) * dy), t = tOf(p);
          if (off <= 0.35 && t >= a && t <= b && (!along || Math.abs(t - (a + b) / 2) < Math.abs(along - (a + b) / 2))) along = t;
        }
      }
      for (const t of arriving.length ? arriving : along != null ? [along] : []) add(at(t), [dx, dy], -1, -1);
      // a street or lane along it (not for a park); neighbouring sites
      const outside = [];
      for (let t = a; t <= b + 1e-6; t += 0.5) {
        const [px, py] = at(t);
        outside.push({ t, n: this.grid.nodeAt(px + dx * 0.5, py + dy * 0.5), p: [px + dx * 0.5, py + dy * 0.5] });
      }
      const road = STRUCTURE_TYPES[s.type]?.streetWays !== false && outside.find((o) => walkable(o.n));
      if (road) add(at((a + b) / 2), [dx, dy], road.n, -1, this.fineNear(at((a + b) / 2)));
      const shared = new Map();
      for (const { t, n } of outside) {
        const o = n >= 0 ? this.structureAt(n) : null;
        if (!o || o.id === s.id || !STRUCTURE_TYPES[o.type]?.site) continue;
        if (!shared.has(o.id)) shared.set(o.id, []);
        shared.get(o.id).push(t);
      }
      for (const [id, ts] of shared) {
        const pos = at((Math.min(...ts) + Math.max(...ts)) / 2);
        add(pos, [dx, dy], -1, id, this.fineNear(pos));
      }
    }
    return { hub: this.fineNear([cx, cy]), hubPos: [cx, cy], half: Math.min(x1 - x0, y1 - y0) / 2 + 0.5, exits };
  }

  // The dense dot nearest a world point, or -1 off the map.
  fineNear([x, y]) {
    const fx = Math.round(2 * x), fy = Math.round(2 * y);
    return this.fine.inBounds(fx, fy) ? this.fine.index(fx, fy) : -1;
  }

  // Which way a structure's front looks: { door, dir: [dx, dy], road }.
  // Towards its road if it has one (road = that road dot), else towards the
  // nearest footpath within 1.5 dots (road = -1), else null.
  frontFor(nodes) {
    const access = this.accessFor(nodes);
    if (access) {
      const [dx, dy] = this.grid.xy(access.door);
      const [rx, ry] = this.grid.xy(access.road);
      const ox = Math.sign(rx - dx), oy = Math.sign(ry - dy);
      return { door: access.door, dir: ox !== 0 ? [ox, 0] : [0, oy], road: access.road };
    }
    const own = new Set(nodes);
    for (let k = 1; k <= 3; k++) {
      for (const n of nodes) {
        const [x, y] = this.grid.xy(n);
        for (const [dx, dy] of ORTHO) {
          if (own.has(this.grid.offset(n, dx, dy))) continue; // an inner side
          const fx = 2 * x + k * dx, fy = 2 * y + k * dy;
          if (this.fine.inBounds(fx, fy) && this.paths.hasNode(this.fine.index(fx, fy))) return { door: n, dir: [dx, dy], road: -1 };
        }
      }
    }
    return null;
  }

  // Rotation a building is drawn with: single-dot buildings turn their front
  // (local -y) towards the road they use, or without one towards a footpath,
  // then `turn` more quarter turns (the player's choice, s.data.turn: side
  // or back to the road); larger ones keep their placed rotation.
  facingRotation(type, node, rotation = 0, turn = 0) {
    const nodes = this.footprintNodes(type, node, rotation);
    if (nodes.length > 1) return rotation;
    const front = this.frontFor(nodes);
    if (!front) return rotation;
    const [ox, oy] = front.dir;
    const base = ox !== 0 ? (ox > 0 ? 1 : 3) : oy > 0 ? 2 : 0;
    return (base + turn) % 4;
  }

  // The rotation structure s is drawn with (see facingRotation): the one it
  // was built with (s.data.face, see faceOnce) – a road laid past it later
  // doesn't turn it round – except for those that always face their road.
  drawnRotation(s) {
    if (s.free) return Math.round(s.angle / (Math.PI / 2)) & 3;
    if (s.data?.face != null && !STRUCTURE_TYPES[s.type]?.facesRoad) return s.data.face;
    return this.facingRotation(s.type, s.node, s.rotation, s.data?.turn ?? 0);
  }

  // The way s's front would look if it weren't turned side or back to its
  // road (s.data.turn): the rotation drawnRotation turns from.
  frontRotation(s) {
    return (this.drawnRotation(s) - (s.data?.turn ?? 0) + 4) % 4;
  }

  // A single-dot building takes its facing once, as it is built: towards
  // the road (or footpath) there is then, else as the player placed it
  // (and with no road to be turned from, s.data.turn goes).
  faceOnce(s) {
    if (s.free) return; // it faces the way it was placed
    const nodes = this.nodesOf(s);
    if (nodes.length !== 1 || STRUCTURE_TYPES[s.type]?.facesRoad) return;
    if (!this.frontFor(nodes)) delete s.data.turn;
    s.data.face = this.facingRotation(s.type, s.node, s.rotation, s.data.turn ?? 0);
    if (this.structures.get(s.id) === s) this.poseStructure(s);
  }

  // Map exits: roads that end at the edge of the map continue off it.
  // Returns [{ node, dir: [dx, dy] }] with dir pointing off the map.
  roadExits() {
    const layer = this.networks.road;
    if (this._exits?.version === layer.version) return this._exits.list;
    const list = this.edgeExits(this.roads, this.grid);
    this._exits = { version: layer.version, list };
    return list;
  }

  // Railways that run off the map edge, like roadExits().
  railExits() {
    const layer = this.networks.rail;
    if (this._railExits?.version === layer.version) return this._railExits.list;
    const list = this.edgeExits(this.rails, this.fine);
    this._railExits = { version: layer.version, list };
    return list;
  }

  edgeExits(graph, grid) {
    const { width, height } = grid;
    const list = [];
    for (const n of graph.nodes()) {
      if (graph.degree(n) !== 1) continue;
      const [x, y] = grid.xy(n);
      const dir = x === 0 ? [-1, 0] : x === width - 1 ? [1, 0] : y === 0 ? [0, -1] : y === height - 1 ? [0, 1] : null;
      if (dir) list.push({ node: n, dir });
    }
    return list;
  }

  accessNode(s) {
    return this.accessInfo(s)?.road ?? -1;
  }

  isConnected(s) {
    return this.accessInfo(s) !== null;
  }

  // A footpath within 1.5 dots of the footprint.
  hasPathAccess(s) {
    for (const n of this.nodesOf(s)) {
      const [x, y] = this.grid.xy(n);
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          if (dx * dx + dy * dy > 9) continue;
          const fx = 2 * x + dx, fy = 2 * y + dy;
          if (this.fine.inBounds(fx, fy) && this.paths.hasNode(this.fine.index(fx, fy))) return true;
        }
      }
    }
    return false;
  }

  // Reachable enough to work: a road, or for `access: 'any'`
  // structures (homes, shops, parks…) a footpath is fine too – people walk
  // or cycle there, nobody drives.
  isServed(s) {
    if (this.isConnected(s)) return true;
    return STRUCTURE_TYPES[s.type]?.access === 'any' && this.hasPathAccess(s);
  }
}
