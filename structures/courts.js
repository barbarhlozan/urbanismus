// Courts (dvůr): the walled yard of a village house, as at Jestřebice near
// Bernartice – a rubble-stone wall in line with the house front with a
// plank gate (vrata) and a small door (branka) in it, and a wooden shed
// (kůlna) across the back. It is not part of the building: the renderer
// draws it beside it like the front yard (Renderer.paintStructure), and it
// is always closed – by houses, wall and shed – never a wall running off.
//
//   shared   between two neighbouring houses (they join, see joinSides in
//            structures/index.js): each draws its half up to x = ±0.5, the
//            gate in the left one's half, the branka in the right one's
//   own      beside a house standing on its own, inside its dot: the front
//            wall with the gate, a short side wall, the shed closing the back
//
// A type opts in with `court: { own }` (the chance of an own court) and a
// `join` group for the shared ones. Its draw reads g.court (what courtOf
// gives) to put its yard door that side, and leaves g.body = { x0, y0, x1,
// y1 } – its walls, local – for the court to meet.

import { mulberry32 } from '../src/core/random.js';
import { wooden } from './kit.js';

const WALL_H = 0.085, WALL_D = 0.03;
const GATE_H = 0.1;
// a shared court's front wall and shed, the same for both halves so they meet
const SHARED_FRONT = -0.14, SHED_D = 0.13, SHED_H = 0.08, SHED_ROOF = 0.055;
const OWN_TO = 0.44; // how far out an own court reaches (inside the dot)

// What courts a structure has: { left, right }, each 'shared', 'own' or null.
// `join` is joinSides(world, s); `others` (dir) is true where a house of
// the same group stands next door without joining (no own court that way).
export function courtOf(def, s, seed, join, others) {
  if (!def.court) return { left: null, right: null };
  if (join.left || join.right) return { left: join.left ? 'shared' : null, right: join.right ? 'shared' : null };
  const rnd = mulberry32((seed ^ 0xc0a7) >>> 0);
  if (rnd() >= (def.court.own ?? 0)) return { left: null, right: null };
  const sides = [-1, 1].filter((d) => !others(d));
  if (!sides.length) return { left: null, right: null };
  const dir = sides[Math.floor(rnd() * sides.length)];
  return { left: dir < 0 ? 'own' : null, right: dir > 0 ? 'own' : null };
}

// The side (-1 / 1) a court is on, or null: where a house puts its yard door.
export function courtSide(court) {
  if (!court) return null;
  if (court.right) return 1;
  if (court.left) return -1;
  return null;
}

// A wall WALL_H high along x from xa to xb on the line y, its thickness
// towards +y.
function wallX(g, xa, xb, y) {
  if (Math.abs(xb - xa) < 0.005) return;
  const [a, b] = xa < xb ? [xa, xb] : [xb, xa];
  g.prism([[a, y], [b, y], [b, y + WALL_D], [a, y + WALL_D]], 0, WALL_H);
}

// The same along y, at x, its thickness inwards (towards -dir).
function wallY(g, x, ya, yb, dir) {
  if (yb - ya < 0.005) return;
  const [a, b] = dir > 0 ? [x - WALL_D, x] : [x, x + WALL_D];
  g.prism([[a, ya], [b, ya], [b, yb], [a, yb]], 0, WALL_H);
}

// A plank gate (or a branka, narrower) between xa and xb in the wall on y.
function gate(g, xa, xb, y, h = GATE_H) {
  const [a, b] = xa < xb ? [xa, xb] : [xb, xa];
  g.box(a, y + 0.005, 0, b - a, 0.015, h);
  g.detailed(2, () => {
    for (let x = a + 0.022; x < b - 0.01; x += 0.022) g.line([[x, y + 0.005, 0.008], [x, y + 0.005, h - 0.008]], { facing: [0, -1, 0] });
  });
}

// The kůlna across the back, from xa to xb, its back on y1.
function shed(g, xa, xb, y1) {
  const [a, b] = xa < xb ? [xa, xb] : [xb, xa];
  wooden(g, () => g.gable(a, y1 - SHED_D, 0, b - a, SHED_D, SHED_H, SHED_ROOF));
}

// Draw the courts of `court` beside a house whose walls are `body`.
// Returns the courts' ground outlines (local), for the plot to keep out of.
export function drawCourt(g, court, body) {
  const out = [];
  for (const dir of [-1, 1]) {
    const kind = dir < 0 ? court.left : court.right;
    if (!kind) continue;
    const e = dir > 0 ? body.x1 : -body.x0; // the house's side wall, out from the middle
    const X = (u) => dir * u;
    if (kind === 'shared') {
      const f = SHARED_FRONT, back = SHED_D + 0.07;
      if (dir > 0) {
        // the gate's half: wall, the vrata, wall to the middle
        const gb = 0.47, ga = Math.max(e + 0.03, gb - 0.17);
        wallX(g, e, ga, f);
        gate(g, ga, gb, f);
        wallX(g, gb, 0.5, f);
      } else {
        // the branka's half
        const ba = 0.4, bb = 0.35;
        wallX(g, -0.5, -ba, f);
        if (e < bb - 0.02) {
          gate(g, -ba, -bb, f, GATE_H - 0.005);
          wallX(g, -bb, -e, f);
        } else wallX(g, -ba, -e, f);
      }
      shed(g, X(e + 0.005), X(0.5), back);
      out.push([[X(e), f], [X(0.5), f], [X(0.5), back], [X(e), back]]);
    } else {
      // own: front wall with the gate, the far side wall, the shed at the back
      const f = body.y0 + 0.012, back = body.y1, far = OWN_TO;
      const gw = Math.min(0.16, far - e - 0.06), ga = e + 0.04;
      wallX(g, X(e), X(ga), f);
      gate(g, X(ga), X(ga + gw), f);
      wallX(g, X(ga + gw), X(far), f);
      wallY(g, X(far), f, back - SHED_D, dir);
      shed(g, X(e + 0.005), X(far), back);
      out.push([[X(e), f], [X(far), f], [X(far), back], [X(e), back]]);
    }
  }
  return out;
}
