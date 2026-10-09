// Services: the fire brigade, the police (VB), health care and the school,
// 1×1 and 2×2, each its own thing to build. A village fire house with its
// siren, a town fire station with a hose-drying tower, a police post, a
// health centre, a polyclinic with ribbon windows, a hospital of hipped
// pavilions and a 60s pavilion school with its gym hall and playground.

import { door, panel, pitch, tree, bench, bikeRack, FRAME } from './kit.js';

const FRONT = [0, -1, 0];

function garageDoor(g, x, y, w = 0.12, h = 0.14) {
  g.line([[x, y, 0], [x, y, h], [x + w, y, h], [x + w, y, 0]], { facing: FRONT });
}

// Plus sign on the front wall.
function cross(g, x, y, z, s = 0.05) {
  g.line([[x - s, y, z], [x + s, y, z]], { facing: FRONT });
  g.line([[x, y, z - s], [x, y, z + s]], { facing: FRONT });
}

// Air-raid siren on a short pole standing on a roof at height z: the
// mushroom-shaped horn every village had on its fire house.
function siren(g, x, y, z, pole = 0.08) {
  g.detailed(1, () => {
    g.solid(x, y, z + pole / 2);
    g.line([[x, y, z], [x, y, z + pole]]);
  });
  g.lathe(x, y, z + pole, [[0.012, 0], [0.028, 0.012], [0.028, 0.022], [0.012, 0.03], [0, 0.034]], 8);
}

// Hose-drying tower, s square, h to the eaves: a closed shaft, an open
// louvred top where the hoses hang (corner posts and slats), a hipped cap.
function hoseTower(g, x, y, s, h) {
  const open = 0.08;
  g.box(x, y, 0, s, s, h - open);
  g.windows(x, y, s, s, 0.1, h - open, 0.16, s * 0.8, { w: 0.3, h: 0.35 });
  g.detailed(1, () => {
    g.solid(x + s / 2, y + s / 2, h - open / 2);
    for (const [px, py] of [[x, y], [x + s, y], [x + s, y + s], [x, y + s]]) g.line([[px, py, h - open], [px, py, h]], FRAME);
    g.detailed(2, () => {
      for (const z of [h - open * 0.66, h - open * 0.33]) g.line([[x, y, z], [x + s, y, z], [x + s, y + s, z], [x, y + s, z], [x, y, z]]);
    });
  });
  g.roofed(x - 0.01, y - 0.01, h, s + 0.02, s + 0.02, 0.005, { h: s * 0.7, hip: (s + 0.02) / 2 });
}

