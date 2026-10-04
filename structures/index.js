// Structure registry. To add a building: create a file next to this one
// (copy residential.js), then import it and add it to the list below.
// Toolbar buttons, the click menu, shortcuts and the simulation pick it up
// automatically. Every structure is one thing to build: nothing grows or
// upgrades into something else.
//
// Optional definition fields beyond those documented in residential.js:
//   category   Build menu group – see CATEGORIES (default 'housing')
//   blurb      a few words for the Build menu on what it is, e.g. 'Trees and paths'
//   size       label for the Size button when it shares a tool (default Small / Large)
//   tags       extra names agents, the story and unlocks can match, e.g. ['park']
//   access     'road' (default) or 'any' – 'any' also counts a footpath as access:
//              such a building works without a road, its people walk
//              or cycle, and its surroundings leave out the car park and garages
//   code       short prefix for annotations, e.g. 'R' -> "R-012" (default: first letter)
//   trucks     how many trucks it keeps, if it is one of config.trucks.homes (default 1)
//   site       true = fills its lot up to the road and merges with neighbouring
//              sites; drawings get the area as g.site (parks, squares)
//   canPlace(world, nodes, rotation) -> { ok, reason }
//              extra placement rule on top of free ground (stations need track)
//              When it fails, the build tool also tries the footprint turned
//              half round on the same dots (World.placementFor). It may
//              return { ok, lay } – something placing will build (a
//              station's own track); the other way round is preferred if it
//              needs no `lay`.
//   placed(world, s)  called once a new structure stands (a station lays its track)
//   railStop   true = trains stop here (stations, src/sim/trains.js)
//   busStop    true = buses call here (src/sim/agents.js, updateBuses)
//   tracks     [{ pts, buffer }] extra railway drawn with the real lines, in
//              local coordinates (stations' passing tracks and sidings)
//   tilt       true = may stand a little askew on its dot (see tiltOf)
//   keepsGrid  true = a single-dot structure never turned to a road at an angle
//              to the grid (squares: their paving joins the neighbours')
//   facesRoad  true = a single-dot structure that always faces its road (the
//              player can't turn it; a bus stop). Other single-dot ones can
//              be turned side or back to it (s.data.turn, World.facingRotation)
//   yards      surroundings styles it may get (see yards.js)

import { rotateQuarter } from '../src/core/grid.js';
import { mulberry32 } from '../src/core/random.js';
import { YARDS } from './yards.js';
import { LOOK } from '../src/render/painter.js';
import * as housing from './residential.js';
import * as business from './business.js';
import * as industry from './industrial.js';
import * as park from './park.js';
import * as square from './square.js';
import * as services from './services.js';
import * as heritage from './heritage.js';
import * as station from './station.js';
import { busStop } from './busStop.js';
import * as landmarks from './landmarks.js';
import * as grounds from './grounds.js';
import * as mine from './mine.js';
import * as farm from './farm.js';
import pool from './pool.js';

// Build menu groups, in order, named as the planners of the time did:
// housing, production, civic amenities (občanská vybavenost – shops, pubs,
// schools, clinics and culture alike, all of it public), open spaces and
// landmarks. The network tools (road, footpath, railway) join 'transport'
// too (src/main.js).
export const CATEGORIES = [
  { id: 'transport', label: 'Doprava' },
  { id: 'housing', label: 'Bydlení' },
  { id: 'work', label: 'Výroba' },
  { id: 'amenities', label: 'Občanská vybavenost' },
  { id: 'spaces', label: 'Prostranství' },
  { id: 'heritage', label: 'Památky' },
];

// Build menu entries: sizes of the same thing share one tool (S switches,
// the first is the default). Every structure is in exactly one; the
// registry is these, in this order.
export const BUILD_FAMILIES = [
  // Doprava
  [station.station, station.main, station.stop], [busStop],
  // Bydlení
  [housing.house, housing.houseWide], [housing.apartments, housing.apartmentsWide], [housing.block, housing.blockWide],
  // Výroba
  [industry.workshop, industry.workshopMedium, industry.workshopLarge], [industry.works, industry.worksMedium],
  [industry.factory], [industry.plantSmall, industry.plantMedium, industry.plant],
  [mine.pit], [mine.colliery], [mine.deepMine],
  [farm.farmstead], [farm.jzd], [farm.stateFarm],
  // Občanská vybavenost
  [business.jednota, business.jednotaWide], [business.hospoda, business.hospodaWide], [business.store, business.storeWide],
  [business.tuzex], [business.office, business.officeWide, business.officeTower, business.officeTowerWide],
  [business.postOffice], [business.hotel, business.hotelWide],
  [services.fireHouse, services.fireStation, services.fireStationLarge], [services.police],
  [services.healthCentre], [services.clinic], [services.hospital], [services.serviceCentre], [services.school],
  [landmarks.cultureHouse], [pool], [grounds.cemetery],
  // Prostranství
  [park.green], [park.gardenPark], [park.pavilionPark], [park.meadow], [park.pondPark], [park.cityPark],
  [square.plaza], [square.fountainSquare, square.fountainSquareLarge], [square.precinct, square.precinctLarge],
  [square.monumentSquare], [square.marketSquare], [square.busStation], [square.grandSquare], [square.paradeSquare],
  // Památky
  [heritage.chapel], [heritage.church], [heritage.townHall, heritage.townHallSmall, heritage.townHallLarge], [heritage.memorial],
  [heritage.castle], [landmarks.tvTower], [landmarks.stadium],
];

