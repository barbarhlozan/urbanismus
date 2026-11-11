// Woods and weather on the map (Renderer methods; see renderer.js): the
// forest and its hatching, trees swaying in the wind, smoke and fire, and
// the mist lying in the valleys.

import { MIST, mistLevel, mistSurface, mistSVG, mistHatch, coverSVG, mistIn, mistOut } from '../mist.js';
import { drawEnabled } from '../draw.js';
import { networkPolylines } from '../../roads/geometry.js';
import { SegmentIndex } from '../../core/geom2d.js';
import { SUN } from '../shadows.js';
import { findForests, forestSVG } from '../forest.js';
import { SVGNS, VIEW_SETTLE, BAND_HOLD, r2, detailRank, TREE_SWAY } from './shared.js';

export class NatureDrawing {
  // Hide the objects (and their ground drawing) that lie outside the drawn
  // view: the browser then skips them when the view is redrawn (every
  // shape's line width is kept constant on screen, so every shown one has
  // to be laid out and painted again at each new zoom) and when the detail
  // level changes. All of them, or just `entries`.
  // The trees lean in the wind: each forest clump (feature) as a whole, and
  // each garden tree in a building's drawing (Painter.swayFrom) – sheared
  // about its foot, so the foot stays put and the top swings – by a few
  // sines over each other, their phase running across the map so gusts
  // roll through. `time` simulated seconds, `strength` how far a top leans
  // per height (config.weather.wind).
  //
  // Every lean repaints the map's whole object layer, so it is kept in
  // budget (TREE_SWAY): only trees on screen, at most `most` of them – a
  // share of those in view, picked by a hash of where each stands so the
  // same ones keep swaying as the view moves – only this close or closer,
  // and `fps` times a second. While the view moves they hold still where
  // they lean: the drawing is moved on the GPU then (placeView), and a
  // lean would paint it all again.
  swayTrees(time, strength) {
    const S = TREE_SWAY;
    if (this.turning || performance.now() - this.movedAt < VIEW_SETTLE) return;
    const on = strength > 0 && this.drawn.zoom >= S.minZoom;
    if (!on && this.swayIdle) return;
    if (on && time >= this.swayTime && time - this.swayTime < 1 / S.fps) return;
    this.swayTime = time;
    const units = [];
    for (const e of this.objs.values()) {
      if (!e.shown) continue;
      if (e.swayAt !== e.at) this.swayUnits(e);
      for (const u of e.sway) units.push(u);
    }
    const share = on ? Math.min(1, S.most / Math.max(1, units.length)) : 0;
    for (const u of units) {
      let k = 0;
      if (u.h < share) {
        const lean = strength * (0.6 * Math.sin(time * 1.3 - u.ph) + 0.3 * Math.sin(time * 2.9 - u.ph * 1.7 + 1.1) + 0.25);
        k = Math.round(lean * 400) / 400;
      }
      if (k === u.lean) continue;
      u.lean = k;
      u.t = k ? `matrix(1 0 ${k} 1 ${r2(-k * u.foot[1])} 0)` : '';
      if (u.e) this.placeGroups(u.e); // (a clump: with its slide, mid-turn)
      else if (u.t) u.el.setAttribute('transform', u.t);
      else u.el.removeAttribute('transform');
    }
    this.swayIdle = !on;
  }

  // What leans in an object's drawing: a forest clump whole, or the garden
  // trees in a building's ({ el, foot, h: hash in [0, 1), ph: phase }).
  swayUnits(e) {
    e.swayAt = e.at;
    e.sway = [];
    const unit = (el, foot, whole) => {
      const h = Math.abs(Math.sin(foot[0] * 12.9898 + foot[1] * 78.233) * 43758.5453) % 1;
      e.sway.push({ el, foot, h, ph: foot[0] * 0.03 + foot[1] * 0.05, lean: 0, t: '', e: whole });
    };
    if (e.key[0] === 'f') {
      const f = this.world.features.get(Number(e.key.slice(1)));
      if (!f) return;
      const [nx, ny] = this.world.grid.xy(f.node);
      unit(e.g, this.project(nx + f.ox, ny + f.oy), e);
    } else if (e.key[0] === 's') {
      for (const el of e.g.querySelectorAll('g.sway')) unit(el, el.dataset.foot.split(' ').map(Number));
    }
  }

  // Is it a tree in a wood that is drawn as one shape?
  inWoods(e) {
    return this.farWoods?.size > 0 && e.key?.[0] === 'f' && this.farWoods.has(this.forestState().woodOf.get(Number(e.key.slice(1))));
  }

