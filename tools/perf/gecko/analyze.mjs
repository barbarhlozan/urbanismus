// Where a thread of a Firefox profile spends its CPU: by category, by its own
// time and with what it calls – over the whole recording or [from, to] s.
//
//   node tools/perf/gecko/analyze.mjs <profile.json> <thread index> [top] [from s] [to s]
//
// A profile saved from profiler.firefox.com (Upload › Download), gunzipped.
// The thread indexes, with their CPU: node tools/perf/gecko/threads.mjs <profile.json>
import { readFileSync } from 'node:fs';
const [file, ti, topArg, fromS, toS] = process.argv.slice(2);
const p = JSON.parse(readFileSync(file, 'utf8'));
const S = p.shared, str = S.stringArray, st = S.stackTable, fr = S.frameTable, fn = S.funcTable;
const prefix = (i) => { const o = st.prefixOffset[i]; return o ? i - o : null; };
const th = p.threads[Number(ti)];
const s = th.samples, cats = p.meta.categories.map((c) => c.name);
const top = Number(topArg ?? 30);
const name = (f) => str[fn.name[fr.func[f]]];
const self = new Map(), incl = new Map(), cat = new Map();
let total = 0;
const start = Math.min(...p.threads.map((t) => t.samples.timeDeltas[0]));
let tt = 0;
for (let i = 0; i < s.length; i++) {
  tt += s.timeDeltas[i];
  const at = (tt - start) / 1000;
  if (fromS != null && (at < Number(fromS) || at > Number(toS))) continue;
  const stk = s.stack[i];
  const w = (s.threadCPUDelta?.[i] ?? 0) / 1000; // ms of CPU
  if (stk == null || !w) continue;
  total += w;
  const leaf = st.frame[stk];
  const ln = name(leaf);
  self.set(ln, (self.get(ln) ?? 0) + w);
  const c = cats[fr.category[leaf]] ?? '?';
  cat.set(c, (cat.get(c) ?? 0) + w);
  const seen = new Set();
  for (let x = stk; x != null; x = prefix(x)) { const n = name(st.frame[x]); if (seen.has(n)) continue; seen.add(n); incl.set(n, (incl.get(n) ?? 0) + w); }
}
const dur = s.timeDeltas.reduce((a, b) => a + b, 0);
const fmt = (m, k = top) => [...m].sort((a, b) => b[1] - a[1]).slice(0, k).map(([n, v]) => `${v.toFixed(0).padStart(7)} ms  ${String(n).slice(0, 140)}`).join('\n');
console.log(`thread ${th.name} ${th.processName} — ${(total).toFixed(0)} ms CPU over ${dur.toFixed(0)} ms`);
console.log('-- by category (leaf) --\n' + fmt(cat, 12));
console.log('-- self --\n' + fmt(self));
console.log('-- inclusive --\n' + fmt(incl));
