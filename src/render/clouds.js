// The sky of a photograph: clouds drawn with the same pen as the map – bumpy
// outlines filled with paper, a few strokes under them. cloudsSVG() returns
// SVG for the part of the picture above the horizon; the terrain's skyline is
// drawn after it, so a hill hides the low clouds behind it.
//
// Depth without 3D: a cloud high in the picture is overhead, so big and
// spread out; one near the horizon is far away, so small, flat and packed
// closer. Everything is drawn far to near, i.e. from the horizon upwards.

export const CLOUD_KINDS = ['fair', 'cloudy', 'overcast', 'rain', 'storm'];

export const CLOUDS = {
  // heaps (fair, cloudy): how many, and how wide at the horizon and overhead
  heaps: { fair: [2, 3], cloudy: [8, 12] },
  width: [34, 190],
  flat: [0.16, 0.4],      // a heap's height as a share of its width, far to near
  // strata (cloudy's long layer near the horizon, overcast, rain)
  layers: { cloudy: 1, overcast: 3, rain: 4, storm: 5 },
  scallop: [30, 90],      // width of one bulge on a layer's lower edge, far to near
  // under-strokes: per unit of a heap's width / per scallop
  underHeap: 0.05,
  underScallop: { overcast: 0.3, rain: 0.7, storm: 1.3 },
  rain: {
    whole: 70,            // strokes across the whole sky
    storm: 170,           // the same in a storm (always all over)
    showers: [2, 3],      // distant showers, and strokes in each
    perShower: 26,
    slant: 0.22,          // sideways per downwards
  },
};

const r2 = (n) => Math.round(n * 100) / 100;
const P = (x, y) => `${r2(x)} ${r2(y)}`;
const lerp = (a, b, t) => a + (b - a) * t;
const between = (rnd, [a, b]) => a + rnd() * (b - a);
const whole = (rnd, [a, b]) => a + Math.floor(rnd() * (b - a + 1));

// A heap of cloud: a flat base at `by` from x0 to x1, a row of bulges over
// it, tallest in the middle. Returns the outline path.
function heap(rnd, x0, x1, by, h) {
  const w = x1 - x0;
  const bumps = 3 + whole(rnd, [0, 2]) + Math.floor(w / 45);
  const ts = [0];
  for (let i = 1; i < bumps; i++) ts.push((i + (rnd() - 0.5) * 0.5) / bumps);
  ts.push(1);
  let d = `M${P(x0, by)}`;
  for (let i = 0; i < bumps; i++) {
    const xa = x0 + w * ts[i], xb = x0 + w * ts[i + 1];
    const yb = i + 1 === bumps ? by : by - h * 0.5 * Math.pow(Math.sin(Math.PI * ts[i + 1]), 0.7) * (0.8 + rnd() * 0.4);
    const chord = Math.hypot(xb - xa, yb - (i ? by - h * 0.5 * Math.pow(Math.sin(Math.PI * ts[i]), 0.7) : by));
    const r = (chord / 2) * (1.05 + rnd() * 0.45);
    d += `A${r2(r)} ${r2(r)} 0 0 1 ${P(xb, yb)}`;
  }
  // the base, a little uneven
  d += `Q${P(x0 + w * 0.6, by + 1 + rnd() * 2)} ${P(x0 + w * 0.3, by - rnd())}T${P(x0, by)}Z`;
  return d;
}

// Short strokes along the underside of a heap, leaning one way.
function underHeap(rnd, x0, x1, by, h) {
  const n = Math.round((x1 - x0) * CLOUDS.underHeap * (0.6 + rnd()));
  let d = '';
  for (let i = 0; i < n; i++) {
    const x = lerp(x0 + (x1 - x0) * 0.1, x1 - (x1 - x0) * 0.1, rnd());
    const l = h * (0.12 + rnd() * 0.15);
    d += `M${P(x, by - 1.5 - rnd() * h * 0.08)}l${r2(l * 0.7)} ${r2(-l)}`;
  }
  return d;
}

