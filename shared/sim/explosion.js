import { Entity } from "./entity.js";
import { seededRandom } from "./random.js";
import { Vector2 } from "./vector.js";

const DURATION = 0.55;

export class Explosion extends Entity {
  constructor({ pos, color, random = seededRandom(1) }) {
    super({ kind: "explosion", pos, collidable: false, edge: "wrap" });
    this.color = color;
    this.ttl = DURATION;
    this.particles = Array.from({ length: 14 }, (_, i) => ({
      vel: Vector2.fromAngle((i / 14) * 2 * Math.PI).scale(32 + random() * 105),
      radius: 1.2 + random() * 2.3,
    }));
  }

  get progress() {
    return 1 - this.ttl / DURATION;
  }

  get age() {
    return DURATION - this.ttl;
  }

  update(dt, world) {
    this.ttl -= dt;
    if (this.ttl <= 1e-9) world.despawn(this.id);
  }
}