  // Which woods are drawn as one shape (forest.js) at zoom z: those it is
  // further out than config.render.forest.zoom for, each by its own share
  // of it (lod.spread, as the buildings' detail, bandOf), so the woods
  // don't all turn at once; and each only once the zoom is BAND_HOLD past.
  updateWoods(z) {
    const { forest, lod } = this.config.render;
    this.farWoods ??= new Set();
    if (z >= forest.zoom * (1 + BAND_HOLD) && !this.farWoods.size) return; // (not even found while close)
    const state = this.forestState();
    if (z === this.woodsZoom && state === this.woodsFor) return;
    this.woodsZoom = z;
    this.woodsFor = state;
    const far = new Set();
    for (const w of state.woods) {
      const at = forest.zoom * (1 - lod.spread * detailRank(`w${w.id}`));
      const was = this.farWoods.has(w.id);
      if (z < at * (was ? 1 + BAND_HOLD : 1 - BAND_HOLD)) far.add(w.id);
    }
    if (far.size === this.farWoods.size && [...far].every((id) => this.farWoods.has(id))) return;
    this.farWoods = far;
    this.dirty.add('forest');
    this.cull();
  }

  // The woods (forest.js), found again after trees come or go.
  forestState() {
    if (!this.forests) {
      const { world, config } = this;
      const ways = new SegmentIndex([...networkPolylines(world.networks.road, config.road), ...networkPolylines(world.networks.rail, config.rail)]);
      this.forests = findForests(world, config.render.forest, ways);
      if (this.farWoods?.size) queueMicrotask(() => { this.woodsZoom = null; this.updateWoods(this.drawn.zoom); this.cull(); }); // trees that joined or left a wood
    }
    return this.forests;
  }

  renderForest() {
    const state = this.farWoods?.size ? this.forestState() : null;
    const woods = state ? state.woods.filter((w) => this.farWoods.has(w.id)) : [];
    this.forestHatchAt = this.hatchScale(this.drawn.zoom);
    const svg = woods.length ? forestSVG({ woods, cover: state.cover }, (x, y) => this.project(x, y), this.config.render.forest, this.camera, this.config.render.forest.hatch / this.forestHatchAt) : '';
    if (svg !== this.forestDrawn) this.layers.forest.innerHTML = this.forestDrawn = svg;
  }

  // The woods' hatching keeps its spacing on screen (config.render.forest
  // .hatch px): the zoom in the steps the line widths go by (strokeStep),
  // and the pattern set again when it moves a step.
  hatchScale(z) {
    const step = this.config.render.strokeStep;
    return step ** Math.round(Math.log(z) / Math.log(step));
  }

  forestHatch(z) {
    const k = this.hatchScale(z);
    if (k === this.forestHatchAt) return;
    this.forestHatchAt = k;
    const pattern = this.layers.forest.querySelector('#forest-hatch');
    if (!pattern) return;
    const s = r2(this.config.render.forest.hatch / k);
    pattern.setAttribute('width', s);
    pattern.setAttribute('height', s);
    const line = pattern.firstElementChild;
    line.setAttribute('y1', s / 2);
    line.setAttribute('x2', s);
    line.setAttribute('y2', s / 2);
  }

  // Chimney smoke (particles.js) from the buildings in sight: `time`
  // simulated seconds, `env` the weather ({ wind, rain, mist }). Not from a
  // chimney under the mist, which hides it.
  smokeFrame(time, env) {
    if (!this.showAgents) return this.smoke.clear();
    const vents = [];
    const height = this.mistLevel != null ? this.groundHeight() : null;
    for (const e of this.objs.values()) {
      if (!e.vents || e.shown === false || e.ventsTurn !== this.camera.angle) continue;
      for (const v of e.vents) {
        if (height && (this.camera.lift?.(v.at[0], v.at[1]) ?? 0) + v.at[2] < this.mistLevel) continue;
        vents.push(v);
      }
    }
    this.smoke.frame(this.camera, this.strokeK, vents, time, env);
  }

  // A building on fire, burning out or put out (fire.js), drawn from its
  // windows and outline as drawn: `time` simulated seconds, `env` the weather.
  fireFrame(time, env) {
    this.fire.frame(this.camera, this.strokeK, (id) => this.objs.get(`s${id}`), time, env);
  }

  // The mist (weather 'mist', mist.js): `risen` 0 (none) to 1, in steps
  // (sim/weather.js mistRisen); each step draws it again.
  setMist(risen) {
    if (risen === this.mistRisen) return;
    this.mistRisen = risen;
    this.dirty.add('mist');
  }

