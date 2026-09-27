// Railway stations, standing beside a straight stretch of track with the
// platform on their front (local -y) facing it:
//   stop     1×2, a platform with a shelter and a little waiting house
//   station  3×2, a passing track beside the line (joining it at both ends),
//            an island platform between them and a station house
//   main     4×3, a main station: two through tracks and two bay tracks
//            ending at buffers, three platforms, a hall with a clock tower
// Extra tracks are for show – trains only use the line itself. They're
// listed in `tracks` (local polylines) and drawn by the renderer with the
// real railways, so they meet the line exactly (see stationTracks).
// Stations are placed facing the track whichever side of it they're on (see
// World.placementFor). Trains stop in front of the middle of the platform
// (see stationStop and src/sim/trains.js).

import { rotateQuarter } from '../src/core/grid.js';
import { door, lamp, chimney, bench, flowerBed, bikeRack, tree } from './kit.js';

// The railway's (dense-grid) dots in front of the footprint's front row,
// from the dot before its first dot to the one before its last, if they
// are one straight stretch of railway; else null. A one-dot front needs the
// track to carry on straight through the dot in front either way.
function trackAlong(world, nodes, rotation) {
  const [fx, fy] = rotateQuarter(0, -1, rotation);
  const own = new Set(nodes);
  const front = nodes.map((n) => world.grid.offset(n, fx, fy)).filter((t) => !own.has(t));
  if (front.some((t) => t < 0)) return null;
  const track = [world.coarseToFine(front[0])];
  for (let i = 1; i < front.length; i++) {
    for (const [f, g] of world.fineSegment(front[i - 1], front[i])) {
      if (!world.rails.hasEdge(f, g)) return null;
      track.push(g);
    }
  }
  if (track.length === 1) {
    // along the front, both ways
    const [ax, ay] = rotateQuarter(1, 0, rotation);
    const [x, y] = world.fine.xy(track[0]);
    const side = (k) => (world.fine.inBounds(x + ax * k, y + ay * k) ? world.fine.index(x + ax * k, y + ay * k) : -1);
    const [l, r] = [side(-1), side(1)];
    if (l < 0 || r < 0 || !world.rails.hasEdge(l, track[0]) || !world.rails.hasEdge(track[0], r)) return null;
    return [l, track[0], r];
  }
  return track;
}

// Where trains stop for station s: { node, track, centre }, or null if its
// track is gone. node = a track dot on the route (the key trains look
// stations up by), centre = the middle of the platform's track.
export function stationStop(world, s) {
  const track = trackAlong(world, world.nodesOf(s), s.rotation);
  if (!track) return null;
  const pts = track.map((n) => world.networks.rail.pos(n));
  const centre = [
    pts.reduce((a, p) => a + p[0], 0) / pts.length,
    pts.reduce((a, p) => a + p[1], 0) / pts.length,
  ];
  return { node: track[Math.floor((track.length - 1) / 2)], track, centre };
}

// Platform along the front from local x0 to x1, right up against the track
// (the track runs along y = -1), with a safety line near its edge.
const EDGE = -0.87, BACK = -0.6;
function platform(g, x0, x1) {
  g.box(x0, EDGE, 0, x1 - x0, BACK - EDGE, 0.03);
  g.detailed(2, () => g.line([[x0 + 0.03, EDGE + 0.05, 0.03], [x1 - 0.03, EDGE + 0.05, 0.03]]));
  lamp(g, x0 + 0.12, BACK - 0.05);
  lamp(g, x1 - 0.2, BACK - 0.05);
}

// Station name board on two posts.
function nameBoard(g, x, y) {
  g.detailed(1, () => {
    g.line([[x - 0.09, y, 0.03], [x - 0.09, y, 0.13]]);
    g.line([[x + 0.09, y, 0.03], [x + 0.09, y, 0.13]]);
  });
  g.box(x - 0.11, y - 0.005, 0.13, 0.22, 0.01, 0.045);
}

