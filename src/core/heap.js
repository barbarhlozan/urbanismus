// Binary min-heap keyed by priority (used by pathfinding).

export class MinHeap {
  constructor() {
    this.items = [];
    this.prios = [];
  }

  get size() {
    return this.items.length;
  }

  push(item, prio) {
    const { items, prios } = this;
    let i = items.length;
    items.push(item);
    prios.push(prio);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (prios[p] <= prio) break;
      items[i] = items[p];
      prios[i] = prios[p];
      i = p;
    }
    items[i] = item;
    prios[i] = prio;
  }

  pop() {
    const { items, prios } = this;
    const top = items[0];
    const lastItem = items.pop();
    const lastPrio = prios.pop();
    if (items.length > 0) {
      let i = 0;
      const n = items.length;
      while (true) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        let mp = lastPrio;
        if (l < n && prios[l] < mp) { m = l; mp = prios[l]; }
        if (r < n && prios[r] < mp) { m = r; mp = prios[r]; }
        if (m === i) break;
        items[i] = items[m];
        prios[i] = prios[m];
        i = m;
      }
      items[i] = lastItem;
      prios[i] = lastPrio;
    }
    return top;
  }
}
