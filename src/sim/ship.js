import { wrapPosition } from "./arena.js";
import { Bullet } from "./bullet.js";
import { createHoming } from "./components.js";
import { Entity } from "./entity.js";
import { integrate } from "./flight.js";
import { Vector2 } from "./vector.js";

const MAX_HP = 100;
const BULLET_SPEED = 460;
const NO_INPUT = { turn: 0, thrust: false, fire: false, homing: false };

export class Ship extends Entity {
  #hp = MAX_HP;
  #cooldown = 0;
  #protection = 0;
  #shield = 0;

  constructor({ pos, angle = 0, team = "player", protection = 0 } = {}) {
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

  grantShield(seconds) {
    this.#shield = Math.max(this.#shield, seconds);
  }

  damage(amount) {
    if (this.#shield > 0 || this.protected) return false;
    this.#hp = Math.max(0, this.#hp - amount);
    this.#protection = 0.28;
    return this.#hp === 0;
  }

  fire(world, { homing = false } = {}) {
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
            target.kind === "asteroid" || target.team !== team,
        })
      : undefined;

    this.#cooldown = homing ? 0.42 : 0.22;
    return world.spawn(
      new Bullet({
        pos: wrapPosition(muzzle, world.arena),
        vel: velocity,
        ownerId: this.id,
        team,
        homing: guidance,
      }),
    );
  }

  update(dt, world, input = NO_INPUT) {
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
