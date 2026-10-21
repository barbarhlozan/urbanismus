// How smoothly the map runs: a town opened in headless Chrome, left still,
// panned, zoomed, turned, each traced for where the time went.
//
//   node tools/perf/bench.mjs <town.urbanismus.json> [variant…] [options]
//
// Variants switch one thing off before measuring (see VARIANTS), to see
// what it costs; `base` is the game as it is. Each runs in a fresh browser.
// Options: --only idle,pan,… (scenarios), --dpr 2, --port 9333,
// --origin http://localhost:8173 (the dev server; if none answers there,
// serve.py is started on a port of its own),
// --setup '<js>' (run before measuring, R is the renderer), --json,
// --cpu (drawn without the GPU, as Firefox rasters SVG).
import { launch, openTown, trace, costs } from './chrome.mjs';

const VARIANTS = {
  base: '',
  noShadows: `document.querySelectorAll('.shade-veil').forEach((e) => (e.style.display = 'none'))`,
  noObjectShadows: `document.querySelector('.shade-shapes').style.display = 'none'`,
  noHillShade: `document.querySelector('.hill-shapes').style.display = 'none'`,
  noSway: `(await import('/src/render/renderer.js')).TREE_SWAY.most = 0`,
  noAgents: `R.showAgents = false`,
  noCanvases: `document.querySelectorAll('canvas').forEach((e) => (e.style.display = 'none')); R.showAgents = false`,
  noNight: `['night-ground', 'night-top', 'gloom'].forEach((i) => (document.getElementById(i).style.display = 'none'))`,
  noClouds: `['cloud-shadows', 'rain'].forEach((i) => (document.getElementById(i).style.display = 'none'))`,
  noMeadow: `R.layers.meadow.style.display = 'none'`,
  noTrees: `R.hiddenKinds.add('f'); R.layers.forest.style.display = 'none'; R.cull()`,
  noBuildings: `R.hiddenKinds.add('s'); R.cull()`,
  // all the time, what the view leaves out while it moves
  draft: `document.head.insertAdjacentHTML('beforeend', '<style>.layer-meadow, .layer-parked, .layer-objects .d2, .layer-lots .d2, .shade-veil { display: none !important }</style>')`,
};

// name: [what to do each frame (cam, i, R), ms, what to count each frame]
const MID = 'innerWidth / 2, innerHeight / 2';
const SCENARIOS = {
  idle: ['() => {}', 3000],
  pan: ['(cam, i) => cam.pan(Math.sin(i / 40) * 12, 0)', 4000],
  zoom: [`(cam) => cam.zoomAt(${MID}, 0.985)`, 1500],
  settle: ['() => {}', 3000], // (the zoom's redraw once it rests)
  unzoom: [`(cam) => cam.zoomAt(${MID}, 1 / 0.985)`, 1500],
  settle2: ['() => {}', 3000],
  // a 20° turn by hand, then let go: `behind` counts the buildings and
  // trees in sight not yet drawn at the step the view has reached
  turn: [`(cam, i) => { if (i < 40) cam.turnAt(${MID}, Math.PI / 360); else if (i === 40) cam.letGo([${MID}], 0); }`, 2500,
    `(R) => { const k = Math.round(R.camera.angle / (Math.PI / 90)) % 180; let n = 0; for (const e of R.objs.values()) if (e.shown !== false && e.k != null && e.k !== k) n++; return n; }`],
};

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : d; };
const only = opt('--only', null)?.split(',');
const dpr = Number(opt('--dpr', 2));
const port = Number(opt('--port', 9333));
const origin = opt('--origin', 'http://localhost:8173');
const setup = opt('--setup', '');
const json = argv.includes('--json') && argv.splice(argv.indexOf('--json'), 1);
const cpu = argv.includes('--cpu') && argv.splice(argv.indexOf('--cpu'), 1);
const [town, ...variants] = argv;
if (!town) {
  console.log(`usage: node tools/perf/bench.mjs <town.json> [${Object.keys(VARIANTS).join('|')}…] [--only ${Object.keys(SCENARIOS).join(',')}]`);
  process.exit(1);
}

