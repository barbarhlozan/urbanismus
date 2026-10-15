// Photo prints kept for the chronicle (ui/chronicleBook.js): every photo
// taken is pasted into the town's chronicle, so its print is kept – as a
// small WebP picture in the browser's IndexedDB, not in the save, which
// lives in localStorage and would hold only a few of them (a photo's SVG is
// over a megabyte of text, the picture some tens of kilobytes). The save
// keeps the chronicle's entry for it: { kind: 'photo', print: id, text:
// caption }. A downloaded city carries its prints along (ui/saveFile.js).
//
// Without IndexedDB (a private window, storage blocked) the entry is still
// written; the book then shows an empty mount where the print would be.
//
// subjectOf() picks what a photo is of, for its caption: the one building
// that stands out in it, or none.

import { PerspectiveCamera } from '../render/perspective.js';
import { PHOTO } from '../render/photo.js';
import { STRUCTURE_TYPES, matches } from '../../structures/index.js';

const DB = 'urbanismus';
const STORE = 'prints';

// computed styles copied onto each element (the page's CSS does not reach
// an SVG drawn into a canvas)
const PROPS = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'fill-opacity', 'stroke-opacity', 'display', 'visibility', 'vector-effect'];

// A photo's <svg> (in the page, so its styles are worked out) drawn as a
// picture: a Blob of `type`, `scale` times the photo's size.
export async function printImage(src, { scale = 2, type = 'image/webp', quality = 0.8 } = {}) {
  const copy = src.cloneNode(true);
  const from = [src, ...src.querySelectorAll('*')];
  const to = [copy, ...copy.querySelectorAll('*')];
  from.forEach((el, i) => {
    const cs = getComputedStyle(el);
    to[i].setAttribute('style', PROPS.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(';'));
  });
  const [w, h] = [Number(src.getAttribute('width')), Number(src.getAttribute('height'))];
  copy.setAttribute('width', w * scale);
  copy.setAttribute('height', h * scale);
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = w * scale;
    canvas.height = h * scale;
    canvas.getContext('2d').drawImage(img, 0, 0);
    return await new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------- the store ----------

let opening = null;
function db() {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return opening;
}

async function run(mode, fn) {
  const store = (await db()).transaction(STORE, mode).objectStore(STORE);
  return new Promise((resolve, reject) => {
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Each resolves even when there is no IndexedDB: put/clear with false,
// get with null, all with [].
export const putPrint = (id, blob) => run('readwrite', (s) => s.put(blob, id)).then(() => true, () => false);
export const getPrint = (id) => run('readonly', (s) => s.get(id)).then((b) => (b instanceof Blob ? b : null), () => null);
export const clearPrints = () => run('readwrite', (s) => s.clear()).then(() => true, () => false);

// The prints with these ids, as [[id, blob]] (those found).
export async function printsOf(ids) {
  const out = [];
  for (const id of ids) {
    const blob = await getPrint(id);
    if (blob) out.push([id, blob]);
  }
  return out;
}

// A new print's id: unique enough within one browser.
export const newPrintId = () => `p${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

// An object URL for a print, made once (null if it isn't there).
const urls = new Map();
export async function printURL(id) {
  if (!urls.has(id)) urls.set(id, getPrint(id).then((blob) => (blob ? URL.createObjectURL(blob) : null)));
  return urls.get(id);
}

// ---------- what a photo is of ----------

// Not what a photo is "of": homes, and what lies flat on the ground.
const BACKGROUND = ['residential', 'park', 'square', 'cemetery', 'bus-stop', 'stop'];
// How wide (a share of the picture) a building must look to stand out.
const STANDS_OUT = 0.12;

// The one building that stands out in the photo `shot` ({ x, y, yaw, fov }),
// as its structure definition – or null when none does, or several do.
export function subjectOf(world, shot) {
  const cam = new PerspectiveCamera({ x: shot.x, y: shot.y, z: 0, yaw: shot.yaw, fov: shot.fov, width: PHOTO.width, height: PHOTO.height });
  const half = Math.tan((shot.fov * Math.PI) / 360);
  const found = [];
  for (const s of world.structures.values()) {
    const def = STRUCTURE_TYPES[s.type];
    if (!def || BACKGROUND.some((tag) => matches(def, tag))) continue;
    const [cx, cy] = world.centerOf(s);
    const ahead = cam.ahead(cx, cy);
    if (ahead < PHOTO.clear || ahead > PHOTO.range) continue;
    const side = (cx - shot.x) * cam.rx + (cy - shot.y) * cam.ry;
    if (Math.abs(side) > ahead * half) continue; // (its middle out of the picture)
    const wide = (Math.sqrt(world.nodesOf(s).length) * cam.focal) / ahead;
    if (wide >= PHOTO.width * STANDS_OUT) found.push(def);
  }
  return found.length === 1 ? found[0] : null;
}
