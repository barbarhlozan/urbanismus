// Getting there (AgentSystem methods; see agents.js): a trip built into
// legs and followed – the pace, room on the road, doors, waiting at level
// crossings – and checked again when the town changes under it.

import { STRUCTURE_TYPES } from '../../../structures/index.js';
import { smoothPolyline, fillet, offsetPolyline, measurePolyline, pointAt, roadway } from '../../roads/geometry.js';
import { hubRadius } from '../../roads/siteWalks.js';

const NONE = [];

// Two ways through one junction (AgentSystem.boxes) that cross: from the
// same side never, from opposite sides when either turns left, otherwise
// always.
function crosses(p, q) {
  const d = p.ix * q.ix + p.iy * q.iy;
  if (d > 0.7) return false;
  if (d < -0.7) return p.turn < -0.5 || q.turn < -0.5;
  return true;
}

export class AgentMovement {
  // ----- level crossings -----

  // How far along its leg an agent may go: in front of the next closed
  // level crossing (behind whoever already queues there), or Infinity.
  // Anyone already at or over the line when it closes carries on across.
  crossingStop(a, leg) {
    const closed = this.trains?.closed;
    if (!closed?.size) {
      a.waitKey = null;
      return Infinity;
    }
    const cfg = this.trains.crossing;
    const kind = a.trip.mode === 'drive' ? 'drive' : a.trip.mode === 'cycle' ? 'cycle' : 'walk';
    const version = this.trains.crossingVersion;
    if (leg.crossVersion !== version) {
      leg.crossings = this.trains.crossingsAlong(leg, 0.25);
      leg.crossVersion = version;
    }
    for (const c of leg.crossings) {
      const line = c.at - cfg.gap[kind];
      if (line < a.s - 1e-6) continue; // passed it, or already on it
      if (line - a.s > 1.5) break;     // the next one is still far off
      if (!closed.has(c.id)) break;
      const key = `${c.id}|${c.dir}|${kind}`;
      if (a.waitKey !== key) {
        a.waitKey = key;
        a.slot = this.queues.get(key) ?? 0;
        this.queues.set(key, a.slot + (a.truck || a.bus ? 2 : 1)); // a truck or a bus takes two places
      }
      return line - a.slot * cfg.queue[kind];
    }
    a.waitKey = null;
    return Infinity;
  }

  // ----- traffic -----

