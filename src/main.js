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
import { WeatherSystem } from './sim/weather.js';
import { RainCanvas } from './render/rain.js';
import { CloudShadows } from './render/cloudShadows.js';
import { ParkingSystem } from './sim/parking.js';
import { TrainSystem } from './sim/trains.js';
import { BoatSystem } from './sim/boats.js';
import { DeerSystem } from './sim/deer.js';
import { LivestockSystem } from './sim/livestock.js';
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
import { askLanguage, LanguageMenu } from './ui/languages.js';
import { AssetsPage } from './ui/assetsPage.js';
import { sketchFrames, HANDS } from './ui/sketchFrame.js';
import { reveal } from './ui/motion.js';
import { attachInput } from './ui/input.js';
import { exportCity, pickCity } from './ui/saveFile.js';
import { createCommands } from './dev/commands.js';
import { BUILD_FAMILIES, STRUCTURE_TYPES, kindShown } from '../structures/index.js';
import { keyOf } from './ui/keys.js';
import { loadText, t, language, saveLanguage, needsLanguage } from './core/text.js';

applyTheme();
// the words for everything on screen (text/*.txt), before any of it is built
await loadText();

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
  [-3, -3, world.grid.width + 2, world.grid.height + 2], 0.125); // (fine enough for the cliff faces, terrain/rocks.js)
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
const boats = new BoatSystem(world, CONFIG);
const deer = new DeerSystem(world, CONFIG, agents);
const livestock = new LivestockSystem(world, CONFIG);
const weather = new WeatherSystem(world, CONFIG);
const rain = new RainCanvas(document.getElementById('rain'));
const cloudShadows = new CloudShadows(document.getElementById('cloud-shadows'), world.seed);
// the walls' shading follows the sun (styles.css --sun), and a grey sky
// shades the whole map (#gloom) and, a little less, the UI's paper (--gloom)
const objectsSvg = document.getElementById('objects');
const gloomEl = document.getElementById('gloom');
let sunFor = null;
let wind = 0;
const showSun = (kind) => {
  if (kind === sunFor) return;
  sunFor = kind;
  objectsSvg.style.setProperty('--sun', CONFIG.weather.sun[kind] ?? 1);
  gloomEl.style.opacity = CONFIG.weather.gloom[kind] ?? 0;
  uiRoot.style.setProperty('--gloom', `${Math.round((CONFIG.weather.gloom[kind] ?? 0) * 100)}%`);
};
agents.trains = trains;
trains.onCall = (id) => agents.transitCall(id); // passengers get on and off
const renderer = new Renderer(svg, document.getElementById('ground'), { world, camera, agents, trains, boats, deer, livestock, parking, config: CONFIG });
const overlayKit = new OverlayKit(world, camera, CONFIG);
const popup = new Popup(uiRoot);
// The top of a building's own drawing (its walls and roofs: not the trees
// and other screen-facing glyphs of its yard, which may stand far taller
// and further back), in scene units, for its name over it; kept while the
// same one is pointed at in the same turn of the view.
let topCache = { key: '', y: null };
function topOf(s) {
  const key = `${s.id}:${camera.rotation}`;
  if (topCache.key === key) return topCache.y;
  const g = renderer.objs.get(`s${s.id}`)?.g;
  let top = Infinity;
  if (g?.isConnected) {
    for (const el of g.querySelectorAll('polygon, polyline, path')) {
      if (el.closest('.sway') || el.matches('.glyph, .tree')) continue;
      const r = el.getBoundingClientRect();
      if (r.height || r.width) top = Math.min(top, r.top);
    }
  }
  if (top === Infinity) return null; // (not drawn yet: ask again next time)
  const y = camera.clientToScene(0, top)[1]; // (window coordinates, as the pointer's)
  topCache = { key, y };
  return y;
}
const annotations = new Annotations({ world, camera, clock, heights: () => renderer.contours, topOf });
agents.log = growth.log = trains.log = (text, pos) => annotations.log(text, pos);

// the town's chronicle, and the story told along the way (story/story.txt)
UNLOCKS.setWorld(world); // (what may be built: story/unlocks.txt, read with the story)
const chronicle = new Chronicle(world, CONFIG);
const dialogue = new Dialogue(uiRoot, { typing: CONFIG.story.typing, avoid: '.build-menu' });
const story = new Storyteller({ world, agents, trains, dialogue, chronicle, config: CONFIG });
// (read with the opening, below: openIntro)

