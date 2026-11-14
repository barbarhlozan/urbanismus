// The view moving (Renderer methods; see renderer.js): panning and zooming
// on the GPU until the view rests, turning step by step with the objects'
// views made ready ahead, landing, the map in draft meanwhile, and the
// pen width and level of detail that follow the zoom.

import { VEHICLES } from '../vehicles.js';
import { drawEnabled } from '../draw.js';
import { MEADOW, meadowGround } from '../meadow.js';
import { isoSort } from '../order.js';
import { Camera } from '../camera.js';
import { SVGNS, VIEW_SETTLE, GL_LINES, STEPS, GL_AHEAD, COS30, r2 } from './shared.js';

// How far past each window edge the map is drawn while the camera moves
// (placeView), as a share of the window.
const OVERSCAN = 0.25;
// While the view turns (Renderer.turnFrame): the layers turned as a sheet
// of paper, drawn anew once it rests, and the lines on the ground drawn at
// the turning angle every frame. Buildings, trees and lamps go their own way.
const SHEET = ['forest', 'mist', 'hillshade'];
const LINES = ['roads', 'paths', 'rails', 'fences'];
const VIEWS = 12;
const PREPARE_REST = 1500;
const SETTLE_FADE = 260;

export class ViewMotion {
  // Pan and zoom. Redrawing the SVGs at a new view re-lays-out and repaints
  // every element, too slow to do on every frame of a pan or zoom. So while
  // the camera moves, the last drawing (`drawn`) is only shifted / stretched
  // on the GPU with a CSS transform on their wrappers (.view), and redrawn
  // when the camera rests –
  // or early, when the moved drawing would no longer cover the window. It
  // reaches OVERSCAN of the window past each edge, so there is picture to
  // slide into. (Mid-zoom the stretched lines look a little soft; they
  // sharpen when the zoom rests.)
  placeView() {
    const cam = this.camera, now = performance.now();
    const W = innerWidth, H = innerHeight;
    if (W !== this.winW || H !== this.winH) {
      [this.winW, this.winH] = [W, H];
      [this.ox, this.oy] = [Math.round(W * OVERSCAN), Math.round(H * OVERSCAN)];
      for (const w of this.wrappers) Object.assign(w.style, { left: `${-this.ox}px`, top: `${-this.oy}px`, width: `${W + 2 * this.ox}px`, height: `${H + 2 * this.oy}px`, transformOrigin: `${this.ox}px ${this.oy}px` });
      this.drawn = null;
    }
    const view = `${cam.zoom} ${cam.panX} ${cam.panY} ${cam.angle}`;
    if (view !== this.lastView) {
      this.lastView = view;
      this.movedAt = now;
    }
    const d = this.drawn;
    let css = '';
    if (!d || d.view !== view) {
      const k = d ? cam.zoom / d.zoom : 1;
      const tx = d ? cam.panX - k * d.panX : 0, ty = d ? cam.panY - k * d.panY : 0;
      const { ox, oy } = this;
      const covered = tx - k * ox <= 0 && ty - k * oy <= 0 && tx + k * (W + ox) >= W && ty + k * (H + oy) >= H;
      // turning: drawn at the angle it has reached every frame (turnFrame),
      // while panning and zooming move the drawing as ever (a bare corner of
      // paper may show meanwhile); once the view rests, what is left is
      // drawn anew (land)
      const turned = d && d.angle !== cam.angle;
      if (d && (covered || turned) && this.deferView && now - this.movedAt < VIEW_SETTLE) {
        css = `translate(${tx}px, ${ty}px) scale(${k})`;
        if (turned) this.goDraft();
        if (turned && !this.turning) this.startTurn();
      } else {
        if (this.turning || turned) this.land();
        this.drawn = { view, zoom: cam.zoom, panX: cam.panX, panY: cam.panY, angle: cam.angle };
        const t = `translate(${cam.panX + ox} ${cam.panY + oy}) scale(${cam.zoom})`;
        for (const scene of this.scenes) scene.setAttribute('transform', t);
        this.updateStroke(cam.zoom);
        // the drawn area (the window and the overscan past it) in scene px
        this.viewBox = [(-ox - cam.panX) / cam.zoom, (-oy - cam.panY) / cam.zoom, (W + ox - cam.panX) / cam.zoom, (H + oy - cam.panY) / cam.zoom];
        this.cull();
        this.cullMeadow();
      }
    }
    if (css !== this.css) {
      this.css = css;
      // on the wrappers, not the SVGs: a transform on an <svg> itself
      // makes the browser lay it out again
      for (const w of this.wrappers) w.style.transform = css;
    }
  }

