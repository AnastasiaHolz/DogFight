import { shortestDelta } from "./arena.js";
import { Vector2 } from "./vector.js";

export function offsetBetween(from, to, arena) {
  if (from.edge !== "wrap" && to.edge !== "wrap") return to.pos.sub(from.pos);
  return new Vector2(
    shortestDelta(from.pos.x, to.pos.x, arena.width),
    shortestDelta(from.pos.y, to.pos.y, arena.height),
  );
}

export function circlesOverlap(a, b, arena) {
  const offset = offsetBetween(a, b, arena);
  const radius = a.radius + b.radius;
  return offset.dot(offset) <= radius * radius;
}

export function* collisionPairs(world) {
  const bodies = [...world].filter(
    (entity) => entity.alive && entity.collidable,
  );
  for (let i = 0; i < bodies.length; i += 1) {
    const a = bodies[i];
    for (let j = i + 1; j < bodies.length; j += 1) {
      const b = bodies[j];
      if (a.alive && b.alive && circlesOverlap(a, b, world.arena)) yield [a, b];
    }
  }
}