  // Every frame: how far each vehicle and cyclist may go before it is up
  // against whoever is in front of it (a.room) and how fast, as a share
  // (a.followK) – braking over traffic.brake, stopping traffic.gap behind.
  // Each is a stretch from its back to its front (a car's middle is a.x /
  // a.y, a truck's or bus's front, its back a.tx / a.ty); it looks ahead
  // of its front, straight on, for a part of another within its lane
  // (sideways less than traffic.lane of their two half-widths, up to
  // traffic.look ahead) or, crossing its way, of their whole width (up to
  // traffic.across). Oncoming ones
  // are passed; one pulling out of a driveway or turning into one is off
  // the road for everyone else, but still gives way itself. Junctions
  // (traffic.box round the dot) take one way through at a time: nobody goes
  // in while someone in it crosses their way, nor stops in it in a queue –
  // so they never lock up there. Elsewhere, two held up by each other across
  // their ways: the nearer goes; held up by someone across its way longer
  // than traffic.creep, it edges on through anyway. One that hasn't moved
  // for traffic.stall (longer than a bus stands at a stop or a level
  // crossing stays closed) is stuck for good: it is taken to the end of
  // its way.
  // Looked up in a grid of traffic.cell squares; nothing is allocated.
  follow(dt) {
    const cfg = this.config.traffic;
    const list = (this.followList ??= []);
    const heads = (this.followHeads ??= new Map());
    const junctions = (this.followJunctions ??= new Map()); // junction dot -> who is in it
    list.length = 0;
    heads.clear();
    for (const inside of junctions.values()) inside.length = 0;
    const cell = cfg.cell;
    const key = (x, y) => Math.floor(x / cell) * 4096 + Math.floor(y / cell);
    for (const a of this.agents.values()) {
      if (a.state !== 'out' && a.state !== 'back') continue;
      const mode = a.trip.mode;
      if (mode !== 'drive' && mode !== 'cycle') continue;
      const leg = a.state === 'out' ? a.trip.out : a.trip.back;
      const [x0, y0] = pointAt(leg, a.s - 0.03), [x1, y1] = pointAt(leg, a.s + 0.03);
      const l = Math.hypot(x1 - x0, y1 - y0);
      if (l > 1e-6) [a.hx, a.hy] = [(x1 - x0) / l, (y1 - y0) / l];
      if (a.truck || a.bus) {
        [a.fx, a.fy, a.bx, a.by] = [a.x, a.y, a.tx, a.ty];
        a.half = a.bus ? 0.044 : 0.042;
        a.nose = 0;
        a.len = a.bus ? this.config.buses.length : this.config.trucks.trailer;
      } else {
        const len = mode === 'drive' ? 0.085 : 0.03;
        [a.fx, a.fy, a.bx, a.by] = [a.x + a.hx * len, a.y + a.hy * len, a.x - a.hx * len, a.y - a.hy * len];
        a.half = mode === 'drive' ? 0.037 : 0.012;
        a.nose = len;
        a.len = 2 * len;
      }
      // how fast it went last frame (grid steps per second)
      a.v = dt > 0 ? Math.hypot(a.x - a.px, a.y - a.py) / dt : 0;
      [a.px, a.py] = [a.x, a.y];
      // off the road: on its way out of a driveway, or into one
      a.aside = (leg.doorStart && a.s < 0.4) || (leg.doorEnd && leg.total - a.s < 0.3);
      a.blocker = null;
      // the junction it is in, or comes up to next
      a.box = null;
      a.toBox = Infinity;
      const front = a.s + a.nose;
      for (const b of leg.boxes ?? NONE) {
        if (b.out <= front - a.len + 0.06) continue; // past it (its back may stick out into the edge of the circle: paths cross well inside it)
        a.box = b;
        a.toBox = Math.max(0, b.in - front);
        break;
      }
      // in it – or about to go in, and let in last frame
      if (a.box && (front >= a.box.in || a.claim)) {
        let inside = junctions.get(a.box.node);
        if (!inside) junctions.set(a.box.node, (inside = []));
        inside.push(a);
      }
      const k = key((a.fx + a.bx) / 2, (a.fy + a.by) / 2);
      a.next = heads.get(k) ?? -1;
      heads.set(k, list.length);
      list.push(a);
    }
    const { look, across: lookAcross, lane } = cfg;
    for (const a of list) {
      const { fx, fy, hx, hy } = a;
      const ax = (fx + a.bx) / 2, ay = (fy + a.by) / 2;
      const mx = fx + hx * look / 2, my = fy + hy * look / 2;
      const cx = Math.floor(mx / cell), cy = Math.floor(my / cell);
      let ahead = Infinity, across = Infinity, blocker = null, leader = null;
      for (let i = cx - 1; i <= cx + 1; i++) {
        for (let j = cy - 1; j <= cy + 1; j++) {
          for (let n = heads.get(i * 4096 + j) ?? -1, b; n >= 0; n = b.next) {
            b = list[n];
            if (b === a || b.aside) continue;
            const along = hx * b.hx + hy * b.hy;
            if (along < -0.3) continue; // oncoming
            const crossing = along < 0.7;
            // (two at one junction: see below)
            if (crossing && (a.creep > 0 || (a.box && a.box.node === b.box?.node && a.toBox < look && b.toBox < look))) continue;
            // going the same way: only one whose middle is ahead, along the
            // two's headings together (so of two side by side, or turning
            // a little apart, only one can be ahead of the other)
            if (!crossing && ((b.fx + b.bx) / 2 - ax) * (hx + b.hx) + ((b.fy + b.by) / 2 - ay) * (hy + b.hy) <= 0) continue;
            const lim = crossing ? a.half + b.half : lane * (a.half + b.half);
            for (let p = 0; p < 3; p++) {
              const px = (p === 0 ? b.bx : p === 1 ? (b.bx + b.fx) / 2 : b.fx) - fx;
              const py = (p === 0 ? b.by : p === 1 ? (b.by + b.fy) / 2 : b.fy) - fy;
              const d = px * hx + py * hy;
              if (d < -0.03 || d > (crossing ? lookAcross : look) || Math.abs(px * hy - py * hx) >= lim) continue;
              if (!crossing) { if (d < ahead) [ahead, leader] = [d, b]; }
              else if (d < across) [across, blocker] = [d, b];
            }
          }
        }
      }
      a.ahead = ahead;
      a.across = across;
      a.leader = leader;
      a.blocker = blocker;
    }
    const { brake } = cfg;
    for (const a of list) {
      let near = a.ahead;
      const b = a.blocker;
      // held up by each other across a junction: the nearer goes
      const yields = b && !(b.blocker === a && (a.across < b.across || (a.across === b.across && a.id < b.id)));
      if (yields) near = Math.min(near, a.across);
      const gap = cfg.gap[a.trip.mode === 'cycle' ? 'cycle' : 'drive'];
      let room = near - gap;
      // in a queue that stands or crawls: not into a junction (others would
      // have to wait for it), but short of it until there's room past it
      const lead = a.leader;
      if (lead && near === a.ahead && lead.v < cfg.crawl) {
        const { boxes } = a.state === 'out' ? a.trip.out : a.trip.back;
        const front = a.s + a.nose;
        for (const { in: e, out: x } of boxes ?? NONE) {
          if (e > front + room) break;
          if (front <= e && front + room - a.len < x) {
            room = e - front - 0.02;
            break;
          }
        }
      }
      // a junction: in only when nobody in it crosses its way (going in
      // from the same side, or straight on or right from the opposite one,
      // is fine) and there is room for it on the far side, along its way
      // (turning too), behind whoever stands or crawls there – so nobody
      // is ever left standing in one; about to go in, it holds its place
      a.claim = false;
      a.yieldTo = null;
      if (a.box && a.toBox > 0 && a.toBox < look) {
        const inside = junctions.get(a.box.node);
        let clear = true;
        if (inside) for (const o of inside) if (o !== a && crosses(a.box, o.box)) [clear, a.yieldTo] = [false, o];
        if (clear && a.toBox < look / 2) clear = this.roomPast(a, gap, heads, list);
        if (!clear) room = Math.min(room, a.toBox - 0.02);
        else if (a.toBox < cfg.claim && room > a.toBox) {
          a.claim = true;
          let list = inside;
          if (!list) junctions.set(a.box.node, (list = []));
          if (!list.includes(a)) list.push(a);
        }
      }
      a.room = Math.max(0, room);
      const target = Math.max(0, Math.min(1, room / brake));
      a.followK = target < a.followK ? target : Math.min(target, a.followK + dt * 1.5); // pulls away gently
      if (a.creep > 0) a.creep -= dt;
      else if (yields && a.across <= a.ahead && room < 0.02) {
        if ((a.held += dt) > cfg.creep) [a.held, a.creep] = [0, 1.5];
      } else a.held = 0;
      // should a queue ever close on itself (round a block, through two
      // junctions): after traffic.stall it is spared the rest of the way,
      // as if it had got there (rather than driving through the others)
      if (a.v < 0.01 && a.followK < 0.05) {
        if ((a.stall += dt) > cfg.stall) {
          a.stall = 0;
          const leg = a.state === 'out' ? a.trip.out : a.trip.back;
          if (a.bus) a.legs.length = a.leg + 1;
          a.s = leg.total;
          a.room = Infinity;
        }
      } else a.stall = 0;
    }
  }

