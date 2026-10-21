// CPU per slice of a Firefox profile for a few threads (the first one's
// time split by what runs): to find the stretch worth looking at.
//
//   node tools/perf/gecko/timeline.mjs <profile.json> <thread,thread,…> [slice ms]
import { readFileSync } from 'node:fs';
const [file, tis, bArg] = process.argv.slice(2);
const p = JSON.parse(readFileSync(file, 'utf8'));
const S = p.shared, str = S.stringArray, st = S.stackTable, fr = S.frameTable, fn = S.funcTable;
const prefix = (i) => { const o = st.prefixOffset[i]; return o ? i - o : null; };
const B = Number(bArg ?? 500);
const KEYS = ['js::RunScript', 'Paint ', 'WebRender display list', 'nsRefreshDriver::Tick', 'Styles', 'PresShell::DoReflow', 'content_script', 'GC', 'CC', 'drawImage', 'RenderBackend', 'Renderer::render', 'rasterize'];
const t0s = p.threads.map((th) => th.samples.timeDeltas[0]);
const start = Math.min(...t0s);
const out = new Map();
for (const ti of tis.split(',').map(Number)) {
  const th = p.threads[ti], s = th.samples;
  let t = 0;
  for (let i = 0; i < s.length; i++) {
    t += s.timeDeltas[i];
    const b = Math.floor((t - start) / B);
    const w = (s.threadCPUDelta?.[i] ?? 0) / 1000;
    const row = out.get(b) ?? {};
    row[ti] = (row[ti] ?? 0) + w;
    if (ti === Number(tis.split(',')[0]) && s.stack[i] != null && w) {
      const seen = new Set();
      for (let x = s.stack[i]; x != null; x = prefix(x)) {
        const n = str[fn.name[fr.func[st.frame[x]]]];
        for (const k of KEYS) if (!seen.has(k) && n.includes(k)) { seen.add(k); row[k] = (row[k] ?? 0) + w; }
      }
    }
    out.set(b, row);
  }
}
const ths = tis.split(',');
console.log('t(s)  ' + ths.map((t) => `${p.threads[t].name.slice(0, 10)}#${t}`.padStart(16)).join('') + '  | main: ' + KEYS.slice(0, 7).join(' / '));
for (const [b, row] of [...out].sort((a, b) => a[0] - b[0])) {
  if (!ths.some((t) => row[t] > 1)) continue;
  console.log(String((b * B / 1000).toFixed(1)).padStart(5) + ' ' + ths.map((t) => (row[t] ?? 0).toFixed(0).padStart(16)).join('') + '  | ' + KEYS.slice(0, 7).map((k) => (row[k] ?? 0).toFixed(0)).join(' / '));
}
