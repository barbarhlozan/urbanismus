// The paper's tooth as a picture, for what the shaders don't draw: the
// photos (ui/photoBrush.js), the UI's drawings (ui/sketchFrame.js) and the
// fire (fire.js). The
// specks are laid as the map's shader lays them (brush.js GRAPHITE_GLSL),
// in a tile that meets itself, so it repeats without a seam.
//
//   toothCanvas(ink)   a TOOTH × TOOTH tile (RES px to one) of `ink` with
//                      the tooth's specks of bare paper in it
//   toothMaskURL()     the same in white, as a data URL, for a mask – with
//                      UI_GRAIN of the grain: the UI's lines are thin, a
//                      pixel or so, and the full grain would break them up
//   paperSpecks()      the tile's specks of bare paper alone (white), to rub
//                      out of a drawing on a canvas ('destination-out')

import { GRAPHITE } from './brush.js';

// TOOTH units square, drawn RES px to one, its specks GRAPHITE.size × SPECK
// units across (a photo is drawn larger than the map, so its grain a
// little finer for its size).
export const TOOTH = 48;
const RES = 4, SPECK = 0.9;

export const UI_GRAIN = 0.8;

let toothAlpha = null, toothKey = '';
// how much lead is left in each of the tile's pixels (0…1), `share` of the grain
function tooth(share = 1) {
  const g = { ...GRAPHITE, grain: GRAPHITE.grain * share }, key = `${g.grain},${g.size},${g.tone}`;
  if (toothAlpha && key === toothKey) return toothAlpha;
  toothKey = key;
  const n = TOOTH * RES, cell = Math.max(1, Math.round(g.size * SPECK * RES));
  const hash = (x, y, p) => {
    x = ((x % p) + p) % p; y = ((y % p) + p) % p;
    const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return v - Math.floor(v);
  };
  // value noise in cells of c px, wrapped round the tile
  const noise = (x, y, c) => {
    const p = Math.round(n / c), fx = x / c, fy = y / c, ix = Math.floor(fx), iy = Math.floor(fy);
    let u = fx - ix, v = fy - iy;
    u = u * u * (3 - 2 * u); v = v * v * (3 - 2 * v);
    const a = hash(ix, iy, p), b = hash(ix + 1, iy, p), c0 = hash(ix, iy + 1, p), d = hash(ix + 1, iy + 1, p);
    return a + (b - a) * u + (c0 - a) * v + (a - b - c0 + d) * u * v;
  };
  // (pressed about as hard as a stroke's middle is on the map)
  const th = g.grain * (1.05 - 0.55 * 0.85);
  const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  toothAlpha = new Float32Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const v = noise(x, y, cell) * 0.65 + noise(x + 5 * cell, y + 3 * cell, Math.max(1, Math.round(cell / 2.3))) * 0.35;
      toothAlpha[y * n + x] = (g.grain > 0 ? smooth(th - 0.1, th + 0.1, v) : 1) * (1 - g.tone);
    }
  }
  return toothAlpha;
}

export const TOOTH_RES = RES;

export function toothCanvas(ink, share = 1) {
  const n = TOOTH * RES, c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d');
  ctx.fillStyle = ink;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  const img = ctx.createImageData(n, n), a = tooth(share);
  for (let i = 0; i < a.length; i++) img.data.set([r, g, b, Math.round(255 * a[i])], i * 4);
  ctx.putImageData(img, 0, 0);
  return c;
}

let specks = null, specksKey = '';
export function paperSpecks() {
  const key = `${GRAPHITE.grain},${GRAPHITE.size},${GRAPHITE.tone}`;
  if (specks && key === specksKey) return specks;
  specksKey = key;
  const n = TOOTH * RES, a = tooth();
  specks = document.createElement('canvas');
  specks.width = specks.height = n;
  const ctx = specks.getContext('2d'), img = ctx.createImageData(n, n);
  for (let i = 0; i < a.length; i++) img.data.set([255, 255, 255, Math.round(255 * (1 - a[i]))], i * 4);
  ctx.putImageData(img, 0, 0);
  return specks;
}

let maskURL = null;
export function toothMaskURL() {
  return (maskURL ??= toothCanvas('#fff', UI_GRAIN).toDataURL());
}
