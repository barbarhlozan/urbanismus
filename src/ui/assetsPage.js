// The Assets page: a full-screen catalogue of every structure in the game
// (opened from the top-right Assets button), grouped like the Build menu.
// Buildings pick their look at random (kind of roof, house style, …), so
// each level shows a row of rolls with different seeds, drawn close up in
// the map's own style. Built on first open: it's a few hundred drawings.

import { STRUCTURES, CATEGORIES, categoryOf } from '../../structures/index.js';
import { structureDrawing, vehicleDrawing } from './icons.js';
import { VEHICLES } from '../render/vehicles.js';
import { CONFIG } from '../config.js';
import { sketchFrame, sketchFrames } from './sketchFrame.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const VARIANTS = 6;
const seedOf = (k) => ((k + 1) * 2654435761) >>> 0;

function footprintSize(def) {
  const xs = def.footprint.map((p) => p[0]), ys = def.footprint.map((p) => p[1]);
  return `${Math.max(...xs) - Math.min(...xs) + 1}×${Math.max(...ys) - Math.min(...ys) + 1}`;
}

function levelRow(def, levelDef, level) {
  const tiles = Array.from({ length: VARIANTS }, (_, k) => `
    <figure class="asset-tile">${structureDrawing(def, { level, seed: seedOf(k) })}<figcaption>#${k}</figcaption></figure>`).join('');
  const title = def.levels.length > 1 ? `${def.name} · ${levelDef.name ?? `Level ${level}`}` : def.name;
  return `
    <div class="asset-row">
      <h3>${esc(title)} <span>${[def.blurb, footprintSize(def)].filter(Boolean).map(esc).join(' · ')}</span></h3>
      <div class="asset-tiles">${tiles}</div>
    </div>`;
}

// Vehicles, each turned a few ways round. Coupled parts (a truck's trailer,
// a train's coaches) trail behind at the spacing the simulation keeps.
const COACH = Math.round((CONFIG.trains.carSpacing - 0.02) * 100) / 100;
const coupled = (...names) => (heading, hand) => {
  const a = (heading / VEHICLES.headings) * Math.PI * 2;
  const gaps = { trailer: CONFIG.trucks.trailer, [`coach:${COACH}`]: CONFIG.trains.carSpacing };
  let back = 0;
  return names.map((name, i) => {
    if (i) back += gaps[name];
    return { name, heading, hand: (hand + i) % VEHICLES.hands, at: [-Math.cos(a) * back, -Math.sin(a) * back] };
  });
};
const VEHICLE_ROWS = [
  ['Saloon car', 'Škoda 120-like', coupled('saloon')],
  ['Hatchback', 'Favorit / Trabant-ish', coupled('hatch')],
  ['Van', 'Avia / Barkas box', coupled('van')],
  ['Truck', 'Cab and box trailer', coupled('cab', 'trailer')],
  ['Bus', 'Karosa town bus', coupled('bus')],
  ['Train', 'Locomotive and coaches', coupled(`loco:${COACH}`, `coach:${COACH}`, `coach:${COACH}`)],
];

function vehicleRow([name, blurb, parts]) {
  const tiles = Array.from({ length: VARIANTS }, (_, k) => {
    const heading = Math.round((k * VEHICLES.headings) / VARIANTS);
    return `<figure class="asset-tile">${vehicleDrawing(parts(heading, k))}<figcaption>#${k}</figcaption></figure>`;
  }).join('');
  return `
    <div class="asset-row">
      <h3>${esc(name)} <span>${esc(blurb)}</span></h3>
      <div class="asset-tiles">${tiles}</div>
    </div>`;
}

export class AssetsPage {
  constructor(root) {
    this.el = document.createElement('div');
    this.el.className = 'assets-page hidden';
    this.el.innerHTML = `
      <div class="assets-head"><span>Assets</span><button class="close" aria-label="Close">×</button></div>
      <div class="assets-body"></div>`;
    root.appendChild(this.el);
    sketchFrame(this.el);

    this.el.querySelector('.close').addEventListener('click', () => this.toggle(false));
    document.addEventListener('keydown', (e) => {
      if (this.open && e.key === 'Escape') this.toggle(false);
    });
  }

  build() {
    this.built = true;
    const body = this.el.querySelector('.assets-body');
    body.innerHTML = CATEGORIES
      .map((c) => ({ ...c, defs: STRUCTURES.filter((d) => categoryOf(d) === c.id) }))
      .filter((g) => g.defs.length)
      .map((g) => `
        <section>
          <h2>${esc(g.label)}</h2>
          ${g.defs.map((def) => def.levels.map((l, i) => levelRow(def, l, i + 1)).join('')).join('')}
        </section>`)
      .join('') + `
      <section>
        <h2>Vehicles</h2>
        ${VEHICLE_ROWS.map(vehicleRow).join('')}
      </section>`;
    sketchFrames(body, '.asset-tile');
  }

  get open() {
    return !this.el.classList.contains('hidden');
  }

  toggle(open = !this.open) {
    this.el.classList.toggle('hidden', !open);
    if (open && !this.built) this.build();
  }
}
