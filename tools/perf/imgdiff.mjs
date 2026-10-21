// How alike two screenshots are (the SVG map and the WebGL one): the share
// of pixels that differ, by how much, and a picture of where – red where
// only the first has ink, blue where only the second does; and how much
// ink the second has for the first's (inkRatio: 1 the same, above heavier).
//
//   node tools/perf/imgdiff.mjs a.png b.png [diff.png] [--ink]
//
// --ink: count only pixels where either has ink (darker than the paper),
// so a sparse drawing isn't flattered by its empty paper.
import { readFileSync, writeFileSync } from 'node:fs';
import { launch } from './chrome.mjs';

const argv = process.argv.slice(2);
const ink = argv.includes('--ink');
const [a, b, out] = argv.filter((x) => !x.startsWith('--'));
const url = (f) => `data:image/png;base64,${readFileSync(f).toString('base64')}`;

const br = await launch({ port: 9440 + Math.floor(Math.random() * 50) });
try {
  const r = await br.evaluate(`(async () => {
    const load = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
    const [A, B] = await Promise.all([load(${JSON.stringify(url(a))}), load(${JSON.stringify(url(b))})]);
    const w = Math.min(A.width, B.width), h = Math.min(A.height, B.height);
    const px = (img) => { const c = new OffscreenCanvas(w, h), x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, w, h).data; };
    const pa = px(A), pb = px(B);
    const lum = (p, i) => 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
    // the paper: the lightest common colour
    let paper = 0;
    for (let i = 0; i < pa.length; i += 4) paper = Math.max(paper, lum(pa, i));
    const diff = new OffscreenCanvas(w, h), dc = diff.getContext('2d'), dd = dc.createImageData(w, h);
    let n = 0, d8 = 0, d32 = 0, d96 = 0, sum = 0, onlyA = 0, onlyB = 0, inkA = 0, inkB = 0;
    for (let i = 0; i < pa.length; i += 4) {
      const la = paper - lum(pa, i), lb = paper - lum(pb, i); // ink: how much darker than the paper
      inkA += Math.max(0, la);
      inkB += Math.max(0, lb);
      const g = 235;
      dd.data.set([g, g, g, 255], i);
      if (${ink} && la < 8 && lb < 8) continue;
      n++;
      const d = Math.max(Math.abs(pa[i] - pb[i]), Math.abs(pa[i + 1] - pb[i + 1]), Math.abs(pa[i + 2] - pb[i + 2]));
      sum += d;
      if (d > 8) d8++;
      if (d > 32) d32++;
      if (d > 96) d96++;
      if (d > 32) {
        if (la > lb) { onlyA++; dd.data.set([220, 40, 40, 255], i); }
        else { onlyB++; dd.data.set([40, 70, 220, 255], i); }
      } else if (la > 8 || lb > 8) dd.data.set([150, 150, 150, 255], i);
    }
    dc.putImageData(dd, 0, 0);
    const blob = await diff.convertToBlob({ type: 'image/png' });
    const png = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result.split(',')[1]); fr.readAsDataURL(blob); });
    const pct = (k) => +(100 * k / Math.max(1, n)).toFixed(2);
    return { w, h, counted: n, meanDiff: +(sum / Math.max(1, n)).toFixed(2), over8: pct(d8), over32: pct(d32), over96: pct(d96), inkOnlyA: pct(onlyA), inkOnlyB: pct(onlyB), inkRatio: +(inkB / Math.max(1, inkA)).toFixed(3), png };
  })()`);
  if (out) writeFileSync(out, Buffer.from(r.png, 'base64'));
  delete r.png;
  console.log(JSON.stringify(r));
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  br.close();
  setTimeout(() => process.exit(), 100);
}
