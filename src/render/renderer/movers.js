// What moves (Renderer methods; see renderer.js): trains, canoes, deer and
// livestock, people, cyclists and cars – placed each frame, jolting and
// puffing exhaust – and the level crossings' signs.

import { THEME } from '../../theme.js';
import { wobble } from '../painter.js';
import { VEHICLES, vehicleSVG, modelFor, truckFor, headingIndex, jolt } from '../vehicles.js';
import { EXHAUST, puffShapes } from '../exhaust.js';
import { PEOPLE, bodyFor, walkerSVG, cyclistSVG, canoeSVG, canoeMarkSVG } from '../people.js';
import { DEER, deerSVG, deerMark } from '../deer.js';
import { LIVESTOCK, livestockSVG, livestockMark } from '../livestock.js';
import { drawEnabled, growScale, shrinkScale } from '../draw.js';
import { AGENT_STYLES, shapesOf, shape } from '../agentCanvas.js';
import { signsAt, signSVG, flashSVG, litLight } from '../crossings.js';
import { carMark, personMark } from '../marks.js';
import { r2 } from './shared.js';

// A closed outline, its points (gl/movers.js drawScene).
const outline = (pts) => ({ pts });

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
    puffs: undefined, puffAt: undefined, puffN: undefined,
  };
}

export class MoverDrawing {
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
          this.joltVehicle(el);
          this.exhaust(el, a.x + wx - ux, a.y + wy - uy, now);
        } else {
          el.shear = 0;
          el.squash = 1;
        }
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
    for (const p of el.parts) pen.draw(p.shapes, p.sx, p.sy, k, false, el.shear ?? 0, el.squash ?? 1);
  }

  // A car, bus or truck close up jolting on the road as it drives (VEHICLES
  // bump): squashed down a little by the way it has driven, so one standing
  // still is still.
  joltVehicle(el) {
    el.squash = jolt(el.walked ?? 0, el.model.seed);
  }

  // Its exhaust (exhaust.js): a puff given off at its back (x, y) every so
  // far driven, and those still going drawn, under it, carried after it.
  exhaust(el, x, y, now) {
    const puffs = (el.puffs ??= []);
    const driven = el.walked ?? 0;
    // (never quite evenly: each gap between ½ and 1½ of `every`)
    if (el.puffAt === undefined || driven - el.puffAt > EXHAUST.every * (0.5 + ((el.puffN ?? 0) * 0.618) % 1)) {
      if (el.puffAt !== undefined) {
        if (puffs.length >= EXHAUST.most) puffs.shift();
        puffs.push({ x, y, born: now, v: (el.puffN = (el.puffN ?? el.model.hand) + 1) % EXHAUST.variants });
      }
      el.puffAt = driven;
    }
    while (puffs.length && now - puffs[0].born > EXHAUST.life * 1000) puffs.shift();
    for (const p of puffs) {
      const u = (now - p.born) / (EXHAUST.life * 1000), c = EXHAUST.carry;
      const [sx, sy] = this.projectDeck(p.x + (x - p.x) * c, p.y + (y - p.y) * c, EXHAUST.low + EXHAUST.rise * u);
      this.pen.draw(puffShapes(p.v, u), sx, sy);
    }
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
    if (el.at) el.walked = (el.walked ?? 0) + Math.hypot(a.x - el.at[0], a.y - el.at[1]); // (driven: it jolts by it)
    el.at = [a.x, a.y];
    if (Math.hypot(front[0] - back[0], front[1] - back[1]) > 1e-4) el.heading = headingIndex(Math.atan2(front[1] - back[1], front[0] - back[0]));
    const [sx, sy] = this.projectDeck((front[0] + back[0]) / 2, (front[1] + back[1]) / 2, 0.04);
    el.shear = this.slopeShear(back, front);
    el.squash = 1;
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
    this.joltVehicle(el);
    this.exhaust(el, back[0], back[1], performance.now());
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
      el.walked = (el.walked ?? 0) + Math.hypot(dx, dy); // (driven: it jolts by it)
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
