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
import { SUN, sunAt, DAY, hourAt } from './render/shadows.js';
import { OverlayKit } from './render/overlay.js';
import { AgentSystem } from './sim/agents.js';
import { FireSystem } from './sim/fire.js';
import { GrowthSystem } from './sim/growth.js';
import { Families } from './sim/families.js';
import { SimClock } from './sim/clock.js';
import { WeatherSystem, mistRisen } from './sim/weather.js';
import { Ambience } from './audio/ambience.js';
import { SOUNDS, LICENCES, sourceOf } from './audio/sounds.js';
import { RainCanvas } from './render/rain.js';
import { CloudShadows } from './render/cloudShadows.js';
import { CloudsAbove } from './render/cloudsAbove.js';
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
import { contoursSetting } from './tools/terrain.js';
import { takePhoto } from './render/photo.js';
import { PhotoPrint } from './ui/photoPrint.js';
import { printImage, putPrint, deletePrint, newPrintId, clearPrints } from './ui/prints.js';
import { Popup } from './ui/popup.js';
import { Hud } from './ui/hud.js';
import { DebugPanel } from './ui/debugPanel.js'; // TEMPORARY
import { DevStrip } from './ui/devStrip.js'; // TEMPORARY
import { ColorMenu } from './ui/colorMenu.js';
import { NewMapMenu } from './ui/newMapMenu.js';
import { askLanguage } from './ui/languages.js';
import { loadIcons } from './ui/uiIcons.js';
import { AssetsPage } from './ui/assetsPage.js';
import { sketchFrames, HANDS } from './ui/sketchFrame.js';
import { penMarks } from './ui/penMarks.js';
import { reveal } from './ui/motion.js';
import { attachInput } from './ui/input.js';
import { exportCity, pickCity, putPrints } from './ui/saveFile.js';
import { createCommands } from './dev/commands.js';
import { BUILD_FAMILIES, STRUCTURE_TYPES, kindShown } from '../structures/index.js';
import { keyOf } from './ui/keys.js';
import { loadText, t, reasonText, language, saveLanguage, needsLanguage, LANGUAGES } from './core/text.js';

applyTheme();
// the words for everything on screen (text/*.txt) and the UI's drawings
// (icons/ui/), before any of it is built
await Promise.all([loadText(), loadIcons()]);

// The map is drawn with WebGL 2 (src/render/gl/): without it there is no
// map – the opening cover says so, and stays.
if (!document.createElement('canvas').getContext('webgl2')) {
  const card = document.querySelector('.intro-card');
  const note = card?.appendChild(document.createElement('p'));
  if (note) {
    note.className = 'intro-note';
    note.textContent = t('noWebGL');
    card.classList.add('shown');
  }
  throw new Error('No WebGL 2: the map cannot be drawn');
}

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
camera.setViewport(innerWidth, innerHeight); // (keeps the map in view, see Camera.pan)
camera.centerOn(camera.cx, camera.cy, innerWidth, innerHeight);

// Keep whatever is in the middle of the screen in the middle when resizing.
// (the SVGs reach past the window, see Renderer.placeView, so use the window)
let viewport = [innerWidth, innerHeight];
window.addEventListener('resize', () => {
  const [w, h] = [innerWidth, innerHeight];
  camera.panX += (w - viewport[0]) / 2;
  camera.panY += (h - viewport[1]) / 2;
  viewport = [w, h];
  camera.setViewport(w, h);
});