const tools = new ToolManager(world.grid, 'inspect');
tools.allowed = (tool) => UNLOCKS.allowsTool(tool);
const ctx = { world, camera, tools, popup, growth, renderer, config: CONFIG };
tools.register(createInspectTool(ctx));
tools.register(createNetworkTool(ctx, { kind: 'road', group: 'transport' }));
tools.register(createNetworkTool(ctx, { kind: 'road', id: 'lane', lane: true, group: 'transport' }));
tools.register(createNetworkTool(ctx, { kind: 'path', fineGrid: true, group: 'transport' }));
tools.register(createNetworkTool(ctx, { kind: 'rail', fineGrid: true, group: 'transport' }));
for (const defs of BUILD_FAMILIES) tools.register(createBuildTool(ctx, defs));
tools.register(createNetworkTool(ctx, { kind: 'fence', fineGrid: true, group: 'farming' }));
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
  debug: () => { debugPanel.toggle(); if (debugPanel.open) hud.buildMenu.makeRoom(); },
  rotateLeft: () => { camera.rotate(-1, ...viewport); renderer.invalidate(); },
  rotateRight: () => { camera.rotate(1, ...viewport); renderer.invalidate(); },
  pause: () => { clock.paused = !clock.paused; },
  speed: () => clock.cycleSpeed(),
  terrain: () => setContours(!renderer.contours),
  colors: () => { colorMenu.toggle(); if (colorMenu.open) hud.buildMenu.makeRoom(); },
  assets: () => assetsPage.toggle(),
  newMap: () => newMapMenu.toggle(),
  photo: () => tools.use(tools.active?.id === 'photo' ? 'inspect' : 'photo'),
  export: () => exportCity(world),
  import: () => importCity(),
  fullscreen: () => toggleFullscreen(),
  chronicle: () => { if (UNLOCKS.allowsControl('chronicle')) chronicleBook.toggle(); },
  language: () => { languageMenu.toggle(); if (languageMenu.open) hud.buildMenu.makeRoom(); },
};

// Another language (picked in the Language menu or on the opening cover):
// everything on screen was written in the old one, so the town is saved
// straight away and the game loads again (behind the opening cover).
function switchLanguage(code) {
  saveLanguage(code);
  world.events.off('*', scheduleSave);
  clearTimeout(saveTimer);
  try {
    localStorage.setItem(CONFIG.storageKey, JSON.stringify(world.toJSON()));
  } catch (err) {
    console.warn('Save before switching language failed.', err);
  }
  // (picked now: ?ask-language, for trying the question, has done its job)
  const url = new URL(location.href);
  url.searchParams.delete('ask-language');
  location.replace(url);
}

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
  popup.show(at.left, at.bottom, t('fullscreen'), [
    { label: t('fullscreen.iphone'), info: true },
    { label: t('fullscreen.iphone.share'), info: true },
    { label: t('fullscreen.iphone.add'), info: true },
    { label: t('fullscreen.iphone.open'), info: true },
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
    return say(t('import.failed'), [{ label: err.message, info: true }]);
  }
  if (!city) return;
  const n = city.structures.size;
  say(t('import.ask', { town: city.name }), [
    { label: t('import.buildings', { n }), info: true },
    { label: t('import.replace'), note: t('import.replace.note'), action: () => replaceCity(city) },
    { label: t('cancel'), action: () => {} },
  ]);
  function replaceCity(city) {
    world.events.off('*', scheduleSave);
    clearTimeout(saveTimer);
    try {
      localStorage.setItem(CONFIG.storageKey, JSON.stringify(city.toJSON()));
    } catch {
      world.events.on('*', scheduleSave);
      return say(t('import.failed'), [{ label: t('import.storage'), info: true }]);
    }
    location.reload();
  }
}