export const STRUCTURES = BUILD_FAMILIES.flat();

export const STRUCTURE_TYPES = Object.fromEntries(STRUCTURES.map((s) => [s.id, s]));

export function categoryOf(def) {
  return def.category ?? 'housing';
}

// Does a structure definition answer to `name` (its id or one of its tags)?
export function matches(def, name) {
  return def.id === name || (def.tags ?? []).includes(name);
}

// Display name for a type id or tag used in rules.
export function nameOf(name) {
  return (STRUCTURE_TYPES[name]?.name ?? name).toLowerCase();
}

// Short technical code for annotations, e.g. "R-012".
export function codeOf(s) {
  const def = STRUCTURE_TYPES[s.type];
  const prefix = def?.code ?? s.type[0].toUpperCase();
  return `${prefix}-${String(s.id).padStart(3, '0')}`;
}

// Every building has a random `seed` that drives its look (see Painter
// variation helpers).
export function newSeed() {
  return Math.floor(Math.random() * 2 ** 31);
}

// The seed its drawing is made from. (Mixed with 1 – once the level – so
// buildings keep the look they had.)
export function drawSeed(s) {
  return (s.seed ^ 0x9e3779b1) >>> 0;
}

// Surroundings style for an instance: the player's choice (s.data.yard),
// or one of its type's `yards` picked by seed. null = none. Without a road
// (cars: false) styles for cars (parking, garages) are left out.
export function yardOf(def, s, { cars = true } = {}) {
  const chosen = s.data?.yard;
  if (chosen === 'none') return null;
  if (chosen && YARDS[chosen] && (cars || !YARDS[chosen].cars)) return chosen;
  const options = (def.yards ?? []).filter((y) => cars || !YARDS[y].cars);
  if (!options.length) return null;
  return options[Math.floor(mulberry32(drawSeed(s) ^ 0x51ed)() * options.length)];
}

// How far (radians) a single-dot building turns on its dot: square to its
// road where that runs at an angle to the grid (a diagonal, a bend – see
// roadFront); else a small turn so a street of houses doesn't line up like
// a grid, up to LOOK.tilt degrees either way, seeded like the rest of its
// look (only types with `tilt: true`). Never while sharing a wall with a
// neighbour (the walls must meet). Without `world` (no road known) only the
// small turn.
export function tiltOf(def, s, join = { left: false, right: false }, world = null) {
  if ((def.footprint ?? [[0, 0]]).length !== 1 || join.left || join.right) return 0;
  const road = world ? roadFront(world, s).tilt : 0;
  if (Math.abs(road) > 1e-6) return road;
  if (!LOOK.tilt || !def.tilt) return 0;
  const r = mulberry32(drawSeed(s) ^ 0x7117)();
  return (r * 2 - 1) * LOOK.tilt * Math.PI / 180;
}

