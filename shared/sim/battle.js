import { KINDS, MAX_ENTITIES, NEUTRAL, STEP } from "../protocol/messages.js";
import { shortestDelta, wrap } from "./arena.js";
import { integrate, TAU } from "./flight.js";
import { nextRandom } from "./random.js";

export const BULLET_TICKS = 46;
export const EXPLOSION_TICKS = 17;

function entity(props) {
  return {
    id: 0,
    owner: 0,
    seq: 0,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    angle: 0,
    k: 0,
    thrust: false,
    homing: false,
    r: 0,
    hp: 0,
    cooldown: 0,
    shield: 0,
    guard: 0,
    respawn: 0,
    ttl: 0,
    life: 0,
    score: 0,
    ...props,
  };
}

function add(state, item) {
  if (state.entities.length >= MAX_ENTITIES) return;
  state.entities.push({ ...item, id: state.nextId++ });
}

function roll(state) {
  state.seed = nextRandom(state.seed);
  return state.seed / 0x100000000;
}

function wrapMoving(e, arena) {
  return { ...e, x: wrap(e.x, arena.width), y: wrap(e.y, arena.height) };
}

export function stepPilot(before, input, arena, flight = integrate) {
  if (before.hp === 0) return { ship: before };
  const ship = wrapMoving(
    {
      ...before,
      ...flight(before, input, STEP),
      cooldown: Math.max(0, before.cooldown - 1),
      shield: Math.max(0, before.shield - 1),
      guard: Math.max(0, before.guard - 1),
    },
    arena,
  );
  if ((!input.fire && !input.homing) || ship.cooldown > 0) return { ship };

  const cos = Math.cos(ship.angle);
  const sin = Math.sin(ship.angle);
  const bullet = wrapMoving(
    entity({
      k: KINDS.bullet,
      owner: ship.id,
      seq: input.seq ?? 0,
      r: 4,
      x: ship.x + cos * 23,
      y: ship.y + sin * 23,
      vx: ship.vx + cos * 460,
      vy: ship.vy + sin * 460,
      angle: ship.angle,
      homing: input.homing,
      ttl: BULLET_TICKS,
    }),
    arena,
  );
  ship.cooldown = input.homing ? 13 : 7;
  return { ship, bullet };
}

function spansEdge(e) {
  return e.k !== KINDS.asteroid && e.k !== KINDS.pickup;
}

export function delta(a, b, arena) {
  if (!spansEdge(a) && !spansEdge(b)) return [b.x - a.x, b.y - a.y];
  return [
    shortestDelta(a.x, b.x, arena.width),
    shortestDelta(a.y, b.y, arena.height),
  ];
}

function touching(a, b, arena, margin = 0) {
  const [dx, dy] = delta(a, b, arena);
  return dx * dx + dy * dy <= (a.r + b.r + margin) ** 2;
}

export function advanceBullet(e, arena, targets = []) {
  let { vx, vy, angle } = e;
  if (e.homing) {
    let best = 375 ** 2;
    let aim;
    for (const target of targets) {
      if (
        target.id === e.owner ||
        (target.k !== KINDS.ship && target.k !== KINDS.asteroid) ||
        !target.hp
      )
        continue;
      const [dx, dy] = delta(e, target, arena);
      const distance = dx * dx + dy * dy;
      if (distance < best) {
        best = distance;
        aim = Math.atan2(dy, dx);
      }
    }
    if (aim !== undefined) {
      const heading = Math.atan2(vy, vx);
      const turn = shortestDelta(heading, aim, TAU);
      angle = wrap(
        heading + Math.max(-6 * STEP, Math.min(turn, 6 * STEP)),
        TAU,
      );
      const speed = Math.hypot(vx, vy);
      vx = Math.cos(angle) * speed;
      vy = Math.sin(angle) * speed;
    }
  }
  return wrapMoving(
    {
      ...e,
      x: e.x + vx * STEP,
      y: e.y + vy * STEP,
      vx,
      vy,
      angle,
      ttl: e.ttl - 1,
    },
    arena,
  );
}

export function createBattle(seed, arena) {
  const state = { tick: 0, nextId: 1, seed: seed >>> 0 || 1, entities: [] };
  const rocks = [
    [0.21, 0.25],
    [0.78, 0.72],
    [0.54, 0.76],
    [0.28, 0.73],
    [0.62, 0.18],
  ];
  for (const [x, y] of rocks.slice(0, 3 + (arena.extraAsteroids ?? 0))) {
    add(
      state,
      entity({
        k: KINDS.asteroid,
        x: x * arena.width,
        y: y * arena.height,
        hp: 65,
        r: 25,
        vx: 42 * (roll(state) - 0.5),
        vy: 32 * (roll(state) - 0.5),
        angle: roll(state) * TAU,
      }),
    );
  }
  add(
    state,
    entity({
      k: KINDS.pickup,
      x: arena.width * 0.46,
      y: arena.height * 0.26,
      r: 13,
    }),
  );
  return state;
}