  // Is there room for vehicle a past the junction it comes up to (a.box),
  // along its leg: nobody going its way standing or crawling within its
  // length and `gap` of the far side? (follow's grid: heads, list)
  roomPast(a, gap, heads, list) {
    const { cell, crawl } = this.config.traffic;
    const leg = a.state === 'out' ? a.trip.out : a.trip.back;
    const from = a.box.out - a.nose + a.len; // (a.s when its back is out)
    for (let k = 0; k <= 3; k++) {
      const s = from + ((a.nose + gap) * k) / 3;
      if (s > leg.total) break;
      const [px, py] = pointAt(leg, s), [qx, qy] = pointAt(leg, s + 0.03);
      const l = Math.hypot(qx - px, qy - py) || 1;
      const [dx, dy] = [(qx - px) / l, (qy - py) / l];
      const cx = Math.floor(px / cell), cy = Math.floor(py / cell);
      for (let i = cx - 1; i <= cx + 1; i++) {
        for (let j = cy - 1; j <= cy + 1; j++) {
          for (let n = heads.get(i * 4096 + j) ?? -1, b; n >= 0; n = b.next) {
            b = list[n];
            if (b === a || b.aside || b.v >= 2 * crawl || b.hx * dx + b.hy * dy < 0.5) continue;
            // how far p is from b's stretch
            const [ex, ey] = [b.fx - b.bx, b.fy - b.by], e2 = ex * ex + ey * ey || 1e-9;
            const t = Math.max(0, Math.min(1, ((px - b.bx) * ex + (py - b.by) * ey) / e2));
            if (Math.hypot(px - b.bx - ex * t, py - b.by - ey * t) < b.half + 0.01) return false;
          }
        }
      }
    }
    return true;
  }