// How a single-dot structure stands square to the road in front of it, e.g.
// a house on a bend: { tilt, gap }. The road's direction at that dot – along
// the line through its two neighbours where it runs on through the dot
// (straight or bending gently), else (a corner, a junction, an end) the one
// of its segments most across the front – as a turn of the front's
// own axis (tilt, radians, at most 45° either way), and how far that line
// passes from the structure's dot (gap; 1 beside a straight road, less
// beside a diagonal), for the drawing to keep its distance (g.roadGap).
export function roadFront(world, s) {
  const none = { tilt: 0, gap: 1 };
  // squares: their paving joins their neighbours' on the grid, never turned
  if (STRUCTURE_TYPES[s.type]?.keepsGrid) return none;
  const rot = world.facingRotation(s.type, s.node, s.rotation);
  const [fx, fy] = rotateQuarter(0, -1, rot);
  const r = world.grid.offset(s.node, fx, fy);
  if (r < 0 || !world.hasRoad(r)) return none;
  const pos = (n) => world.networks.road.pos(n);
  const [rx, ry] = pos(r);
  const out = [...world.roads.neighbors(r)].map((n) => {
    const [x, y] = pos(n), l = Math.hypot(x - rx, y - ry) || 1;
    return [(x - rx) / l, (y - ry) / l];
  });
  if (!out.length) return none;
  let t;
  const through = out.length === 2 && out[0][0] * out[1][0] + out[0][1] * out[1][1] < -0.5; // bends 60° at most
  if (through) t = [out[1][0] - out[0][0], out[1][1] - out[0][1]];
  else t = out.reduce((best, d) => (Math.abs(d[0] * fx + d[1] * fy) < Math.abs(best[0] * fx + best[1] * fy) ? d : best));
  // into the frame of the structure facing its road (one turned side or back
  // to it – s.data.turn – turns by the same angle in its own frame)
  const [lx, ly] = rotateQuarter(t[0], t[1], (4 - rot) % 4);
  let a = Math.atan2(ly, lx);
  if (a > Math.PI / 2) a -= Math.PI;
  if (a < -Math.PI / 2) a += Math.PI;
  const [sx, sy] = world.grid.xy(s.node), tl = Math.hypot(...t) || 1;
  const gap = Math.abs((sx - rx) * t[1] - (sy - ry) * t[0]) / tl;
  return { tilt: Math.max(-Math.PI / 4, Math.min(Math.PI / 4, a)), gap: Math.max(0.5, Math.min(1, gap)) };
}

// Joined buildings: neighbouring single-dot buildings facing the same road
// can share a wall and read as one street front (a terrace of tenements, a
// panel block in sections). A type opts in with
//   join: { group, chance }
// Two neighbours join when both are in the same group, they stand side
// by side along their road (same drawn rotation), and a roll seeded by both
// buildings is under the lower chance – so it stays put until one of them is
// restyled. The draw function gets g.join = { left, right }.
export function joinSides(world, s) {
  return { left: !!joinedNeighbour(world, s, -1), right: !!joinedNeighbour(world, s, 1) };
}

// Every structure in the street front `s` belongs to (just [s] if it
// shares no walls), from one end to the other.
export function joinedRow(world, s) {
  const row = [s];
  for (const dir of [-1, 1]) {
    let cur = s;
    for (let o; (o = joinedNeighbour(world, cur, dir)) && !row.includes(o);) {
      if (dir < 0) row.unshift(o);
      else row.push(o);
      cur = o;
    }
  }
  return row;
}

// The neighbour `s` shares its wall with on the local -x (dir -1) or +x
// (dir 1) side, or null.
function joinedNeighbour(world, s, dir) {
  const def = STRUCTURE_TYPES[s.type];
  const join = def?.join;
  if (!join || world.nodesOf(s).length !== 1) return null;
  if (s.data?.turn) return null; // turned away from the street front
  const rot = world.facingRotation(s.type, s.node, s.rotation);
  const [x, y] = world.grid.xy(s.node);
  const side = (dir) => {
    const [dx, dy] = rotateQuarter(dir, 0, rot);
    const n = world.grid.nodeAt(x + dx, y + dy);
    const o = n >= 0 ? world.structureAt(n) : null;
    if (!o || o.id === s.id) return null;
    const odef = STRUCTURE_TYPES[o.type];
    const ojoin = odef?.join;
    if (!ojoin || ojoin.group !== join.group || world.nodesOf(o).length !== 1) return null;
    if (o.data?.turn || world.facingRotation(o.type, o.node, o.rotation) !== rot) return null;
    const [a, b] = s.id < o.id ? [s, o] : [o, s];
    const roll = mulberry32((drawSeed(a) ^ Math.imul(drawSeed(b), 0x85ebca6b) ^ 0x10ad) >>> 0)();
    return roll < Math.min(join.chance ?? 1, ojoin.chance ?? 1) ? o : null;
  };
  return side(dir);
}

// Footprint offsets relative to the anchor dot, after rotation.
export function footprintOffsets(def, rotation = 0) {
  return (def.footprint ?? [[0, 0]]).map(([dx, dy]) => rotateQuarter(dx, dy, rotation));
}

// Offset from the anchor dot to the middle of the footprint.
export function footprintCenter(def, rotation = 0) {
  const offs = footprintOffsets(def, rotation);
  return [
    offs.reduce((s, o) => s + o[0], 0) / offs.length,
    offs.reduce((s, o) => s + o[1], 0) / offs.length,
  ];
}
