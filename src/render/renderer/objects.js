// The objects on the map (Renderer methods; see renderer.js): structures,
// features and street lamps – built, painted, sketched in and erased, put in
// detail bands, culled with the view and drawn on the GPU (gl/objects.js).

import { Painter, LOOK } from '../painter.js';
import { drawIn, eraseOut, drawEnabled, DRAW } from '../draw.js';
import { GLObjects } from '../gl/objects.js';
import { joinedRow } from '../../../structures/index.js';
import { freeTest, pathIndex, railIndex } from '../lots.js';
import { streetLamp, FURNITURE } from '../../roads/furniture.js';
import { lamp } from '../../../structures/kit.js';
import { networkPolylines } from '../../roads/geometry.js';
import { SegmentIndex } from '../../core/geom2d.js';
import { FEATURE_TYPES } from '../../../features/index.js';
import { mergeRuns, isoSort } from '../order.js';
import { SUN } from '../shadows.js';
import { SVGNS, NEAR, bareOf, BAND_HOLD, STEPS, GL_AHEAD, detailRank, STRUCTURE_PAD, centerOf } from './shared.js';

// A drawn element (painter.js) carrying detail class d2, or d1 / d2 (atDetail).
const DETAIL_2 = /<(?:path|polygon|polyline|circle|ellipse|rect|line)\b[^>]*\bclass="[^"]*\bd2\b[^"]*"[^>]*\/>/g;
const DETAIL_1_2 = /<(?:path|polygon|polyline|circle|ellipse|rect|line)\b[^>]*\bclass="[^"]*\bd[12]\b[^"]*"[^>]*\/>/g;
// Roof hatching (painter.js) in density tiers above n, for n = 0, 1, 2.
const ROOF_TIERS = [1, 2, 3].map((n) => new RegExp(`<(?:path|polyline)\\b[^>]*\\bclass="[^"]*\\brh[${n}-3]\\b[^"]*"[^>]*\\/>`, 'g'));
const ROOF_TIER_CLASS = / rh[1-3]\b/g;
// An object's place among the others in when its detail changes
// (Renderer.bandOf): 0..1, seeded by its key ('s12', 'f7', 'k3-4').
// The shapes an object is drawn with, its garden and shadow (not the mist
// over it, coverMist).
function strokesOf(e) {
  return [e.lg, e.g].flatMap((g) => [...g.querySelectorAll('path,polygon,polyline,circle,ellipse,line,rect')]).filter((el) => !el.closest('.mist-cover'));
}
const FEATURE_PAD = 0.4; // forest trees stand in clumps around their dot

export class ObjectDrawing {
  // The buildings, trees and lamps drawn with WebGL (gl/objects.js) from
  // their SVG, which stays in the page as the drawings' source, neither
  // styled nor laid out (display: none; the pen measures it through
  // gl/objects.js, draw.js) – on a canvas under the objects' <svg> (its
  // overlay over it).
  makeGlObjects() {
    const layer = this.layers.objects;
    this.glObjects = GLObjects.make(document.getElementById('objects-gl'), layer, this.top, this.sunCss);
    if (!this.glObjects) return;
    // (the drawings made ready for a turn kept on the GPU: those of the
    // nearest steps)
    this.glObjects.kept = () => {
      const out = new Set(), k = this.camera.step();
      for (const e of this.objs.values()) {
        for (const [j, v] of e.views ?? []) {
          const d = Math.min(Math.abs(j - k) % STEPS, STEPS - (Math.abs(j - k) % STEPS));
          if (d <= GL_AHEAD) out.add(v.g);
        }
      }
      return out;
    };
    layer.style.display = 'none';
    layer.classList.add('gl-drawn');
    // (the mist under them, and its covers over them, drawn alike)
    this.glObjects.watch(this.layers.mist, { under: true });
    this.layers.mist.style.display = 'none';
  }

  // The ground's and the world's layers drawn with WebGL as the objects
  // are (gl/objects.js), so their lines take the brush (brush.js): the
  // terrain (brows, rocks, steep slopes, shores, waves, ponds), the
  // meadow, the lots and the forest – each on a canvas just under its
  // <svg>, which stays in the page as their source with what is drawn
  // hidden (styles.css .gl-mirror), but for what WebGL can't draw: the
  // forest's hatched band, with its pattern and clip, over the rest as it
  // was (the forest the last of the world's layers).
  makeGlMirrors() {
    this.glMirrors = [];
    for (const [svg, names] of [[this.ground, ['terrain']], [this.svg, ['meadow', 'lots', 'forest']]]) {
      const canvas = document.createElement('canvas');
      canvas.className = 'map-canvas';
      svg.before(canvas);
      const layers = names.map((n) => this.layers[n]);
      const gl = GLObjects.make(canvas, layers[0], svg, this.sunCss);
      if (!gl) {
        canvas.remove();
        continue;
      }
      for (const l of layers.slice(1)) gl.watch(l);
      // (water in a pool, a mine's pit: hatched as the pattern hatch-water)
      if (SUN.hatch) gl.setTile({ ...SUN.hatch, angle: 320, gap: 5 / 32 }, 32, 0.6);
      for (const l of layers) l.classList.add('gl-mirror');
      this.glMirrors.push({ gl, layers });
    }
  }

  // The canvas the terrain's SVG is drawn on (makeGlMirrors), or null.
  groundMirror() {
    return this.glMirrors?.find((m) => m.layers[0] === this.layers.terrain)?.gl.canvas ?? null;
  }

  renderGlMirrors() {
    const d = this.drawn;
    if (!d) return;
    const view = { zoom: d.zoom, panX: d.panX, panY: d.panY, ox: this.ox, oy: this.oy, W: this.winW, H: this.winH };
    for (const { gl, layers } of this.glMirrors ?? []) gl.drawLayers(view, layers);
  }

  // The objects' groups put back in their layer (drawn with WebGL, which
  // keeps their order).
  placeObjectGroups(els) {
    const layer = this.layers.objects;
    for (const el of els) if (el.parentNode !== layer) layer.appendChild(el);
  }

  renderGlObjects() {
    const d = this.drawn;
    if (!this.glObjects || !d) return;
    this.glObjects.draw({ zoom: d.zoom, panX: d.panX, panY: d.panY, ox: this.ox, oy: this.oy, W: this.winW, H: this.winH }, this.order);
  }

  // An object's detail at zoom z, a number made of four parts: its level
  // (0 full, 1 without the facade detail, 2 bare; config.render.lod), the
  // densest tier of roof hatching it keeps (0–3, painter.js: strokes about
  // config.render.roofGap px apart on screen at least) and, for a tree,
  // how plain its crown is (config.render.trees), and for a building
  // whether its windows are drawn close up (NEAR). Each object crosses
  // these zooms a little sooner or later than the next – its own share of
  // them, from 1 − lod.spread to 1, seeded by its key – so a change goes
  // through the town over a stretch of zooms rather than all at once;
  // and only once the zoom is BAND_HOLD past, if it was drawn with `prev`.
  bandOf(key, z, prev) {
    const at = (zz) => {
      const { lod, trees, roofGap } = this.config.render;
      const r = 1 - lod.spread * detailRank(key);
      const level = (zz < lod.medium * r) + (zz < lod.far * r);
      // tier n keeps every 2^(3 − n)th stroke, LOOK.hatch apart
      let roof = 3;
      if (key[0] === 's') while (roof > 0 && LOOK.hatch * 2 ** (3 - roof) * this.camera.tile * zz < roofGap * r) roof--;
      const tree = key[0] === 'f' ? (zz < trees.medium * r) + (zz < trees.far * r) : 0;
      // a building's windows close up (Painter._window, LOOK.open)
      const near = key[0] === 's' && LOOK.open && zz >= lod.near * r ? 1 : 0;
      return [level, roof, tree, near];
    };
    const now = at(z);
    if (prev !== undefined) {
      const was = [(prev >> 4) & 3, (prev >> 2) & 3, prev & 3, prev & NEAR ? 1 : 0];
      const closer = at(z * (1 + BAND_HOLD)), further = at(z * (1 - BAND_HOLD));
      // each part only goes up with the zoom (roof) or down (level, tree)
      const keep = was[0] >= closer[0] && was[0] <= further[0]
        && was[1] <= closer[1] && was[1] >= further[1]
        && was[2] >= closer[2] && was[2] <= further[2]
        && was[3] <= closer[3] && was[3] >= further[3];
      if (keep) return prev;
    }
    return (now[3] ? NEAR : 0) | (now[0] << 4) | (now[1] << 2) | now[2];
  }

  // The zoom changed: objects whose detail (bandOf) changes with it are
  // redrawn – those in sight a batch per frame once the view has settled
  // (frame), the rest once they come into sight (stale, see cull()).
  rebandObjects() {
    const z = this.bandZoom;
    for (const [key, e] of this.objs) {
      if (e.band === undefined) continue;
      const band = this.bandOf(key, z, e.band);
      if (band !== e.band || e.hide) this.hideAhead(e, band);
      if (band !== e.band) {
        if (e.bandStale) continue;
        e.stale = e.bandStale = true;
        if (e.shown !== false) {
          this.rebuildQueue.add(key);
          this.rebuildOrder = null;
        }
      } else if (e.bandStale) {
        // back where it was drawn before it was redrawn (unless the sun
        // has moved since, setSun)
        e.bandStale = false;
        e.stale = !!e.sunStale;
      }
    }
  }

  // The facade detail an object's drawing has that `band` leaves out hides
  // at once (a class on its groups, styles.css), until it is redrawn
  // without it; what it lacks, and its roof hatching, wait for the redraw.
  hideAhead(e, band) {
    const level = (band >> 4) & 3;
    const hide = level > ((e.band >> 4) & 3) ? `lv${level}` : '';
    if (hide === (e.hide ?? '')) return;
    for (const g of [e.g, e.lg]) {
      if (e.hide) g.classList.remove(e.hide);
      if (hide) g.classList.add(hide);
    }
    e.hide = hide;
  }

  // Keys sorted by how far their objects are from the middle of the view,
  // the furthest first.
  nearestLast(keys) {
    const v = this.viewBox, cx = v ? (v[0] + v[2]) / 2 : 0, cy = v ? (v[1] + v[3]) / 2 : 0;
    const far = (key) => {
      const b = this.objs.get(key)?.box;
      return b ? Math.hypot((b[0] + b[2]) / 2 - cx, (b[1] + b[3]) / 2 - cy) : Infinity;
    };
    return [...keys].map((key) => [far(key), key]).sort((a, b) => b[0] - a[0]).map(([, key]) => key);
  }

  renderObjects() {
    const { world } = this;
    let keys = this.objsDirty;
    this.objsDirty = new Set(); // (cull() may add to it while we go)
    // Only the view changed (rotation…): objects out of sight are just
    // placed, and drawn once they come into view (cull()).
    const lazy = this.objsAll && !this.worldAll && this.cullOn;
    if (this.objsAll) {
      keys = new Set(this.objs.keys());
      for (const id of world.structures.keys()) keys.add(`s${id}`);
      for (const id of world.features.keys()) keys.add(`f${id}`);
      for (const key of world.sidewalks) keys.add(`k${key}`);
    } else {
      // a street front shares one lift (buildStructure): redraw whole rows
      for (const key of [...keys]) {
        const s = key[0] === 's' && world.structures.get(Number(key.slice(1)));
        if (s) for (const o of joinedRow(world, s)) keys.add(`s${o.id}`);
      }
    }
    this.free = freeTest(world, this.config);
    this.lampRoom = null; // (buildStreet: worked out again when needed)
    if (this.lampsOn && [...keys].some((k) => k[0] === 'k')) this.dirty.add('lights'); // (lamps come and go)
    if ((this.dark || this.gloom) && keys.size) this.dirty.add('lights'); // (windows come and go, or are hidden anew)
    if (this.objsAll) this.reapGhosts(true); // drawn for the old view

    const now = performance.now();
    const animate = drawEnabled();
    // a whole new map (or a big batch) just appears
    const fresh = [...this.born].filter(([, t]) => t === null).length;
    const drawing = animate && fresh <= DRAW.cap;
    const erasing = animate && this.dying.size <= DRAW.cap;
    const sketch = [];
    let swaps = 0;
    for (const [key, t] of this.born) if (t !== null && now - t > DRAW.max * DRAW.speed) this.born.delete(key);
    // (turned past its quarter, the view puts the same boxes in another order)
    let orderChanged = this.orderAngle !== this.camera.angle;
    for (const key of keys) {
      const id = Number(key.slice(1));
      let entry = this.objs.get(key);
      if (lazy && entry?.at && !this.born.has(key) && this.exists(key)) {
        const { bounds, box } = this.placeOf(entry.at);
        if (!this.inView(box)) {
          if (['minX', 'maxX', 'minY', 'maxY'].some((k) => entry.bounds[k] !== bounds[k])) orderChanged = true;
          Object.assign(entry, { bounds, box, stale: true, bandStale: false });
          if (!this.viewOnly.has(key)) entry.views?.clear(); // (drawn for another town or sun)
          this.cull([entry]);
          continue;
        }
      }
      const built = key[0] === 's' ? this.buildStructure(world.structures.get(id))
        : key[0] === 'f' ? this.buildFeature(world.features.get(id))
          : this.buildStreet(key.slice(1));
      if (!built) {
        if (entry) {
          this.objs.delete(key);
          if (erasing && this.dying.has(key) && entry.shown !== false) {
            // erase from where the pen got to, if it was still drawing it in
            const t = this.born.get(key);
            this.ghosts.set(key, entry);
            sketch.push({ entry, reverse: true, drawnFor: t == null ? Infinity : now - t });
          } else {
            entry.g.remove();
            entry.lg.remove();
            entry.sg.remove();
            orderChanged = true;
          }
        }
        this.born.delete(key);
        if (key[0] === 's') this.parking.spots.delete(id);
        continue;
      }
      if (!entry) {
        entry = { key, g: document.createElementNS(SVGNS, 'g'), lg: document.createElementNS(SVGNS, 'g'), sg: document.createElementNS(SVGNS, 'g') };
        this.layers.lots.appendChild(entry.lg);
        this.layers.shadows.appendChild(entry.sg);
        this.objs.set(key, entry);
        orderChanged = true;
      }
      const s = key[0] === 's' && world.structures.get(id);
      const sig = s && `${s.type}|${s.seed}|${s.ruin ? 'ruin' : ''}`; // (burning down: the house rubbed out, the ruin drawn)
      if (sig !== entry.sig && entry.sig && animate && swaps < DRAW.cap && !this.born.has(key) && entry.shown !== false) {
        // the old drawing is erased as a ghost, the new one drawn after it
        swaps++;
        this.ghosts.set(`${key}~${now}`, { g: entry.g, lg: entry.lg, sg: entry.sg, bounds: entry.bounds, box: entry.box, shown: entry.shown });
        entry.shown = undefined; // new elements below
        sketch.push({ entry: this.ghosts.get(`${key}~${now}`), reverse: true, drawnFor: Infinity, then: key });
        entry.g = document.createElementNS(SVGNS, 'g');
        entry.lg = entry.lg.parentNode.insertBefore(document.createElementNS(SVGNS, 'g'), entry.lg.nextSibling);
        entry.sg = entry.sg.parentNode.insertBefore(document.createElementNS(SVGNS, 'g'), entry.sg.nextSibling);
        this.born.set(key, now);
        orderChanged = true;
      }
      entry.sig = sig;
      // drawn bare for a turn (goBare), now whole: the pen draws in what
      // the bare drawing lacked
      const was = entry.redetail && entry.bare && animate && entry.shown !== false && !this.born.has(key) ? new Set(strokesOf(entry).map((el) => el.outerHTML)) : null;

      entry.g.innerHTML = built.svg;
      entry.lg.innerHTML = built.ground;
      entry.shade = built.shade;
      entry.night = built.night;
      this.glShadows?.castInto(entry.sg, entry.shade);
      if (was) {
        const only = new Set(strokesOf(entry).filter((el) => !was.has(el.outerHTML)));
        if (only.size) sketch.push({ entry, only });
      }
      entry.bare = entry.redetail = false;
      const b = built.bounds;
      if (!entry.bounds || ['minX', 'maxX', 'minY', 'maxY'].some((k) => entry.bounds[k] !== b[k])) orderChanged = true;
      entry.bounds = b;
      entry.box = built.box;
      entry.at = built.at;
      entry.mid = null;
      entry.angle = entry.placedAt = this.camera.angle;
      entry.stale = false;
      // drawn anew for the same town: the views it keeps still hold
      // (land); for a changed one they are old
      if (!this.viewOnly.has(key)) entry.views?.clear();
      entry.k = this.camera.step();
      entry.slid = false;
      entry.band = built.band;
      entry.vents = built.vents?.length ? built.vents : null;
      entry.ventsTurn = this.camera.angle;
      this.coverMist(entry);
      if (entry.hide) {
        for (const g of [entry.g, entry.lg]) g.classList.remove(entry.hide);
        entry.hide = '';
      }
      entry.stale = entry.bandStale = entry.sunStale = false;
      this.cull([entry]);
      if (this.born.has(key) && !entry.shown) this.born.delete(key); // out of sight: no pen
      if (this.born.has(key)) {
        if (!drawing) this.born.delete(key);
        else {
          if (this.born.get(key) === null) this.born.set(key, now);
          if (!sketch.some((k) => k.then === key)) sketch.push({ entry, key });
        }
      }
    }
    this.objsAll = this.worldAll = false;
    this.dying.clear();

    if (orderChanged) {
      const order = isoSort([...this.objs.values(), ...this.ghosts.values()].map((e) => ({ ...e.bounds, entry: e })), this.camera.quarterView()).map((i) => i.entry);
      this.orderAngle = this.camera.angle;
      this.placeObjectGroups(order.filter((e) => e.shown !== false).map((e) => e.g)); // (out of sight: out of the page, see cull)
      this.order = order;
      this.objsPlace = false;
    }

    // after the DOM is in place: the pen needs computed styles and lengths
    const tile = this.camera.tile, scale = this.drawn.zoom;
    sketch.sort((a, b) => !!b.reverse - !!a.reverse); // erasing first: a swap waits for it
    for (const { entry, key, reverse, drawnFor, then, only } of sketch) {
      // (the shadow is shapes in a mask, not pen lines: it goes as the pen
      // starts erasing, and comes once the pen is done)
      const groups = [entry.lg, entry.g], sg = entry.sg;
      if (reverse) {
        sg.style.display = 'none';
        const left = eraseOut(groups, { drawn: drawnFor, tile, scale, speed: then ? DRAW.swap : 1 });
        entry.until = now + left;
        if (then) {
          // the new drawing starts when the old one is half erased
          this.born.set(then, now + left / 2);
          sketch.push({ entry: this.objs.get(then), key: then });
        }
      } else if (only) {
        drawIn(groups, { tile, scale, only, speed: DRAW.detail });
      } else {
        const left = drawIn(groups, { elapsed: now - this.born.get(key), tile, scale });
        if (left <= 0) this.born.delete(key); // done
        sg.style.display = left > 0 ? 'none' : '';
        if (left > 0) setTimeout(() => { sg.style.display = ''; }, left);
      }
    }
    this.renderParked();
  }

  // The opening (main.js): the buildings and trees nearest the middle of
  // the screen are sketched in by the pen as the cover's edge passes over
  // them, the nearest first (DRAW.cap of them; the rest are there already).
  // `at(px)`: ms from now the edge is `px` screen pixels from the middle.
  sketchIntro(at) {
    if (!drawEnabled()) return;
    const { world, camera } = this;
    const cx = innerWidth / 2, cy = innerHeight / 2;
    const off = ([x, y]) => {
      const [sx, sy] = camera.project(x, y);
      return Math.hypot(sx * camera.zoom + camera.panX - cx, sy * camera.zoom + camera.panY - cy);
    };
    const near = [
      ...[...world.structures.values()].map((s) => [`s${s.id}`, off(centerOf(world, s))]),
      ...[...world.features.values()].map((f) => [`f${f.id}`, off([f.x, f.y])]),
    ].filter(([key, d]) => d < Math.hypot(cx, cy) && this.objs.get(key)?.shown !== false)
      .sort((a, b) => a[1] - b[1])
      .slice(0, DRAW.cap);
    const now = performance.now();
    for (const [key, d] of near) {
      this.born.set(key, now + at(d));
      this.objsDirty.add(key);
    }
  }

  // Drop erased objects whose pen is done (all of them with `all`).
  reapGhosts(all = false) {
    const now = performance.now();
    for (const [key, e] of this.ghosts) {
      if (!all && now < e.until) continue;
      e.g.remove();
      e.lg.remove();
      e.sg.remove();
      this.ghosts.delete(key);
    }
  }

  // Local free-space test for a painter (footpaths and roads keep clear).
  attachFree(painter) {
    painter.free = (x, y, r) => this.free(...painter.toWorld(x, y), r);
    return painter;
  }

  // Is the thing an object key stands for still there?
  exists(key) {
    const { world } = this;
    if (key[0] === 'k') return world.sidewalks.has(key.slice(1));
    return (key[0] === 's' ? world.structures : world.features).has(Number(key.slice(1)));
  }

  // Street lamps come and go with the streets (and move for footpaths
  // and railways): redraw every street's, sketching in the new ones.
  touchStreets() {
    const { world } = this;
    for (const key of world.sidewalks) {
      const k = `k${key}`;
      if (!this.objs.has(k)) this.born.set(k, null);
      this.objsDirty.add(k);
    }
    for (const k of this.objs.keys()) {
      if (k[0] !== 'k' || world.sidewalks.has(k.slice(1))) continue;
      this.dying.add(k);
      this.objsDirty.add(k);
    }
  }

  // A street segment's lamp (roads/furniture.js), or null where it has none.
  buildStreet(key) {
    const out = this.paintStreet(key);
    if (!out) return null;
    const { painter, x, y } = out;
    const band = this.bandFor(`k${key}`), detail = this.drawBare ? bareOf(band) : band;
    return { band, detail, svg: mergeRuns(this.atDetail(painter.toSVG(), detail)), ground: '', shade: this.shadeOf(painter), night: this.nightOf(painter), ...this.placeOf({ points: [[x, y]], pad: 0.05, top: painter.top }) };
  }

  // The painters behind buildStreet / buildFeature / buildStructure, for any
  // camera (the photo camera too, see photo.js). `live`: the map's own
  // drawing, which also updates the parking spots.
  paintStreet(key, camera = this.camera) {
    const { world, config } = this;
    if (!world.sidewalks.has(key)) return null;
    if (!this.lampRoom) {
      const paths = pathIndex(world, config), rails = railIndex(world, config);
      const clear = FURNITURE.lamp.clear;
      this.lampRoom = {
        clear: (q) => paths.distance(q, clear) === Infinity && rails.distance(q, clear) === Infinity,
        roads: new SegmentIndex(networkPolylines(world.networks.road, config.road)),
      };
    }
    const [a, b] = key.split('-').map(Number);
    const at = streetLamp(world, config.road, a, b, this.lampRoom.clear, this.lampRoom.roads);
    if (!at) return null;
    const [x, y] = at;
    const painter = new Painter(camera, { x, y, z: world.terrain.heightAt(x, y) }, 0, a * 7919 + b);
    painter.rigid = [x, y];
    lamp(painter, 0, 0);
    return { painter, x, y };
  }

  buildFeature(f) {
    const band = f && this.bandFor(`f${f.id}`), detail = this.drawBare ? bareOf(band) : band;
    const out = this.paintFeature(f, this.camera, detail & 3);
    if (!out) return null;
    const { painter, x, y } = out;
    return { band, detail, svg: mergeRuns(this.atDetail(painter.toSVG(), detail)), ground: '', shade: this.shadeOf(painter), night: this.nightOf(painter), ...this.placeOf({ points: [[x, y]], pad: FEATURE_PAD, top: painter.top }) };
  }

  // The detail (bandOf) an object is drawn with now: as it was drawn last
  // unless the zoom has moved on far enough.
  bandFor(key) {
    return this.bandOf(key, this.bandZoom ?? this.drawn.zoom, this.objs.get(key)?.band);
  }

  // A drawing without the details its band (bandOf) leaves out: the
  // elements tagged d2, or d1 / d2 (painter.js), and the denser tiers of
  // roof hatching – left out rather than hidden, as the browser restyles
  // and lays out hidden elements too. The tiers kept lose their tier
  // class, so each roof plane's strokes merge into one path again
  // (mergeRuns).
  atDetail(svg, band = 0) {
    const level = (band >> 4) & 3, roof = (band >> 2) & 3;
    if (level) svg = svg.replace(level >= 2 ? DETAIL_1_2 : DETAIL_2, '');
    if (roof < 3) svg = svg.replace(ROOF_TIERS[roof], '');
    return svg.replace(ROOF_TIER_CLASS, '');
  }

  paintFeature(f, camera = this.camera, detail = 0) {
    if (!f) return null;
    const def = FEATURE_TYPES[f.type];
    if (!def) return null;
    const { world } = this;
    const { x, y } = f;
    // seeded per feature, so each tree has its own shape
    const painter = new Painter(camera, { x, y, z: world.terrain.heightAt(x, y) }, 0, Math.imul(f.id, 2654435761) ^ f.node);
    painter.rigid = [x, y];
    painter.detail = detail;
    def.draw(painter, f);
    return { painter, x, y };
  }

  buildStructure(s) {
    const out = this.paintStructure(s);
    if (!out) return null;
    const { painter, points } = out;
    const band = this.bandFor(`s${s.id}`), detail = this.drawBare ? bareOf(band) : band;
    return { band, detail, svg: mergeRuns(this.atDetail(painter.toSVG(), detail)), ground: mergeRuns(this.atDetail(painter.toGroundSVG(), detail)), shade: this.shadeOf(painter), night: this.nightOf(painter), vents: painter.vents, ...this.placeOf({ points, pad: STRUCTURE_PAD, top: painter.top, anchor: painter.rigid }) };
  }

  cull(entries = [...this.objs.values(), ...this.ghosts.values()]) {
    if (!this.viewBox) return;
    for (const e of entries) {
      const show = !this.hiddenKinds.has(e.key?.[0]) && !this.inWoods(e) && (!e.box || !this.cullOn || this.inView(e.box));
      if (show === e.shown) continue;
      e.shown = show;
      this.preparedAt = null; // (another in sight to make ready for a turn)
      // drawn for an old view: redraw (renderObjects; mid-turn turnFrame does)
      if (show && e.stale && !this.turning) this.objsDirty.add(e.key);
      // out of sight is out of the page, not just hidden: the browser still
      // restyles hidden elements whenever the line widths change (--stroke)
      if (show) {
        this.layers.lots.appendChild(e.lg);
        this.layers.shadows.appendChild(e.sg);
        this.objsPlace = true; // its drawing goes back in its place (placeObjects)
      } else {
        e.g.remove();
        e.lg.remove();
        e.sg.remove();
      }
    }
  }

  // Put the drawings of the objects in sight back in the objects layer, in
  // the painter's order (this.order): after cull() showed some again.
  placeObjects() {
    this.objsPlace = false;
    if (!this.order) return;
    const live = new Set([...this.objs.values(), ...this.ghosts.values()]);
    this.placeObjectGroups(this.order.filter((e) => e.shown !== false && live.has(e)).map((e) => e.g));
  }

  // Does a scene box overlap the drawn view?
  inView(b) {
    const v = this.viewBox;
    return !v || (b[0] < v[2] && b[2] > v[0] && b[1] < v[3] && b[3] > v[1]);
  }

  // Ground rectangle of an object in the axes of the view's nearest quarter
  // turn (Camera.quarter: both lead towards the viewer), for isoSort.
  viewBounds(points, pad) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of points) {
      const [rx, ry] = this.camera.quarter(x, y);
      minX = Math.min(minX, rx - pad);
      maxX = Math.max(maxX, rx + pad);
      minY = Math.min(minY, ry - pad);
      maxY = Math.max(maxY, ry + pad);
    }
    return { minX, maxX, minY, maxY };
  }
}
