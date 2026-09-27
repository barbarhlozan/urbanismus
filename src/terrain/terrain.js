// Terrain layers, stored per grid node.
//
//   height – elevation in grid units. Everything that draws already projects
//            through heightAt(), so hills only need data (plus contour
//            rendering in the renderer's terrain layer).
//   water  – 1 where the node is lake, 2 where it is river.
//   rivers – the rivers' centrelines, [{ points: [[x, y]…], z: [metres…] }]
//            (terrain/rivers.js); the valleys around them are cut into the
//            elevation (World.elevation).
//
// New layers (soil, fertility, pollution, land value…) should be added here as
// typed arrays of grid.size and included in toJSON/load.

export class Terrain {
  constructor(grid) {
    this.grid = grid;
    this.height = new Float32Array(grid.size);
    this.water = new Uint8Array(grid.size);
    this.rivers = [];
  }

  isWater(node) {
    return this.water[node] !== 0;
  }

  isRiver(node) {
    return this.water[node] === 2;
  }

  heightAtNode(node) {
    return this.height[node];
  }

  // Bilinear height at a fractional world position.
  heightAt(x, y) {
    const { width, height } = this.grid;
    const cx = Math.min(Math.max(x, 0), width - 1);
    const cy = Math.min(Math.max(y, 0), height - 1);
    const x0 = Math.floor(cx);
    const y0 = Math.floor(cy);
    const x1 = Math.min(x0 + 1, width - 1);
    const y1 = Math.min(y0 + 1, height - 1);
    const tx = cx - x0;
    const ty = cy - y0;
    const h = this.height;
    const a = h[y0 * width + x0];
    const b = h[y0 * width + x1];
    const c = h[y1 * width + x0];
    const d = h[y1 * width + x1];
    return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
  }

  toJSON() {
    const water = [], river = [];
    this.water.forEach((v, i) => (v === 1 ? water : v === 2 ? river : []).push(i));
    const flat = this.height.every((v) => v === 0);
    const round = (v) => Math.round(v * 1000) / 1000;
    return {
      height: flat ? null : Array.from(this.height, round),
      water,
      river,
      rivers: this.rivers.map((r) => ({ ...r, points: r.points.map((p) => p.map(round)), z: r.z.map(round) })),
    };
  }

  load(data) {
    this.height.fill(0);
    this.water.fill(0);
    if (data.height) this.height.set(data.height);
    for (const i of data.water) this.water[i] = 1;
    for (const i of data.river ?? []) this.water[i] = 2;
    this.rivers = data.rivers ?? [];
  }
}
