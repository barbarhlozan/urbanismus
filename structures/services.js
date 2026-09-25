// Services (police, fire and health in one): 1×1 and 2×2.
// Each level covers a radius (`coverage`, in dots). Top-level homes,
// businesses and industry need to be inside some service coverage.

const FRONT = [0, -1, 0];

function garageDoor(g, x, y, w = 0.12, h = 0.14) {
  g.line([[x, y, 0], [x, y, h], [x + w, y, h], [x + w, y, 0]], { facing: FRONT });
}

// Plus sign on the front wall.
function cross(g, x, y, z, s = 0.05) {
  g.line([[x - s, y, z], [x + s, y, z]], { facing: FRONT });
  g.line([[x, y, z - s], [x, y, z + s]], { facing: FRONT });
}

// "H" helipad on a roof at height z.
function helipad(g, x, y, z, s = 0.12) {
  g.line([[x - s, y - s, z], [x + s, y - s, z], [x + s, y + s, z], [x - s, y + s, z], [x - s, y - s, z]]);
  g.line([[x - s * 0.5, y - s * 0.6, z], [x - s * 0.5, y + s * 0.6, z]]);
  g.line([[x + s * 0.5, y - s * 0.6, z], [x + s * 0.5, y + s * 0.6, z]]);
  g.line([[x - s * 0.5, y, z], [x + s * 0.5, y, z]]);
}

function flag(g, x, y, h) {
  g.solid(x, y, h / 2);
  g.line([[x, y, 0], [x, y, h]]);
  g.shape(x, y, h - 0.06, [[0, 0], [0.09, 0.03], [0, 0.06]]);
}

const common = {
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
  hotkey: '8',
  footprint: [[0, 0]],
  levels: [
    {
      name: 'Service post',
      stats: { jobs: 4 },
      coverage: 4,
      agents: 1,
      yards: ['parking', 'plaza'],
      draw(g) {
        const x = -0.24, y = -0.18, w = 0.48, d = 0.36, h = 0.22;
        g.box(x, y, 0, w, d, h);
        garageDoor(g, -0.18, y);
        cross(g, 0.12, y, 0.12);
        flag(g, 0.3, 0.12, 0.42);
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
        const y = -0.2, d = 0.4, h = 0.3;
        g.box(-0.32, y, 0, 0.5, d, h);
        g.floors(-0.32, y, 0.5, d, 0, h, h / 2);
        garageDoor(g, -0.28, y);
        garageDoor(g, -0.12, y);
        g.box(0.18, -0.05, 0, 0.12, 0.12, 0.62); // tower
        cross(g, 0.06, y, 0.22, 0.04);
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
        const x = -0.3, y = -0.23, w = 0.6, d = 0.46, h = 0.5;
        g.box(x, y, 0, w, d, h);
        g.floors(x, y, w, d, 0, h, h / 3);
        cross(g, 0, y, h * 0.55, 0.06);
        garageDoor(g, -0.25, y, 0.1, 0.12);
        helipad(g, 0, 0, h, 0.12);
      },
    },
  ],
};

export const large = {
  ...common,
  id: 'services-large',
  name: 'Large services',
  hotkey: '9',
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
        g.box(-0.3, y, 0, 1.25, 0.75, 0.3);
        for (const x of [-0.2, 0.15, 0.5]) garageDoor(g, x, y, 0.22, 0.2);
        g.box(1.02, y, 0, 0.36, 0.45, 0.42);
        g.floors(1.02, y, 0.36, 0.45, 0, 0.42, 0.21);
        g.box(-0.28, 0.6, 0, 0.14, 0.14, 0.85); // tower
        flag(g, 1.25, 1.2, 0.5);
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
        g.box(-0.3, 0.32, 0, 1.6, 1.0, 0.6);
        g.floors(-0.3, 0.32, 1.6, 1.0, 0, 0.6, 0.2);
        g.box(-0.3, -0.32, 0, 1.15, 0.58, 0.28);
        for (const x of [-0.22, 0.12]) garageDoor(g, x, -0.32, 0.22, 0.2);
        cross(g, 0.62, -0.32, 0.14, 0.06);
        g.box(1.0, -0.3, 0, 0.16, 0.16, 0.95); // tower
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
        g.box(-0.32, -0.05, 0, 1.64, 1.37, 0.4);
        g.floors(-0.32, -0.05, 1.64, 1.37, 0, 0.4, 0.13);
        g.box(0.0, 0.25, 0.4, 1.0, 0.85, 0.75);
        g.floors(0.0, 0.25, 1.0, 0.85, 0.4, 1.15, 0.125);
        helipad(g, 0.5, 0.68, 1.15, 0.16);
        cross(g, 0.5, -0.05, 0.25, 0.07);
        // entrance canopy on posts
        g.box(0.2, -0.32, 0.16, 0.6, 0.25, 0.025);
        g.line([[0.22, -0.3, 0], [0.22, -0.3, 0.16]]);
        g.line([[0.78, -0.3, 0], [0.78, -0.3, 0.16]]);
      },
    },
  ],
};
