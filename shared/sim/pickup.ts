import type { ShieldEffect } from "./components.ts";
import { createShieldEffect } from "./components.ts";
import { Entity } from "./entity.ts";
import type { Ship } from "./ship.ts";
import type { Vector2 } from "./vector.ts";
import type { World } from "./world.ts";

export class Pickup extends Entity {
  readonly effect: ShieldEffect;
  constructor({
    pos,
    effect = createShieldEffect(),
  }: { pos?: Vector2; effect?: ShieldEffect }) {
    super({ kind: "pickup", pos, radius: 13 });
    this.effect = effect;
  }

  update() {}

  collect(ship: Ship, world: World) {
    this.effect.applyTo(ship);
    world.despawn(this.id);
  }
}
