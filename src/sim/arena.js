import { Vector2 } from "./vector.js";

export const ARENA = { width: 960, height: 540 };

export function wrap(value, size) {
  return ((value % size) + size) % size;
}

export function wrapShip(ship, arena) {
  return {
    ...ship,
    x: wrap(ship.x, arena.width),
    y: wrap(ship.y, arena.height),
  };
}

export function lerpWrapped(from, to, alpha, size) {
  const distance = wrap(to - from + size / 2, size) - size / 2;
  return wrap(from + distance * alpha, size);
}

export function shortestDelta(from, to, size) {
  return wrap(to - from + size / 2, size) - size / 2;
}

export function wrapPosition(pos, arena) {
  return new Vector2(wrap(pos.x, arena.width), wrap(pos.y, arena.height));
}

function bounceAxis(position, velocity, radius, size) {
  const max = size - radius;
  if (position < radius) return [radius, Math.abs(velocity)];
  if (position > max) return [max, -Math.abs(velocity)];
  return [position, velocity];
}

export function applyEdges(entity, arena) {
  if (entity.edge === "wrap") {
    entity.pos = wrapPosition(entity.pos, arena);
  } else if (entity.edge === "bounce") {
    const [x, vx] = bounceAxis(
      entity.pos.x,
      entity.vel.x,
      entity.radius,
      arena.width,
    );
    const [y, vy] = bounceAxis(
      entity.pos.y,
      entity.vel.y,
      entity.radius,
      arena.height,
    );
    entity.pos = new Vector2(x, y);
    entity.vel = new Vector2(vx, vy);
  }
}
