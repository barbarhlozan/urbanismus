// Boot: create / load the world, wire systems together, run the loop.

import { CONFIG } from './config.js';
import { applyTheme } from './theme.js';
import { STYLE } from './render/style.js';
import { makeWarp, makeLift } from './render/warp.js';
import { ELEVATION } from './terrain/elevation.js';
import { Annotations } from './ui/annotations.js';
import { Dialogue } from './ui/dialogue.js';
import { ChronicleBook } from './ui/chronicleBook.js';
import { Chronicle } from './sim/chronicle.js';
import { Storyteller } from './story/storyteller.js';
import { UNLOCKS, applyScheme } from './story/unlocks.js';
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
import { createPhotoTool } from './tools/photo.js';
import { takePhoto } from './render/photo.js';
import { PhotoPrint } from './ui/photoPrint.js';
import { Popup } from './ui/popup.js';
import { Hud } from './ui/hud.js';
import { DebugPanel } from './ui/debugPanel.js'; // TEMPORARY
import { ColorMenu } from './ui/colorMenu.js';
import { NewMapMenu } from './ui/newMapMenu.js';
import { AssetsPage } from './ui/assetsPage.js';
import { sketchFrames } from './ui/sketchFrame.js';
import { reveal } from './ui/motion.js';
import { attachInput } from './ui/input.js';
import { exportCity, pickCity } from './ui/saveFile.js';
import { BUILD_FAMILIES } from '../structures/index.js';
import { keyOf } from './ui/keys.js';

applyTheme();

// ---------- world ----------

// Set up in the New map menu, handed over across the reload (see newMap).
const PENDING_KEY = 'urbanismus.pendingMap';

