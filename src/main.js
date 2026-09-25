// Boot: create / load the world, wire systems together, run the loop.

import { CONFIG } from './config.js';
import { applyTheme } from './theme.js';
import { Style } from './render/style.js';
import { makeWarp } from './render/warp.js';
import { Crt } from './ui/crt.js';
import { Annotations } from './ui/annotations.js';
import { StylePanel } from './ui/stylePanel.js';
import { PixelRenderer } from './render/pixel.js';
import { World } from './core/world.js';
import { generateWorld } from './terrain/generate.js';
import { Camera } from './render/camera.js';
import { Renderer } from './render/renderer.js';
import { OverlayKit } from './render/overlay.js';
import { AgentSystem } from './sim/agents.js';
import { GrowthSystem } from './sim/growth.js';
import { SimClock } from './sim/clock.js';
import { ParkingSystem } from './sim/parking.js';
import { ToolManager } from './tools/manager.js';
import { createInspectTool } from './tools/inspect.js';
import { createNetworkTool } from './tools/network.js';
import { createBuildTool } from './tools/build.js';
import { createBulldozeTool } from './tools/bulldoze.js';
import { Popup } from './ui/popup.js';
import { Hud } from './ui/hud.js';
import { attachInput } from './ui/input.js';
import { STRUCTURES } from '../structures/index.js';

applyTheme();

// ---------- world ----------

function loadWorld() {
  try {
    const raw = localStorage.getItem(CONFIG.storageKey);
    if (raw) return World.fromJSON(JSON.parse(raw));
  } catch (err) {
    console.warn('Could not load save, starting fresh.', err);
  }
  const seed = CONFIG.seed ?? Math.floor(Math.random() * 1e9);
  const world = new World({ ...CONFIG.grid, seed });
  generateWorld(world, CONFIG);
  return world;
}

const world = loadWorld();

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(CONFIG.storageKey, JSON.stringify(world.toJSON()));
    } catch (err) {
      console.warn('Autosave failed.', err);
    }
  }, CONFIG.autosaveDelay);
}
world.events.on('*', scheduleSave);
scheduleSave();

// ---------- systems ----------

const svg = document.getElementById('world');
const uiRoot = document.getElementById('ui');

const style = new Style();
const camera = new Camera(world.grid, CONFIG.camera);
camera.warp = makeWarp(world.seed, style.get('warp'), style.get('tremor'));
camera.centerOn(camera.cx, camera.cy, svg.clientWidth, svg.clientHeight);

// Keep whatever is in the middle of the screen in the middle when resizing.
let viewport = [svg.clientWidth, svg.clientHeight];
new ResizeObserver(() => {
  const [w, h] = [svg.clientWidth, svg.clientHeight];
  camera.panX += (w - viewport[0]) / 2;
  camera.panY += (h - viewport[1]) / 2;
  viewport = [w, h];
}).observe(svg);

const clock = new SimClock(CONFIG);
const parking = new ParkingSystem(world);
const agents = new AgentSystem(world, CONFIG, parking);
const growth = new GrowthSystem(world, CONFIG);
const renderer = new Renderer(svg, { world, camera, agents, parking, style, config: CONFIG });
const overlayKit = new OverlayKit(world, camera, CONFIG);
const pixels = new PixelRenderer(svg, { world, camera, renderer, agents, parking, config: CONFIG });
const popup = new Popup(uiRoot);
const crt = new Crt(uiRoot);
const annotations = new Annotations(uiRoot, { world, camera, clock, style });
agents.log = growth.log = (text, pos) => annotations.log(text, pos);
const stylePanel = new StylePanel(uiRoot, style);

// Visual style: CSS classes on the map, CRT overlay, and the map warp.
function applyStyle(key) {
  svg.classList.toggle('crisp', !!style.get('crisp'));
  svg.classList.toggle('broken', !!style.get('broken'));
  svg.classList.toggle('glow', !!style.get('glow'));
  crt.set({ scanlines: style.get('scanlines') });
  if (!key || key.startsWith('pixel')) {
    pixels.set({ size: style.get('pixels'), weight: style.get('pixelWeight'), detail: style.get('pixelDetail'), follow: style.get('pixelFollow') });
    annotations.pixelScale = pixels.scale;
  }
  if (key === 'warp' || key === 'tremor') {
    camera.warp = makeWarp(world.seed, style.get('warp'), style.get('tremor'));
    renderer.invalidate();
  }
  if (key === 'frame') renderer.dirty.add('frame');
}
style.onChange(applyStyle);
applyStyle();

const tools = new ToolManager(world.grid, 'inspect');
const ctx = { world, camera, tools, popup, growth, config: CONFIG };
tools.register(createInspectTool(ctx));
tools.register(createNetworkTool(ctx, { kind: 'road', label: 'Road', hotkey: 'r' }));
tools.register(createNetworkTool(ctx, { kind: 'path', label: 'Footpath', hotkey: 'f', fineGrid: true }));
for (const def of STRUCTURES) tools.register(createBuildTool(ctx, def));
tools.register(createBulldozeTool(ctx));

const actions = {
  rotateLeft: () => { camera.rotate(-1, ...viewport); renderer.invalidate(); },
  rotateRight: () => { camera.rotate(1, ...viewport); renderer.invalidate(); },
  pause: () => { clock.paused = !clock.paused; },
  style: () => stylePanel.toggle(),
  speed: () => clock.cycleSpeed(),
  newMap: () => {
    if (!confirm('Discard this city and generate a new map?')) return;
    world.events.off('*', scheduleSave);
    clearTimeout(saveTimer);
    localStorage.removeItem(CONFIG.storageKey);
    location.reload();
  },
};

const hud = new Hud(uiRoot, { world, tools, agents, clock, actions });
tools.onChange((tool) => svg.classList.toggle('show-fine', !!tool.fineGrid));
tools.use('inspect');

// ---------- input ----------

attachInput(svg, {
  camera,
  onPointer: (x, y) => tools.pointer(x, y),
  onClick: (e) => tools.click(e),
  onCancel: () => { popup.hide(); tools.cancel(); },
});

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'Escape') {
    if (popup.open) popup.hide();
    else tools.cancel();
    return;
  }
  if (tools.key(e)) {
    e.preventDefault();
    return;
  }
  const k = e.key.toLowerCase();
  if (k === 'q') return actions.rotateLeft();
  if (k === 'e') return actions.rotateRight();
  if (k === 'p' || k === ' ') { e.preventDefault(); return actions.pause(); }
  if (k === 't') return actions.speed();
  const tool = tools.list().find((t) => t.hotkey === k);
  if (tool) {
    popup.hide();
    tools.use(tool.id);
  }
});

// ---------- loop ----------

let last = performance.now();
let reported = false;
function loop(now) {
  // schedule the next frame first, so one failing frame can't stop the game
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  try {
    const simDt = clock.step(dt);
    agents.update(simDt);
    growth.update(simDt);
    renderer.frame(tools.overlay(overlayKit) + annotations.overlay(overlayKit, tools.point, tools.active?.id));
    pixels.frame();
    hud.update();
    annotations.update();
  } catch (err) {
    if (!reported) console.error('Frame failed:', err);
    reported = true;
  }
}
requestAnimationFrame(loop);

// Handy for debugging from the console.
window.urbanismus = { world, camera, clock, agents, growth, parking, tools, renderer, style, annotations, pixels, hud };
