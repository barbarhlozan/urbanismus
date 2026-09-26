// Boot: create / load the world, wire systems together, run the loop.

import { CONFIG } from './config.js';
import { applyTheme } from './theme.js';
import { STYLE } from './render/style.js';
import { makeWarp, makeLift } from './render/warp.js';
import { ELEVATION, makeElevation } from './terrain/elevation.js';
import { Annotations } from './ui/annotations.js';
import { World } from './core/world.js';
import { generateWorld } from './terrain/generate.js';
import { Camera } from './render/camera.js';
import { Renderer } from './render/renderer.js';
import { OverlayKit } from './render/overlay.js';
import { AgentSystem } from './sim/agents.js';
import { GrowthSystem } from './sim/growth.js';
import { SimClock } from './sim/clock.js';
import { ParkingSystem } from './sim/parking.js';
import { TrainSystem } from './sim/trains.js';
import { ToolManager } from './tools/manager.js';
import { createInspectTool } from './tools/inspect.js';
import { createNetworkTool } from './tools/network.js';
import { createBuildTool } from './tools/build.js';
import { createBulldozeTool } from './tools/bulldoze.js';
import { Popup } from './ui/popup.js';
import { Hud } from './ui/hud.js';
import { DebugPanel } from './ui/debugPanel.js'; // TEMPORARY
import { attachInput } from './ui/input.js';
import { BUILD_FAMILIES } from '../structures/index.js';

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

const camera = new Camera(world.grid, CONFIG.camera);
camera.warp = makeWarp(world.seed, STYLE.warp, STYLE.tremor);
camera.lift = makeLift(makeElevation(world.seed), ELEVATION.relief, STYLE.relief,
  [-3, -3, world.grid.width + 2, world.grid.height + 2]);
camera.centerOn(camera.cx, camera.cy, innerWidth, innerHeight);

// Keep whatever is in the middle of the screen in the middle when resizing.
// (the SVGs reach past the window, see Renderer.placeView, so use the window)
let viewport = [innerWidth, innerHeight];
window.addEventListener('resize', () => {
  const [w, h] = [innerWidth, innerHeight];
  camera.panX += (w - viewport[0]) / 2;
  camera.panY += (h - viewport[1]) / 2;
  viewport = [w, h];
});

const clock = new SimClock(CONFIG);
const parking = new ParkingSystem(world);
const agents = new AgentSystem(world, CONFIG, parking);
const growth = new GrowthSystem(world, CONFIG);
const trains = new TrainSystem(world, CONFIG);
agents.trains = trains;
const renderer = new Renderer(svg, document.getElementById('ground'), { world, camera, agents, trains, parking, config: CONFIG });
const overlayKit = new OverlayKit(world, camera, CONFIG);
const popup = new Popup(uiRoot);
const annotations = new Annotations(uiRoot, { world, camera, clock });
agents.log = growth.log = trains.log = (text, pos) => annotations.log(text, pos);

const tools = new ToolManager(world.grid, 'inspect');
const ctx = { world, camera, tools, popup, growth, config: CONFIG };
tools.register(createInspectTool(ctx));
tools.register(createNetworkTool(ctx, { kind: 'road', label: 'Road', hotkey: 'r', group: 'transport', blurb: 'Cars, bikes and people' }));
tools.register(createNetworkTool(ctx, { kind: 'path', label: 'Footpath', hotkey: 'f', fineGrid: true, group: 'transport', blurb: 'People and bikes · along a road makes a street' }));
tools.register(createNetworkTool(ctx, { kind: 'rail', label: 'Railway', hotkey: 'l', group: 'transport', blurb: 'Off the map edge brings trains' }));
for (const defs of BUILD_FAMILIES) tools.register(createBuildTool(ctx, defs));
tools.register(createBulldozeTool(ctx));

const actions = {
  rotateLeft: () => { camera.rotate(-1, ...viewport); renderer.invalidate(); },
  rotateRight: () => { camera.rotate(1, ...viewport); renderer.invalidate(); },
  pause: () => { clock.paused = !clock.paused; },
  speed: () => clock.cycleSpeed(),
  terrain: () => setContours(!renderer.contours),
  newMap: () => {
    if (!confirm('Discard this city and generate a new map?')) return;
    world.events.off('*', scheduleSave);
    clearTimeout(saveTimer);
    localStorage.removeItem(CONFIG.storageKey);
    location.reload();
  },
};

const hud = new Hud(uiRoot, { world, tools, agents, trains, clock, actions });
new DebugPanel(uiRoot, { renderer, camera }); // TEMPORARY

// Terrain contour lines: off unless switched on (remembered in this browser).
const CONTOURS_KEY = 'urbanismus.contours';
function setContours(on) {
  renderer.setContours(on);
  uiRoot.querySelector('[data-act="terrain"]').classList.toggle('on', on);
  try {
    localStorage.setItem(CONTOURS_KEY, on ? '1' : '0');
  } catch {
    // storage unavailable: the choice just won't be remembered
  }
}
let savedContours = null;
try {
  savedContours = localStorage.getItem(CONTOURS_KEY);
} catch {
  // storage unavailable
}
setContours(savedContours === null ? STYLE.contours : savedContours === '1');
tools.onChange((tool) => {
  // dots only while building; Select shows the bare map
  svg.classList.toggle('show-grid', tool.id !== 'inspect');
  svg.classList.toggle('show-fine', !!tool.fineGrid);
});
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
  const tool = tools.list().find((t) => t.hotkey === k || t.hotkeys?.includes(k));
  if (tool) {
    popup.hide();
    tools.use(tool.id, { hotkey: k });
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
    trains.update(simDt);
    growth.update(simDt);
    renderer.frame(tools.overlay(overlayKit) + annotations.overlay(overlayKit, tools.point, tools.active?.id));
    hud.update();
    annotations.update();
  } catch (err) {
    if (!reported) console.error('Frame failed:', err);
    reported = true;
  }
}
requestAnimationFrame(loop);

// Handy for debugging from the console.
window.urbanismus = { world, camera, clock, agents, trains, growth, parking, tools, renderer, annotations, hud };
