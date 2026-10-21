// A thread's markers in a Firefox profile, summed by name: 'Texture uploads',
// 'Styles' (with elementsStyled), 'RefreshDriverTick' (frames)…
//
//   node tools/perf/gecko/markers.mjs <profile.json> <thread index> [from s] [to s]
import { readFileSync } from 'node:fs';
const [file, ti, fromS, toS] = process.argv.slice(2);
const p = JSON.parse(readFileSync(file, 'utf8'));
const str = p.shared.stringArray;
const start = Math.min(...p.threads.map((t) => t.samples.timeDeltas[0]));
const m = p.threads[Number(ti)].markers;
const by = new Map();
for (let i = 0; i < m.length; i++) {
  const t = (m.startTime[i] ?? m.endTime[i]) - start;
  if (fromS != null && (t / 1000 < Number(fromS) || t / 1000 > Number(toS))) continue;
  const n = str[m.name[i]];
  const d = m.endTime[i] != null && m.startTime[i] != null ? m.endTime[i] - m.startTime[i] : 0;
  const r = by.get(n) ?? { n: 0, ms: 0, max: 0, ex: m.data[i] };
  r.n++; r.ms += d; r.max = Math.max(r.max, d);
  by.set(n, r);
}
for (const [n, r] of [...by].sort((a, b) => b[1].ms - a[1].ms).slice(0, 40)) console.log(`${String(r.n).padStart(6)}x ${r.ms.toFixed(0).padStart(7)} ms  max ${r.max.toFixed(1).padStart(6)}  ${n}  ${JSON.stringify(r.ex)?.slice(0, 160)}`);
