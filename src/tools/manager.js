// Tools are plain objects. Every hook is optional:
//
//   {
//     id, label, hotkey,           // hotkey: single lowercase key
//     toolbar: true,               // false = not shown as a toolbar button
//     fineGrid: false,             // true = show the dense footpath dots while active
//     snap(x, y) -> node,          // turn the pointer's world position into a node;
//                                  //   default: nearest main dot + a hover ring
//     enter(params), exit(),
//     hover(node), click(node, pointerEvent),
//     cancel() -> bool,            // true = handled, false = fall back to Select
//     key(keyboardEvent) -> bool,  // true = handled
//     actions() -> [{ label, key?, run }],  // on-screen buttons for keyboard features
//     touchConfirm: true,          // on touch, first tap previews, a second tap on
//                                  //   the same dot clicks (bool or () -> bool)
//     hint() -> string,
//     overlay(kit, hoverNode) -> svg string,
//   }
//
// New tool: write a factory in src/tools/, register it in main.js.

export class ToolManager {
  constructor(grid, defaultId = 'inspect') {
    this.grid = grid;
    this.registry = new Map();
    this.defaultId = defaultId;
    this.active = null;
    this.point = null;
    this.hoverNode = -1;
    this.armed = -1; // touch: dot previewed by the last tap, waiting for a confirming tap
    this.listeners = new Set();
  }

  register(tool) {
    this.registry.set(tool.id, tool);
    return this;
  }

  list() {
    return [...this.registry.values()];
  }

  use(id, params = {}) {
    const next = this.registry.get(id);
    if (!next) return;
    this.active?.exit?.();
    this.active = next;
    this.armed = -1;
    next.enter?.(params);
    this.resnap();
    this.listeners.forEach((fn) => fn(next));
  }

  onChange(fn) {
    this.listeners.add(fn);
  }

  // Pointer moved to world position (x, y), or left the map (null).
  pointer(x, y) {
    this.point = x == null ? null : [x, y];
    this.resnap();
  }

  resnap() {
    const t = this.active;
    const p = this.point;
    this.hoverNode = !p ? -1 : t?.snap ? t.snap(p[0], p[1]) : this.grid.nodeAt(p[0], p[1]);
    t?.hover?.(this.hoverNode);
  }

  click(event) {
    const t = this.active;
    if (event?.pointerType && event.pointerType !== 'mouse' && this.needsConfirm() && this.hoverNode !== this.armed) {
      this.armed = this.hoverNode;
      return;
    }
    this.armed = -1;
    t?.click?.(this.hoverNode, event);
    this.resnap();
  }

  needsConfirm() {
    const c = this.active?.touchConfirm;
    return typeof c === 'function' ? c() : !!c;
  }

  // On-screen buttons for the active tool, ending with a way out
  // (the touch equivalent of Esc / right-click).
  actions() {
    const t = this.active;
    if (!t || t.id === this.defaultId) return [];
    const list = [...(t.actions?.() ?? [])];
    list.push({ label: t.cancelLabel?.() ?? 'Done', key: 'Esc', run: () => this.cancel() });
    return list;
  }

  runAction(i) {
    this.actions()[i]?.run();
    this.resnap();
  }

  cancel() {
    this.armed = -1;
    if (this.active?.cancel?.()) return;
    if (this.active?.id !== this.defaultId) this.use(this.defaultId);
  }

  key(event) {
    const handled = this.active?.key?.(event) ?? false;
    if (handled) this.resnap();
    return handled;
  }

  hint() {
    return this.active?.hint?.() ?? '';
  }

  overlay(kit) {
    const custom = this.active?.overlay?.(kit, this.hoverNode) ?? '';
    return (this.active?.snap ? '' : kit.ring(this.hoverNode, 0.32)) + custom;
  }
}
