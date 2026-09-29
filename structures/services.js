// Services (police, fire and health in one): 1×1 and 2×2.
// Fire stations with a hose-drying tower, a polyclinic with ribbon windows,
// a hospital of hipped pavilions – and, as another look of the service
// centre, a 60s pavilion school with its gym hall and playground.
// Each level covers a radius (`coverage`, in dots). Top-level homes,
// businesses and industry need to be inside some service coverage.

import { flagpole, pitch, tree } from './kit.js';

const FRONT = [0, -1, 0];

function garageDoor(g, x, y, w = 0.12, h = 0.14) {
  g.line([[x, y, 0], [x, y, h], [x + w, y, h], [x + w, y, 0]], { facing: FRONT });
}

// Plus sign on the front wall.
function cross(g, x, y, z, s = 0.05) {
  g.line([[x - s, y, z], [x + s, y, z]], { facing: FRONT });
  g.line([[x, y, z - s], [x, y, z + s]], { facing: FRONT });
}

const common = {
  access: 'any', // a footpath will do
  category: 'civic',
  tags: ['services'],
  code: 'S',
  sim: { destinations: ['residential'] },
  plot: { props: 'green', boundary: 0.4, kinds: ['fence', 'hedge'], density: 0.3 },
};

export const small = {
  ...common,
  id: 'services',
  name: 'Services',
  blurb: 'Police, clinic, hospital',
  hotkey: 'd',
  footprint: [[0, 0]],
  levels: [
    {
      name: 'Service post',
      stats: { jobs: 4 },
      coverage: 4,
      agents: 1,
      yards: ['parking', 'plaza'],
      draw(g) {
        const x = -0.24, y = -0.18, w = 0.48, d = 0.36, h = 0.2;
        g.roofed(x, y, 0, w, d, h, { h: 0.12, hip: 0.1 });
        garageDoor(g, -0.18, y);
        cross(g, 0.12, y, 0.12);
        flagpole(g, 0.3, -0.3, 0.42);
      },
    },
    {
      name: 'Station',
      stats: { jobs: 10 },
      coverage: 5,
      agents: 2,
      yards: ['parking', 'plaza'],
      grow: { requires: [{ type: 'residential', count: 6, radius: 5 }] },
      draw(g) {
        // fire station: gabled garage hall and a hose-drying tower
        const y = -0.2, d = 0.4, h = 0.3;
        g.roofed(-0.34, y, 0, 0.5, d, h, { h: 0.14 });
        g.windows(-0.34, y, 0.5, d, h / 2, h, h / 2, 0.09, { skip: ['front'] });
        garageDoor(g, -0.3, y);
        garageDoor(g, -0.14, y);
        g.roofed(0.18, -0.06, 0, 0.13, 0.13, 0.66, { h: 0.1, hip: 0.065 }); // tower
        g.windows(0.18, -0.06, 0.13, 0.13, 0.5, 0.64, 0.14, 0.06);
      },
    },
    {
      name: 'Clinic',
      stats: { jobs: 18 },
      coverage: 6,
      agents: 3,
      yards: ['plaza', 'parking'],
      grow: {
        requires: [
          { type: 'residential', count: 12, radius: 6 },
          { type: 'residential', count: 4, radius: 6, minLevel: 2 },
        ],
      },
      draw(g) {
        // polyclinic: ribbon windows, glazed stair tower
        const x = -0.3, y = -0.2, w = 0.6, d = 0.4, fh = 0.13, h = fh * 4;
        g.box(x, y, 0, w, d, h);
        g.windows(x, y, w, d, 0, h, fh, 0.1, { ribbon: true });
        g.box(x - 0.02, y - 0.02, h, w + 0.04, d + 0.04, 0.02);
        g.box(0.12, y - 0.1, 0, 0.12, 0.1, h + 0.05);
        g.mullions(0.12, y - 0.1, 0.12, 0.1, 0, h + 0.05, 0.04);
        cross(g, -0.12, y, h * 0.6, 0.05);
      },
    },
  ],
};

