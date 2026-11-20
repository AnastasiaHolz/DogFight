import type { EntityId } from "../protocol.ts";
import type { Homing } from "./components.ts";
import { Entity } from "./entity.ts";
import type { Vector2 } from "./vector.ts";
import type { World } from "./world.ts";

export class Bullet extends Entity {
  readonly ownerId?: EntityId;
  readonly team?: string;
  readonly homing?: Homing;
  ttl: number;
  readonly damage: number;
  constructor({
    pos,
    vel,
    ownerId,
    team,
    homing,
    ttl = 1.55,
    damage = 35,
  }: {
    pos?: Vector2;
    vel?: Vector2;
    ownerId?: EntityId;
    team?: string;
    homing?: Homing;
    ttl?: number;
    damage?: number;
  }) {
    super({ kind: "bullet", pos, vel, radius: 4, edge: "wrap" });
    this.ownerId = ownerId;
    this.team = team;
    this.homing = homing;
    this.ttl = ttl;
    this.damage = damage;
  }

  update(dt: number, world: World) {
    this.ttl -= dt;
    if (this.ttl <= 1e-9) {
      world.despawn(this.id);
      return;
    }
    this.homing?.steer(this, world, dt);
    super.update(dt);
  }
}