const clock = new SimClock(CONFIG);
clock.elapsed = world.time; // (the town's own time carries on from the save)
DAY.shift = DAY.start - hourAt(world.time, { ...DAY, shift: 0 }); // (but each visit opens in the morning)
const parking = new ParkingSystem(world);
const agents = new AgentSystem(world, CONFIG, parking);
const fires = new FireSystem(world, agents, CONFIG);
const growth = new GrowthSystem(world, CONFIG);
new Families(world); // who lives where and runs what (kept on the buildings)
const trains = new TrainSystem(world, CONFIG);
const boats = new BoatSystem(world, CONFIG);
const deer = new DeerSystem(world, CONFIG, agents);
const livestock = new LivestockSystem(world, CONFIG);
const weather = new WeatherSystem(world, CONFIG);
const rain = new RainCanvas(document.getElementById('rain'));
const ambience = new Ambience(); // (the weather's sound: the wind and the rain)
const cloudShadows = new CloudShadows(document.getElementById('cloud-shadows'), world.seed);
const cloudsAbove = new CloudsAbove(document.getElementById('clouds-above'), cloudShadows); // (zoomed far out, the clouds themselves)
// the shadows follow the sun (styles.css --sun), and a grey sky
// shades the whole map (#gloom) and, a little less, the UI's paper (--gloom)
const objectsSvg = document.getElementById('objects');
const groundSvg = document.getElementById('ground'); // (the hills' shadows, render/hillShadows.js)
const gloomEl = document.getElementById('gloom');
// As the weather turns these go over gradually (WeatherSystem.sky), but in
// steps – each new --sun repaints the whole map – and the CSS eases between.
let sunFor = null, gloomFor = null, uiGloomFor = null;
let wind = 0;
const showSun = ({ sun, gloom }) => {
  sun = Math.round(sun * 20) / 20;
  // the dusk and the night grey the map too (DAY.steps), drawn with the
  // night itself, so the lights are left out of it (Renderer.renderNight);
  // the UI's paper takes some of both
  const ui = Math.round((1 - (1 - gloom) * (1 - (renderer.gloom ?? 0))) * 50) / 50;
  gloom = Math.round(gloom * 50) / 50;
  if (sun !== sunFor) {
    sunFor = sun;
    for (const el of [groundSvg, svg, objectsSvg]) el.style.setProperty('--sun', sun);
  }
  if (gloom !== gloomFor || ui !== uiGloomFor) {
    gloomFor = gloom;
    uiGloomFor = ui;
    gloomEl.style.opacity = gloom;
    uiRoot.style.setProperty('--gloom', `${Math.round(ui * 100)}%`);
  }
};
agents.trains = trains;
trains.onCall = (id) => agents.transitCall(id); // passengers get on and off
const renderer = new Renderer(svg, document.getElementById('ground'), { world, camera, agents, trains, boats, deer, livestock, parking, config: CONFIG });
renderer.setSun(sunAt(world.time)); // (the sun as the day has it, before the map is first drawn)
const overlayKit = new OverlayKit(world, camera, CONFIG);
const popup = new Popup(uiRoot);
const annotations = new Annotations({ world, camera, clock, heights: () => renderer.contours });
agents.log = growth.log = trains.log = (text, pos) => annotations.log(text, pos);

// the town's chronicle, and the story told along the way (story/story.txt)
UNLOCKS.setWorld(world); // (what may be built: story/unlocks.txt, read with the story)
const chronicle = new Chronicle(world, CONFIG);
const dialogue = new Dialogue(uiRoot, { typing: CONFIG.story.typing, avoid: '.build-menu' });
const story = new Storyteller({ world, agents, fires, trains, dialogue, chronicle, config: CONFIG });
// (read with the opening, below: openIntro)

const tools = new ToolManager(world.grid, 'inspect');
tools.allowed = (tool) => UNLOCKS.allowsTool(tool);
// (contours: the Terrain button beside Erase, tools/terrain.js; the button is
// told whenever it changes)
const contours = contoursSetting({ renderer, fallback: STYLE.contours, changed: (on) => hud.buildMenu.showTerrain(on) });
const ctx = { world, camera, tools, popup, growth, renderer, config: CONFIG };
tools.register(createInspectTool(ctx));
tools.register(createNetworkTool(ctx, { kind: 'road', id: 'street', street: true, group: 'transport' }));
tools.register(createNetworkTool(ctx, { kind: 'road', group: 'transport' }));
tools.register(createNetworkTool(ctx, { kind: 'road', id: 'lane', lane: true, group: 'transport' }));
tools.register(createNetworkTool(ctx, { kind: 'path', fineGrid: true, group: 'transport' }));
tools.register(createNetworkTool(ctx, { kind: 'rail', fineGrid: true, group: 'transport' }));
for (const defs of BUILD_FAMILIES) tools.register(createBuildTool(ctx, defs));
tools.register(createNetworkTool(ctx, { kind: 'fence', fineGrid: true, group: 'farming' }));
tools.register(createBulldozeTool(ctx));
// while a print is out, photo mode rests (see the input below): no menu
// left open on the map, the dock and the camera put by
const photoPrint = new PhotoPrint(uiRoot, {
  onToggle: (open) => {
    if (open) popup.hide();
    document.body.classList.toggle('print-open', open);
  },
});
tools.register(createPhotoTool(ctx, {
  shoot: (shot) => {
    // captioned with the town's name
    const caption = world.name;
    photoPrint.show(takePhoto(renderer, shot), caption);
    world.story.vars.photos_taken = (world.story.vars.photos_taken ?? 0) + 1;
    pasteIn(photoPrint.photo, caption);
  },
}));