  driveRoute(home, dest) {
    const from = this.drivePlace(home);
    const to = this.drivePlace(dest);
    if (!from || !to) return null;
    const way = this.driveWay(from.place, to.place);
    return way && { mode: 'drive', ...way, fromDoor: from.door, toDoor: to.door };
  }

  begin(a, plan, destId) {
    a.trip = this.buildTrip(plan, destId);
    this.beginLeg(a, a.trip.out);
    if (plan.mode === 'drive' && !plan.truck) this.parking?.take(this.world.structures.get(a.home));
    return true;
  }

  // Door -> route nodes -> destination door (strolls end on the path).
  // Each leg keeps to the right-hand side of its line.
  buildTrip(plan, destId) {
    const { world, config } = this;
    const drive = plan.mode === 'drive';
    const layer = drive ? world.networks.road : world.networks.path;
    const curve = drive ? config.road : config.path;
    // on foot / by bike: the street's sidewalk or the road's lane where
    // there's roadway, near the middle of a footpath elsewhere
    const walker = plan.mode === 'cycle' ? config.bike : config.walk;
    const onRoad = this.roadway();
    const side = drive
      ? (p) => (onRoad(p) === 'lane' ? config.lane.laneOffset : config.sim.laneOffset)
      : (p) => {
        const where = onRoad(p);
        return where === 'lane' ? walker.laneOffset : where ? walker.sideOffset : walker.pathOffset;
      };

    // Only the route itself is smoothed; buildings are left and entered in a
    // straight line from their edge, so nobody cuts across them or their yard.
    const line = (nodes, fromPoint, toPoint, fromDoor, toDoor) => {
      const pts = nodes.map((n) => layer.pos(n));
      if (fromPoint) pts.unshift(fromPoint);
      if (toPoint) pts.push(toPoint);
      const first = fromPoint ? 1 : 0;
      const smooth = smoothPolyline(pts, (i) => this.cornerAt(plan.mode, nodes[i - first]), curve.curveSamples);
      if (fromDoor != null) smooth.unshift(this.doorEdge(fromDoor, smooth[0]));
      if (toDoor != null) smooth.push(this.doorEdge(toDoor, smooth[smooth.length - 1]));
      return smooth;
    };
    // a route along the ways (sim/wayGraph.js): already on the curves,
    // rounded only where it turns at a junction
    const wayLine = (pts, joints, fromPoint, toPoint, fromDoor, toDoor) => {
      const at = new Set(joints ?? []);
      const smooth = [pts[0]];
      for (let i = 1; i < pts.length - 1; i++) {
        if (at.has(i)) smooth.push(...fillet(pts[i - 1], pts[i], pts[i + 1], curve.junctionRadius, curve.curveSamples));
        else smooth.push(pts[i]);
      }
      if (pts.length > 1) smooth.push(pts[pts.length - 1]);
      if (fromPoint) smooth.unshift(fromPoint);
      if (toPoint) smooth.push(toPoint);
      if (fromDoor != null) smooth.unshift(this.doorEdge(fromDoor, smooth[0]));
      if (toDoor != null) smooth.push(this.doorEdge(toDoor, smooth[smooth.length - 1]));
      return smooth;
    };
    const atDoor = !plan.toPoint && plan.toDoor != null;
    const smooth = plan.pts
      ? wayLine(plan.pts, plan.joints, plan.fromPoint, plan.toPoint, plan.fromDoor, atDoor ? plan.toDoor : null)
      : line(plan.nodes, plan.fromPoint, plan.toPoint, plan.fromDoor, atDoor ? plan.toDoor : null);
    // loop walks come home another way (backNodes, ending at backDoor)
    const loop = plan.backNodes || plan.backPts;
    const back = plan.backPts ? wayLine(plan.backPts, plan.backJoints, null, null, null, plan.backDoor)
      : plan.backNodes ? line(plan.backNodes, null, null, null, plan.backDoor) : smooth.slice().reverse();
    const home = loop ? plan.backDoor != null : plan.fromDoor != null;

    return {
      mode: plan.mode,
      dest: destId,
      purpose: plan.purpose ?? null,
      outside: !!plan.outside,
      commute: !!plan.commute, // resident working outside the map
      truck: !!plan.truck,
      linger: !!plan.linger,   // wanders about the destination (a park)
      transit: plan.transit ?? null, // { stop }: waits there for a bus / train
      exit: plan.exit ?? null,
      nodes: plan.nodes ?? null,
      backNodes: plan.backNodes ?? null,
      ways: plan.ways ?? null,         // the way edges it goes along (sim/wayGraph.js)…
      wayPts: plan.pts ?? null,        // …and its route on them
      backWays: plan.backWays ?? null,
      backPts: plan.backPts ?? null,
      out: this.leg(offsetPolyline(smooth, side), plan.fromDoor != null, atDoor, drive, plan.mode === 'cycle'),
      back: this.leg(offsetPolyline(back, side), loop ? false : atDoor, home, drive, plan.mode === 'cycle'),
    };
  }

