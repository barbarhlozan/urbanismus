// Headless Chrome for Testing (Playwright's download) driven over the
// DevTools protocol, with nothing to install: Node 22's own WebSocket.
// Its profile is a fresh folder each run, so the town it plays is the one
// seeded here (openTown), never the one saved in your own browser.
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

// The newest Chrome for Testing in Playwright's cache (or $CHROME).
function chromePath() {
  if (process.env.CHROME) return process.env.CHROME;
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  const dirs = existsSync(cache) ? readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => b.split('-')[1] - a.split('-')[1]) : [];
  for (const d of dirs) {
    for (const app of ['chrome-mac-arm64', 'chrome-mac']) {
      const p = join(cache, d, app, 'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
      if (existsSync(p)) return p;
    }
  }
  throw new Error('No Chrome for Testing found: run `npx playwright install chromium`, or set $CHROME');
}

export async function launch({ port = 9333, width = 1440, height = 900, dpr = 2 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dedina-perf-'));
  const proc = spawn(chromePath(), [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`,
    '--no-first-run', '--no-default-browser-check', `--window-size=${width},${height}`,
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows', '--enable-precise-memory-info', 'about:blank',
  ], { stdio: 'ignore', detached: true }); // (its own process group: closed whole, helpers too)
  const kill = () => { try { process.kill(-proc.pid, 'SIGKILL'); } catch { /* gone */ } };
  process.on('exit', kill);
  let targets = [];
  for (let i = 0; i < 50 && !targets.some((t) => t.type === 'page'); i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch { /* not up yet */ }
    if (!targets.some((t) => t.type === 'page')) await new Promise((r) => setTimeout(r, 200));
  }
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error(`Chrome didn't come up on port ${port}`);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0;
  const pending = new Map(), listeners = new Map();
  ws.addEventListener('message', (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) rej(new Error(JSON.stringify(msg.error)));
      else res(msg.result);
    } else if (msg.method) for (const f of listeners.get(msg.method) ?? []) f(msg.params);
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const on = (method, f) => listeners.set(method, [...(listeners.get(method) ?? []), f]);
  const off = (method) => listeners.delete(method);
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile: false });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  const close = () => {
    try { ws.close(); } catch { /* gone */ }
    kill();
    setTimeout(() => rmSync(dir, { recursive: true, force: true }), 500).unref();
  };
  return { send, on, off, evaluate, close };
}

// The game's address: `origin` if a server answers there, else serve.py
// started here on a port of its own (stopped with the process).
export async function server(origin = 'http://localhost:8173') {
  const up = async (url) => { try { return (await fetch(url)).ok; } catch { return false; } };
  if (await up(origin)) return origin;
  const port = 20000 + Math.floor(Math.random() * 20000);
  const own = `http://localhost:${port}`;
  const proc = spawn('python3', [join(ROOT, 'serve.py'), String(port)], { cwd: ROOT, stdio: 'ignore' });
  process.on('exit', () => proc.kill());
  for (let i = 0; i < 50 && !(await up(own)); i++) await new Promise((r) => setTimeout(r, 100));
  return own;
}

// Open the game on a town saved to a file (Menu › Save to a file), once the
// cover has gone. The renderer is then `window.R` (taken off its module:
// the game's own instance), and agents etc. can be had the same way.
export async function openTown(b, { town, origin, query = '' }) {
  origin = await server(origin);
  const data = JSON.parse(readFileSync(town, 'utf8'));
  const world = data.format ? data.world : data;
  // (localStorage is per origin: seeded from a page of the server that isn't the game)
  await b.send('Page.navigate', { url: `${origin}/__perf-seed` });
  await new Promise((r) => setTimeout(r, 400));
  await b.evaluate(`localStorage.setItem('urbanismus.save.v1', ${JSON.stringify(JSON.stringify(world))}); localStorage.setItem('urbanismus.language', 'cs'); true`);
  await b.send('Page.navigate', { url: `${origin}/${query}` });
  for (let i = 0; i < 150; i++) {
    if (await b.evaluate(`!!(window.cmd && !document.getElementById('intro'))`).catch(() => false)) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  await b.evaluate(`(async () => {
    const { Renderer } = await import('/src/render/renderer.js');
    const frame = Renderer.prototype.frame;
    await new Promise((res) => {
      Renderer.prototype.frame = function (...a) { window.R = this; Renderer.prototype.frame = frame; res(); return frame.apply(this, a); };
    });
    return true;
  })()`);
}

// The trace events recorded while `fn` runs.
export async function trace(b, fn, categories = ['devtools.timeline', 'toplevel', 'gpu', 'cc', 'v8']) {
  const events = [];
  b.on('Tracing.dataCollected', (p) => events.push(...p.value));
  const done = new Promise((r) => b.on('Tracing.tracingComplete', r));
  await b.send('Tracing.start', { traceConfig: { includedCategories: categories }, transferMode: 'ReportEvents' });
  const out = await fn();
  await b.send('Tracing.end');
  await done;
  b.off('Tracing.dataCollected');
  b.off('Tracing.tracingComplete');
  return { out, events };
}

// Where the time went, in ms per second of the trace: the page's main
// thread busy at all, and in script, style, layout and paint; the raster
// workers drawing the page's tiles.
export function costs(events, seconds) {
  const names = new Map();
  for (const e of events) if (e.name === 'thread_name') names.set(`${e.pid}:${e.tid}`, e.args.name);
  const sum = (pred) => {
    let ms = 0;
    for (const e of events) if (e.ph === 'X' && e.dur && pred(e, names.get(`${e.pid}:${e.tid}`) ?? '')) ms += e.dur / 1000;
    return Math.round(ms / seconds);
  };
  const main = (name) => (e, t) => t === 'CrRendererMain' && e.name === name;
  return {
    main: sum(main('ThreadControllerImpl::RunTask')),
    js: sum(main('FunctionCall')),
    style: sum(main('UpdateLayoutTree')),
    layout: sum(main('Layout')),
    paint: sum(main('Paint')),
    gc: sum((e, t) => t === 'CrRendererMain' && /^V8\.GC|MajorGC|MinorGC/.test(e.name)),
    raster: sum((e, t) => /Worker/.test(t) && e.name === 'RasterTask'),
  };
}