// A switch: a gentle S-curve from a on one track to b on a parallel one
// (along x), as points without a.
function turnout(a, b, samples = 8) {
  const out = [];
  for (let i = 1; i <= samples; i++) {
    const t = i / samples;
    const e = t * t * (3 - 2 * t); // smoothstep: leaves and joins the tracks parallel
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * e]);
  }
  return out;
}

// A track through local points, where each pair [from, to] with a changed y
// becomes a switch curve: track(p0, p1, p2…) keeps straight pieces straight.
function track(...pts) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    out.push(...(a[1] === b[1] ? [b] : turnout(a, b)));
  }
  return out;
}

// A station's extra tracks in world coordinates: [{ line: [[x, y]…], buffer }]
// – buffer = the track ends at a buffer stop at its last point.
export function stationTracks(world, s, def) {
  if (!def.tracks) return [];
  const [ox, oy] = world.grid.xy(s.node);
  return def.tracks.map(({ pts, buffer }) => ({
    buffer,
    line: pts.map(([x, y]) => {
      const [rx, ry] = rotateQuarter(x, y, s.rotation);
      return [ox + rx, oy + ry];
    }),
  }));
}

// Canopy on a row of posts over a platform (y0…y1), from x0 to x1.
function canopy(g, x0, x1, y0, y1, h = 0.17) {
  g.detailed(1, () => {
    for (let x = x0 + 0.12; x < x1; x += 0.3) g.line([[x, (y0 + y1) / 2, 0.03], [x, (y0 + y1) / 2, h]]);
  });
  g.box(x0, y0, h, x1 - x0, y1 - y0, 0.015);
}

// Door on a back (+y) wall.
function backDoor(g, x, y, w = 0.07, h = 0.13) {
  g.line([[x + w / 2, y, 0], [x + w / 2, y, h], [x - w / 2, y, h], [x - w / 2, y, 0]], { facing: [0, 1, 0] });
}

const common = {
  category: 'transport',
  railStop: true,
  sim: { destinations: [] },
  canPlace(world, nodes, rotation) {
    return trackAlong(world, nodes, rotation) ? { ok: true } : { ok: false, reason: 'Needs straight track alongside' };
  },
};

// The station building: a taller hall with a clock gable between two lower
// wings, doors front and back, from x0 to x1 at depth y…y + d.
function stationHouse(g, x0, x1, y, d) {
  const h = 0.24, hall = Math.min(0.7, (x1 - x0) * 0.4), wing = (x1 - x0 - hall) / 2;
  const cx = (x0 + x1) / 2;
  g.roofed(x0, y, 0, wing, d, h, { h: 0.16, hip: 0.14 });
  g.roofed(x1 - wing, y, 0, wing, d, h, { h: 0.16, hip: 0.14 });
  g.roofed(cx - hall / 2, y, 0, hall, d, h + 0.12, { h: 0.2, ridge: 'y' });
  g.windows(x0, y, wing, d, 0, h, h / 2, 0.11);
  g.windows(x1 - wing, y, wing, d, 0, h, h / 2, 0.11);
  g.windows(cx - hall / 2, y, hall, d, h / 2, h + 0.12, h / 2, 0.13, { skip: ['front', 'back'] });
  door(g, cx - 0.1, y, 0.08, 0.15);
  door(g, cx + 0.1, y, 0.08, 0.15);
  backDoor(g, cx - 0.1, y + d, 0.08, 0.15);
  backDoor(g, cx + 0.1, y + d, 0.08, 0.15);
  chimney(g, x0 + wing / 2, y + d / 2, h + 0.08, 0.1);
  chimney(g, x1 - wing / 2, y + d / 2, h + 0.08, 0.1);
  clock(g, cx, [[y, [0, -1, 0]], [y + d, [0, 1, 0]]], h + 0.08);
}

// Clock faces at x on the walls listed as [y, normal], at height z.
function clock(g, x, walls, z, r = 0.05) {
  g.detailed(1, () => {
    for (const [yy, n] of walls) {
      g.line(Array.from({ length: 13 }, (_, i) => [x + Math.cos((i / 12) * Math.PI * 2) * r, yy, z + Math.sin((i / 12) * Math.PI * 2) * r]), { facing: n });
    }
  });
}

