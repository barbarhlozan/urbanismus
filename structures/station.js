// Railway stations, standing beside a straight stretch of track with the
// platform on their front (local -y) facing it:
//   station  1×3, a little station house with its platform
//   stop     1×2, just a platform with a shelter
// They are placed facing the track whichever side of it they're on (see
// World.placementFor). Trains stop in front of the middle of the platform
// (see stationStop and src/sim/trains.js).

import { rotateQuarter } from '../src/core/grid.js';
import { door, lamp, chimney, bench, flowerBed, bikeRack } from './kit.js';

// The track dots in front of the footprint, if they are one straight
// stretch of railway; else null.
function trackAlong(world, nodes, rotation) {
  const [fx, fy] = rotateQuarter(0, -1, rotation);
  const track = nodes.map((n) => world.grid.offset(n, fx, fy));
  if (track.some((t) => t < 0)) return null;
  for (let i = 1; i < track.length; i++) if (!world.rails.hasEdge(track[i - 1], track[i])) return null;
  return track;
}

// Where trains stop for station s: { node, track, centre }, or null if its
// track is gone. node = a track dot on the route (the key trains look
// stations up by), centre = the middle of the platform's track.
export function stationStop(world, s) {
  const track = trackAlong(world, world.nodesOf(s), s.rotation);
  if (!track) return null;
  const pts = track.map((n) => world.grid.xy(n));
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

export const station = {
  ...common,
  id: 'station',
  name: 'Station',
  size: 'Station',
  blurb: 'Beside straight track',
  hotkey: '0',
  code: 'ST',
  footprint: [[-1, 0], [0, 0], [1, 0]],
  levels: [
    {
      name: 'Station house',
      stats: { jobs: 2 },
      agents: 0,
      // towards the road (when there is one behind): see structures/yards.js
      yards: ['forecourt', 'forecourt', 'plaza', 'parking'],
      draw(g) {
        platform(g, -1.36, 1.36);
        // the house right behind the platform: gable ends to the sides,
        // a door onto the platform and one out the back
        const x = -0.34, y = -0.58, w = 0.68, d = 0.4, h = 0.2;
        g.roofed(x, y, 0, w, d, h, { h: 0.17 });
        g.windows(x, y, w, d, 0, h, h, 0.11, { skip: ['front', 'back'] });
        g.windows(x, y, 0.26, d, 0, h, h, 0.11, { skip: ['right', 'left'] });
        g.windows(0.08, y, 0.26, d, 0, h, h, 0.11, { skip: ['right', 'left'] });
        door(g, 0, y, 0.07, 0.13);
        backDoor(g, 0, y + d);
        chimney(g, 0.18, y + d / 2, h + 0.1, 0.1);
        // woodshed beside it; name board and a bench on the platform
        g.roofed(0.52, -0.52, 0, 0.26, 0.3, 0.1, { h: 0.05, ridge: 'y' });
        nameBoard(g, -0.72, -0.72);
        bench(g, 0.62, -0.7);
        // a flower bed and bike stands behind, on the way to the road
        flowerBed(g, -0.62, -0.05, 0.07);
        bikeRack(g, 0.45, 0.7, -0.05);
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
      stats: {},
      agents: 0,
      yards: ['forecourt', 'trees'],
      draw(g) {
        platform(g, -0.36, 1.36);
        // shelter with a back wall of windows on the platform, the name board
        g.roofed(0.3, -0.72, 0.03, 0.4, 0.1, 0.13, { h: 0.04 });
        g.windows(0.3, -0.72, 0.4, 0.1, 0.03, 0.16, 0.13, 0.1, { skip: ['front'] });
        nameBoard(g, 0.02, -0.7);
        // steps down off the back of the platform, bike stands beside them
        g.box(0.44, BACK, 0, 0.12, 0.06, 0.015);
        bikeRack(g, 0.75, 1.0, -0.4);
        flowerBed(g, 0.1, -0.35, 0.06);
      },
    },
  ],
};