  // How much a route rounds its turn at node n: like the drawn roads and
  // paths – curved where the line just bends, (almost) sharp at junctions,
  // so nobody takes a shortcut across a crossroads.
  cornerAt(mode, n) {
    const { world, config } = this;
    if (mode === 'drive') {
      return n === undefined || world.roads.degree(n) === 2 ? config.road.cornerRadius : config.road.junctionRadius;
    }
    const { cornerRadius, junctionRadius } = config.path;
    if (n === undefined) return cornerRadius;
    const c = world.fineToCoarse(n);
    const onRoad = c >= 0 && world.roads.hasNode(c);
    const pathDeg = world.paths.degree(n);
    if (!onRoad && pathDeg === 0) {
      // a park's hub: as its walkways are drawn (roads/siteWalks.js)
      const s = world.structureAt(world.coarseAround(n)[0]);
      const paths = s && STRUCTURE_TYPES[s.type]?.site && world.sitePaths(s);
      if (paths?.hub === n) return hubRadius(paths.exits);
    }
    if (!onRoad) return pathDeg === 2 ? cornerRadius : junctionRadius;
    return pathDeg === 0 && world.roads.degree(c) === 2 ? cornerRadius : junctionRadius; // along a street
  }

  // The roadway test (roads/geometry.js), rebuilt when roads, paths or
  // sidewalks change.
  roadway() {
    const { world, config } = this;
    const key = `${world.networks.road.version}|${world.networks.path.version}|${world.sidewalks.size}|${world.lanes.size}`;
    if (this.roadwayKey !== key) {
      this.roadwayKey = key;
      this.roadwayTest = roadway(world, config.road, config.lane);
    }
    return this.roadwayTest;
  }

  // A measured leg, remembering which of its ends is at a building's door;
  // a drive's with its pace, a drive's or ride's with its junctions.
  leg(points, doorStart, doorEnd, drive = false, wheels = false) {
    const leg = { ...measurePolyline(points), doorStart, doorEnd, pace: null, boxes: null };
    if (drive) leg.pace = this.pace(leg);
    if (drive || wheels) leg.boxes = this.boxes(leg);
    return leg;
  }

  // Where a leg goes through junctions (three roads or more): within
  // traffic.box of the junction's node (AgentSystem.junctionAt). In order: [{ node, in, out (arc lengths), ix,
  // iy (the way it goes in), turn (>0 right, <0 left) }].
  boxes(leg) {
    const { world } = this;
    const r = this.config.traffic.box, step = 0.04;
    const out = [];
    let box = null;
    const dir = (s) => {
      const [x0, y0] = pointAt(leg, s - 0.05), [x1, y1] = pointAt(leg, s + 0.05);
      const l = Math.hypot(x1 - x0, y1 - y0) || 1;
      return [(x1 - x0) / l, (y1 - y0) / l];
    };
    for (let s = 0; s <= leg.total + step; s += step) {
      const at = Math.min(s, leg.total);
      const [x, y] = pointAt(leg, at);
      const here = this.junctionAt(x, y, r);
      if (here && box && here.node !== box.node) {
        box.out = at;
        box = null;
      }
      if (here && !box) out.push((box = { node: here.node, in: at, out: leg.total, ix: 0, iy: 0, turn: 0 }));
      else if (!here && box) {
        box.out = at;
        box = null;
      }
    }
    for (const b of out) {
      [b.ix, b.iy] = dir(b.in);
      const [ox, oy] = dir(b.out);
      b.turn = ox * -b.iy + oy * b.ix; // along its right hand
    }
    return out;
  }

