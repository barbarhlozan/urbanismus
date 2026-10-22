// The same scenarios as bench.mjs, in Firefox – or Zen, or any browser made
// from it – driven over WebDriver BiDi, which Firefox has built in: frame
// rates measured in the page. It opens a window of its own, with a fresh
// profile (your own browser's tabs and data are not touched), so run it
// from a terminal of your own: an app sandbox can't open windows.
//
//   node tools/perf/firefox.mjs <town.urbanismus.json> [--night] [--pref name=value …] [--only idle,pan,…] [--setup '<js>'] [--browser path]
//
// --browser: the app's binary (default: Zen, else Firefox, in /Applications);
// --setup: run in the page before measuring (R is the renderer), e.g.
// 'R.setGlLines(true); R.setGlMovers(true)';
// --pref sets a preference for the run, e.g. --pref gfx.canvas.accelerated=true.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { server } from './chrome.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : d; };
const prefs = {};
for (let i = argv.indexOf('--pref'); i >= 0; i = argv.indexOf('--pref')) {
  const [k, v] = argv.splice(i, 2)[1].split('=');
  prefs[k] = v === 'true' ? true : v === 'false' ? false : isNaN(v) ? v : Number(v);
}
const only = opt('--only', null)?.split(',');
const setup = opt('--setup', '');
const port = Number(opt('--port', 9226));
const binary = opt('--browser', ['/Applications/Zen.app/Contents/MacOS/zen', '/Applications/Firefox.app/Contents/MacOS/firefox'].find(existsSync));
const night = argv.includes('--night');
const town = argv.find((a) => !a.startsWith('--'));
if (!town || !binary) {
  console.log('usage: node tools/perf/firefox.mjs <town.json> [--night] [--pref name=value] [--only idle,pan,…] [--browser path]');
  process.exit(1);
}

const MID = 'innerWidth / 2, innerHeight / 2';
const SCENARIOS = {
  idle: ['() => {}', 3000],
  pan: ['(cam, i) => cam.pan(Math.sin(i / 40) * 12, 0)', 4000],
  zoom: [`(cam) => cam.zoomAt(${MID}, 0.985)`, 1500],
  settle: ['() => {}', 3000],
  unzoom: [`(cam) => cam.zoomAt(${MID}, 1 / 0.985)`, 1500],
  settle2: ['() => {}', 3000],
  turn: [`(cam, i) => { if (i < 40) cam.turnAt(${MID}, Math.PI / 360); else if (i === 40) cam.letGo([${MID}], 0); }`, 2500],
};

// a profile of its own: no first-run pages, what the run asks for
const profile = mkdtempSync(join(tmpdir(), 'dedina-ff-'));
const base = {
  'browser.shell.checkDefaultBrowser': false, 'browser.aboutwelcome.enabled': false,
  'browser.startup.homepage_override.mstone': 'ignore', 'datareporting.policy.dataSubmissionEnabled': false,
  'browser.startup.page': 0, 'browser.sessionstore.resume_from_crash': false, 'toolkit.telemetry.reportingpolicy.firstRun': false,
  'zen.welcome-screen.seen': true,
};
writeFileSync(join(profile, 'user.js'), Object.entries({ ...base, ...prefs }).map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join('\n'));
const proc = spawn(binary, ['-no-remote', '-new-instance', '-profile', profile, '--remote-debugging-port', String(port), 'about:blank'], { stdio: 'ignore' });
const quit = () => { try { proc.kill(); } catch { /* gone */ } setTimeout(() => rmSync(profile, { recursive: true, force: true }), 1000).unref(); };
process.on('exit', quit);

// WebDriver BiDi over a WebSocket (Node 22's own)
let ws;
for (let i = 0; i < 60 && !ws; i++) {
  await new Promise((r) => setTimeout(r, 500));
  try {
    const s = new WebSocket(`ws://127.0.0.1:${port}/session`);
    await new Promise((res, rej) => { s.addEventListener('open', res, { once: true }); s.addEventListener('error', rej, { once: true }); });
    ws = s;
  } catch { /* not up yet */ }
}
if (!ws) throw new Error(`${binary} didn't open WebDriver BiDi on port ${port}`);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.type === 'error') rej(new Error(`${msg.error}: ${msg.message}`));
    else res(msg.result);
  }
});
ws.addEventListener('close', (e) => {
  console.error(`the browser closed the connection (${e.code}${e.reason ? `: ${e.reason}` : ''})`);
  for (const { rej } of pending.values()) rej(new Error('connection closed'));
  pending.clear();
  process.exit(2);
});
const step = (what) => process.env.VERBOSE && console.error(`… ${what}`);
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id;
  pending.set(i, { res, rej });
  ws.send(JSON.stringify({ id: i, method, params }));
});