// Footbridge at x over the tracks: stair towers on the platforms at ys, a
// deck between the first and last.
function footbridge(g, x, ys, deck = 0.3) {
  for (const y of ys) g.roofed(x - 0.07, y - 0.07, 0.03, 0.14, 0.14, deck - 0.03, { h: 0.04, hip: 0.07 });
  const y0 = Math.min(...ys) + 0.07, y1 = Math.max(...ys) - 0.07;
  g.box(x - 0.04, y0, deck - 0.04, 0.08, y1 - y0, 0.03);
}

export const station = {
  ...common,
  id: 'station',
  name: 'Station',
  size: 'Station',
  blurb: 'Beside straight track',
  hotkey: '0',
  code: 'ST',
  // front row along the line, the house in the back row
  footprint: [[-1, 0], [0, 0], [1, 0], [-1, 1], [0, 1], [1, 1]],
  // a passing track: off the line at one end, back onto it at the other
  tracks: [{ pts: track([-1.6, -1], [-0.8, -0.36], [0.8, -0.36], [1.6, -1]) }],
  levels: [
    {
      name: 'Station',
      stats: { jobs: 4 },
      agents: 0,
      // towards the road (when there is one behind): see structures/yards.js
      yards: ['forecourt', 'forecourt', 'plaza', 'parking'],
      draw(g) {
        // island platform between the line and the passing track
        g.box(-0.7, -0.87, 0, 1.4, 0.31, 0.03);
        g.detailed(2, () => g.line([[-0.67, -0.82, 0.03], [0.67, -0.82, 0.03]]));
        canopy(g, -0.45, 0.45, -0.8, -0.62);
        nameBoard(g, -0.55, -0.7);
        lamp(g, 0.58, -0.7);
        // the house platform behind the passing track
        g.box(-1.36, -0.24, 0, 2.72, 0.26, 0.03);
        bench(g, 0.7, -0.12);
        lamp(g, -1.15, -0.12);
        stationHouse(g, -0.9, 0.9, 0.1, 0.52);
        // bike stands and a flower bed behind, on the way to the road
        bikeRack(g, -1.3, -1.0, 0.95);
        flowerBed(g, 1.15, 0.95, 0.07);
      },
    },
  ],
};