// A layer: a lower edge of bulges hanging down across the whole picture,
// the paper above it so it covers what lies behind. `strokes` of the hanging
// kind (per scallop) go under the edge.
function layer(rnd, width, by, scallop, strokes) {
  const x0 = -12, x1 = width + 12;
  let x = x0, d = `M${P(x, by)}`, under = '';
  while (x < x1) {
    const w = scallop * (0.7 + rnd() * 0.6), xb = x + w;
    const y = by + (rnd() - 0.5) * scallop * 0.12;
    const r = (w / 2) * (1.05 + rnd() * 0.4);
    d += `A${r2(r)} ${r2(r)} 0 0 0 ${P(xb, y)}`;
    if (rnd() < strokes) {
      const n = 1 + whole(rnd, [0, Math.round(strokes * 2)]);
      for (let i = 0; i < n; i++) {
        const sx = x + w * (0.2 + rnd() * 0.6), sy = y + r * 0.45 + rnd() * 2, l = scallop * (0.12 + rnd() * 0.18);
        under += `M${P(sx, sy)}l${r2(-l * 0.5)} ${r2(l)}`;
      }
    }
    x = xb;
  }
  return {
    fill: `${d}L${P(x, by - 400)}L${P(x0, by - 400)}Z`,
    edge: d,
    under,
  };
}

// Slanted strokes from (x, y0) to the ground, `n` of them over `spread` px.
function streaks(rnd, n, xc, spread, y0, y1) {
  const { slant } = CLOUDS.rain;
  let d = '';
  for (let i = 0; i < n; i++) {
    const x = xc + (rnd() - 0.5) * spread, ya = y0 + rnd() * (y1 - y0) * 0.5;
    const len = (y1 - ya) * (0.3 + rnd() * 0.5);
    d += `M${P(x, ya)}l${r2(-len * slant)} ${r2(len)}`;
  }
  return d;
}

// `kind`: one of CLOUD_KINDS. `rain` (only for 'rain'): 'showers' – a few
// distant ones under the cloud – or 'whole' – rain all over the sky. A
// storm is the heaviest cloud with rain all over.
export function cloudsSVG(rnd, width, height, kind, { rain = 'showers' } = {}) {
  const horizon = height / 2;
  const pen = (cls, d) => (d ? `<path class="${cls}" d="${d}"/>` : '');
  let out = '';

  // layers, far to near
  const count = CLOUDS.layers[kind];
  if (count) {
    const top = kind === 'cloudy' ? horizon * 0.8 : horizon * 0.12;
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0 : i / (count - 1);
      const by = horizon - 6 - t * (horizon - 6 - top);
      const l = layer(rnd, width, by, lerp(CLOUDS.scallop[0], CLOUDS.scallop[1], t), CLOUDS.underScallop[kind] ?? 0.08);
      out += pen('photo-cloud-fill', l.fill) + pen('photo-cloud-edge', l.edge) + pen('photo-cloud-under', l.under);
    }
    if (kind === 'storm') {
      // rain all over, hard, and slanting with the wind
      out += pen('photo-rain', streaks(rnd, CLOUDS.rain.storm, width / 2, width * 1.3, 4, horizon * 0.98));
    } else if (kind === 'rain') {
      const { rain: R } = CLOUDS;
      const y0 = horizon * 0.55;
      if (rain === 'whole') {
        out += pen('photo-rain', streaks(rnd, R.whole, width / 2, width * 1.2, 4, horizon * 0.95));
      } else {
        const n = whole(rnd, R.showers);
        let d = '';
        for (let i = 0; i < n; i++) d += streaks(rnd, R.perShower, lerp(width * 0.1, width * 0.9, rnd()), 30 + rnd() * 50, y0 - rnd() * 10, horizon - 2);
        out += pen('photo-rain', d);
      }
    }
  }
  // heaps, far (near the horizon) to near (high up)
  const heaps = CLOUDS.heaps[kind];
  if (heaps) {
    const n = whole(rnd, heaps);
    const ts = Array.from({ length: n }, () => Math.pow(rnd(), 0.9)).sort((a, b) => a - b);
    for (const t of ts) {
      const w = lerp(CLOUDS.width[0], CLOUDS.width[1], t) * (0.7 + rnd() * 0.6);
      const h = w * lerp(CLOUDS.flat[0], CLOUDS.flat[1], t) * (1.4 - 0.7 * rnd()) * 1.4;
      const by = horizon - 3 - t * (horizon - 24 - h);
      const x0 = -w * 0.4 + rnd() * (width - w * 0.2);
      out += pen('photo-cloud', heap(rnd, x0, x0 + w, by, h)) + pen('photo-cloud-under', underHeap(rnd, x0, x0 + w, by, h));
    }
  }

  return out;
}
