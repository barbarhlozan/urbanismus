// The shadows' canvases drawn off the page's thread (shadeCanvas.js): each
// part's shapes laid, the lamps' pools and what else it leaves out rubbed
// out, the paper's strokes kept where they are, and the picture sent back
// as a bitmap to be shown at once. Drawn without a GPU this takes a while
// on a sheet this large, and the game's own frames shouldn't wait for it.
//
// In: { part, key, w, h, base, tile: { d, size, q, colour, width }, angle,
//       sheets: [{ clip, shapes: [[kind, d, matrix, alpha, cut, evenodd]…] }…] }
// Out: { part, key, bitmap }

import { hatchTileLines } from './hatch.js';

// The shapes' ragged edges and the trunks' lines (shadeCanvas.js).
const EDGE = { width: 2.5, dash: [3, 2, 1.5, 3.5, 2.5, 1, 4, 2.5, 1, 3] };
const LINE = 2.2;

const canvases = new Map(); // part -> OffscreenCanvas
const paths = new Map();     // part -> Map path data -> { path, dashes }, kept while used
let tile = null;              // { key, pattern, scale }
let latest = new Map();       // part -> the newest job (older ones are skipped)

self.onmessage = ({ data }) => {
  latest.set(data.part, data);
  // (a burst of jobs: only the last of each part is drawn)
  setTimeout(() => {
    const job = latest.get(data.part);
    if (job !== data) return;
    latest.delete(data.part);
    const bitmap = draw(job);
    self.postMessage({ part: job.part, key: job.key, bitmap }, [bitmap]);
  });
};

function draw({ part, w, h, base, tile: t, angle, sheets }) {
  let canvas = canvases.get(part);
  if (canvas?.width !== w || canvas?.height !== h) canvases.set(part, (canvas = new OffscreenCanvas(w, h)));
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const used = new Map();
  if (t) {
    const m = new DOMMatrix(base);
    const pattern = patternFor(ctx, t);
    pattern.pattern.setTransform(m.rotate(angle).scale(1 / pattern.scale));
    for (const sheet of sheets) {
      const alone = sheets.length === 1 && !sheet.clip;
      const c = alone ? ctx : (self.sheet?.width === w && self.sheet?.height === h ? self.sheet : (self.sheet = new OffscreenCanvas(w, h))).getContext('2d');
      if (!alone) {
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.clearRect(0, 0, w, h);
      }
      for (const shape of sheet.shapes) lay(c, shape, used, paths.get(part));
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.globalAlpha = 1;
      c.globalCompositeOperation = 'source-in';
      c.fillStyle = pattern.pattern;
      c.fillRect(0, 0, w, h);
      c.globalCompositeOperation = 'source-over';
      if (alone) continue;
      ctx.save();
      if (sheet.clip) {
        ctx.setTransform(m);
        ctx.clip(new Path2D(sheet.clip));
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
      ctx.drawImage(c.canvas, 0, 0);
      ctx.restore();
    }
  }
  paths.set(part, used);
  return canvas.transferToImageBitmap();
}

// One shape: laid (white, where the strokes show) or, `cut`, rubbed out.
function lay(c, [kind, d, matrix, alpha, cut, evenodd], used, kept) {
  let p = used.get(d) ?? kept?.get(d);
  if (!p) p = { path: new Path2D(d), dashes: kind === 'line' ? null : dashes(d, EDGE.dash) };
  used.set(d, p);
  c.setTransform(matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5]);
  c.globalAlpha = alpha;
  c.globalCompositeOperation = cut ? 'destination-out' : 'source-over';
  c.fillStyle = c.strokeStyle = '#fff';
  c.lineJoin = 'round';
  if (kind === 'line') {
    c.lineCap = 'round';
    c.lineWidth = LINE;
    c.stroke(p.path);
  } else {
    c.fill(p.path, evenodd ? 'evenodd' : 'nonzero');
    // the ragged edge: the dashes cut out once (dashing is dear to draw)
    c.lineCap = 'butt';
    c.lineWidth = EDGE.width;
    if (p.dashes) c.stroke(p.dashes);
    else {
      c.setLineDash(EDGE.dash);
      c.stroke(p.path);
      c.setLineDash([]);
    }
  }
  c.globalCompositeOperation = 'source-over';
}

// The paper's strokes as a pattern, drawn at t.q canvas px to a scene px.
function patternFor(ctx, t) {
  const key = `${t.tier}|${t.hatch}|${t.px}|${t.width}|${t.q}|${t.colour}`;
  if (tile?.key === key) return tile;
  const { d, size } = hatchTileLines(t.tier, JSON.parse(t.hatch), t.px);
  const n = Math.max(1, Math.round(size * t.q));
  const off = new OffscreenCanvas(n, n), c = off.getContext('2d');
  c.scale(n / size, n / size);
  c.strokeStyle = t.colour;
  c.lineWidth = t.width;
  c.lineCap = c.lineJoin = 'round';
  c.stroke(new Path2D(d));
  tile = { key, pattern: ctx.createPattern(off, 'repeat'), scale: n / size };
  return tile;
}

// Path data of straight lines only (M, L, Z) cut into the dashes of
// `pattern` (lengths, on and off by turns), as a Path2D of the dashes;
// null for any other path (it is dashed as it is drawn).
function dashes(d, pattern) {
  if (/[^MLZ\d\s.,eE+-]/.test(d)) return null;
  const out = new Path2D();
  const total = pattern.reduce((a, b) => a + b, 0);
  for (const sub of d.split('M').filter(Boolean)) {
    const closed = /Z\s*$/.test(sub);
    const nums = sub.replace(/[LZ]/g, ' ').trim().split(/[\s,]+/).map(Number);
    const pts = [];
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
    if (closed && pts.length > 2) pts.push(pts[0]);
    // the pattern from the start of each line, as SVG has it
    let at = 0;
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
      const len = Math.hypot(bx - ax, by - ay);
      let s = 0;
      while (s < len) {
        // where in the pattern: which dash (even: on), and what of it is left
        let k = 0, rest = at % total;
        while (k < pattern.length - 1 && rest >= pattern[k]) rest -= pattern[k++];
        const step = Math.max(1e-6, Math.min(pattern[k] - rest, len - s));
        if (k % 2 === 0) {
          out.moveTo(ax + ((bx - ax) * s) / len, ay + ((by - ay) * s) / len);
          out.lineTo(ax + ((bx - ax) * (s + step)) / len, ay + ((by - ay) * (s + step)) / len);
        }
        s += step;
        at += step;
      }
    }
  }
  return out;
}
