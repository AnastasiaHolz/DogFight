import { wrapPosition } from "./arena.ts";
import { Bullet } from "./bullet.ts";
import { createHoming } from "./components.ts";
import { Entity } from "./entity.ts";
import type { FlightInput } from "./flight.ts";
import { integrate } from "./flight.ts";
import { Vector2 } from "./vector.ts";
import type { World } from "./world.ts";

const MAX_HP = 100;
const BULLET_SPEED = 460;
const NO_INPUT = { turn: 0, thrust: false, fire: false, homing: false };

export class Ship extends Entity {
  readonly team: string;
  thrust: boolean;
  #hp = MAX_HP;
  #cooldown = 0;
  #protection = 0;
  #shield = 0;

  constructor({
    pos,
    angle = 0,
    team = "player",
    protection = 0,
  }: {
    pos?: Vector2;
    angle?: number;
    team?: string;
    protection?: number;
  } = {}) {
    super({ kind: "ship", pos, angle, radius: 15, edge: "wrap" });
    this.team = team;
    this.thrust = false;
    this.#protection = protection;
  }

  get hp() {
    return this.#hp;
  }

  get shield() {
    return this.#shield;
  }

  get protected() {
    return this.#protection > 0;
  }

  grantShield(seconds: number) {
    this.#shield = Math.max(this.#shield, seconds);
  }

  damage(amount: number) {
    if (this.#shield > 0 || this.protected) return false;
    this.#hp = Math.max(0, this.#hp - amount);
    this.#protection = 0.28;
    return this.#hp === 0;
  }

  fire(world: World, { homing = false } = {}) {
    if (this.#cooldown > 1e-9 || !this.alive) return null;
    const direction = Vector2.fromAngle(this.angle);
    const muzzle = this.pos.add(direction.scale(23));
    const velocity = this.vel.add(direction.scale(BULLET_SPEED));
    const team = this.team;
    const guidance = homing
      ? createHoming({
          kinds: ["asteroid", "ship"],
          range: 375,
          turnRate: 6,
          speed: velocity.length(),
          accepts: (target) =>
            target.kind === "asteroid" ||
            (target instanceof Ship && target.team !== team),
        })
      : undefined;

    this.#cooldown = homing ? 0.42 : 0.22;
    const shot = world.spawn(
      new Bullet({
        pos: wrapPosition(muzzle, world.arena),
        vel: velocity,
        ownerId: this.id,
        team,
        homing: guidance,
      }),
    );
    world.emit("fired", { team, entityId: this.id, bulletId: shot.id });
    return shot;
  }

  update(dt: number, world: World, input: FlightInput = NO_INPUT) {
    this.#cooldown = Math.max(0, this.#cooldown - dt);
    this.#protection = Math.max(0, this.#protection - dt);
    this.#shield = Math.max(0, this.#shield - dt);

    const state = integrate(
      {
        x: this.pos.x,
        y: this.pos.y,
        vx: this.vel.x,
        vy: this.vel.y,
        angle: this.angle,
        thrust: this.thrust,
      },
      input,
      dt,
    );

    this.pos = new Vector2(state.x, state.y);
    this.vel = new Vector2(state.vx, state.vy);
    this.angle = state.angle;
    this.thrust = state.thrust;
    if (input.fire || input.homing) this.fire(world, { homing: input.homing });
  }
}