function loadWorld() {
  let pending = null;
  try {
    pending = JSON.parse(localStorage.getItem(PENDING_KEY));
    localStorage.removeItem(PENDING_KEY);
  } catch {
    // storage unavailable or garbled: no settings
  }
  if (!pending) {
    try {
      const raw = localStorage.getItem(CONFIG.storageKey);
      if (raw) return World.fromJSON(JSON.parse(raw));
    } catch (err) {
      console.warn('Could not load save, starting fresh.', err);
    }
  }
  const seed = pending?.seed ?? CONFIG.seed ?? Math.floor(Math.random() * 1e9);
  const world = new World({ ...CONFIG.grid, seed, name: pending?.name, hilliness: pending?.hilliness });
  generateWorld(world, { ...CONFIG, terrain: { ...CONFIG.terrain, ...pending?.terrain } });
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
camera.lift = makeLift(world.elevation, ELEVATION.relief, STYLE.relief,
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
clock.elapsed = world.time; // (the town's own time carries on from the save)
const parking = new ParkingSystem(world);
const agents = new AgentSystem(world, CONFIG, parking);
const growth = new GrowthSystem(world, CONFIG);
const trains = new TrainSystem(world, CONFIG);
agents.trains = trains;
trains.onCall = (id) => agents.transitCall(id); // passengers get on and off
const renderer = new Renderer(svg, document.getElementById('ground'), { world, camera, agents, trains, parking, config: CONFIG });
const overlayKit = new OverlayKit(world, camera, CONFIG);
const popup = new Popup(uiRoot);
const annotations = new Annotations({ world, camera, clock });
agents.log = growth.log = trains.log = (text, pos) => annotations.log(text, pos);

// the town's chronicle, and the story told along the way (story/story.txt)
UNLOCKS.setWorld(world); // (what may be built: story/unlocks.txt, read with the story)
const chronicle = new Chronicle(world, CONFIG);
const dialogue = new Dialogue(uiRoot, { typing: CONFIG.story.typing, avoid: '.build-menu' });
const story = new Storyteller({ world, agents, trains, dialogue, chronicle, config: CONFIG });
// (read with the opening, below: openIntro)

const tools = new ToolManager(world.grid, 'inspect');
tools.allowed = (tool) => UNLOCKS.allowsTool(tool);
const ctx = { world, camera, tools, popup, growth, config: CONFIG };
tools.register(createInspectTool(ctx));
tools.register(createNetworkTool(ctx, { kind: 'road', label: 'Road', hotkey: '1', group: 'transport', blurb: 'Cars and people' }));
tools.register(createNetworkTool(ctx, { kind: 'road', id: 'lane', lane: true, label: 'Lane', hotkey: '2', group: 'transport', blurb: 'Single track, slow cars' }));
tools.register(createNetworkTool(ctx, { kind: 'path', label: 'Footpath', hotkey: '3', fineGrid: true, group: 'transport', blurb: 'People and bikes' }));
tools.register(createNetworkTool(ctx, { kind: 'rail', label: 'Railway', hotkey: '4', fineGrid: true, group: 'transport', blurb: 'Trains from the map edge' }));
for (const defs of BUILD_FAMILIES) tools.register(createBuildTool(ctx, defs));
tools.register(createBulldozeTool(ctx));
const photoPrint = new PhotoPrint(uiRoot);
tools.register(createPhotoTool(ctx, {
  shoot: (shot) => {
    photoPrint.show(takePhoto(renderer, shot), world.name);
    world.story.vars.photos_taken = (world.story.vars.photos_taken ?? 0) + 1;
    chronicle.first('photo', `Someone took a photograph of ${world.name}.`);
  },
}));

const actions = {
  debug: () => debugPanel.toggle(),
  rotateLeft: () => { camera.rotate(-1, ...viewport); renderer.invalidate(); },
  rotateRight: () => { camera.rotate(1, ...viewport); renderer.invalidate(); },
  pause: () => { clock.paused = !clock.paused; },
  speed: () => clock.cycleSpeed(),
  terrain: () => setContours(!renderer.contours),
  colors: () => colorMenu.toggle(),
  assets: () => assetsPage.toggle(),
  newMap: () => newMapMenu.toggle(),
  photo: () => tools.use(tools.active?.id === 'photo' ? 'inspect' : 'photo'),
  export: () => exportCity(world),
  import: () => importCity(),
  fullscreen: () => toggleFullscreen(),
  chronicle: () => { if (UNLOCKS.allowsControl('chronicle')) chronicleBook.toggle(); },
};

// Full screen: the whole page, UI and all. Safari (iPad too) wants its own
// prefixed names. An iPhone has no full screen for pages at all: there the
// button explains how to put the game on the home screen, from where it
// opens as an app, without Safari around it (manifest.webmanifest). Opened
// that way it's as full as it gets, and the button hides.
const fs = {
  // what the browser can do, not what it says (iPad Safari leaves
  // fullscreenEnabled out but can go full screen all the same)
  enabled: () => !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen),
  app: () => matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || navigator.standalone === true,
  element: () => document.fullscreenElement ?? document.webkitFullscreenElement,
  enter: () => (document.documentElement.requestFullscreen ?? document.documentElement.webkitRequestFullscreen)?.call(document.documentElement),
  exit: () => (document.exitFullscreen ?? document.webkitExitFullscreen)?.call(document),
};
function toggleFullscreen() {
  if (!fs.enabled()) return explainHomeScreen();
  const p = fs.element() ? fs.exit() : fs.enter();
  p?.catch?.(() => { /* refused (not from a click, or not allowed here) */ });
}

// iPhone: no full screen for pages, but the game added to the home screen
// opens without Safari's bars – say how, under the button.
function explainHomeScreen() {
  const at = uiRoot.querySelector('[data-act="fullscreen"]').getBoundingClientRect();
  popup.show(at.left, at.bottom, 'Full screen', [
    { label: 'Safari can’t show web pages full screen on iPhone. Add the game to your home screen instead:', info: true },
    { label: '1. Tap Share (the square with the arrow)', info: true },
    { label: '2. Choose Add to Home Screen', info: true },
    { label: 'Open it from there: it fills the screen like an app.', info: true },
  ]);
}

// Discard this city and start over with the New map menu's settings.
function newMap(settings) {
  world.events.off('*', scheduleSave);
  clearTimeout(saveTimer);
  try {
    localStorage.removeItem(CONFIG.storageKey);
    localStorage.setItem(PENDING_KEY, JSON.stringify(settings));
  } catch {
    // storage unavailable: the reload rolls a map of its own
  }
  location.reload();
}

// Replace this city with one from a file (see saveFile.js): it goes in as the
// autosave and the reload picks it up, as after newMap.
async function importCity() {
  const at = uiRoot.querySelector('.controls').getBoundingClientRect();
  const say = (title, items) => popup.show(innerWidth, at.bottom, title, items);
  let city;
  try {
    city = await pickCity();
  } catch (err) {
    return say('Could not import', [{ label: err.message, info: true }]);
  }
  if (!city) return;
  const n = city.structures.size;
  say(`Import ${city.name}?`, [
    { label: `${n} ${n === 1 ? 'building' : 'buildings'}`, info: true },
    { label: 'Replace this city', note: 'it will be lost', action: () => replaceCity(city) },
    { label: 'Cancel', action: () => {} },
  ]);
  function replaceCity(city) {
    world.events.off('*', scheduleSave);
    clearTimeout(saveTimer);
    try {
      localStorage.setItem(CONFIG.storageKey, JSON.stringify(city.toJSON()));
    } catch {
      world.events.on('*', scheduleSave);
      return say('Could not import', [{ label: 'This browser would not store the city.', info: true }]);
    }
    location.reload();
  }
}

const hud = new Hud(uiRoot, { world, tools, agents, trains, chronicle, actions });
const chronicleBook = new ChronicleBook(uiRoot, { world, chronicle });
// something locked or unlocked: the Build menu and the buttons at the top
// follow, a tool in hand that may no longer be used is put down, and a panel
// whose button went is closed
const followUnlocks = () => {
  hud.buildMenu.refreshLocks();
  if (tools.active && !tools.allowed(tools.active)) tools.use(tools.defaultId);
  // cars, trucks and buses: off the map if locked, and the car parks follow
  agents.followVehicles();
  renderer.dirty.add('parked');
  for (const btn of uiRoot.querySelectorAll('.controls [data-act], .hud .chron')) {
    btn.classList.toggle('locked', !UNLOCKS.allowsControl(btn.dataset.act ?? 'chronicle'));
  }
  const panels = { chronicle: chronicleBook, debug: debugPanel, assets: assetsPage, colors: colorMenu, newMap: newMapMenu };
  for (const [id, panel] of Object.entries(panels)) {
    if (panel?.open && !UNLOCKS.allowsControl(id)) (panel.hide ? panel.hide() : panel.toggle(false));
  }
};

// The colour scheme from story/unlocks.txt (`scheme Night`): put on when the
// line changes (so editing it shows), or every time while the Colors button
// is locked; otherwise the player's own pick from the Colors menu stays.
const FILE_SCHEME_KEY = 'urbanismus.fileScheme';
function fileScheme() {
  const value = UNLOCKS.scheme?.value;
  if (!value) return;
  let last = null;
  try { last = localStorage.getItem(FILE_SCHEME_KEY); } catch { /* storage unavailable */ }
  if (last === value && UNLOCKS.allowsControl('colors')) return;
  applyScheme(value);
  colorMenu.refresh();
  try { localStorage.setItem(FILE_SCHEME_KEY, value); } catch { /* storage unavailable */ }
}
story.onScheme = () => colorMenu.refresh();
// the full-screen button: its icon and name following the state; hidden
// when the game already runs as an app from the home screen
{
  const btn = uiRoot.querySelector('[data-act="fullscreen"]');
  if (fs.app()) btn.hidden = true;
  const show = () => {
    const full = !!fs.element();
    btn.classList.toggle('full', full);
    btn.title = full ? 'Leave full screen' : 'Full screen';
    btn.querySelector('.label').textContent = full ? 'Leave full screen' : 'Full screen';
  };
  document.addEventListener('fullscreenchange', show);
  document.addEventListener('webkitfullscreenchange', show);
}
const debugPanel = new DebugPanel(uiRoot, { renderer, camera }); // TEMPORARY
debugPanel.onToggle = (open) => uiRoot.querySelector('[data-act="debug"]').classList.toggle('on', open);
const colorMenu = new ColorMenu(uiRoot, uiRoot.querySelector('[data-act="colors"]'));
const assetsPage = new AssetsPage(uiRoot);
const newMapMenu = new NewMapMenu(uiRoot, uiRoot.querySelector('[data-act="newMap"]'), { onCreate: newMap });
UNLOCKS.onChange(followUnlocks); // (once the panels it closes exist)
followUnlocks();
// pen-drawn frames on every UI box, to match the sketched map
sketchFrames(uiRoot, '.hud, .controls, .actions, .popup, .bm-panel, .bm-dock, .debug-panel, .color-panel, .newmap-panel');

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
  uiRoot.querySelector('[data-act="photo"]').classList.toggle('on', tool.id === 'photo');
  // dots only while building; Select and Photo show the bare map
  svg.classList.toggle('show-grid', tool.id !== 'inspect' && tool.id !== 'photo');
  svg.classList.toggle('show-fine', !!tool.fineGrid);
});
tools.use('inspect');

