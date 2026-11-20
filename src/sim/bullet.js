import { Entity } from "./entity.js";

export class Bullet extends Entity {
  constructor({ pos, vel, ownerId, team, homing, ttl = 1.55, damage = 35 }) {
    super({ kind: "bullet", pos, vel, radius: 4, edge: "wrap" });
    this.ownerId = ownerId;
    this.team = team;
    this.homing = homing;
    this.ttl = ttl;
    this.damage = damage;
  }

  update(dt, world) {
    this.ttl -= dt;
    if (this.ttl <= 1e-9) {
      world.despawn(this.id);
      return;
    }
    this.homing?.steer(this, world, dt);
    super.update(dt);
  }
}
