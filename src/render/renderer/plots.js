// A building with its ground (Renderer methods; see renderer.js): its
// drawing, the plot and garden round it and what they may claim, its yard,
// where its front faces, and the cars parked on its lot.

import { THEME } from '../../theme.js';
import { Painter } from '../painter.js';
import { VEHICLES, vehicleSVG, modelFor, headingIndex } from '../vehicles.js';
import { STRUCTURE_TYPES, drawSeed, yardOf, joinSides, joinedRow, tiltOf, roadFront, courtSides } from '../../../structures/index.js';
import { drawCourt } from '../../../structures/courts.js';
import { drawRuin } from '../../../structures/ruin.js';
import { YARDS } from '../../../structures/yards.js';
import { drawPlot, boundaryChance, SPREAD, SPREAD_DENSITY } from '../../../structures/plots.js';
import { rotateQuarter } from '../../core/grid.js';
import { pointInPolygon } from '../../core/geom2d.js';
import { fitYard, fitSite, siteEdges, plotClaim } from '../lots.js';
import { SUN } from '../shadows.js';
import { SVGNS, NEAR, bareOf, COS30, r2, STRUCTURE_PAD, quarterOf, centerOf } from './shared.js';

const SHORE_GAP = 0.06; // plots (props, fences) keep this clear of the drawn shore
// Objects' box corners lifted and warped, per their points (sceneBox).
const BOX_CORNERS = new WeakMap();

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

export class PlotDrawing {
  paintStructure(s, camera = this.camera) {
    if (!s) return null;
    const def = STRUCTURE_TYPES[s.type];
    if (!def) return null;
    const { world } = this;
    const live = camera === this.camera;
    const [x, y] = world.anchorOf(s);
    const z = world.terrain.heightAt(x, y);
    const painter = this.attachFree(new Painter(camera, { x, y, z }, quarterOf(world, s), drawSeed(s)));
    // the building moves with the relief as one piece, so it stays square on
    // slopes (see Camera.project) – and so does a whole street front of
    // buildings sharing walls, so the walls still meet. Its yard and plot (and
    // parks and squares) keep its warp but follow the ground (Painter.follow).
    const joined = joinedRow(world, s), row = joined.map((o) => centerOf(world, o));
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
    painter.setTilt(tiltOf(def, s, painter.join, world), !!s.free);
    painter.roadGap = world.nodesOf(s).length === 1 ? roadFront(world, s).gap : 1; // see busStop.js
    if (s.ruin) drawRuin(painter, def); // burnt down (World.burnStructure)
    else def.draw(painter, s);
    const core = painter.bounds;

    // Courts: the walled yard beside a village house (structures/courts.js),
    // standing with it, not lying on the ground like the front yard.
    let courtWorld = [];
    if (core && (painter.court.left || painter.court.right)) {
      const cp = this.attachFree(new Painter(camera, { x, y, z }, quarterOf(world, s), drawSeed(s) ^ 0x3c6ef372));
      cp.setTilt(painter.tilt, true);
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
      pp.setTilt(this.roadTurn(s), !!s.free); // a plot turned with its building to a diagonal road
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
    const [ax, ay] = world.anchorOf(s);
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
    const dir = rotateQuarter(0, -1, quarterOf(world, s));
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
}