function spawnPilot(state, arena, template, prefer) {
  function safe(pos) {
    return !state.entities.some(
      (e) =>
        e.id !== template.id &&
        e.k !== KINDS.explosion &&
        !(e.k === KINDS.ship && !e.hp) &&
        touching({ ...template, ...pos }, e, arena, 45),
    );
  }
  let position = prefer;
  if (!position || !safe(position)) {
    position = undefined;
    for (let tries = 0; tries < 24 && !position; tries += 1) {
      const test = {
        x: 45 + roll(state) * (arena.width - 90),
        y: 45 + roll(state) * (arena.height - 90),
      };
      if (safe(test)) position = test;
    }
    for (let y = 45; y < arena.height - 45 && !position; y += 64) {
      for (let x = 45; x < arena.width - 45 && !position; x += 64) {
        if (safe({ x, y })) position = { x, y };
      }
    }
  }
  if (!position) return null;
  return {
    ...template,
    ...position,
    vx: 0,
    vy: 0,
    hp: 100,
    guard: 20,
    shield: 0,
    cooldown: 0,
    thrust: false,
    respawn: 0,
    life: (template.life + 1) & 0xffff,
  };
}

export function addPilot(previous, arena) {
  const state = { ...previous, entities: [...previous.entities] };
  const index = state.entities.filter((e) => e.k === KINDS.ship).length;
  const id = state.nextId++;
  const template = entity({
    id,
    owner: id,
    k: KINDS.ship,
    r: 15,
    angle: index % 2 === 0 ? 0 : Math.PI,
  });
  const prefer =
    index < 2
      ? { x: arena.width * (index * 0.44 + 0.28), y: arena.height / 2 }
      : undefined;
  const player = spawnPilot(state, arena, template, prefer) ?? {
    ...template,
    respawn: 1,
  };
  state.entities.push(player);
  return { state, id };
}

export function removePilot(previous, id) {
  return {
    ...previous,
    entities: previous.entities.filter((e) => e.id !== id && e.owner !== id),
  };
}

function bounce(value, velocity, limit, radius) {
  if (value < radius) return [radius, Math.abs(velocity)];
  if (value > limit - radius) return [limit - radius, -Math.abs(velocity)];
  return [value, velocity];
}

function driftRock(e, arena) {
  const [x, vx] = bounce(e.x + e.vx * STEP, e.vx, arena.width, e.r);
  const [y, vy] = bounce(e.y + e.vy * STEP, e.vy, arena.height, e.r);
  return { ...e, x, y, vx, vy, angle: wrap(e.angle + 0.65 * STEP, TAU) };
}

export function advanceWorld(previous, inputs, arena) {
  const state = { ...previous, tick: previous.tick + 1, entities: [] };
  const shots = [];
  for (const e of previous.entities) {
    if (e.k === KINDS.ship) {
      if (e.hp === 0) {
        const remaining = Math.max(0, e.respawn - 1);
        const spawnState = { ...state, entities: previous.entities };
        const next = remaining === 0 ? spawnPilot(spawnState, arena, e) : null;
        state.seed = spawnState.seed;
        state.entities.push(next ?? { ...e, respawn: remaining });
      } else {
        const { ship, bullet } = stepPilot(
          e,
          inputs.get(e.id) ?? NEUTRAL,
          arena,
        );
        state.entities.push(ship);
        if (bullet) shots.push(bullet);
      }
    } else if (e.k === KINDS.bullet && e.ttl > 1) {
      state.entities.push(advanceBullet(e, arena, previous.entities));
    } else if (e.k === KINDS.asteroid) {
      state.entities.push(driftRock(e, arena));
    } else if (e.k === KINDS.pickup || (e.k === KINDS.explosion && e.ttl > 1)) {
      state.entities.push({ ...e, ttl: Math.max(0, e.ttl - 1) });
    }
  }

  const dead = new Set();
  const effects = [];
  function damage(target, amount, owner = 0) {
    if (!target.hp || target.shield || target.guard) return;
    target.hp = Math.max(0, target.hp - amount);
    if (target.k === KINDS.ship) target.guard = 8;
    if (target.hp > 0) return;
    if (target.k === KINDS.ship) {
      target.respawn = 60;
      target.thrust = false;
    } else dead.add(target.id);
    const pilot = state.entities.find(
      (e) => e.id === owner && e.k === KINDS.ship,
    );
    if (pilot) pilot.score += target.k === KINDS.ship ? 250 : 100;
    effects.push(
      entity({
        k: KINDS.explosion,
        x: target.x,
        y: target.y,
        owner: target.id,
        seq: owner,
        ttl: EXPLOSION_TICKS,
      }),
    );
  }

  for (const e of state.entities) {
    if (e.k !== KINDS.bullet) continue;
    const target = state.entities.find(
      (candidate) =>
        candidate.id !== e.owner &&
        (candidate.k === KINDS.ship || candidate.k === KINDS.asteroid) &&
        candidate.hp &&
        touching(e, candidate, arena),
    );
    if (target) {
      dead.add(e.id);
      damage(target, 35, e.owner);
    }
  }

  for (const ship of state.entities) {
    if (ship.k !== KINDS.ship || !ship.hp) continue;
    for (const item of state.entities) {
      if (dead.has(item.id) || !touching(ship, item, arena)) continue;
      if (item.k === KINDS.pickup) {
        ship.shield = 180;
        dead.add(item.id);
      } else if (item.k === KINDS.asteroid) damage(ship, 42);
    }
  }
  state.entities = state.entities.filter((e) => !dead.has(e.id));
  for (const shot of shots) add(state, shot);
  for (const effect of effects) add(state, effect);
  return state;
}

export function stateHash(state) {
  const text = JSON.stringify(state);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1)
    hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return (hash >>> 0).toString(16).padStart(8, "0");
}
