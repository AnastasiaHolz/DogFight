import { Entity } from "./entity.js";

export class Asteroid extends Entity {
  constructor({ pos, vel, radius = 24, hp = 65, homing }) {
    super({ kind: "asteroid", pos, vel, radius, edge: "bounce" });
    this.hp = hp;
    this.homing = homing;
  }

  damage(amount) {
    this.hp = Math.max(0, this.hp - amount);
    return this.hp === 0;
  }

  update(dt, world) {
    this.homing?.steer(this, world, dt);
    this.angle += dt * 0.65;
    super.update(dt);
  }
}