const hud = new Hud(uiRoot, { world, camera, tools, chronicle, actions });
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
  for (const btn of uiRoot.querySelectorAll('.controls [data-act], .bm-loose [data-act], .hud .chron')) {
    btn.classList.toggle('locked', !UNLOCKS.allowsControl(btn.dataset.act ?? 'chronicle'));
  }
  const panels = { chronicle: chronicleBook, debug: debugPanel, assets: assetsPage, colors: colorMenu, newMap: newMapMenu, language: languageMenu };
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
    btn.title = btn.querySelector('.label').textContent = t(full ? 'fullscreen.leave' : 'fullscreen');
  };
  document.addEventListener('fullscreenchange', show);
  document.addEventListener('webkitfullscreenchange', show);
}
const debugPanel = new DebugPanel(uiRoot, { renderer, camera }); // TEMPORARY
const colorMenu = new ColorMenu(uiRoot, uiRoot.querySelector('[data-act="colors"]'));
const assetsPage = new AssetsPage(uiRoot);
const languageMenu = new LanguageMenu(uiRoot, uiRoot.querySelector('[data-act="language"]'), { onPick: switchLanguage });
const newMapMenu = new NewMapMenu(uiRoot, uiRoot.querySelector('[data-act="newMap"]'), { onCreate: newMap, onExport: () => exportCity(world) });
UNLOCKS.onChange(followUnlocks); // (once the panels it closes exist)
followUnlocks();
// pen-drawn frames on every UI box, to match the sketched map
// (the corner menu has none: words on the paper)
sketchFrames(uiRoot, '.hud', HANDS.steady);
sketchFrames(uiRoot, '.controls, .actions, .bm-panel, .bm-dock, .bm-rail-box, .debug-panel, .color-panel, .newmap-panel, .newmap-confirm');
sketchFrames(uiRoot, '.popup', HANDS.loose);

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
// The dots around the pointer (OverlayKit.nearDots): only while building,
// Select and Photo show the bare map; only those the tool can use.
let dots = null;
tools.onChange((tool) => {
  uiRoot.querySelector('[data-act="photo"]').classList.toggle('on', tool.id === 'photo');
  dots = tool.id === 'inspect' || tool.id === 'photo' ? null
    : { fine: !!tool.fineGrid, building: tool.id.startsWith('build:'), roads: tool.id === 'road' || tool.id === 'lane' };
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
  if (s) [tool, params] = [buildToolFor(s.type), { type: s.type, rotation: s.rotation, turn: s.data?.turn ?? 0, kind: kindShown(STRUCTURE_TYPES[s.type], s) }];
  else if (world.paths.hasNode(world.networks.path.nodeAt(...p))) tool = tools.registry.get('path');
  else if (world.rails.hasNode(world.networks.rail.nodeAt(...p))) tool = tools.registry.get('rail');
  else if (world.fences.hasNode(world.networks.fence.nodeAt(...p))) tool = tools.registry.get('fence');
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
  // by place on the keyboard (ui/keys.js): the number row opens a Build
  // menu group, the letter rows pick a tool in it; a few keys of their own
  const k = keyOf(e);
  if (k === '[') return actions.rotateLeft();
  if (k === ']') return actions.rotateRight();
  if (k === 'l') return actions.pause();
  if (k === ' ') e.preventDefault(); // (Space: another look, while building; not a page scroll)
  if (k === '`') return actions.speed();
  // the tools for making the game, not playing it: \ the debug panel,
  // Shift+\ the page of every drawing (each still unless locked)
  if (k === '\\') {
    const id = e.shiftKey ? 'assets' : 'debug';
    if (UNLOCKS.allowsControl(id)) actions[id]();
    return;
  }
  if (k === 'backspace') e.preventDefault(); // (Erase: not the browser's Back)
  const tool = tools.list().find((t) => t.hotkey === k);
  if (tool) {
    popup.hide();
    tools.use(tool.id);
  } else if (hud.buildMenu.key(k)) {
    popup.hide();
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
  picked: 350, // ms the language picked on the cover shows ticked before the map opens
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
  // never picked a language: asked here, under the name, before the map
  // opens (the guess it's loaded in, from the browser, comes ticked)
  if (card && needsLanguage()) {
    const code = await askLanguage(card);
    if (code !== language()) return switchLanguage(code);
    saveLanguage(code);
    const url = new URL(location.href);
    if (url.searchParams.has('ask-language')) {
      url.searchParams.delete('ask-language');
      history.replaceState(null, '', url);
    }
    await wait(INTRO.picked);
  }
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
    weather.update();
    agents.update(simDt);
    trains.update(simDt);
    boats.update(simDt);
    deer.update(simDt);
    livestock.update(simDt);
    growth.update(simDt);
    renderer.frame((dots ? overlayKit.nearDots(tools.point, dots) : '') + tools.overlay(overlayKit) + annotations.overlay(overlayKit, popup.open ? null : tools.point, tools.active?.id));
    cloudShadows.frame(simDt, camera, world.weather.kind);
    rain.frame(simDt, camera, CONFIG.weather.rain[world.weather.kind] ?? 0);
    showSun(world.weather.kind);
    // the wind eases to the weather's
    wind += ((CONFIG.weather.wind[world.weather.kind] ?? 0) - wind) * Math.min(1, simDt / 4);
    renderer.swayTrees(world.time, wind);
    hud.update();
    chronicle.update(dt);
    if (!opening) story.update(dt); // (the story waits for the map to be drawn)
  } catch (err) {
    if (!reported) console.error('Frame failed:', err);
    reported = true;
  }
}
requestAnimationFrame(loop);

// Handy for debugging from the console: cmd.help() (src/dev/commands.js).
window.cmd = createCommands({ world, config: CONFIG, clock, weather, agents, trains, boats, deer, livestock, growth, story, annotations, unlocks: UNLOCKS });