try {
  const session = await send('session.new', { capabilities: {} });
  const { contexts } = await send('browsingContext.getTree', {});
  const context = contexts[0].context;
  await send('browsingContext.setViewport', { context, viewport: { width: 1440, height: 900 } }).catch(() => {});
  // the page's own code, its result as JSON
  const evaluate = async (expression) => {
    const r = await send('script.evaluate', { expression: `(async () => JSON.stringify(await (${expression})))()`, target: { context }, awaitPromise: true });
    if (r.type === 'exception') throw new Error(r.exceptionDetails?.text ?? 'exception');
    return r.result.value === undefined ? undefined : JSON.parse(r.result.value);
  };
  const go = (url) => send('browsingContext.navigate', { context, url, wait: 'complete' });
  const origin = await server(opt('--origin', 'http://localhost:8173'));
  const data = JSON.parse(readFileSync(town, 'utf8'));
  const world = data.format ? data.world : data;
  await go(`${origin}/__perf-seed`);
  await evaluate(`(localStorage.setItem('urbanismus.save.v1', ${JSON.stringify(JSON.stringify(world))}), localStorage.setItem('urbanismus.language', 'cs'), true)`);
  step('town seeded');
  await go(`${origin}/`);
  step('game loading');
  for (let i = 0; i < 150 && !(await evaluate('!!(window.cmd && !document.getElementById("intro"))').catch(() => false)); i++) await new Promise((r) => setTimeout(r, 200));
  await evaluate(`(async () => {
    const { Renderer } = await import('/src/render/renderer.js');
    const frame = Renderer.prototype.frame;
    await new Promise((res) => { Renderer.prototype.frame = function (...a) { window.R = this; Renderer.prototype.frame = frame; res(); return frame.apply(this, a); }; });
    return true;
  })()`);
  step('game running');
  if (night) {
    await evaluate(`(cmd.weather('fair'), cmd.day(1), true)`);
    await new Promise((r) => setTimeout(r, 8000));
  }
  if (setup) await evaluate(`(async () => { ${setup}; return true; })()`);
  const t0 = Date.now();
  while (Date.now() - t0 < 60000 && !(await evaluate('R.preparedAt != null'))) await new Promise((r) => setTimeout(r, 500));
  await new Promise((r) => setTimeout(r, 1500));
  const info = await evaluate(`({ dpr: devicePixelRatio, w: innerWidth, h: innerHeight, ua: navigator.userAgent.match(/(Firefox|Zen)\\/[\\d.]+/g)?.join(' ') })`);
  console.log(`${info.ua}, ${info.w}×${info.h} at ${info.dpr}×${night ? ', at night' : ''}${Object.keys(prefs).length ? `, ${JSON.stringify(prefs)}` : ''} (${session.capabilities?.browserName ?? ''})`);
  console.log('scenario     fps    p95  worst');
  for (const [name, [step, ms]] of Object.entries(SCENARIOS)) {
    if (only && !only.includes(name)) continue;
    const r = await evaluate(`(async () => {
      const f = ${step}, cam = R.camera, gaps = [];
      let last = performance.now(), i = 0;
      const t0 = last;
      await new Promise((done) => {
        const tick = (now) => {
          gaps.push(now - last);
          last = now;
          if (now - t0 > ${ms}) return done();
          f(cam, i++, R);
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      gaps.shift();
      if (gaps.length < 3) return null;
      const s = [...gaps].sort((a, b) => a - b);
      return { fps: +(1000 * gaps.length / gaps.reduce((a, b) => a + b, 0)).toFixed(1), p95: Math.round(s[Math.floor(s.length * 0.95)]), worst: Math.round(s[s.length - 1]) };
    })()`);
    if (!r) {
      console.log(`${name.padEnd(9)} no frames drawn: the window must be in sight (not hidden, minimised, or behind a locked screen)`);
      continue;
    }
    console.log([name.padEnd(9), ...['fps', 'p95', 'worst'].map((k) => String(r[k]).padStart(6))].join(' '));
  }
  await send('session.end').catch(() => {});
} finally {
  quit();
  process.exit(0);
}
