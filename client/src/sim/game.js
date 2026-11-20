import { ARENA, shortestDelta } from "./arena.js";
import { Asteroid } from "./asteroid.js";
import { offsetBetween } from "./collision.js";
import { createHoming } from "./components.js";
import { Explosion } from "./explosion.js";
import { Pickup } from "./pickup.js";
import { Ship } from "./ship.js";
import { Vector2 } from "./vector.js";
import { World } from "./world.js";

const RESPAWN_SECONDS = 2;
const TAU = 2 * Math.PI;

function firstOf(kind, a, b) {
  if (a.kind === kind) return [a, b];
  return b.kind === kind ? [b, a] : [];
}

export class Game {
  #respawns = new Map();
  #nextRivalShot = 1;

  constructor({
    random = Math.random,
    demo = true,
    arena = ARENA,
    events,
  } = {}) {
    this.random = random;
    this.time = 0;
    this.score = 0;
    this.world = new World({
      arena,
      events,
      onCollision: (a, b) => this.resolveCollision(a, b),
    });
    this.player = this.world.spawn(
      new Ship({ pos: new Vector2(arena.width / 2, arena.height / 2) }),
    );

    if (demo) this.populate();
  }

  populate() {
    const { width, height, extraAsteroids = 0 } = this.world.arena;
    const place = (x, y) =>
      new Vector2((x / ARENA.width) * width, (y / ARENA.height) * height);
    this.rival = this.world.spawn(
      new Ship({
        pos: place(819, 173),
        team: "rival",
        angle: Math.PI,
      }),
    );

    this.world.spawn(new Pickup({ pos: place(585, 270) }));
    this.world.spawn(
      new Asteroid({
        pos: place(714, 270),
        vel: new Vector2(-18, 3),
        radius: 27,
      }),
    );
    this.world.spawn(
      new Asteroid({
        pos: place(281, 395),
        vel: new Vector2(32, -15),
        radius: 29,
      }),
    );
    this.world.spawn(
      new Asteroid({
        pos: place(690, 425),
        vel: new Vector2(-24, -18),
        radius: 22,
        homing: createHoming({
          kinds: ["ship"],
          accepts: (ship) => ship.team === "player",
          range: 420,
          turnRate: 1.1,
          speed: 58,
        }),
      }),
    );
    for (let i = 0; i < extraAsteroids; i += 1) {
      this.world.spawn(
        new Asteroid({
          pos: place(170 + i * 520, 110 + i * 350),
          vel: new Vector2(25 - i * 12, 18),
          radius: 22 + i * 3,
        }),
      );
    }
  }

  get respawnIn() {
    const due = this.#respawns.get("player");
    return due === undefined ? null : Math.max(0, due - this.time);
  }

  getRivalInput() {
    if (!this.player.alive) return { turn: 0, thrust: false };
    const delta = offsetBetween(this.rival, this.player, this.world.arena);
    const distance = delta.length();
    const target = Math.atan2(delta.y, delta.x);
    const angle = shortestDelta(this.rival.angle, target, TAU);
    const turn = Math.max(-1, Math.min(angle * 5, 1));
    const fire =
      Math.abs(angle) < 0.12 &&
      distance < 365 &&
      this.time >= this.#nextRivalShot;
    if (fire) this.#nextRivalShot = this.time + 0.86;
    return { turn, thrust: distance > 210 && Math.abs(angle) < 0.45, fire };
  }

  step(dt, controls) {
    this.time += dt;
    const inputs = new Map();
    if (this.player.alive && controls) inputs.set(this.player.id, controls);
    if (this.rival?.alive) inputs.set(this.rival.id, this.getRivalInput());
    this.world.step(dt, inputs);
    for (const [team, due] of this.#respawns) {
      if (this.time + 1e-9 < due) continue;
      const pos = this.pickSpawn();
      if (!pos) continue;
      const ship = this.world.spawn(new Ship({ pos, team, protection: 1.2 }));
      if (team === "player") this.player = ship;
      else this.rival = ship;
      this.#respawns.delete(team);
    }
  }

  pickSpawn() {
    const { width, height } = this.world.arena;
    const inset = 58;
    const safe = (pos) => {
      const candidate = { pos, edge: "wrap" };
      for (const entity of this.world) {
        if (!entity.alive || !entity.collidable) continue;
        const offset = offsetBetween(candidate, entity, this.world.arena);
        if (offset.length() < 85 + entity.radius) return false;
      }
      return true;
    };

    for (let tries = 0; tries < 24; tries += 1) {
      const pos = new Vector2(
        inset + this.random() * (width - 2 * inset),
        inset + this.random() * (height - 2 * inset),
      );
      if (safe(pos)) return pos;
    }

    for (let y = inset; y <= height - inset; y += 60) {
      for (let x = inset; x <= width - inset; x += 60) {
        const pos = new Vector2(x, y);
        if (safe(pos)) return pos;
      }
    }

    return null;
  }

  destroy(entity, sourceTeam) {
    this.world.despawn(entity.id);
    this.world.spawn(
      new Explosion({
        pos: entity.pos,
        color: entity.kind === "asteroid" ? "#ffbc81" : "#fff1a3",
        random: this.random,
      }),
    );

    if (entity.kind === "ship") {
      this.#respawns.set(entity.team, this.time + RESPAWN_SECONDS);
    }
    if (sourceTeam === "player")
      this.score += entity.kind === "asteroid" ? 100 : 250;
    this.world.emit("exploded", {
      entityId: entity.id,
      kind: entity.kind,
      sourceTeam,
      score: this.score,
    });
  }

  resolveCollision(a, b) {
    const [bullet, target] = firstOf("bullet", a, b);
    if (bullet) {
      const validTarget =
        target.kind === "asteroid" ||
        (target.kind === "ship" &&
          target.id !== bullet.ownerId &&
          target.team !== bullet.team);
      if (!validTarget) return;
      this.world.despawn(bullet.id);
      const destroyed = target.damage(bullet.damage);
      this.world.emit("hit", {
        entityId: target.id,
        kind: target.kind,
        sourceTeam: bullet.team,
      });
      if (destroyed) this.destroy(target, bullet.team);
      return;
    }

    const [ship, other] = firstOf("ship", a, b);
    if (!ship) return;
    if (other.kind === "pickup") {
      if (ship.team === "player") other.collect(ship, this.world);
    } else if (other.kind === "asteroid") {
      const before = ship.hp;
      const destroyed = ship.damage(42);
      if (ship.hp !== before)
        this.world.emit("hit", { entityId: ship.id, kind: ship.kind });
      if (destroyed) this.destroy(ship);
    }
  }
}