export const large = {
  ...common,
  id: 'services-large',
  name: 'Large services',
  footprint: [[0, 0], [1, 0], [0, 1], [1, 1]],
  levels: [
    {
      name: 'Service station',
      stats: { jobs: 14 },
      coverage: 6,
      agents: 2,
      yards: ['parking'],
      draw(g) {
        const y = -0.3;
        g.roofed(-0.3, y, 0, 1.25, 0.75, 0.3, { h: 0.16, hip: 0.14 });
        g.windows(-0.3, y, 1.25, 0.75, 0, 0.3, 0.3, 0.12, { skip: ['front'], h: 0.4 });
        for (const x of [-0.2, 0.15, 0.5]) garageDoor(g, x, y, 0.22, 0.2);
        g.roofed(1.02, y, 0, 0.36, 0.45, 0.42, { h: 0.12, hip: 0.1 });
        g.windows(1.02, y, 0.36, 0.45, 0, 0.42, 0.14, 0.09);
        g.roofed(-0.28, 0.6, 0, 0.14, 0.14, 0.8, { h: 0.12, hip: 0.07 }); // hose tower
        flagpole(g, 1.25, 1.2, 0.5);
      },
    },
    {
      name: 'Service centre',
      stats: { jobs: 30 },
      coverage: 8,
      agents: 3,
      yards: ['parking', 'plaza'],
      grow: { requires: [{ type: 'residential', count: 10, radius: 7 }] },
      draw(g) {
        if (g.chance(0.4)) {
          // 60s pavilion school: a two-storey classroom wing along the back
          // with ribbon windows, the entrance hall in front of it, the gym
          // hall with tall windows, a playground with a pitch
          const fh = 0.13;
          g.box(-0.32, 0.72, 0, 1.64, 0.4, fh * 2);
          g.windows(-0.32, 0.72, 1.64, 0.4, 0, fh * 2, fh, 0.1, { ribbon: true });
          g.box(-0.34, 0.7, fh * 2, 1.68, 0.44, 0.02);
          g.box(0.35, 0.36, 0, 0.5, 0.36, fh);                   // entrance hall
          g.mullions(0.35, 0.36, 0.5, 0.36, 0, fh, 0.05, { skip: ['back'] });
          g.box(0.33, 0.34, fh, 0.54, 0.38, 0.015);
          g.box(-0.32, -0.3, 0, 0.6, 0.9, 0.3);                  // gym hall
          g.windows(-0.32, -0.3, 0.6, 0.9, 0.08, 0.3, 0.22, 0.12, { skip: ['front', 'back'], w: 0.4, h: 0.8 });
          g.box(-0.34, -0.32, 0.3, 0.64, 0.94, 0.02);
          pitch(g, 0.45, -0.34, 1.34, 0.22);
          flagpole(g, 0.95, 0.4, 0.45);
          tree(g, 1.25, 0.45, 1);
          return;
        }
        g.box(-0.3, 0.32, 0, 1.6, 1.0, 0.6);
        g.windows(-0.3, 0.32, 1.6, 1.0, 0, 0.6, 0.15, 0.1, { ribbon: true });
        g.box(-0.32, 0.3, 0.6, 1.64, 1.04, 0.02);
        g.box(-0.3, -0.32, 0, 1.15, 0.58, 0.28);
        g.windows(-0.3, -0.32, 1.15, 0.58, 0, 0.28, 0.28, 0.12, { skip: ['front'], h: 0.4 });
        for (const x of [-0.22, 0.12]) garageDoor(g, x, -0.32, 0.22, 0.2);
        cross(g, 0.62, -0.32, 0.14, 0.06);
        g.roofed(1.0, -0.3, 0, 0.16, 0.16, 0.9, { h: 0.14, hip: 0.08 }); // hose tower
      },
    },
    {
      name: 'Hospital',
      stats: { jobs: 60 },
      coverage: 10,
      agents: 3,
      yards: ['plaza', 'parking'],
      grow: {
        requires: [
          { type: 'residential', count: 20, radius: 8 },
          { type: 'residential', count: 6, radius: 8, minLevel: 2 },
        ],
      },
      draw(g) {
        // hipped pavilions around a taller main block
        const fh = 0.13;
        g.roofed(-0.3, -0.05, 0, 1.6, 0.42, fh * 3, { h: 0.14, hip: 0.14 });
        g.windows(-0.3, -0.05, 1.6, 0.42, 0, fh * 3, fh, 0.09);
        g.roofed(0.2, 0.55, 0, 0.6, 0.8, fh * 6, { h: 0.16, hip: 0.16 });
        g.windows(0.2, 0.55, 0.6, 0.8, 0, fh * 6, fh, 0.09);
        g.roofed(-0.3, 0.55, 0, 0.36, 0.8, fh * 2, { h: 0.12, hip: 0.1 });
        g.windows(-0.3, 0.55, 0.36, 0.8, 0, fh * 2, fh, 0.09);
        g.roofed(0.94, 0.55, 0, 0.36, 0.8, fh * 2, { h: 0.12, hip: 0.1 });
        g.windows(0.94, 0.55, 0.36, 0.8, 0, fh * 2, fh, 0.09);
        cross(g, 0.5, -0.05, 0.25, 0.07);
        // entrance canopy on posts
        g.box(0.2, -0.32, 0.16, 0.6, 0.25, 0.025);
        g.line([[0.22, -0.3, 0], [0.22, -0.3, 0.16]]);
        g.line([[0.78, -0.3, 0], [0.78, -0.3, 0.16]]);
      },
    },
  ],
};
