// Which JavaScript functions sit above a native frame (e.g. "fillRect",
// "Style computation") in a thread of a Firefox profile.
//
//   node tools/perf/gecko/callers.mjs <profile.json> <thread index> "<frame name part>" <from s> <to s>
import { readFileSync } from 'node:fs';
const [file, ti, needle, fromS, toS] = process.argv.slice(2);
const p = JSON.parse(readFileSync(file, 'utf8'));
const S = p.shared, str = S.stringArray, st = S.stackTable, fr = S.frameTable, fn = S.funcTable;
const cats = p.meta.categories.map((c) => c.name);
const prefix = (i) => { const o = st.prefixOffset[i]; return o ? i - o : null; };
const th = p.threads[Number(ti)], s = th.samples;
const start = Math.min(...p.threads.map((t) => t.samples.timeDeltas[0]));
let tt = 0; const by = new Map();
for (let i = 0; i < s.length; i++) {
  tt += s.timeDeltas[i];
  const at = (tt - start) / 1000;
  if (at < Number(fromS) || at > Number(toS) || s.stack[i] == null) continue;
  const w = (s.threadCPUDelta?.[i] ?? 0) / 1000;
  const chain = [];
  for (let x = s.stack[i]; x != null; x = prefix(x)) chain.push(st.frame[x]);
  const k = chain.findIndex((f) => str[fn.name[fr.func[f]]].includes(needle));
  if (k < 0) continue;
  // the nearest frames above it that are JavaScript (or a named phase)
  const above = chain.slice(k + 1).filter((f) => cats[fr.category[f]] === 'JavaScript').slice(0, 3).map((f) => str[fn.name[fr.func[f]]]).join(' < ') || chain.slice(k + 1, k + 4).map((f) => str[fn.name[fr.func[f]]]).join(' < ');
  by.set(above, (by.get(above) ?? 0) + w);
}
for (const [k, v] of [...by].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(v.toFixed(0).padStart(6), 'ms ', k.slice(0, 200));
