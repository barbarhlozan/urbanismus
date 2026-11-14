// Where a structure is and which way it faces, for sim code: the fields
// world/structures keep (x, y, angle), with the dots as the fallback for a
// structure not indexed yet (a plan, a test fake).

// The quarter turn (0–3) the front looks: angle = r·π/2.
export const quarterOf = (world, s) => (s.angle == null ? world.drawnRotation(s) : Math.round(s.angle / (Math.PI / 2)) & 3);

// The middle of its footprint, [x, y] in world units.
export const centerOf = (world, s) => (s.x == null ? world.centerOf(s) : [s.x, s.y]);