// Every photo goes into the chronicle: its print kept (ui/prints.js), then
// its entry written, so the book never shows an entry before its picture.
// The chronicle keeps only the last few (config.chronicle.photos): the
// oldest go, prints and all.
async function pasteIn(svg, caption) {
  const id = newPrintId();
  try {
    const blob = await printImage(svg);
    if (blob) await putPrint(id, blob);
  } catch (err) {
    console.warn('The print could not be kept.', err);
  }
  for (const old of chronicle.photo(id, caption)) deletePrint(old);
}

const actions = {
  debug: () => { debugPanel.toggle(); if (debugPanel.open) hud.buildMenu.makeRoom(); },
  colors: () => { colorMenu.toggle(); if (colorMenu.open) hud.buildMenu.makeRoom(); },
  assets: () => assetsPage.toggle(),
  newMap: () => newMapMenu.toggle(),
  photo: () => tools.use(tools.active?.id === 'photo' ? 'inspect' : 'photo'),
  // the north arrow: the view turns back, north up, the shorter way round
  // about the middle of the screen, slowing to a stop as a turn let go does
  northUp: () => {
    const a = camera.angle;
    const left = a > Math.PI ? Math.PI * 2 - a : -a;
    if (Math.abs(left) > 1e-6) camera.spin = { at: [viewport[0] / 2, viewport[1] / 2], left };
  },
  terrain: () => contours.toggle(),
  undo: () => takeBack('undo'),
  redo: () => takeBack('redo'),
  export: () => exportCity(world),
  import: () => importCity(),
  fullscreen: () => toggleFullscreen(),
  sound: () => ambience.toggle(),
  credits: () => showCredits(),
  chronicle: () => { if (UNLOCKS.allowsControl('chronicle')) chronicleBook.toggle(); },
  language: () => switchLanguage(Object.keys(LANGUAGES).find((code) => code !== language())),
};

// Another language (the Menu's language button, or picked on the opening cover):
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
async function newMap(settings) {
  world.events.off('*', scheduleSave);
  clearTimeout(saveTimer);
  try {
    localStorage.removeItem(CONFIG.storageKey);
    localStorage.setItem(PENDING_KEY, JSON.stringify(settings));
  } catch {
    // storage unavailable: the reload rolls a map of its own
  }
  await clearPrints(); // (the old town's photos go with it)
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
  async function replaceCity(city) {
    world.events.off('*', scheduleSave);
    clearTimeout(saveTimer);
    try {
      localStorage.setItem(CONFIG.storageKey, JSON.stringify(city.toJSON()));
    } catch {
      world.events.on('*', scheduleSave);
      return say(t('import.failed'), [{ label: t('import.storage'), info: true }]);
    }
    await putPrints(city);
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
  for (const btn of uiRoot.querySelectorAll('.controls [data-act], .bm-loose [data-act="terrain"], .bm-camera, .hud .chron')) {
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
    btn.title = btn.querySelector('.label').textContent = t(full ? 'fullscreen.leave' : 'fullscreen');
  };
  document.addEventListener('fullscreenchange', show);
  document.addEventListener('webkitfullscreenchange', show);
}
// The sound of the buttons (a tap of wood; a knock for opening the Menu and
// folding the Build menu), and of building: the pencil (audio/ambience.js).
uiRoot.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (btn && !btn.disabled) ambience.tap(btn.matches('.menu-toggle, .bm-fold'), e.clientX / innerWidth);
}, true);
world.history.onStep((step) => ambience.built(step));

