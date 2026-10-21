// Which functions the time goes to: a JS CPU profile of the game in
// headless Chrome, its top functions by their own time and with what they call.
//
//   node tools/perf/profile.mjs <town.urbanismus.json> [--ms 4000] [--step '<js>'] [--now]
//
// --step: run every frame while profiling (cam => …), e.g. a pan:
//   --step 'cam => cam.pan(8, 0)'
// --now: profile from the start, not once the turn's drawings are ready.
import { launch, openTown } from './chrome.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : d; };
const ms = Number(opt('--ms', 4000));
const step = opt('--step', null);
const origin = opt('--origin', 'http://localhost:8173');
const port = Number(opt('--port', 9334));
const now = argv.includes('--now');
const town = argv.find((a) => !a.startsWith('--'));

const b = await launch({ port });
try {
  await openTown(b, { town, origin });
  const t0 = Date.now();
  while (!now && Date.now() - t0 < 60000 && !(await b.evaluate('R.preparedAt != null'))) await new Promise((r) => setTimeout(r, 500));
  await b.send('Profiler.enable');
  await b.send('Profiler.setSamplingInterval', { interval: 200 });
  if (step) await b.evaluate(`window.__perfStop = false; (function t() { if (__perfStop) return; (${step})(R.camera); requestAnimationFrame(t); })(); true`);
  await b.send('Profiler.start');
  await new Promise((r) => setTimeout(r, ms));
  const { profile } = await b.send('Profiler.stop');
  await b.evaluate('window.__perfStop = true');

  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const hits = new Map();
  profile.samples.forEach((id, i) => hits.set(id, (hits.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0)));
  const name = ({ callFrame: f }) => `${f.functionName || '(anonymous)'}  ${f.url.replace(/^.*?\/(src|structures|features)\//, '$1/')}${f.url ? `:${f.lineNumber + 1}` : ''}`;
  const self = new Map(), total = new Map();
  for (const [id, t] of hits) {
    const k = name(byId.get(id));
    self.set(k, (self.get(k) ?? 0) + t);
    const seen = new Set();
    for (let cur = id; cur; cur = parent.get(cur)) {
      const kk = name(byId.get(cur));
      if (seen.has(kk)) continue;
      seen.add(kk);
      total.set(kk, (total.get(kk) ?? 0) + t);
    }
  }
  const top = (m) => [...m].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, t]) => `${String(Math.round(t / 1000)).padStart(6)} ms  ${k}`).join('\n');
  console.log(`${ms} ms profiled\n\n-- own time --\n${top(self)}\n\n-- with what they call --\n${top(total)}`);
} finally {
  b.close();
  process.exit(0);
}