export const main = {
  ...common,
  id: 'station-main',
  name: 'Main station',
  size: 'Main station',
  blurb: 'Beside straight track',
  code: 'MS',
  footprint: [
    [-1, 0], [0, 0], [1, 0], [2, 0],
    [-1, 1], [0, 1], [1, 1], [2, 1],
    [-1, 2], [0, 2], [1, 2], [2, 2],
  ],
  // two through tracks off the line on both sides, two bays ending at
  // buffers by the concourse on the right
  tracks: [
    { pts: track([-1.6, -1], [-0.95, -0.5], [1.95, -0.5], [2.6, -1]) },
    { pts: track([-0.85, -0.5], [-0.3, -0.2], [1.3, -0.2], [1.85, -0.5]) },
    { pts: track([-0.3, -0.2], [0.3, 0.4], [2.05, 0.4]), buffer: true },
    { pts: track([0.4, 0.4], [0.85, 0.7], [2.05, 0.7]), buffer: true },
  ],
  levels: [
    {
      name: 'Main station',
      stats: { jobs: 12 },
      agents: 0,
      yards: ['forecourt', 'plaza', 'parking'],
      draw(g) {
        // platform 1: an island between the line and the first through track
        g.box(-0.8, -0.87, 0, 2.6, 0.24, 0.03);
        g.detailed(2, () => g.line([[-0.77, -0.83, 0.03], [1.77, -0.83, 0.03]]));
        canopy(g, 0, 1.3, -0.82, -0.66);
        nameBoard(g, -0.45, -0.75);
        lamp(g, 1.6, -0.75);
        // platform 2: between the second through track and the first bay
        g.box(0.45, -0.07, 0, 1.6, 0.34, 0.03);
        canopy(g, 0.75, 1.75, -0.02, 0.22);
        bench(g, 0.6, 0.1);
        // platform 3 along the second bay, and the concourse across the
        // bay ends joining the platforms
        g.box(0.95, 0.83, 0, 1.45, 0.26, 0.03);
        g.box(2.12, -0.07, 0, 0.3, 1.16, 0.03);
        canopy(g, 2.14, 2.4, 0, 1.0, 0.2);
        lamp(g, 1.1, 0.96);
        footbridge(g, 1.55, [-0.75, 0.1, 0.96]);

        // the hall: a vaulted roof over the middle, a clock tower, two wings
        const y = 1.2, d = 1.0, h = 0.3;
        g.vault(-0.2, y, 0, 1.5, d, h, 0.24, 8);
        g.windows(-0.2, y, 1.5, d, 0, h, h / 2, 0.14, { skip: ['left', 'right'] });
        door(g, 0.4, y, 0.1, 0.18);
        door(g, 0.7, y, 0.1, 0.18);
        backDoor(g, 0.4, y + d, 0.1, 0.18);
        backDoor(g, 0.7, y + d, 0.1, 0.18);
        clock(g, 0.55, [[y, [0, -1, 0]], [y + d, [0, 1, 0]]], h + 0.1, 0.07);
        // clock tower at the left end of the hall
        const tx = -0.42, ty = y + 0.35, t = 0.12, th = 0.78;
        g.roofed(tx - t, ty - t, 0, 2 * t, 2 * t, th, { h: 0.16, hip: t });
        g.windows(tx - t, ty - t, 2 * t, 2 * t, th - 0.16, th - 0.02, 0.14, 0.08);
        clock(g, tx, [[ty - t, [0, -1, 0]]], th - 0.24, 0.045);
        // wings
        g.roofed(-1.36, y + 0.1, 0, 0.8, d - 0.2, 0.24, { h: 0.15, hip: 0.14 });
        g.windows(-1.36, y + 0.1, 0.8, d - 0.2, 0, 0.24, 0.12, 0.11);
        g.roofed(1.42, y + 0.1, 0, 0.98, d - 0.2, 0.24, { h: 0.15, hip: 0.14 });
        g.windows(1.42, y + 0.1, 0.98, d - 0.2, 0, 0.24, 0.12, 0.11);
      },
    },
  ],
};

export const stop = {
  ...common,
  id: 'stop',
  name: 'Stop',
  size: 'Stop',
  code: 'SP',
  footprint: [[0, 0], [1, 0]],
  levels: [
    {
      name: 'Stop',
      stats: { jobs: 1 },
      agents: 0,
      yards: ['forecourt', 'trees'],
      draw(g) {
        platform(g, -0.36, 1.36);
        // shelter on the platform and the name board
        g.roofed(0.78, -0.82, 0.03, 0.38, 0.1, 0.13, { h: 0.04 });
        g.windows(0.78, -0.82, 0.38, 0.1, 0.03, 0.16, 0.13, 0.1, { skip: ['front'] });
        nameBoard(g, 0.45, -0.72);
        // a little waiting house with a ticket window, right behind the platform
        const x = -0.26, y = -0.5, w = 0.5, d = 0.36, h = 0.15;
        g.roofed(x, y, 0, w, d, h, { h: 0.12 });
        g.windows(x, y, w, d, 0, h, h, 0.12, { skip: ['front'] });
        door(g, -0.1, y, 0.06, 0.11);
        g.detailed(1, () => g.line([[0.04, y, 0.05], [0.14, y, 0.05], [0.14, y, 0.11], [0.04, y, 0.11], [0.04, y, 0.05]], { facing: [0, -1, 0] }));
        chimney(g, 0.12, y + d / 2, h + 0.06, 0.08);
        // behind: steps down from the platform, bike stands, a bench, a tree
        g.box(0.5, BACK, 0, 0.12, 0.06, 0.015);
        bikeRack(g, 0.72, 1.02, -0.38);
        bench(g, 0.62, 0.05);
        flowerBed(g, -0.02, 0.12, 0.07);
        tree(g, 1.18, 0.12, 0.9);
      },
    },
  ],
};
