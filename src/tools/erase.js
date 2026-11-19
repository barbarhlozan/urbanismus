// What the eraser takes at a point (x, y in main-dot units): building, then
// footpath, then a street's sidewalks, then road, then railway, then fence or
// churchyard wall,
// then a field (the whole of it, and the crop sinks back into the ground
// from where it was touched), then trees. null if there is nothing. Used by the eraser tool and by cmd.erase.
// { key, field, run }: `key` is the drawing that turns to the secondary
// colour (a field: `field`, its squares, whose outline shows), `run`
// removes it.

import { fieldCellsAt } from '../sim/fields.js';

export function eraseTarget(world, point) {
  if (!point) return null;
  const node = world.grid.nodeAt(...point);
  if (node < 0) return null;

  const s = world.structureAtPoint(...point);
  // `key`: the drawing that turns to the secondary colour (Renderer.erasing)
  if (s) return { key: `s${s.id}`, run: () => world.removeStructure(s.id) };
  // ways: the nearest edge of each kind in turn, between its junctions
  const way = (kind, reach, keep = () => true) => world.ways.edgeNear(...point, reach, (e) => e.kind === kind && keep(e));
  const path = way('path', 0.25);
  if (path) return { run: () => world.removeWay(path.edge.id) };
  const road = way('road', 0.45);
  // a street's sidewalks first (a lane's kerbs too), then the road
  if (road?.edge.street) return { run: () => world.setWayAttrs(road.edge.id, { street: false }) };
  if (road?.edge.walks) return { run: () => world.setWayAttrs(road.edge.id, { walks: 0 }) };
  if (road) return { run: () => world.removeWay(road.edge.id) };
  const rail = way('rail', 0.3);
  if (rail) return { run: () => world.removeWay(rail.edge.id) };
  const fence = way('fence', 0.2);
  if (fence) return { run: () => world.removeWay(fence.edge.id) };
  const wall = way('wall', 0.2);
  if (wall) return { run: () => world.removeWay(wall.edge.id) };
  // a field: the whole of it, as the field eraser takes it
  const field = fieldCellsAt(world, ...point);
  if (field.length) return { field, run: () => world.setCrops(field.map((c) => [c, 0]), { from: point }) };
  const f = world.featureAt(node);
  if (f) return { key: `f${f.id}`, run: () => world.removeFeature(f.id) };
  return null;
}