  // The share of full speed at each point of a drive's leg: 1 on an open
  // road, sim.village through the village (a street, or a building within
  // sim.villageReach of the road), lane.speed on a single-track lane.
  // Changes are spread over traffic.ramp grid steps – slowing down before
  // the village, speeding up after it.
  pace(leg) {
    const { world, config } = this;
    const onRoad = this.roadway();
    const { village, villageReach: r } = config.sim;
    const built = (x, y) => {
      for (let j = Math.ceil(y - r); j <= y + r; j++) {
        for (let i = Math.ceil(x - r); i <= x + r; i++) {
          if ((i - x) ** 2 + (j - y) ** 2 <= r * r && world.grid.inBounds(i, j) && world.structureAt(world.grid.index(i, j))) return true;
        }
      }
      return false;
    };
    const { points, cum } = leg;
    const n = points.length;
    const k = new Float64Array(n).fill(NaN);
    for (let i = 0; i < n; i++) {
      const where = onRoad(points[i]);
      if (where === 'lane') k[i] = config.lane.speed;
      else if (where) k[i] = where === 'street' || built(...points[i]) ? village : 1;
    }
    // off the road (a door, off the map): as the road next to it
    for (let i = 1; i < n; i++) if (Number.isNaN(k[i])) k[i] = k[i - 1];
    for (let i = n - 2; i >= 0; i--) if (Number.isNaN(k[i])) k[i] = k[i + 1];
    if (Number.isNaN(k[0])) k.fill(1);
    const ramp = config.traffic.ramp;
    for (let i = 1; i < n; i++) k[i] = Math.min(k[i], k[i - 1] + (cum[i] - cum[i - 1]) / ramp);
    for (let i = n - 2; i >= 0; i--) k[i] = Math.min(k[i], k[i + 1] + (cum[i + 1] - cum[i]) / ramp);
    return k;
  }

  // Cars and bikes pull away from and roll up to doors slowly: speed factor
  // from sim.doorMinSpeed at the door up to 1 over sim.doorSlowdown.
  doorEase(a, leg) {
    if (a.trip.mode !== 'drive' && a.trip.mode !== 'cycle') return 1;
    const { doorSlowdown: zone, doorMinSpeed: min } = this.config.sim;
    let t = 1;
    if (leg.doorStart) t = Math.min(t, a.s / zone);
    if (leg.doorEnd) t = Math.min(t, (leg.total - a.s) / zone);
    if (t >= 1) return 1;
    t = Math.max(0, t);
    return min + (1 - min) * t * t * (3 - 2 * t); // smoothstep
  }

  // Where the line from a building's door dot towards `to` leaves the building.
  doorEdge(door, to) {
    const [x, y] = typeof door === 'number' ? this.world.grid.xy(door) : door;
    const dx = to[0] - x, dy = to[1] - y;
    const l = Math.hypot(dx, dy);
    const pad = this.config.sim.doorPad;
    return l > pad ? [x + (dx / l) * pad, y + (dy / l) * pad] : to;
  }

  beginLeg(a, leg) {
    if (a.chat) { // (a fire took them from a chat: meet)
      a.chat.group.people.splice(a.chat.group.people.indexOf(a), 1);
      a.chat = null;
    }
    a.s = 0;
    a.followK = 1;
    a.room = Infinity;
    [a.x, a.y] = leg.points[0];
    [a.tx, a.ty] = [a.x, a.y];
  }

  tripIntact(trip) {
    if (trip.ways) {
      const g = trip.mode === 'drive' ? this.driveGraph() : this.footGraph(trip.mode === 'cycle');
      return this.waysIntact(g, trip.ways, trip.wayPts) && (!trip.backWays || this.waysIntact(g, trip.backWays, trip.backPts));
    }
    const net = trip.mode === 'drive' ? this.world.roads : trip.mode === 'cycle' ? this.ride : this.walk;
    const ok = (nodes) => nodes.every((n, i) => net.hasNode(n) && (i === 0 || net.hasEdge(nodes[i - 1], n)));
    return ok(trip.nodes) && (!trip.backNodes || ok(trip.backNodes));
  }

  // After road / path edits, send anyone whose route no longer exists straight home.
  revalidate() {
    for (const a of this.agents.values()) {
      if (a.trip && !this.tripIntact(a.trip)) {
        if (a.visitor) {
          this.agents.delete(a.id);
          continue;
        }
        this.arriveHome(a);
      }
    }
  }
}
