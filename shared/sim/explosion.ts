import { Entity } from "./entity.ts";
import { seededRandom } from "./random.ts";
import { Vector2 } from "./vector.ts";
import type { World } from "./world.ts";

const DURATION = 0.55;

export class Explosion extends Entity {
  readonly color: string;
  ttl: number;
  readonly particles: readonly { vel: Vector2; radius: number }[];
  constructor({
    pos,
    color,
    random = seededRandom(1),
  }: { pos?: Vector2; color: string; random?: () => number }) {
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

  update(dt: number, world: World) {
    this.ttl -= dt;
    if (this.ttl <= 1e-9) world.despawn(this.id);
  }
}