  // The ground drawn at angle `from` turned to angle `to`, in scene px:
  // about the middle of the map (the scene's origin), as in Camera.project,
  // without the relief. As an SVG transform.
  // (`css`: as a CSS transform, about the same point)
  sheet(from, to, css = false) {
    const c = COS30, a = to - from, cos = Math.cos(a), sin = Math.sin(a);
    // scene px -> view axes (the projection undone) -> turned -> scene px
    const inv = [[0.5 / c, 1], [-0.5 / c, 1]];
    const turn = [[cos, -sin], [sin, cos]];
    const proj = [[c, -c], [0.5, 0.5]];
    const mul = (p, q) => [0, 1].map((i) => [0, 1].map((j) => p[i][0] * q[0][j] + p[i][1] * q[1][j]));
    const m = mul(proj, mul(turn, inv));
    const sep = css ? ', ' : ' ';
    return `matrix(${[m[0][0], m[1][0], m[0][1], m[1][1], 0, 0].join(sep)})`;
  }

  // Where the middle of an object's ground shows at angle `a`, in scene px
  // (flat: the relief raises it the same at any angle).
  footAt(e, a) {
    const cam = this.camera;
    if (!e.mid) {
      const pts = e.at.points;
      const mid = [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
      e.mid = cam.warp ? cam.warp(...mid) : mid;
    }
    const x = e.mid[0] - cam.cx, y = e.mid[1] - cam.cy;
    const rx = x * Math.cos(a) - y * Math.sin(a), ry = x * Math.sin(a) + y * Math.cos(a);
    return [(rx - ry) * COS30 * cam.tile, (rx + ry) * 0.5 * cam.tile];
  }

  // The view starts turning: the hover marks (drawn for the camera as it
  // is) wait for it to end, and what is being erased goes at once.
  startTurn() {
    this.turning = true;
    this.landing.clear(); // (still behind: the turn draws them, turnFrame)
    this.landingOrder = null;
    this.sweep?.end(); // (the shadows as they are now)
    this.renderLights(); // (the lamps' alone, turning as a sheet; the windows' once the view rests)
    this.layers.overlay.style.visibility = 'hidden';
    this.reapGhosts(true);
  }

  // Turned far enough (config.render.turnBare): the objects go bare (bareOf)
  // for the rest of the turn – their facade detail hidden at once, and
  // each drawn bare at the steps it comes to – and get it back from the
  // pen once the view rests (land, renderObjects).
  goBare() {
    this.bare = true;
    for (const e of this.objs.values()) {
      if (e.bare || e.hidBare) continue;
      for (const g of [e.g, e.lg]) g.classList.add('bare');
      e.hidBare = 'bare';
    }
  }

  // One frame of a turn, at the angle the camera has reached. The ground
  // (SHEET) turns as a sheet of paper, exact on flat ground; the roads,
  // paths, railways, fences and parked cars on it are drawn at this angle.
  // Buildings, trees and lamps are drawn at the step of the turn (Camera.STEP)
  // nearest it, each with its garden and shadow: from the drawings each
  // keeps for the steps it has been drawn at (views, made ready while the
  // view rests: prepareTurn), or drawn now, as many as config.render.
  // turnBudget allows – buildings first, those furthest behind first. Each
  // slides the last hair to where it stands at this very angle; one not
  // drawn yet slides round upright as last drawn, until its turn. All of
  // that bare (goBare), and only once the view has turned config.render.
  // turnBare from where it rested: a nudge just slides them.
  turnFrame() {
    const cam = this.camera, a = cam.angle, t0 = performance.now();
    const k = Math.round(a / Camera.STEP) % STEPS;
    const turn = this.sheet(this.drawn.angle, a);
    for (const l of SHEET) this.layers[l].setAttribute('transform', turn);
    for (const el of this.lightCuts) el.setAttribute('transform', turn); // (as the lights)
    this.nightSheet = new DOMMatrix(this.sheet(this.drawn.angle, a, true)); // (and the ground's, gl/night.js)
    // the terrain, the largest of them, turned whole on the GPU: its <svg>
    // about the middle of the map as drawn (the scene's origin)
    const { ground } = this, d = this.drawn;
    ground.style.transformOrigin = `${d.panX + this.ox}px ${d.panY + this.oy}px`;
    ground.style.transform = this.sheet(d.angle, a, true);
    ground.style.willChange = 'transform';
    // (and the canvas its shapes are drawn on, gl/objects.js: what of the
    // terrain is drawn for the view, the brows and rocks, and the washes)
    const mirror = this.groundMirror();
    if (mirror) Object.assign(mirror.style, { transformOrigin: ground.style.transformOrigin, transform: ground.style.transform });
    if (this.linesAngle !== a) {
      for (const l of LINES) {
        if (GL_LINES.includes(l)) continue; // (on the GPU the camera turns them)
        this.ink[l]?.clearErasing();
        this[`render${l[0].toUpperCase()}${l.slice(1)}`]();
      }
      if (!this.drafting) this.renderParked(); // (left out of a draft, drawn once it rests: land)
      this.linesAngle = a;
    }
    // (changed meanwhile: its views are old, and it is drawn anew once at rest)
    for (const key of this.objsDirty) this.objs.get(key)?.views?.clear();
    // every object where it stands at this angle: what is in sight
    for (const e of this.objs.values()) {
      if (!e.at || e.placedAt === a) continue;
      Object.assign(e, this.placeOf(e.at));
      e.placedAt = a;
    }
    this.cull();
    if (!this.bare) {
      const off = Math.abs(Math.atan2(Math.sin(a - d.angle), Math.cos(a - d.angle)));
      if (off >= (this.config.render.turnBare * Math.PI) / 180) this.goBare();
    }
    const due = [];
    for (const e of this.bare ? this.objs.values() : []) {
      if (e.shown === false || e.k === k) continue;
      const view = !this.objsDirty.has(e.key) && e.views?.get(k);
      if (view) this.swapIn(e, view);
      else due.push(e);
    }
    const behind = (e) => {
      if (e.k == null) return Infinity;
      const d = Math.abs(e.k - k) % STEPS;
      return Math.min(d, STEPS - d) * (e.key[0] === 's' ? 4 : 1);
    };
    due.sort((p, q) => behind(q) - behind(p));
    // (the meadow's share kept back)
    const { turnBudget, turnMeadow } = this.config.render, budget = turnBudget - turnMeadow;
    // let go, it is coasting to the step it will rest on: everything in
    // sight is made ready there, buildings first, so it rests on what it
    // shows as it comes in
    const rest = cam.spin && this.bare ? ((Math.round((a + cam.spin.left) / Camera.STEP) % STEPS) + STEPS) % STEPS : null;
    if (rest !== null && rest !== k) {
      this.turnRest = rest;
      for (const kind of ['s', 'f', 'k']) {
        for (const e of this.objs.values()) {
          if (e.key[0] !== kind || e.shown === false || e.k === rest || e.views?.has(rest)) continue;
          if (performance.now() - t0 > budget) break;
          const view = this.buildView(e, rest);
          if (!view) continue;
          (e.views ??= new Map()).set(rest, view);
          this.keepViews(e);
        }
      }
    }
    // (coasting, all of it goes to the step it rests on; the steps passed
    // on the way are only seen for a moment)
    for (const e of rest !== null && rest !== k ? [] : due) {
      if (performance.now() - t0 > budget) break;
      const view = this.buildView(e, k);
      if (view) this.swapIn(e, view);
    }
    this.reorder(false);
    // the meadow: each chunk in sight turned as a sheet from where it was
    // drawn (its tufts lean a little meanwhile), and drawn at this angle,
    // the furthest behind first, for config.render.turnMeadow ms
    // (left out of a draft: drawn once it rests, land)
    const chunks = this.drafting ? [] : [...this.meadow.entries()].filter(([, c]) => c.shown && c.angle !== a);
    const off = (c) => Math.abs(Math.sin(((c.angle ?? this.drawn.angle) - a) / 2));
    chunks.sort((p, q) => off(q[1]) - off(p[1]));
    const m0 = performance.now();
    let meadow = null;
    for (const [key, c] of chunks) {
      if (performance.now() - m0 > turnMeadow || performance.now() - t0 > turnBudget) {
        c.g.setAttribute('transform', this.sheet(c.angle ?? this.drawn.angle, a));
        c.turned = true;
        continue;
      }
      this.drawChunk(key, (meadow ??= meadowGround(this.world, this.config)));
    }
    for (const e of this.objs.values()) {
      const slide = e.shown !== false && e.angle !== undefined && e.angle !== a;
      if (!slide && !e.slid) continue;
      e.slid = slide;
      e.slideT = '';
      if (slide) {
        const [x0, y0] = this.footAt(e, e.angle), [x1, y1] = this.footAt(e, a);
        e.slideT = `translate(${r2(x1 - x0)} ${r2(y1 - y0)})`;
      }
      this.placeGroups(e);
    }
  }

  // An object's groups where they show: moved by its slide mid-turn
  // (turnFrame), and a forest clump's drawing leaning in the wind as well
  // (swayTrees) – both in the one transform, so neither undoes the other.
  placeGroups(e) {
    const lean = e.sway?.[0]?.el === e.g ? e.sway[0].t : '';
    for (const g of [e.g, e.lg, e.sg]) {
      const t = [e.slideT, g === e.g ? lean : ''].filter(Boolean).join(' ');
      if (t) g.setAttribute('transform', t);
      else g.removeAttribute('transform');
    }
  }

  // An object's drawing at step `k` of the turn, bare (bareOf), its garden
  // and shadow, as a view to keep (swapIn), drawn off the page; null if it
  // is gone.
  buildView(e, k) {
    const cam = this.camera, live = cam.angle, id = Number(e.key.slice(1));
    cam.angle = k * Camera.STEP;
    this.drawBare = true;
    try {
      const built = e.key[0] === 's' ? this.buildStructure(this.world.structures.get(id))
        : e.key[0] === 'f' ? this.buildFeature(this.world.features.get(id))
          : this.buildStreet(e.key.slice(1));
      if (!built) return null;
      const [g, lg, sg] = [0, 1, 2].map(() => document.createElementNS(SVGNS, 'g'));
      g.innerHTML = built.svg;
      lg.innerHTML = built.ground;
      this.glShadows?.castInto(sg, built.shade);
      return { k, angle: cam.angle, bare: true, g, lg, sg, shade: built.shade, night: built.night, band: built.band, vents: built.vents?.length ? built.vents : null, ventsTurn: cam.angle, bounds: built.bounds, box: built.box, at: built.at };
    } finally {
      cam.angle = live;
      this.drawBare = false;
    }
  }

  // Put a view (buildView) in for the object's drawing, keeping the one it
  // had, if a bare one drawn at a step, for when the turn comes back to it.
  swapIn(e, view) {
    e.views ??= new Map();
    if (e.k != null && e.bare && !e.views.has(e.k)) {
      const { k, angle, bare, g, lg, sg, shade, night, band, vents, ventsTurn, bounds, box, at } = e;
      e.views.set(e.k, { k, angle, bare, g, lg, sg, shade, night, band, vents, ventsTurn, bounds, box, at });
    }
    e.views.delete(view.k);
    for (const n of ['g', 'lg', 'sg']) {
      e[n].removeAttribute('transform');
      // (shown on the GPU until the new one is built there: gl/objects.js)
      view[n].standIn = e[n].standIn ?? e[n];
      e[n].parentNode?.replaceChild(view[n], e[n]);
    }
    Object.assign(e, view);
    e.placedAt = view.angle;
    e.mid = null;
    e.slid = false;
    e.slideT = '';
    e.hide = e.hidBare = ''; // (classes on the groups swapped out)
    // a clump leaning in the wind leans as far in its new drawing, at once
    const lean = e.sway?.[0]?.e ? e.sway[0].lean : 0;
    if (lean) {
      this.swayUnits(e);
      const u = e.sway[0];
      if (u) Object.assign(u, { lean, t: `matrix(1 0 ${lean} 1 ${r2(-lean * u.foot[1])} 0)` });
      this.placeGroups(e);
    }
    this.keepViews(e);
    // (a view kept from before the mist came or went: covered as it is now)
    if (this.mistLevel != null || e.g.querySelector(':scope > .mist-cover') || e.g.mistUnderTo) this.coverMist(e);
  }

  // At most VIEWS kept for an object: those furthest from the step it shows
  // go first (never the one a coasting turn will rest on).
  keepViews(e) {
    if (e.views.size <= VIEWS) return;
    const far = (j) => (j === this.turnRest ? -1 : Math.min(Math.abs(j - e.k) % STEPS, STEPS - (Math.abs(j - e.k) % STEPS)));
    const keys = [...e.views.keys()].sort((p, q) => far(q) - far(p));
    for (const j of keys.slice(0, e.views.size - VIEWS)) e.views.delete(j);
  }

  // The painter's order of the objects as they now stand (isoSort): of all
  // of them, or mid-turn (`all` false) of those in sight only, the others
  // after them until the turn is over.
  reorder(all = true) {
    const live = [...this.objs.values(), ...this.ghosts.values()];
    const sorted = all ? live : live.filter((e) => e.shown !== false);
    const order = isoSort(sorted.map((e) => ({ ...e.bounds, entry: e })), this.camera.quarterView()).map((i) => i.entry);
    this.placeObjectGroups(order.filter((e) => e.shown !== false).map((e) => e.g));
    this.order = all ? order : order.concat(live.filter((e) => e.shown === false));
    this.orderAngle = this.camera.angle;
  }

  // While the view rests on a step of the turn, the views of the steps
  // either side (config.render.turnAhead each way, the nearest first,
  // buildings first) are made ready for the objects in sight, for at most
  // config.render.prepareBudget ms each frame, so a turn finds them drawn.
  // (in the browser's idle time between frames, as much as it has – never
  // holding a frame up; in a frame's budget where there's no such time)
  schedulePrepare() {
    if (typeof requestIdleCallback !== 'function') return this.prepareTurn();
    if (this.prepareIdle) return;
    this.prepareIdle = requestIdleCallback((deadline) => {
      this.prepareIdle = null;
      this.prepareTurn(Math.min(this.config.render.prepareBudget, deadline.timeRemaining() - 1));
    }, { timeout: 500 });
  }

  prepareTurn(budget = this.config.render.prepareBudget) {
    if (!(budget > 0)) return;
    const k = this.camera.step();
    if (k == null || this.turning || this.objsAll || this.objsDirty.size || performance.now() - this.movedAt < PREPARE_REST) return;
    if (this.preparedAt === k) return;
    const { turnAhead } = this.config.render, prepareBudget = budget;
    const t0 = performance.now();
    for (let d = 1; d <= turnAhead; d++) {
      for (const kind of ['s', 'f', 'k']) {
        for (const e of this.objs.values()) {
          if (e.key[0] !== kind || e.shown === false || e.k !== k) continue;
          for (const j of [(k + d) % STEPS, (k - d + STEPS) % STEPS]) {
            let view = e.views?.get(j);
            if (!view) {
              if (performance.now() - t0 > prepareBudget) return;
              view = this.buildView(e, j);
              if (!view) continue;
              (e.views ??= new Map()).set(j, view);
              this.keepViews(e);
            }
            // (with WebGL, the nearest steps' drawings made ready on the GPU too)
            if (this.glObjects && d <= GL_AHEAD && !this.glObjects.has(view.g)) {
              if (performance.now() - t0 > prepareBudget) return;
              this.glObjects.prebuild(view.g);
            }
          }
        }
      }
    }
    this.preparedAt = k; // (all ready: nothing to look for until something changes)
  }

  // The turn is over: the sheet drawn anew at the angle it rests at, and
  // whatever is still behind – from its views when it has one for this
  // step (so what was shown last is what stays), or drawn anew. What
  // shows bare (goBare) is drawn whole again, from the middle of the view
  // out (the rebuild queue in frame()), the pen putting the detail back.
  // What a turn rested on before it was drawn at that step (land): as many
  // as config.render.turnBudget allows by what they took so far, from the
  // middle out, each drawn anew while what it showed fades out over it,
  // where it showed it, rather than jumping. How many went to the redraw.
  landFrame() {
    if (!this.landing.size || this.objsAll) return 0;
    this.landingOrder ??= this.nearestLast(this.landing);
    const a = this.camera.angle, n = Math.max(1, Math.floor(this.config.render.turnBudget / this.rebuildCost));
    let batch = 0;
    while (batch < n && this.landingOrder.length) {
      const key = this.landingOrder.pop();
      this.landing.delete(key);
      const e = this.objs.get(key);
      if (!e || e.shown === false || e.angle === a || this.objsDirty.has(key)) continue;
      this.objsDirty.add(key);
      this.viewOnly.add(key);
      if (e.slid && drawEnabled()) {
        for (const g of ['g', 'lg', 'sg']) {
          const old = e[g];
          if (!old.parentNode) continue;
          e[g] = old.parentNode.insertBefore(document.createElementNS(SVGNS, 'g'), old);
          old.fade = { at: performance.now(), ms: SETTLE_FADE, from: 1, to: 0, ease: 'out' }; // (as gl/objects.js draws it)
          old.animate([{ opacity: 1 }, { opacity: 0 }], { duration: SETTLE_FADE, easing: 'ease-out', fill: 'forwards' }).finished.then(() => old.remove(), () => old.remove());
        }
      } else if (e.slid) {
        e.slideT = '';
        this.placeGroups(e);
      }
      e.slid = false;
      if (e.hidBare) for (const g of [e.g, e.lg]) g.classList.remove('bare');
      e.hidBare = '';
      batch++;
    }
    return batch;
  }

  land() {
    const bare = this.bare;
    this.turning = this.bare = false;
    this.turnRest = null;
    const a = this.camera.angle, k = this.camera.step();
    // the contours, water and brows as turned fade out over their drawing
    // anew: on slopes the sheet can only come near it
    const { ground } = this, terrain = this.layers.terrain;
    if (ground.style.transform && drawEnabled()) {
      const old = terrain.parentNode.insertBefore(terrain.cloneNode(true), terrain.nextSibling);
      old.setAttribute('transform', this.sheet(this.drawn.angle, a));
      old.animate([{ opacity: 1 }, { opacity: 0 }], { duration: SETTLE_FADE, easing: 'ease-out', fill: 'forwards' }).finished.then(() => old.remove(), () => old.remove());
    }
    Object.assign(ground.style, { transform: '', transformOrigin: '', willChange: '' });
    const mirror = this.groundMirror();
    if (mirror) Object.assign(mirror.style, { transform: '', transformOrigin: '' });
    this.dirty.add('terrain');
    for (const l of SHEET) {
      this.layers[l].removeAttribute('transform');
      this.dirty.add(l);
    }
    for (const el of this.lightCuts) el.removeAttribute('transform');
    this.nightSheet = null;
    if (this.linesAngle !== a) {
      for (const l of LINES) {
        this.ink[l]?.clearErasing();
        this.dirty.add(l);
      }
      this.dirty.add('parked');
    }
    this.linesAngle = null;
    for (const [key, c] of this.meadow) {
      if (c.angle === a) continue;
      if (c.turned) c.g.removeAttribute('transform');
      c.turned = false;
      this.meadowDirty.add(key);
    }
    for (const e of this.objs.values()) {
      if (e.at && e.placedAt !== a) {
        Object.assign(e, this.placeOf(e.at));
        e.placedAt = a;
      }
      const view = bare && e.angle !== a && k != null && !this.objsDirty.has(e.key) && e.views?.get(k);
      if (view) this.swapIn(e, view);
      else if (e.angle !== a) {
        e.stale = true;
        // not drawn here yet: drawn a few a frame, from the middle out,
        // showing meanwhile what it showed mid-turn (landFrame)
        if (e.shown !== false && !this.objsDirty.has(e.key)) {
          this.landing.add(e.key);
          this.landingOrder = null;
          continue;
        }
      }
      if (e.slid) {
        e.slideT = '';
        this.placeGroups(e);
      }
      e.slid = false;
      if (e.hidBare) {
        for (const g of [e.g, e.lg]) g.classList.remove('bare');
        e.hidBare = '';
      }
      if (e.bare && e.angle === a && !this.objsDirty.has(e.key)) {
        e.stale = true;
        if (e.shown !== false) {
          e.redetail = true;
          this.rebuildQueue.add(e.key);
          this.rebuildOrder = null;
        }
      }
    }
    this.reorder();
    this.preparedAt = null;
    this.lastOverlay = null;
    this.layers.overlay.style.visibility = '';
  }

  // Line widths for the zoom `z` (--stroke in styles.css): 1 / z rounded to
  // a step of config.render.strokeStep, so lines keep about their width on
  // screen. Set only when the step changes – it restyles every line on the
  // map. With constantStrokes off (debug panel) lines scale with the map.
  // The widths are in device pixels, as Chrome drew the non-scaling strokes
  // the map had before: a 1.2 line is 1.2 pixels of a sharp screen, not 1.2
  // CSS px (twice as thick there).
  updateStroke(z) {
    const { strokeStep: step, lineWeight } = this.config.render;
    const k = this.constantStrokes ? (lineWeight * step ** -Math.round(Math.log(z) / Math.log(step))) / (devicePixelRatio || 1) : 1;
    if (k === this.strokeK) return;
    this.strokeK = k;
    for (const s of this.svgs) s.style.setProperty('--stroke', k);
  }

  updateLod(z) {
    const { medium, far } = this.config.render.lod;
    // meadow detail tiers (meadow.js), on its own layer: a class on the
    // whole <svg> would restyle everything in it
    const tier = z >= MEADOW.close ? 2 : z >= medium ? 1 : 0;
    if (tier !== this.meadowTier) {
      this.layers.meadow.classList.remove(`mz${this.meadowTier}`);
      this.layers.meadow.classList.add(`mz${tier}`);
      this.meadowTier = tier;
    }
    // parked cars switch between dots and models (src/render/vehicles.js),
    // railways between the map symbol and the track (trackItems)
    const close = z >= VEHICLES.minZoom;
    this.railsNear = close;
    if (close !== this.carsClose) {
      this.carsClose = close;
      this.dirty.add('parked');
    }
    // far out the woods are one shape each (forest.js), their trees not drawn
    this.updateWoods(z);
    if (this.farWoods.size) this.forestHatch(z);
    // each object's own detail (bandOf), redrawn where it changes
    if (z !== this.bandZoom) {
      this.bandZoom = z;
      this.rebandObjects();
    }
    // the map's level, for the rest of what's drawn with detail classes
    // (contours, the overlay); not the objects, which go by their own
    const level = z >= medium ? 0 : z >= far ? 1 : 2;
    if (level === this.lodLevel) return;
    for (const s of this.svgs) {
      s.classList.remove(`lod-${this.lodLevel}`);
      s.classList.add(`lod-${level}`);
    }
    this.lodLevel = level;

  }

  // The map in draft while the view turns (DRAFT)…
  goDraft() {
    this.hideShadows();
    if (this.drafting) return;
    this.drafting = true;
    for (const svg of this.svgs) svg.classList.add('draft');
  }

  // …its detail back as soon as it rests.
  endDraft() {
    this.drafting = false;
    for (const svg of this.svgs) svg.classList.remove('draft');
  }
}
