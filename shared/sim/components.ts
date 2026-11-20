import { shortestDelta } from "./arena.ts";
import { offsetBetween } from "./collision.ts";
import type { Entity } from "./entity.ts";
import { Vector2 } from "./vector.ts";
import type { World } from "./world.ts";

const TAU = 2 * Math.PI;

export type Homing = { steer(entity: Entity, world: World, dt: number): void };
export type ShieldEffect = {
  applyTo(ship: { grantShield(seconds: number): void }): void;
};

export function createHoming({
  kinds,
  range,
  turnRate,
  speed,
  accepts = () => true,
}: {
  kinds: readonly string[];
  range: number;
  turnRate: number;
  speed: number;
  accepts?: (target: Entity) => boolean;
}): Homing {
  return {
    steer(entity, world, dt) {
      let bestDistance = range * range;
      let bestOffset: Vector2 | undefined;
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

export function createShieldEffect(seconds = 6): ShieldEffect {
  return {
    applyTo(ship) {
      ship.grantShield(seconds);
    },
  };
}