  // The ground's height as drawn (the relief's lift and the terrain), and
  // its lowest and highest over the map, for the mist's top.
  groundHeight() {
    const { camera, world } = this;
    return (x, y) => (camera.lift?.(x, y) ?? 0) + world.terrain.heightAt(x, y);
  }

  mistTop() {
    const { grid } = this.world;
    if (!this.groundRange) {
      const height = this.groundHeight();
      let lo = Infinity, hi = -Infinity;
      for (let y = 0; y < grid.height; y += 0.5) for (let x = 0; x < grid.width; x += 0.5) { const h = height(x, y); lo = Math.min(lo, h); hi = Math.max(hi, h); }
      this.groundRange = [lo, hi];
    }
    return mistLevel(...this.groundRange, this.config.weather.mist, this.mistRisen);
  }

  // Each step of the mist rising or sinking comes in slowly over the last
  // (mistIn, mistOut) – the paper settling, the pen drawing its lines –
  // and so do the covers of what stands in it. Drawn again for another
  // reason (the view turned, the ground changed), it is just there.
  renderMist() {
    const { camera, world } = this;
    const level = this.mistRisen ? this.mistTop() : null;
    const animate = drawEnabled() && level !== this.mistLevel && this.mistLevel !== undefined;
    const seed = Math.round((level ?? 0) * 1000) ^ world.seed;
    let svg = '';
    // the paper's strokes it is filled with, as are its covers (gl/objects.js)
    if (level != null && SUN.hatch) {
      const { hatch, width } = mistHatch(SUN.hatch);
      this.glObjects?.setTile(hatch, camera.tile, width * camera.tile);
    }
    if (level != null) {
      const { grid } = world;
      const m = 1.2; // (as the contours: the ground is drawn a little past the map)
      const surface = mistSurface(camera, this.groundHeight(), [-m, -m, grid.width - 1 + m, grid.height - 1 + m], level);
      svg = mistSVG(surface, camera, world.seed);
    }
    const layer = this.layers.mist;
    if (animate) for (const old of layer.querySelectorAll(':scope > g:not(.leaving)')) mistOut(old, { seed });
    else layer.innerHTML = '';
    if (svg) {
      const g = layer.appendChild(document.createElementNS(SVGNS, 'g'));
      g.innerHTML = svg;
      if (animate) mistIn(g, { seed });
    }
    this.mistLevel = level;
    for (const e of this.objs.values()) this.coverMist(e, animate);
  }

  // What of an object is under the mist: covered over with paper and the
  // cut lumped (coverSVG), or all of it hidden – coming and going slowly
  // with `animate` (as the mist's own steps, renderMist).
  coverMist(e, animate = false) {
    animate &&= e.shown !== false;
    const seed = detailRank(e.key ?? '') * 1e9;
    for (const old of e.g.querySelectorAll(':scope > .mist-cover:not(.leaving)')) {
      if (animate) mistOut(old, { seed, owner: e.g });
      else old.remove();
    }
    if (!animate) for (const old of e.g.querySelectorAll(':scope > .mist-cover')) old.remove();
    const level = this.mistLevel;
    let svg = '';
    if (level != null && e.at) {
      const [ax, ay] = e.at.anchor ?? e.at.points[0];
      const height = this.groundHeight();
      svg = coverSVG(this.camera, e.at, height(ax, ay), height, level, seed);
    }
    const under = svg === 'under';
    if (under !== (e.g.mistUnderTo ?? e.g.classList.contains('mist-under'))) {
      // sinking out of sight or coming up again: it fades
      const g = e.g, ms = MIST.fade * 0.85;
      clearTimeout(g.mistUnder);
      g.mistUnderTo = under;
      if (animate) {
        g.fade = { at: performance.now(), ms, from: under ? 1 : 1 - MIST.paper, to: under ? 1 - MIST.paper : 1, ease: 'in-out' }; // (gl/objects.js)
        g.classList.remove('mist-under');
        g.mistUnder = setTimeout(() => {
          g.classList.toggle('mist-under', under);
          g.fade = null;
        }, ms);
      } else {
        g.fade = null;
        g.classList.toggle('mist-under', under);
      }
    }
    if (!svg || under) return;
    const g = document.createElementNS(SVGNS, 'g');
    g.setAttribute('class', 'mist-cover');
    g.innerHTML = svg;
    e.g.appendChild(g);
    if (animate) mistIn(g, { seed, owner: e.g });
  }
}