const run = (b, [step, ms, probe]) => b.evaluate(`(async () => {
  const cam = R.camera, gaps = [], probes = [];
  const probe = ${probe ?? 'null'};
  let last = performance.now(), i = 0;
  const t0 = last;
  await new Promise((done) => {
    const f = (now) => {
      gaps.push(now - last);
      last = now;
      if (probe) probes.push(probe(R));
      if (now - t0 > ${ms}) return done();
      (${step})(cam, i++, R);
      requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  });
  gaps.shift();
  const s = [...gaps].sort((a, b) => a - b);
  const out = { fps: +(1000 * gaps.length / gaps.reduce((a, b) => a + b, 0)).toFixed(1), p95: Math.round(s[Math.floor(s.length * 0.95)]), worst: Math.round(s[s.length - 1]) };
  if (probe) Object.assign(out, { behind: Math.round(probes.reduce((a, b) => a + b, 0) / probes.length), behindMost: Math.max(...probes) });
  return out;
})()`);

// What the page holds: the JS heap, the elements on the page, and the
// turned drawings kept off it for a turn (Renderer.prepareTurn).
const memory = (b) => b.evaluate(`(() => {
  let views = 0, viewNodes = 0;
  for (const e of R.objs.values()) for (const v of e.views?.values() ?? []) {
    views++;
    for (const g of [v.g, v.lg, v.sg]) viewNodes += g.getElementsByTagName('*').length;
  }
  return { heapMB: Math.round(performance.memory.usedJSHeapSize / 1e6), pageNodes: document.getElementsByTagName('*').length, views, viewNodes };
})()`);

const cols = ['fps', 'p95', 'worst', 'main', 'js', 'style', 'paint', 'gc', 'raster', 'behind', 'behindMost'];
const show = (r) => {
  if (json) return;
  if (r.scenario === 'memory') console.log(`${r.variant.padEnd(12)} ready after ${r.readyS} s, heap ${r.heapMB} MB, ${r.pageNodes} elements on the page, ${r.views} turned drawings kept (${r.viewNodes} elements)`);
  else console.log([r.variant.padEnd(12), r.scenario.padEnd(9), ...cols.map((c) => String(r[c] ?? '').padStart(6))].join(' '));
};
if (!json) {
  console.log('frame times in ms; main…raster in ms of work per second\n');
  console.log(['variant'.padEnd(12), 'scenario'.padEnd(9), ...cols.map((c) => c.padStart(6))].join(' '));
}
const rows = [];
const add = (r) => { rows.push(r); show(r); };
for (const variant of variants.length ? variants : ['base']) {
  if (!(variant in VARIANTS)) throw new Error(`no variant ${variant}: ${Object.keys(VARIANTS).join(', ')}`);
  const b = await launch({ port, dpr, cpu: !!cpu });
  const limit = setTimeout(() => { console.error(`${variant}: no result in 5 minutes, given up`); process.exit(2); }, 300000);
  try {
    await openTown(b, { town, origin });
    // at rest, once the turn's drawings are ready (or a minute)
    const t0 = Date.now();
    while (Date.now() - t0 < 60000 && !(await b.evaluate('R.preparedAt != null'))) await new Promise((r) => setTimeout(r, 500));
    const ready = Math.round((Date.now() - t0) / 1000);
    const pre = VARIANTS[variant] + (setup ? `;\n${setup}` : '');
    if (pre) await b.evaluate(`(async () => { ${pre}; return true; })()`);
    await new Promise((r) => setTimeout(r, 1500));
    const mem = await memory(b);
    for (const [name, sc] of Object.entries(SCENARIOS)) {
      if (only && !only.includes(name)) continue;
      const { out, events } = await trace(b, () => run(b, sc));
      add({ variant, scenario: name, ...out, ...costs(events, sc[1] / 1000) });
    }
    add({ variant, scenario: 'memory', readyS: ready, ...mem });
  } finally {
    clearTimeout(limit);
    b.close();
  }
}

if (json) console.log(JSON.stringify(rows, null, 1));
process.exit(0);
