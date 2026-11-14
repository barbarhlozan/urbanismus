// What the eraser takes at a point (x, y in main-dot units): building, then
// footpath, then a street's sidewalks, then road, then railway, then fence,
// then trees. null if there is nothing. Used by the eraser tool and by cmd.erase.
// { key, at, size, run }: `key` is the drawing that turns to the secondary
// colour, `at` and `size` where the eraser pops up, `run` removes it.

export function eraseTarget(world, point) {
  if (!point) return null;
  const node = world.grid.nodeAt(...point);
  if (node < 0) return null;

  const s = world.structureAt(node);
  // `key`: the drawing that turns to the secondary colour (Renderer.erasing)
  if (s) return { key: `s${s.id}`, at: world.centerOf(s), size: 0.3, run: () => world.removeStructure(s.id) };
  // ways: the nearest edge of each kind in turn, between its junctions
  const way = (kind, reach, keep = () => true) => world.ways.edgeNear(...point, reach, (e) => e.kind === kind && keep(e));
  const path = way('path', 0.25);
  if (path) return { at: path.point, size: 0.12, run: () => world.removeWay(path.edge.id) };
  const road = way('road', 0.45);
  // a street's sidewalks first (a lane's kerbs too), then the road
  if (road?.edge.street) return { at: road.point, size: 0.2, run: () => world.setWayAttrs(road.edge.id, { street: false }) };
  if (road?.edge.walks) return { at: road.point, size: 0.2, run: () => world.setWayAttrs(road.edge.id, { walks: 0 }) };
  if (road) return { at: road.point, size: 0.2, run: () => world.removeWay(road.edge.id) };
  const rail = way('rail', 0.3);
  if (rail) return { at: rail.point, size: 0.16, run: () => world.removeWay(rail.edge.id) };
  const fence = way('fence', 0.2);
  if (fence) return { at: fence.point, size: 0.12, run: () => world.removeWay(fence.edge.id) };
  const f = world.featureAt(node);
  if (f) return { key: `f${f.id}`, at: [f.x, f.y], size: 0.2, run: () => world.removeFeature(f.id) };
  return null;
}
