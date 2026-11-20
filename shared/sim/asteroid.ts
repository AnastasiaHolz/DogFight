import type { Homing } from "./components.ts";
import { Entity } from "./entity.ts";
import type { Vector2 } from "./vector.ts";
import type { World } from "./world.ts";

export class Asteroid extends Entity {
  hp: number;
  readonly homing?: Homing;
  constructor({
    pos,
    vel,
    radius = 24,
    hp = 65,
    homing,
  }: {
    pos?: Vector2;
    vel?: Vector2;
    radius?: number;
    hp?: number;
    homing?: Homing;
  }) {
    super({ kind: "asteroid", pos, vel, radius, edge: "bounce" });
    this.hp = hp;
    this.homing = homing;
  }

  damage(amount: number) {
    this.hp = Math.max(0, this.hp - amount);
    return this.hp === 0;
  }

  update(dt: number, world: World) {
    this.homing?.steer(this, world, dt);
    this.angle += dt * 0.65;
    super.update(dt);
  }
}
