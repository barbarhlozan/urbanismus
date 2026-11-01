// Device px per CSS px for the map's canvases (WebGL and 2D), in place of
// devicePixelRatio. The screen's own, but at most MAX_DPR: a phone's 3
// makes every full-window canvas 2.25× the memory of 2 for lines hardly
// any sharper, and iOS Safari kills a page that holds more canvas memory
// than the phone allows (a few hundred MB) – over and over on reload, as
// the same town loads into the same canvases ("A problem repeatedly
// occurred"). The map has a dozen full-window WebGL canvases, eight of
// them with the overscan (renderer.js placeView).
//
// After a start that didn't last (the page gone before START_OK, without
// being hidden or left) the next starts are light for LIGHT_DAYS: 1 device
// px per CSS px and no multisampling. `?dpr=1` (or any number) sets it by
// hand, `?dpr=full` the screen's own.

const MAX_DPR = 2;
const BOOT_KEY = 'urbanismus.boot';   // set while starting, gone once it lasted
const LIGHT_KEY = 'urbanismus.light'; // ms until which starts are light
const START_OK = 30_000;              // ms a start has to last
const LIGHT_DAYS = 3;

const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  drop: (k) => { try { localStorage.removeItem(k); } catch {} },
};

const now = Date.now();
if (store.get(BOOT_KEY)) store.set(LIGHT_KEY, String(now + LIGHT_DAYS * 864e5));
store.set(BOOT_KEY, String(now));
const lasted = () => store.drop(BOOT_KEY);
setTimeout(lasted, START_OK);
addEventListener('pagehide', lasted);
document.addEventListener('visibilitychange', () => document.hidden && lasted());

const asked = new URLSearchParams(location.search).get('dpr');
export const LIGHT = asked ? asked !== 'full' && Number(asked) <= 1 : +(store.get(LIGHT_KEY) ?? 0) > now;
const cap = asked === 'full' ? Infinity : asked && Number(asked) > 0 ? Number(asked) : LIGHT ? 1 : MAX_DPR;
if (LIGHT) console.info('Light canvases (dpr 1, no multisampling): the last start did not last');

export const canvasDpr = () => Math.min(devicePixelRatio || 1, cap);