// ---------- input ----------

// Right-click with nothing in hand picks up what's under the pointer (a
// building of the same kind and size, turned the same way, or the road,
// railway or footpath) to build more of it; right-click again puts it down.
const buildToolFor = (type) => tools.list().find((t) => t.defs?.some((d) => d.id === type));
function pickUp() {
  const p = tools.point;
  const node = tools.hoverNode;
  if (!p || node < 0) return;
  const s = world.structureAt(node);
  let tool = null, params = {};
  if (s) [tool, params] = [buildToolFor(s.type), { type: s.type, rotation: s.rotation, turn: s.data?.turn ?? 0 }];
  else if (world.paths.hasNode(world.networks.path.nodeAt(...p))) tool = tools.registry.get('path');
  else if (world.rails.hasNode(world.networks.rail.nodeAt(...p))) tool = tools.registry.get('rail');
  else if (world.hasRoad(node)) tool = tools.registry.get(world.laneOnly(node) ? 'lane' : 'road');
  if (!tool) return;
  tools.use(tool.id, params);
}

attachInput(document.getElementById('input'), {
  camera,
  onPointer: (x, y) => tools.pointer(x, y),
  onClick: (e) => tools.click(e),
  onCancel: () => {
    if (popup.open) return popup.hide();
    if (tools.active?.id === tools.defaultId) return pickUp();
    tools.cancel();
  },
  // middle click works like Tab: rotate what's being placed, flip a line's bend
  onMiddle: () => tools.key({ key: 'Tab', preventDefault() {} }),
});

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  // the open book takes the keys (and nothing reaches the map behind it)
  if (chronicleBook.open) {
    if (chronicleBook.key(e)) e.preventDefault();
    return;
  }
  if (dialogue.key(e)) {
    e.preventDefault();
    return;
  }
  if (e.key === 'Escape') {
    if (photoPrint.open) photoPrint.hide();
    else if (popup.open) popup.hide();
    // nothing in hand: Esc folds the open Build menu away
    else if (tools.active?.id === tools.defaultId && !hud.buildMenu.folded) hud.buildMenu.fold(true);
    else tools.cancel();
    return;
  }
  if (tools.key(e)) {
    e.preventDefault();
    return;
  }
  // by place on the keyboard (ui/keys.js): the letter and number rows are
  // build tools, in Build menu order
  const k = keyOf(e);
  if (k === '[') return actions.rotateLeft();
  if (k === ']') return actions.rotateRight();
  if (k === 'l') return actions.pause();
  if (k === ' ') e.preventDefault(); // (Space: another look, while building; not a page scroll)
  if (k === '`') return actions.speed();
  if (k === 'backspace') e.preventDefault(); // (Erase: not the browser's Back)
  const tool = tools.list().find((t) => t.hotkey === k || t.hotkeys?.includes(k));
  if (tool) {
    popup.hide();
    tools.use(tool.id, { hotkey: k });
  }
});

