// Visual style settings: the "less clinical" effects, all switchable from
// the Style panel and remembered per browser.
//
// To add an effect: add a control to STYLE_CONTROLS (and a default), then
// react to it where it's drawn (renderer / CSS class on #world / overlays).

const KEY = 'urbanismus.style.v1';

export const STYLE_CONTROLS = [
  { key: 'pixels', label: 'Pixel size', type: 'range', min: 1, max: 10, step: 1, group: 'Pixels' },
  { key: 'pixelFollow', label: 'Scale with zoom', type: 'toggle', group: 'Pixels' },
  { key: 'pixelWeight', label: 'Line weight', type: 'range', min: 0, max: 1, step: 0.05, group: 'Pixels' },
  { key: 'pixelDetail', label: 'Detail', type: 'range', min: 0, max: 1, step: 0.05, group: 'Pixels' },
  { key: 'warp', label: 'Map warp', type: 'range', min: 0, max: 1, step: 0.05, group: 'Drawing' },
  { key: 'tremor', label: 'Line tremor', type: 'range', min: 0, max: 1, step: 0.05, group: 'Drawing' },

  { key: 'crisp', label: 'Aliased lines', type: 'toggle', group: 'Drawing' },
  { key: 'broken', label: 'Broken lines', type: 'toggle', group: 'Drawing' },
  { key: 'glow', label: 'Glow on dots', type: 'toggle', group: 'Drawing' },
  { key: 'frame', label: 'Map frame', type: 'toggle', group: 'Drawing' },
  { key: 'scanlines', label: 'Scanlines', type: 'toggle', group: 'CRT' },
  { key: 'hoverTags', label: 'Hover tags', type: 'toggle', group: 'Annotations' },
  { key: 'feed', label: 'Event log', type: 'toggle', group: 'Annotations' },
];

export const STYLE_DEFAULTS = {
  warp: 0.5,
  tremor: 0.35,
  pixels: 4,       // real screen pixels per pixel; 1 = off (sharp vector drawing)
  pixelFollow: true,  // pixels shrink with the map when zooming out
  pixelWeight: 0.5,
  pixelDetail: 0.5,
  crisp: true,
  broken: false,
  glow: true,
  frame: true,
  scanlines: false,
  hoverTags: true,
  feed: true,
};

export class Style {
  constructor() {
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    } catch {
      saved = {};
    }
    this.values = { ...STYLE_DEFAULTS, ...saved };
    this.listeners = new Set();
  }

  get(key) {
    return this.values[key];
  }

  set(key, value) {
    if (this.values[key] === value) return;
    this.values[key] = value;
    try {
      localStorage.setItem(KEY, JSON.stringify(this.values));
    } catch {
      // storage unavailable: settings just won't persist
    }
    this.listeners.forEach((fn) => fn(key, value));
  }

  onChange(fn) {
    this.listeners.add(fn);
  }
}