// Who made what the game uses (the Menu's Credits, under the imprint): the
// recordings, each with its author, its name on Freesound and its licence.
function showCredits() {
  const at = uiRoot.querySelector('.controls .imprint').getBoundingClientRect();
  const esc = (v) => String(v).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const link = (href, text) => `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(text)}</a>`;
  const sounds = Object.values(SOUNDS).map((s) => ({
    block: `<span class="credit"><b>${esc(t(s.what))}</b><span>${link(sourceOf(s), s.title)}, ${esc(s.author)}, ${link(LICENCES[s.licence], s.licence)}</span></span>`,
  }));
  popup.show(at.left, at.top, t('credits'), [{ section: t('credits.sounds') }, ...sounds]);
}

// the Sound button: its icon and name following whether there is sound
{
  const btn = uiRoot.querySelector('[data-act="sound"]');
  const show = (on) => {
    btn.classList.toggle('off', !on);
    btn.title = btn.querySelector('.label').textContent = t(on ? 'sound.off' : 'sound.on');
    btn.setAttribute('aria-label', btn.title);
  };
  ambience.changed = show;
  show(ambience.on);
}
const debugPanel = new DebugPanel(uiRoot, { renderer, camera }); // TEMPORARY
const colorMenu = new ColorMenu(uiRoot, uiRoot.querySelector('[data-act="colors"]'));
const assetsPage = new AssetsPage(uiRoot);
const newMapMenu = new NewMapMenu(uiRoot, uiRoot.querySelector('[data-act="newMap"]'), { onCreate: newMap, onExport: () => exportCity(world) });
UNLOCKS.onChange(followUnlocks); // (once the panels it closes exist)
followUnlocks();
// pen-drawn frames on every UI box, to match the sketched map
// (the corner menu has none: words on the paper)
sketchFrames(uiRoot, '.hud', HANDS.steady);
sketchFrames(uiRoot, '.controls, .bm-panel, .bm-dock, .bm-rail-box, .debug-panel, .color-panel, .newmap-panel, .newmap-confirm');
sketchFrames(uiRoot, '.popup', HANDS.loose);
// what a control is doing drawn on it in the pen: pressed, in keyboard focus
penMarks(uiRoot);
penMarks(document.getElementById('intro'));

