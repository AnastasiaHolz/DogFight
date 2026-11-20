import { shortestDelta } from "./arena.js";
import { offsetBetween } from "./collision.js";
import { Vector2 } from "./vector.js";

const TAU = 2 * Math.PI;

export function createHoming({
  kinds,
  range,
  turnRate,
  speed,
  accepts = () => true,
}) {
  return {
    steer(entity, world, dt) {
      let bestDistance = range * range;
      let bestOffset;
      for (const kind of kinds) {
        for (const target of world.ofKind(kind)) {
          if (target === entity || !accepts(target)) continue;
          const offset = offsetBetween(entity, target, world.arena);
          const distance = offset.dot(offset);
          if (distance > 0 && distance < bestDistance) {
            bestDistance = distance;
            bestOffset = offset;
          }
        }
      }

      if (!bestOffset) return;

      const heading = Math.atan2(entity.vel.y, entity.vel.x);
      const desired = Math.atan2(bestOffset.y, bestOffset.x);
      const delta = shortestDelta(heading, desired, TAU);
      const limit = turnRate * dt;
      const turn = Math.max(-limit, Math.min(delta, limit));
      entity.vel = Vector2.fromAngle(heading + turn).scale(speed);
    },
  };
}

export function createShieldEffect(seconds = 6) {
  return {
    applyTo(ship) {
      ship.grantShield(seconds);
    },
  };
}