// Fire pond (požární nádrž): a concrete-rimmed rectangle of water.
function firePond(g, x0, y0, x1, y1) {
  g.groundPoly([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
  g.groundPoly([[x0 + 0.03, y0 + 0.03], [x1 - 0.03, y0 + 0.03], [x1 - 0.03, y1 - 0.03], [x0 + 0.03, y1 - 0.03]], { fill: 'url(#hatch-water)' });
}

const common = {
  access: 'any', // a footpath will do
  category: 'amenities',
  code: 'S',
  sim: { destinations: ['residential'] },
  plot: { props: 'green', boundary: 0.4, kinds: ['fence', 'hedge'], density: 0.3 },
};

// ----- 1×1 -----

// Village fire house (hasičská zbrojnice): a gabled garage for the pump,
// the siren on the ridge, a bench for the old men by the door.
export const fireHouse = {
  ...common,
  id: 'fire-house',
  name: 'Fire station',
  blurb: 'Fire engines and the siren',
  size: 'Village',
  tags: ['services', 'fire'],
  footprint: [[0, 0]],
  stats: { jobs: 4 },
  agents: 1,
  yards: ['parking', 'plaza'],
  draw(g) {
    const w = g.range(0.36, 0.42), d = 0.4, y = -0.2, h = 0.2, r = g.range(0.14, 0.17);
    g.roofed(-w / 2 - 0.06, y, 0, w, d, h, { h: r, ridge: 'y' });
    g.windows(-w / 2 - 0.06, y, w, d, 0, h, h, 0.1, { skip: ['front'], h: 0.4 });
    garageDoor(g, -w / 2 + 0.02, y, w - 0.16, 0.15);
    panel(g, -0.12, 0.0, y, h + 0.02, h + 0.06);                   // name board in the gable
    siren(g, -0.06, 0.08, h + r * 0.85);
    bench(g, w / 2 + 0.06, -0.12, false, 1);
  },
};

// Town fire station: the engine hall with its doors to the street, a
// flat-roofed crew wing, the hose-drying tower at the back with its louvred
// top, the siren on the roof.
export const fireStation = {
  ...common,
  id: 'fire-station',
  name: 'Fire station',
  blurb: 'Fire engines and the siren',
  size: 'Town',
  tags: ['services', 'fire'],
  footprint: [[0, 0]],
  stats: { jobs: 10 },
  agents: 2,
  yards: ['parking', 'plaza'],
  draw(g) {
    const y = -0.22, d = 0.36, h = 0.26, doors = g.int(2, 3);
    const hw = doors === 3 ? 0.5 : 0.4, x0 = -0.36, x1 = x0 + hw;
    if (g.chance(0.5)) g.roofed(x0, y, 0, hw, d, h, { h: 0.12 });
    else {
      g.box(x0, y, 0, hw, d, h);
      g.box(x0 - 0.015, y - 0.02, h, hw + 0.03, d + 0.035, 0.02);
    }
    g.windows(x0, y, hw, d, h * 0.55, h, h * 0.45, 0.09, { skip: ['front', 'right'] });
    const dw = (hw - 0.04) / doors;
    for (let i = 0; i < doors; i++) garageDoor(g, x0 + 0.02 + i * dw + 0.01, y, dw - 0.02, 0.17);
    const fh = 0.13, ww = 0.36 - x1;
    g.box(x1, y + 0.04, 0, ww, 0.26, fh * 2);                        // crew wing
    g.windows(x1, y + 0.04, ww, 0.26, 0, fh * 2, fh, 0.08, { ribbon: true, skip: ['left'] });
    g.box(x1 - 0.01, y + 0.03, fh * 2, ww + 0.02, 0.28, 0.015);
    door(g, x1 + ww / 2, y + 0.04, 0.05, 0.1);
    siren(g, x1 + ww / 2, y + 0.18, fh * 2 + 0.015);
    hoseTower(g, 0.2, 0.18, 0.14, g.range(0.62, 0.72));
  },
};

// Police post (VB): a two-storey house under a hipped roof, a porch and
// the sign board over the door, bikes by the wall.
export const police = {
  ...common,
  id: 'police',
  name: 'Police post',
  blurb: 'Veřejná bezpečnost',
  tags: ['services', 'police'],
  footprint: [[0, 0]],
  stats: { jobs: 4 },
  agents: 1,
  yards: ['parking', 'plaza'],
  draw(g) {
    const x = -0.24, y = -0.18, w = 0.48, d = 0.36, fh = 0.14, h = fh * 2;
    g.roofed(x, y, 0, w, d, h, { h: 0.11, hip: 0.12 });
    g.windows(x, y, w, d, 0, h, fh, 0.1, { h: 0.45 });
    g.box(-0.08, y - 0.07, 0, 0.16, 0.07, 0.012);                   // steps
    g.box(-0.09, y - 0.08, fh * 0.8, 0.18, 0.08, 0.012);            // porch roof
    door(g, 0, y, 0.06, fh * 0.75);
    panel(g, -0.07, 0.07, y, fh * 0.85, fh * 0.98);                 // sign board
    bikeRack(g, 0.12, 0.3, y - 0.1);
  },
};

// Health centre (zdravotní středisko): a flat-roofed 60s pavilion, a band
// of windows, the entrance under a canopy, the cross.
export const healthCentre = {
  ...common,
  id: 'health-centre',
  name: 'Health centre',
  blurb: 'The doctor and the dentist',
  tags: ['services', 'health'],
  footprint: [[0, 0]],
  stats: { jobs: 4 },
  agents: 1,
  yards: ['parking', 'plaza'],
  draw(g) {
    const x = -0.3, y = -0.16, w = 0.6, d = 0.34, h = 0.17;
    g.box(x, y, 0, w, d, h);
    g.windows(x, y, w, d, 0, h, h, 0.1, { ribbon: true, h: 0.45 });
    g.box(x - 0.02, y - 0.02, h, w + 0.04, d + 0.04, 0.018);
    g.box(-0.2, y - 0.1, h - 0.03, 0.2, 0.1, 0.015);                // canopy
    g.detailed(1, () => {
      g.solid(-0.1, y - 0.09, h / 2);
      for (const px of [-0.19, -0.01]) g.line([[px, y - 0.09, 0], [px, y - 0.09, h - 0.03]]);
    });
    door(g, -0.1, y, 0.07, 0.11);
    cross(g, 0.15, y, 0.11, 0.035);
    bench(g, 0.15, y - 0.1, true, -1);
  },
};

// Polyclinic: ribbon windows, a glazed stair tower.
export const clinic = {
  ...common,
  id: 'clinic',
  name: 'Polyclinic',
  blurb: 'Doctors of every kind',
  tags: ['services', 'health'],
  footprint: [[0, 0]],
  stats: { jobs: 18 },
  agents: 3,
  yards: ['plaza', 'parking'],
  draw(g) {
    const x = -0.3, y = -0.2, w = 0.6, d = 0.4, fh = 0.13, h = fh * 4;
    g.box(x, y, 0, w, d, h);
    g.windows(x, y, w, d, 0, h, fh, 0.1, { ribbon: true });
    g.box(x - 0.02, y - 0.02, h, w + 0.04, d + 0.04, 0.02);
    g.box(0.12, y - 0.1, 0, 0.12, 0.1, h + 0.05);
    g.mullions(0.12, y - 0.1, 0.12, 0.1, 0, h + 0.05, 0.04);
    cross(g, -0.12, y, h * 0.6, 0.05);
  },
};

// ----- 2×2 -----

// District fire station: a hipped engine hall with three doors, the crew
// house beside it, the hose tower; the drill yard behind.
export const fireStationLarge = {
  ...common,
  id: 'fire-station-large',
  name: 'Fire station',
  blurb: 'Fire engines and the siren',
  size: 'Large',
  tags: ['services', 'fire'],
  footprint: [[0, 0], [1, 0], [0, 1], [1, 1]],
  stats: { jobs: 14 },
  agents: 2,
  yards: ['parking'],
  draw(g) {
    const y = -0.3;
    g.roofed(-0.3, y, 0, 1.25, 0.75, 0.3, { h: 0.16, hip: 0.14 });
    g.windows(-0.3, y, 1.25, 0.75, 0, 0.3, 0.3, 0.12, { skip: ['front'], h: 0.4 });
    for (const x of [-0.2, 0.15, 0.5]) garageDoor(g, x, y, 0.22, 0.2);
    g.roofed(1.02, y, 0, 0.36, 0.45, 0.42, { h: 0.12, hip: 0.1 });
    g.windows(1.02, y, 0.36, 0.45, 0, 0.42, 0.14, 0.09);
    hoseTower(g, -0.3, 0.6, 0.16, 0.8);
    siren(g, 0.3, 0.1, 0.3 + 0.12);
    // the drill yard behind: a fire pond, a training wall
    firePond(g, 0.55, 0.75, 1.3, 1.3);
    g.box(-0.05, 1.05, 0, 0.35, 0.05, 0.3);
    g.windows(-0.05, 1.05, 0.35, 0.05, 0.05, 0.3, 0.1, 0.1, { skip: ['left', 'right'], h: 0.6 });
  },
};

// Hospital: hipped pavilions around a taller main block.
export const hospital = {
  ...common,
  id: 'hospital',
  name: 'Hospital',
  blurb: 'Wards around a main block',
  tags: ['services', 'health'],
  footprint: [[0, 0], [1, 0], [0, 1], [1, 1]],
  stats: { jobs: 60 },
  agents: 3,
  yards: ['plaza', 'parking'],
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
};

// 60s pavilion school: a two-storey classroom wing along the back with
// ribbon windows, the entrance hall in front of it, the gym hall with tall
// windows, a playground with a pitch.
export const school = {
  ...common,
  id: 'school',
  name: 'School',
  blurb: 'Classrooms, gym and playground',
  tags: ['services', 'school'],
  footprint: [[0, 0], [1, 0], [0, 1], [1, 1]],
  stats: { jobs: 30 },
  agents: 3,
  yards: ['parking', 'plaza'],
  draw(g) {
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
    bench(g, 0.95, 0.3, true, -1);
    tree(g, 1.25, 0.45, 1);
  },
};