// Terrain contour lines: off unless switched on with the Terrain button beside
// Erase (tools/terrain.js), then on until switched off, whatever is in hand
// (remembered in this browser); shown anyway while building, once Terrain is
// unlocked.
contours.start();
// The dots around the pointer (OverlayKit.nearDots): only while building,
// Select and Photo show the bare map; only those the tool can use (with a
// structure in hand, those the type it's on could have).
let dots = null;
tools.onChange((tool) => {
  dots = tool.id === 'inspect' || tool.id === 'photo' ? null
    : { fine: !!tool.fineGrid, building: tool.id.startsWith('build:') ? tool : null, roads: ['road', 'lane', 'street'].includes(tool.id) };
  contours.lend(!!dots && tool.id !== 'bulldoze' && UNLOCKS.allowsControl('terrain'));
  // the road marks (render/roadMarks.js): firmer while the player can mend
  // them, gone while composing a photo
  renderer.setNotes(tool.id === 'photo' ? 'off' : tool.id.startsWith('build:') || ['road', 'lane', 'street', 'path'].includes(tool.id) ? 'strong' : 'quiet');
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
  else if (world.hasRoad(node)) tool = tools.registry.get(world.laneOnly(node) ? 'lane' : [...world.roads.neighbors(node)].some((m) => world.hasSidewalk(node, m)) ? 'street' : 'road');
  if (!tool) return;
  tools.use(tool.id, params);
}

// Take back the last change, or put it back (⌘Z, ⇧⌘Z and the dock's Zpět
// and Znovu all come here). A step that can't be done, because something
// now stands in the way, says why in a small menu beside the dock, as the
// import's failure does.
function takeBack(which) {
  if (chronicleBook.open) return;
  popup.hide(); // (its building may be gone)
  if (!world.history[which === 'undo' ? 'canUndo' : 'canRedo']) return;
  const result = world.history[which]();
  if (result.ok) return;
  const dock = uiRoot.querySelector('.bm-dock').getBoundingClientRect();
  popup.show(innerWidth / 2, innerHeight, t(`${which}.refused`), [{ label: reasonText(result.reason), info: true }], null, dock.width ? dock : null);
}

// (with a photo's print out, the map takes no clicks: the photographer
// stays where they stood and looks where they looked, until it's put away)
attachInput(document.getElementById('input'), {
  camera,
  onPointer: (x, y) => { if (!photoPrint.open) tools.pointer(x, y); },
  onClick: (e) => { if (!photoPrint.open) tools.click(e); },
  onCancel: () => {
    if (photoPrint.open) return photoPrint.hide();
    if (popup.open) return popup.hide();
    if (tools.active?.id === tools.defaultId) return pickUp();
    tools.cancel();
  },
  // middle click works like Tab: rotate what's being placed, flip a line's bend
  onMiddle: () => { if (!photoPrint.open) tools.key({ key: 'Tab', preventDefault() {} }); },
});

window.addEventListener('keydown', (e) => {
  // ⌘Z / Ctrl+Z takes back the last change to the town, ⇧⌘Z / Ctrl+Y puts
  // it back (core/history.js); in a text field, the field's own
  if ((e.metaKey || e.ctrlKey) && !e.altKey && /^[zy]$/i.test(e.key) && !e.target.closest?.('input, textarea')) {
    e.preventDefault();
    if (chronicleBook.open) return;
    takeBack(e.shiftKey || e.key.toLowerCase() === 'y' ? 'redo' : 'undo');
    return;
  }
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
  // a photo's print out: Esc puts it away, the other keys wait
  if (photoPrint.open) {
    if (e.key === 'Escape') photoPrint.hide();
    return;
  }
  if (e.key === 'Escape') {
    if (popup.open) popup.hide();
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
  if (k === ' ') e.preventDefault(); // (Space: another look, while building; not a page scroll)
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
    const panels = [...uiRoot.querySelectorAll('.hud, .controls, .bm-panel, .bm-dock')];
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
    fires.update(simDt);
    trains.update(simDt);
    boats.update(simDt);
    deer.update(simDt);
    livestock.update(simDt);
    growth.update(simDt);
    camera.coast(dt); // (a turn let go: in real time, whatever the clock)
    // the building under the pointer, with nothing in hand, gives a little
    // squash as the pointer comes onto it (Renderer.markHovered): there's
    // something to click; its name is on the card that opens
    const hovered = tools.active?.id === 'inspect' && !popup.open && !photoPrint.open && tools.hoverNode >= 0
      ? world.structureAt(tools.hoverNode) : null;
    renderer.hovered = hovered ? `s${hovered.id}` : null;
    renderer.frame((dots ? overlayKit.nearDots(tools.point, { ...dots, building: dots.building?.type }) : '') + tools.overlay(overlayKit) + annotations.overlay(overlayKit, popup.open || photoPrint.open ? null : tools.point, tools.active?.id));
    const sky = weather.sky();
    // (no sun at night, so no cloud shadows: they fade away)
    cloudShadows.frame(simDt, camera, renderer.dark ? 0 : sky.cover, { hatch: SUN.hatch, stroke: renderer.strokeK });
    cloudsAbove.frame(dt, camera, renderer.dark ? 0 : sky.cover, renderer.strokeK);
    rain.frame(simDt, camera, sky.rain);
    ambience.frame(dt, sky, DAY.held ?? hourAt(world.time)); // (the birds keep the hour too)
    showSun(sky);
    renderer.setSun(sunAt(world.time)); // (the sun steps through the day, shadows.js DAY)
    renderer.setMist(mistRisen(world.weather, world.time, CONFIG.weather.mist));
    // the wind eases to the weather's (already gradual, but cmd.weather()
    // may jump it)
    wind += (sky.wind - wind) * Math.min(1, simDt / 4);
    renderer.swayTrees(world.time, wind);
    renderer.smokeFrame(world.time, { wind, rain: sky.rain, mist: renderer.mistRisen });
    renderer.fireFrame(world.time, { wind, rain: sky.rain });
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
window.cmd = createCommands({ world, config: CONFIG, clock, weather, agents, fires, trains, boats, deer, livestock, growth, story, annotations, renderer, unlocks: UNLOCKS });
// TEMPORARY: time and fire buttons always on screen, for the phone; they
// act on the building whose card was opened last
const devStrip = new DevStrip(uiRoot, { world, clock, cmd: window.cmd });
ctx.onPick = (s) => devStrip.pick(s);
sketchFrames(uiRoot, '.dev-strip');
