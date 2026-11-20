import {
  inputMessage,
  KINDS,
  TICK_MS,
} from "@dogfight/shared/protocol/messages";
import { lerpWrapped, shortestDelta, wrap } from "@dogfight/shared/sim/arena";
import { advanceBullet, delta, stepPilot } from "@dogfight/shared/sim/battle";
import { integrate, TAU } from "@dogfight/shared/sim/flight";

const MAX_PENDING = 120;
const SMOOTH_MS = 100;
const copy = (value) => ({ ...value });

function disturbedFlight(ship, input, dt) {
  const result = integrate(ship, input, dt);
  return {
    ...result,
    x: result.x + (Math.random() - 0.5) * 24,
    y: result.y + (Math.random() - 0.5) * 24,
  };
}

function between(a, b, amount, arena) {
  if (!b || a.life !== b.life || (a.hp === 0 && b.hp > 0)) return a;
  const loop = a.k === KINDS.ship || a.k === KINDS.bullet;
  return {
    ...a,
    x: loop
      ? lerpWrapped(a.x, b.x, amount, arena.width)
      : a.x + (b.x - a.x) * amount,
    y: loop
      ? lerpWrapped(a.y, b.y, amount, arena.height)
      : a.y + (b.y - a.y) * amount,
    angle: lerpWrapped(a.angle, b.angle, amount, TAU),
  };
}

export class Prediction {
  seq = 0;
  pending = [];
  history = [];
  bullets = [];
  correction = 0;
  average = 0;
  #mode;
  #offset;
  #playedTick;
  #interpolation;

  constructor({ player, arena, settings }) {
    this.player = player;
    this.arena = arena;
    this.settings = settings;
    this.#mode = settings.predict;
  }

  get latest() {
    return this.history.at(-1);
  }

  get authoritative() {
    return this.latest?.snapshot.entities.find(
      (entity) => entity.id === this.player,
    );
  }

  get enabled() {
    return this.#mode;
  }

  get targets() {
    return this.latest?.snapshot.entities ?? [];
  }

  #replay(input) {
    if (!this.predicted) return null;
    this.bullets = this.bullets
      .filter((e) => e.ttl > 1)
      .map((e) => advanceBullet(e, this.arena, this.targets));
    const { ship, bullet } = stepPilot(
      this.predicted,
      input,
      this.arena,
      this.settings.drift ? disturbedFlight : integrate,
    );
    this.predicted = ship;
    if (bullet) this.bullets.push({ ...bullet, id: -input.seq });
    return bullet;
  }

  #rebuild(own) {
    this.predicted = own ? copy(own) : undefined;
    this.bullets = [];
    if (this.#mode) {
      for (const input of this.pending) this.#replay(input);
    }
  }

  next(controls, send) {
    if (this.#mode !== this.settings.predict) {
      this.#mode = this.settings.predict;
      this.#offset = undefined;
      this.correction = 0;
      this.average = 0;
      this.#rebuild(this.authoritative);
    }
    if (!this.latest || this.pending.length >= MAX_PENDING) return null;
    const command = inputMessage(this.seq + 1, controls);
    if (!send(command)) return null;
    this.seq += 1;
    this.pending.push(command);
    return this.#mode ? this.#replay(command) : null;
  }

  receive(snapshot, now) {
    if (this.latest && snapshot.tick <= this.latest.snapshot.tick) return false;
    const raw = this.predicted;
    const prior = this.local(now);
    this.history.push({ snapshot, now });
    if (this.history.length > 45) this.history.shift();
    this.pending = this.pending.filter(
      (input) => input.seq > snapshot.lastProcessedSeq,
    );
    this.#rebuild(this.authoritative);
    const fixed = this.predicted;

    this.correction = 0;
    if (this.#mode && raw?.hp && fixed?.hp && raw.life === fixed.life) {
      this.correction = Math.hypot(...delta(raw, fixed, this.arena));
      const [x, y] = delta(fixed, prior, this.arena);
      const angle = shortestDelta(fixed.angle, prior.angle, TAU);
      this.#offset = { x, y, angle, start: now };
    } else this.#offset = undefined;
    this.average = 0.94 * this.average + 0.06 * this.correction;
    return true;
  }

  local(now) {
    if (!this.#mode) return this.authoritative;
    const ship = this.predicted;
    if (!ship || !this.#offset) return ship;
    const { x, y, angle, start } = this.#offset;
    const ratio = Math.max(0, 1 - (now - start) / SMOOTH_MS);
    return {
      ...ship,
      x: wrap(ship.x + x * ratio, this.arena.width),
      y: wrap(ship.y + y * ratio, this.arena.height),
      angle: wrap(ship.angle + angle * ratio, TAU),
    };
  }

  remotes(now) {
    const latest = this.latest;
    if (!latest) return [];
    const delay = this.settings.interpolation;
    if (delay !== this.#interpolation) {
      this.#playedTick = undefined;
      this.#interpolation = delay;
    }
    const estimated =
      latest.snapshot.tick + (now - latest.now - delay) / TICK_MS;
    const target = Math.min(
      latest.snapshot.tick,
      Math.max(this.#playedTick ?? 0, estimated),
    );
    this.#playedTick = target;
    const hi = this.history.findIndex((item) => item.snapshot.tick >= target);
    const right = this.history[hi].snapshot;
    if (hi === 0 || right.tick === target) return right.entities;
    const left = this.history[hi - 1].snapshot;
    const ratio = (target - left.tick) / (right.tick - left.tick);
    const byId = new Map(right.entities.map((entity) => [entity.id, entity]));
    return left.entities.map((entity) =>
      between(entity, byId.get(entity.id), ratio, this.arena),
    );
  }

  scene(now) {
    const world = this.remotes(now).filter(
      (e) =>
        e.id !== this.player &&
        !(e.k === KINDS.bullet && e.owner === this.player),
    );
    const own = this.local(now);
    if (own) world.push(own);
    world.push(
      ...this.targets.filter(
        (e) => e.k === KINDS.bullet && e.owner === this.player,
      ),
    );
    if (this.#mode)
      world.push(
        ...this.bullets.filter(
          (bullet) =>
            !world.some(
              (e) =>
                e.k === KINDS.bullet &&
                e.owner === bullet.owner &&
                e.seq === bullet.seq,
            ),
        ),
      );
    return world;
  }
}
