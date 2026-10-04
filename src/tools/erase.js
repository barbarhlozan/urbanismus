// What the eraser takes at a point (x, y in main-dot units): building, then
// footpath, then a street's sidewalks, then road, then railway, then fence,
// then trees. null if there is nothing. Used by the eraser tool and by cmd.erase.
// { key, at, size, run }: `key` is the drawing that turns to the secondary
// colour, `at` and `size` where the eraser pops up, `run` removes it.

export function eraseTarget(world, point) {
  if (!point) return null;
  const node = world.grid.nodeAt(...point);
  const fine = world.networks.path.nodeAt(...point);
  if (node < 0) return null;

  const s = world.structureAt(node);
  // `key`: the drawing that turns to the secondary colour (Renderer.erasing)
  if (s) return { key: `s${s.id}`, at: world.centerOf(s), size: 0.3, run: () => world.removeStructure(s.id) };
  if (fine >= 0 && world.paths.hasNode(fine)) {
    return { at: world.networks.path.pos(fine), size: 0.12, run: () => world.removeNetworkAt('path', fine) };
  }
  const sidewalks = world.hasRoad(node) ? world.sidewalksAt(node) : [];
  if (sidewalks.length) return { at: world.grid.xy(node), size: 0.2, run: () => world.setSidewalks(sidewalks, false) };
  if (world.hasRoad(node)) return { at: world.grid.xy(node), size: 0.2, run: () => world.removeRoadAt(node) };
  const rail = world.networks.rail.nodeAt(...point);
  if (rail >= 0 && world.rails.hasNode(rail)) {
    return { at: world.networks.rail.pos(rail), size: 0.16, run: () => world.removeNetworkAt('rail', rail) };
  }
  const fence = world.networks.fence.nodeAt(...point);
  if (fence >= 0 && world.fences.hasNode(fence)) {
    return { at: world.networks.fence.pos(fence), size: 0.12, run: () => world.removeNetworkAt('fence', fence) };
  }
  const f = world.featureAt(node);
  if (f) return { key: `f${f.id}`, at: world.grid.xy(node), size: 0.2, run: () => world.removeFeature(f.id) };
  return null;
}