// ---------- opening ----------

// The cover in index.html shows the town's name, underlined by a pen
// stroke as it appears, while everything loads. A new town (or a first
// visit) has no name to show yet: the game's own name comes first, and
// gives way to the town's once it's made. Once the story and what's
// unlocked are read (so the Build menu and the buttons are right from the
// first look), the map has been drawn and the underline is done, the name
// fades, a hole opens from the middle to show the map – the nearest
// buildings sketched in by the pen as the edge reaches them – and the
// panels come in.
const INTRO = {
  underline: 950, // ms from the name appearing to its underline done (.intro-pen in styles.css), and a breath
  title: 1700, // a new town: ms the game's name shows before the town's takes over…
  swap: 420,   // …and for it to fade out (.intro-card in styles.css) first;
  named: 1500, // then the new town's name shows this long before the map opens (it's new: time to read it)
  delay: 180,  // ms before the hole starts opening (the name fades meanwhile)
  open: 1300,  // ms for the hole to open (as .intro.opening in styles.css)
  panels: 650, // ms after it starts that the panels come in
};
let opening = true;
async function openIntro() {
  await story.load();
  fileScheme();
  const intro = document.getElementById('intro');
  const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // the map drawn with what's unlocked, and the name in its font
  await frames();
  const card = intro?.querySelector('.intro-card');
  const name = intro?.querySelector('.intro-name');
  const show = () => {
    card?.classList.remove('out');
    card?.classList.add('shown'); // (its underline starts again with it)
    window.introShownAt = performance.now();
  };
  if (card && !card.classList.contains('shown')) show();
  if (window.introTitle && name) {
    // the game's name a while, then the new town's in its place
    await wait(Math.max(0, window.introShownAt + INTRO.title - performance.now()));
    card.classList.replace('shown', 'out');
    await wait(INTRO.swap);
    name.textContent = world.name;
    show();
  } else if (name && name.textContent !== world.name) {
    name.textContent = world.name;
  }
  await wait(Math.max(0, window.introShownAt + (window.introTitle ? INTRO.named : INTRO.underline) - performance.now()));
  // the pen gets the middle ready under the cover (each drawing hidden
  // until its turn), a couple of frames before the hole opens on it
  const start = performance.now() + 50;
  const reach = Math.hypot(innerWidth, innerHeight) * 1.5 / 2;
  renderer.sketchIntro((px) => start - performance.now() + INTRO.delay + INTRO.open * Math.sqrt(Math.min(1, px / reach)) * 0.85);
  await frames();
  intro?.classList.add('opening');
  setTimeout(() => {
    document.body.classList.remove('loading');
    // (the Build menu's own box is centred with a transform: its panel and dock move instead)
    const panels = [...uiRoot.querySelectorAll('.hud, .controls, .bm-panel, .bm-dock, .credit')];
    // each stays out of sight until its own entrance starts (else it shows, blinks out, comes in)
    for (const el of panels) el.style.opacity = '0';
    panels.forEach((el, i) => setTimeout(() => {
      el.style.opacity = '';
      reveal(el, true, { force: true, from: [0, el.closest('.build-menu') ? 14 : -8] });
    }, i * 70));
  }, INTRO.panels);
  setTimeout(() => {
    intro?.remove();
    opening = false;
  }, INTRO.delay + INTRO.open + 100);
}
openIntro();

// ---------- loop ----------

let last = performance.now();
let reported = false;
function loop(now) {
  // schedule the next frame first, so one failing frame can't stop the game
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  // the New map dialog: the town stands still behind it (nobody's watching,
  // and a still picture is cheap to blur), and carries on when it closes
  if (newMapMenu.open) return;
  try {
    const simDt = clock.step(dt);
    world.time = clock.elapsed;
    agents.update(simDt);
    trains.update(simDt);
    growth.update(simDt);
    renderer.frame(tools.overlay(overlayKit) + annotations.overlay(overlayKit, tools.point, tools.active?.id));
    hud.update();
    chronicle.update(dt);
    if (!opening) story.update(dt); // (the story waits for the map to be drawn)
  } catch (err) {
    if (!reported) console.error('Frame failed:', err);
    reported = true;
  }
}
requestAnimationFrame(loop);

// Handy for debugging from the console.
window.urbanismus = { world, camera, clock, agents, trains, growth, parking, tools, renderer, annotations, hud, story, chronicle, dialogue };
