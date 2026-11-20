import { createShieldEffect } from "./components.js";
import { Entity } from "./entity.js";

export class Pickup extends Entity {
  constructor({ pos, effect = createShieldEffect() }) {
    super({ kind: "pickup", pos, radius: 13 });
    this.effect = effect;
  }

  update() {}

  collect(ship, world) {
    this.effect.applyTo(ship);
    world.despawn(this.id);
  }
}
