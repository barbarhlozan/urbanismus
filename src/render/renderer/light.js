// Sun and night (Renderer methods; see renderer.js): the sun's place and
// the shadows it casts, swept across the view as it moves, the night's
// grey, and the lights – windows, lamps and headlights.

import { THEME } from '../../theme.js';
import { wobble } from '../painter.js';
import { VEHICLES } from '../vehicles.js';
import { drawIn, drawEnabled, DRAW } from '../draw.js';
import { SUN, DAY, sunFor, sunOfHour, hourAt } from '../shadows.js';
import { lampPool, headBeam } from '../lights.js';
import { sunStyle } from '../sunFree.js';
import { treeLightSector } from '../../../features/trees.js';
import { hashKey, NO_COVER, COS30, r2 } from './shared.js';

// An object's light shapes as path data, for the night's mask
// (renderLights), worked out once per drawing: its outline (Painter.covers)
// and each window's glow (a little larger than the pane) and the light it
// throws on the ground, all rings turned anticlockwise, so rings of one
// colour add up where they overlap.
function lightShapes(night, px) {
  if (night.d?.px === px) return night.d;
  const xy = ([x, y]) => `${r2(x)} ${r2(y)}`;
  const ring = (pts) => {
    let a = 0;
    for (let i = 0; i < pts.length; i++) a += pts[i][0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * pts[i][1];
    return `M${(a > 0 ? pts : [...pts].reverse()).map(xy).join('L')}Z`;
  };
  const grow = (pts, by) => {
    const cx = pts.reduce((t, p) => t + p[0], 0) / pts.length, cy = pts.reduce((t, p) => t + p[1], 0) / pts.length;
    return pts.map(([x, y]) => { const l = Math.hypot(x - cx, y - cy) || 1; return [x + ((x - cx) / l) * by, y + ((y - cy) / l) * by]; });
  };
  night.d = {
    px,
    cover: night.covers.map(ring).join(''),
    wins: night.wins.map((w) => ({ n: w.n, glow: ring(grow(w.pts, 0.04 * px)), spill: w.spill ? ring(w.spill) : '' })).sort((p, q) => p.n - q.n),
  };
  return night.d;
}
// The densest tier of the paper's hatching (hatch.js) the shadows and the
// night keep at each level of detail: every line close up (3), every other
// further out, every 4th far out.
const SHADE_TIERS = [3, 2, 1];
// Seconds the night's strokes take to be hatched in, a set at a time
// (renderNightCanvases); a share of the windows going out (or coming on)
// each second; ms the shadows take to be drawn anew as the sun moves
// (sweepShadows).
const NIGHT_IN = 2.4;
const INK_STEP = 0.1;
const INK_EVERY = 500;
const WINDOWS_BY = 0.06;
const SHADE_SWEEP = 1600;
// ms between the sun's moves between the day's steps (followSun)
const SUN_EVERY = 100;
// While the view turns the map is drawn in draft (goDraft): it leaves out
// the meadow's tufts, the parked cars and the buildings' and gardens' fine
// detail (styles.css, svg.draft), and the objects' shadows (cast for the
// view as it was, they would point the wrong way; the hills' stay, read
// again as it turns). Panning and zooming leave everything as it is:
// what is on the GPU is drawn anew cheaply, and the rest moves with the
// map. Once it rests the detail is back; the shadows wait until what the
// turn redraws is drawn (frame), then are hatched in in `steps`, `step`
// ms apart.
const DRAFT = { steps: 3, step: 80 };
const SWEEP_STEPS = 6; // ms the terrain as turned takes to fade, once the view rests (land)

export class LightDrawing {
  // An object's shadow (shadows.js): the feet of its walls and the other
  // shapes it casts from, in world points, and how its ground projects –
  // kept on the object's entry, so the shadow alone can be drawn again for
  // another sun (renderShadows).
  nightOf(painter) {
    return { wins: painter.panes, covers: painter.covers() };
  }

  shadeOf(painter) {
    return painter.feet.length || painter.casts.length ? { feet: painter.feet, casts: painter.casts, project: painter.groundProjector() } : null;
  }

  // The day steps to step i (DAY.steps): the night or not (drawn over
  // everything, renderNight), how grey, the lamps and windows, and the
  // hills' shadows, drawn again for the sun as it is then (between the
  // steps the sun goes on by itself, followSun). Not mid-turn: false if
  // put off, to try again.
  setSun(i) {
    if (i == null || i === this.dayStep) return true;
    if (this.turning || this.bare) return false;
    const step = DAY.steps[i];
    this.dayStep = i;
    if (!!(step.gloom ?? 0) !== !!this.gloom) this.dirty.add('lights'); // (the objects' outlines, for the grey)
    this.gloom = step.gloom ?? 0;
    this.nightDepth = step.depth ?? 1;
    // the main ink going over to the secondary (styles.css --ink-night on
    // the map; the canvases', renderNightCanvases)
    this.inkNight = step.ink ?? 0;
    if ((step.windows ?? 0) !== this.litShare || !!step.night !== this.windowsDark) {
      this.litShare = step.windows ?? 0;
      this.windowsDark = !!step.night;
      this.dirty.add('lights');
    }
    if (!!step.lamps !== !!this.lampsOn) {
      this.lampsOn = !!step.lamps;
      this.dirty.add('lights');
    }
    const dark = step.night ? 1 : 0;
    if (dark !== this.dark) {
      this.dark = dark;
      this.dirty.add('lights');
    }
    const pos = step.night ? null : step.sun;
    const sun = pos == null ? 'none' : `${pos}|${step.length ?? ''}|${step.hills ?? ''}`;
    if (sun === this.sunAt) return true;
    this.sunAt = sun;
    this.sunPos = pos;
    SUN.on = pos != null;
    if (pos != null) [SUN.azimuth, SUN.length] = sunOfHour(this.hour()) ?? DAY.positions[pos];
    // (the first sun of all just is; the next ones are drawn in)
    const drawn = this.sunDrawn;
    this.sunDrawn = true;
    if (drawn && drawEnabled() && !this.shadesOff) this.sweepShadows(); // (out of sight while the view moves: they come back as they are)
    // nothing of the objects is drawn anew for it: their shadows are cast
    // on the GPU (gl/shadows.js), the stylesheet shows the walls' hatching
    // and the trees' shaded sides the light has now (sunFree.js), the pen
    // drawing in what comes into sight
    this.updateSunStyle(drawn && drawEnabled());
    this.dirty.add('hillshade');
    return true;
  }

  // The hour of the day (shadows.js DAY): the clock's, or where it is held.
  hour() {
    return DAY.on || DAY.held == null ? hourAt(this.world.time) : DAY.held;
  }

  // The sun going on between the day's steps (sunOfHour), a little at a
  // time: the objects' shadows follow it at once (cast on the GPU,
  // gl/shadows.js), the walls' hatching and the trees' shaded sides as
  // the light comes round to them (updateSunStyle); the hills' wait for
  // the next step (setSun). Not mid-turn.
  followSun() {
    if (this.turning || !SUN.on || this.dayStep == null) return;
    const now = performance.now();
    if (now - (this.sunFollowed ?? 0) < SUN_EVERY) return;
    this.sunFollowed = now;
    const at = sunOfHour(this.hour());
    if (!at || (at[0] === SUN.azimuth && at[1] === SUN.length)) return;
    [SUN.azimuth, SUN.length] = at;
    this.updateSunStyle(drawEnabled());
  }

  // The stylesheet for the sun and the view as they are (sunFree.js); with
  // `pen`, what it shows that it didn't is drawn in by the pen, on the
  // objects in sight.
  updateSunStyle(pen = false) {
    const sun = sunFor(this.camera), sector = treeLightSector(this.camera);
    this.styleAngle = this.camera.angle;
    // (written only when what it shows changes: each time restyles the drawings)
    const { css, shown } = sunStyle(sun, sector);
    if (css === this.sunStyleKey) return;
    this.sunStyleKey = css;
    const was = new Set(this.sunShown ?? []);
    this.sunShown = shown;
    this.sunCss.textContent = css;
    const fresh = shown.filter((s) => !was.has(s));
    if (!pen || !fresh.length || this.turning) return;
    const sel = fresh.join(', '), tile = this.camera.tile, scale = this.drawn.zoom;
    for (const e of this.objs.values()) {
      if (e.shown === false || !e.g?.isConnected || (e.box && !this.inView(e.box))) continue;
      const only = new Set(e.g.querySelectorAll(sel));
      if (only.size) drawIn([e.g], { tile, scale, only, speed: DRAW.detail });
    }
  }

  // The lights (lights.js), left out of the night (see the constructor).
  // On the ground: with the lamps on (DAY.steps `lamps`), a pool under
  // every street lamp, and at night the light a lit window low on its
  // wall throws on the ground before it – the objects, drawn over the
  // ground, hide what of it lies behind them. Over the objects, the night
  // is their outlines (Painter.covers), painted from the furthest to the
  // nearest (this.order), each with its own lights left out after it: the
  // windows lit (`windows`: so many tenths of them, by each window's
  // number, Painter._window), a hole a little larger than the pane, so its
  // own paper shows with a glow about it, and the lamps' heads – so a house
  // hides the windows behind it along its outline. The lamps' pools are cut
  // out of the shadows' masks too (lightCuts). Drawn again when the lamps
  // come on or go off, the share of windows changes, objects are drawn
  // anew, and once a turn of the view rests; while it turns, the objects'
  // night lies over everything (it can't follow them), and the ground's
  // pools turn as a sheet.
  renderLights() {
    const px = this.camera.tile;
    const project = (x, y, z) => this.project(x, y, z);
    const turning = this.turning || !this.order;
    const lit = this.dark && !turning ? Math.round((this.litShown ?? this.litShare ?? 0) * 100) : 0;
    this.litDrawn = Math.round((this.litShown ?? this.litShare ?? 0) * 100);
    const parts = []; // [light?, path data], in order
    const each = []; // (the same, one shape each: the GPU's, gl/night.js)
    const add = (light, d) => {
      if (!d) return;
      each.push([light, d]);
      const last = parts[parts.length - 1];
      if (last && last[0] === light) last[1] += d;
      else parts.push([light, d]);
    };
    let pools = '';
    const ground = []; // (the pools and the windows' light on the ground, one by one)
    const view = `${this.camera.angle}|${px}`;
    for (const e of turning ? this.objs.values() : this.order) {
      const lamp = this.lampsOn && e.key?.[0] === 'k' && e.at?.points?.[0];
      let head = '';
      if (lamp) {
        // (worked out once per view and lamp)
        if (e.lampD?.view !== view || e.lampD.at !== lamp) {
          const [pool, h] = lampPool(lamp[0], lamp[1], project, px);
          e.lampD = { view, at: lamp, pool, head: h };
        }
        pools += e.lampD.pool;
        if (e.lampD.pool) ground.push(e.lampD.pool);
        head = e.lampD.head;
      }
      if (turning) continue;
      const n = e.night && lightShapes(e.night, px);
      if (n?.cover) add(false, n.cover); // (by day too, for the night as it comes in or lifts)
      if (head) add(true, head);
      if (lit && n) {
        for (const w of n.wins) {
          if (w.n >= lit) continue;
          add(true, w.glow);
          if (w.spill) ground.push(w.spill);
        }
      }
    }
    this.glCover = each;
    this.glGround = ground;
    // (the shadows' masks, only when the pools change: a change repaints them)
    if (pools !== this.poolsCut) {
      this.poolsCut = pools;
      const cut = pools ? `<path class="light" d="${pools}"/>` : '';
      for (const el of this.lightCuts) el.innerHTML = cut;
    }
  }

  // The lights of what moves, at night (with the lamps on): a beam on the
  // ground ahead of every car, bus, lorry and train (lights.js headBeam),
  // as polygons in scene px, for the night's canvas to rub out
  // (renderNightGround) – over the map's drawing, under what moves and
  // under the buildings in front.
  headlights() {
    const out = [];
    if (!this.lampsOn || !this.showAgents) return out;
    const beam = (x, y, dx, dy, long, seed) => {
      const pts = headBeam(x, y, dx, dy, long, seed).map(([px, py]) => this.projectDeck(px, py, 0.02));
      if (pts.some(([sx, sy]) => this.pen.onScreen(sx, sy))) out.push(pts);
    };
    for (const a of this.agents.visible()) {
      if (!(a.bus || a.truck || a.trip?.mode === 'drive')) continue;
      let dx, dy;
      if (a.bus || a.truck) {
        const l = Math.hypot(a.x - a.tx, a.y - a.ty);
        if (l < 1e-4) continue;
        [dx, dy] = [(a.x - a.tx) / l, (a.y - a.ty) / l];
      } else {
        const h = this.agentEls.get(a.id)?.heading;
        if (h == null) continue;
        const t = (h / VEHICLES.headings) * Math.PI * 2;
        [dx, dy] = [Math.cos(t), Math.sin(t)];
      }
      const [wx, wy] = wobble(a.x, a.y);
      beam(a.x + wx + dx * 0.08, a.y + wy + dy * 0.08, dx, dy, false, typeof a.id === 'number' ? a.id : hashKey(a.id));
    }
    const half = this.config.trains.length / 2;
    for (const t of this.trains.visible()) {
      const [x, y, dx, dy] = t.points[0] ?? [];
      if (x == null) continue;
      const l = Math.hypot(dx, dy) || 1;
      beam(x + (dx / l) * half, y + (dy / l) * half, dx / l, dy / l, true, hashKey(String(t.id)));
    }
    return out;
  }

  // The shadows (gl/shadows.js), for the view the SVGs were last drawn
  // at, fading with the weather as they do (--sun, main.js); the objects'
  // hidden while the view turns (hideShadows), hatched in once it rests.
  renderShadeCanvas() {
    const d = this.drawn;
    if (!d || !this.glShadows) return;
    const sun = this.svg.style.getPropertyValue('--sun');
    if (sun !== this.shadeSun) {
      this.shadeSun = sun;
      for (const el of [this.glShadows.canvas, this.parkedSvg]) el.style.setProperty('--sun', sun);
    }
    const look = {
      view: { zoom: d.zoom, panX: d.panX, panY: d.panY, angle: d.angle, ox: this.ox, oy: this.oy, W: this.winW, H: this.winH },
      hatch: SUN.hatch, tier: SHADE_TIERS[this.lodLevel ?? 0] ?? 1, px: this.camera.tile, stroke: this.strokeK,
    };
    // the sun the objects' shadows are cast by (gl/shadows.js castPieces):
    // its shift on the ground, and a shift on the ground on screen
    const cam = this.camera, [ux, uy] = cam.toView(1, 0), [vx, vy] = cam.toView(0, 1), T = cam.tile;
    const casting = {
      cast: SUN.on && SUN.hatch ? sunFor(cam).cast : [0, 0],
      iso: [(ux - uy) * COS30 * T, (ux + uy) * 0.5 * T, (vx - vy) * COS30 * T, (vx + vy) * 0.5 * T],
    };
    this.glShadows.draw({ ...look, hold: (this.shadesOff && !this.shadesComing) || this.turning, shown: this.shadesShown ?? 1, sun: casting });
  }

  hideShadows() {
    this.shadesComing = false;
    if (this.shadesOff) return;
    this.shadesOff = true;
    cancelAnimationFrame(this.shadesIn);
    this.sweep?.end();
    this.shadesShown = 0;
  }

  // The shadows hatched in again once the view rests and what it redraws
  // is drawn (frame).
  showShadows() {
    this.shadesOff = this.shadesComing = false;
    const { steps, step } = DRAFT;
    this.shadesShown = 1;
    if (!drawEnabled()) return;
    const start = performance.now();
    const next = () => {
      const i = Math.min(steps, Math.floor((performance.now() - start) / step) + 1);
      this.shadesShown = i / steps;
      if (i < steps) this.shadesIn = requestAnimationFrame(next);
    };
    next();
  }

  // The sun has moved a step: the hills' shadows as they were stay, under
  // a ragged front that goes across the view the way a hand hatches
  // (across the lines), and the new ones come in behind it, over
  // SHADE_SWEEP ms – the old a copy of their sheet and masks, clipped to
  // what the front has not reached, the new clipped to what it has. (The
  // objects' follow the sun as it goes, followSun.) A sweep still going
  // ends at once.
  sweepShadows() {
    this.sweep?.end();
    const veil = this.shadeVeil, h = SUN.hatch;
    if (!veil || !h) return;
    const old = veil.cloneNode(true);
    for (const el of old.querySelectorAll('[id]')) el.id = `${el.id}-was`;
    for (const el of old.querySelectorAll('[fill^="url(#"], [mask^="url(#"]')) {
      for (const a of ['fill', 'mask']) {
        const v = el.getAttribute(a);
        if (v?.startsWith('url(#')) el.setAttribute(a, v.replace(/\)$/, '-was)'));
      }
    }
    veil.parentNode.insertBefore(old, veil);
    const defs = this.svg.querySelector('defs');
    defs.insertAdjacentHTML('beforeend', '<clipPath id="sweep-new" clipPathUnits="userSpaceOnUse"><path/></clipPath><clipPath id="sweep-old" clipPathUnits="userSpaceOnUse"><path/></clipPath>');
    const [pNew, pOld] = ['#sweep-new path', '#sweep-old path'].map((q) => defs.querySelector(q));
    veil.setAttribute('clip-path', 'url(#sweep-new)');
    old.setAttribute('clip-path', 'url(#sweep-old)');
    // the map in the front's axes: u along the hatching, v across it
    const a = ((h.angle + 90) * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a);
    // (across what is in view, so it is seen going all the way)
    const cam = this.camera, px = cam.tile, m = 80;
    const corners = [[-m, -m], [innerWidth + m, -m], [-m, innerHeight + m], [innerWidth + m, innerHeight + m]].map(([x, y]) => [(x - cam.panX) / cam.zoom, (y - cam.panY) / cam.zoom]);
    const us = corners.map(([x, y]) => -x * sn + y * c), vs = corners.map(([x, y]) => x * c + y * sn);
    const u0 = Math.min(...us), u1 = Math.max(...us), v0 = Math.min(...vs), v1 = Math.max(...vs);
    const jag = px * 0.9, n = Math.max(8, Math.ceil((u1 - u0) / (px * 0.7)));
    const off = Array.from({ length: n + 1 }, (_, i) => (hashKey(`sweep${i}`) % 1000) / 1000 * jag);
    const at = (u, v) => `${r2(v * c - u * sn)} ${r2(v * sn + u * c)}`;
    // in SWEEP_STEPS steps, as stop-motion: each moves the front over a
    // block of the view (and repaints the shadows whole)
    const start = performance.now();
    let shown = -1;
    const step = () => {
      const i = Math.min(SWEEP_STEPS, Math.floor(((performance.now() - start) / SHADE_SWEEP) * SWEEP_STEPS) + 1);
      if (i === shown) {
        this.sweep.raf = requestAnimationFrame(step);
        return;
      }
      shown = i;
      const t = i / SWEEP_STEPS, e = t * t * (3 - 2 * t);
      const f = v0 - jag + (v1 - v0 + 2 * jag) * e;
      const front = off.map((o, i) => [u0 + ((u1 - u0) * i) / n, f + o - jag / 2]);
      pNew.setAttribute('d', `M${at(u0, v0 - jag * 2)}L${at(u1, v0 - jag * 2)}${front.slice().reverse().map(([u, v]) => `L${at(u, v)}`).join('')}Z`);
      pOld.setAttribute('d', `M${at(u0, v1 + jag * 2)}L${at(u1, v1 + jag * 2)}${front.slice().reverse().map(([u, v]) => `L${at(u, v)}`).join('')}Z`);
      if (this.glShadows) this.glShadows.dirty.hills = this.glShadows.dirty.objects = true; // (the clips are outside the sheets they watch)
      if (t < 1) this.sweep.raf = requestAnimationFrame(step);
      else this.sweep.end();
    };
    this.sweep = {
      end: () => {
        cancelAnimationFrame(this.sweep?.raf);
        old.remove();
        veil.removeAttribute('clip-path');
        defs.querySelector('#sweep-new')?.remove();
        defs.querySelector('#sweep-old')?.remove();
        this.sweep = null;
      },
    };
    step();
  }

  // The night, every frame (gl/night.js): its grey easing to the
  // hour's (this.gloom, a little each frame), the paper's strokes at night
  // – every line close up, fewer further out, as the shadows' – and the
  // lights rubbed out: on the ground, the lamps' pools, the windows' light
  // and the beams of what moves; over the objects, their lit windows.
  renderNightCanvases(dt) {
    const { camera } = this, now = performance.now();
    this.inkShown = (this.inkShown ?? 0) + ((this.inkNight ?? 0) - (this.inkShown ?? 0)) * Math.min(1, dt / 1.6);
    if (Math.abs(this.inkShown - (this.inkNight ?? 0)) < 0.01) this.inkShown = this.inkNight ?? 0;
    // the map's main ink (styles.css --ink-night) in steps of INK_STEP, at
    // most every INK_EVERY ms – each change restyles the whole map
    const ink = Math.round(this.inkShown / INK_STEP) * INK_STEP;
    if (ink !== this.inkSet && (now - (this.inkAt ?? 0) > INK_EVERY || this.inkSet == null || this.inkShown === this.inkNight)) {
      this.inkSet = ink;
      this.inkAt = now;
      for (const el of this.svgs) el.style.setProperty('--ink-night', `${Math.round(ink * 100)}%`);
    }
    this.nightGrey += ((this.gloom ?? 0) - this.nightGrey) * Math.min(1, dt / 1.6);
    if (Math.abs(this.nightGrey - (this.gloom ?? 0)) < 0.004) this.nightGrey = this.gloom ?? 0;
    const pal = THEME.palette;
    // each set of the night's strokes hatched in (or rubbed out) over
    // NIGHT_IN seconds as the night deepens (or lifts)
    const want = [this.dark ? 1 : 0, this.dark && (this.nightDepth ?? 1) >= 2 ? 1 : 0, this.dark && (this.nightDepth ?? 1) >= 3 ? 1 : 0];
    this.reveal ??= [...want];
    this.reveal = this.reveal.map((r, i) => (r < want[i] ? Math.min(want[i], r + dt / NIGHT_IN) : Math.max(want[i], r - dt / NIGHT_IN)));
    // the windows going out (or coming on) one by one, not a tenth at once
    const target = this.litShare ?? 0;
    this.litShown = (this.litShown ?? target) + Math.max(-dt * WINDOWS_BY, Math.min(dt * WINDOWS_BY, target - (this.litShown ?? target)));
    if (Math.round(this.litShown * 100) !== this.litDrawn && now - (this.litAt ?? 0) > 150) {
      this.litAt = now;
      this.dirty.add('lights');
    }
    const look = {
      grey: this.nightGrey,
      colour: pal.detail,
      // (in steps, ten a second, as stop-motion: each step repaints both
      // canvases whole)
      reveal: this.reveal.map((r) => Math.round(r * NIGHT_IN * 10) / (NIGHT_IN * 10)),
      tier: SUN.hatch && this.reveal.some((r) => r > 0) ? SHADE_TIERS[this.lodLevel ?? 0] ?? 1 : -1,
      hatch: SUN.hatch,
      px: camera.tile,
      stroke: this.strokeK ?? 1,
    };
    const d = this.drawn;
    if (!this.glNight || !d) return;
    const view = { zoom: d.zoom, panX: d.panX, panY: d.panY, ox: this.ox, oy: this.oy, W: this.winW, H: this.winH };
    this.glNight[0].draw(view, { ...look, lights: this.glGround, sheet: this.nightSheet, beams: this.headlights() });
    // (while the view turns the objects' night can't follow them: they go
    // without, bare paper, as they are drawn bare – the lights on the ground stay)
    this.glNight[1].draw(view, { ...look, cover: this.turning ? NO_COVER : this.glCover });
  }

  // Every object's shadow drawn again from its feet, with SUN as it is
  // now – without repainting the objects (mark the layer dirty after a
  // change to SUN).
  renderShadows() {
    for (const e of this.objs.values()) this.glShadows?.castInto(e.sg, e.shade);
  }
}
