import assert from "node:assert/strict";
import test from "node:test";
import { createInput } from "../src/input.js";
import { createLoop, STEP } from "../src/loop.js";
import { interpolateShip } from "../src/render/draw.js";
import { ARENA, wrap, wrapShip } from "../src/sim/arena.js";
import { createShip, integrate, MAX_SPEED, TAU } from "../src/sim/ship.js";

test("integrate не змінює вхідний об’єкт і гальмує без тяги", () => {
  const ship = Object.freeze(createShip(0, 0));
  const input = Object.freeze({ turn: 0, thrust: true });
  const moved = integrate(ship, input, STEP);
  assert.deepEqual(integrate(ship, input, STEP), moved);
  assert.equal(ship.x, 0);
  assert.ok(moved.x > 0);
  assert.equal(moved.y, 0);
  assert.ok(integrate(moved, { turn: 0, thrust: false }, STEP).vx < moved.vx);
});

test("корабель не перевищує ліміт швидкості й реагує на поворот", () => {
  let ship = createShip(0, 0);
  for (let i = 0; i < 500; i += 1) {
    ship = integrate(ship, { turn: 0, thrust: true }, STEP);
  }
  assert.ok(Math.hypot(ship.vx, ship.vy) <= MAX_SPEED);
  const turned = integrate(ship, { turn: -1, thrust: true }, STEP);
  assert.ok(turned.angle > TAU - 0.1 && turned.angle < TAU);
  assert.ok(turned.vy < 0);
});

test("краї арени і кут інтерполюються через найближчу межу", () => {
  assert.equal(wrap(-2, ARENA.width), ARENA.width - 2);
  assert.equal(wrapShip(createShip(ARENA.width + 2, -2), ARENA).x, 2);
  const from = { ...createShip(ARENA.width - 2, 10), angle: TAU - 0.1 };
  const to = { ...createShip(2, 10), angle: 0.1 };
  const midpoint = interpolateShip(from, to, 0.5);
  assert.equal(midpoint.x, 0);
  assert.ok(Math.min(midpoint.angle, TAU - midpoint.angle) < 1e-9);
});

test("клавіша має стан утримання й одноразову подію натискання", () => {
  const target = new EventTarget();
  const keys = createInput(target);
  function send(type, repeat = false) {
    const event = Object.assign(new Event(type), { code: "KeyR", repeat });
    target.dispatchEvent(event);
  }
  send("keydown");
  assert.equal(keys.isDown("KeyR"), true);
  assert.equal(keys.justPressed("KeyR"), true);
  send("keydown", true);
  assert.equal(keys.justPressed("KeyR"), false);
  send("keyup");
  assert.equal(keys.isDown("KeyR"), false);
  send("keydown");
  target.dispatchEvent(new Event("blur"));
  assert.equal(keys.isDown("KeyR"), false);
  assert.equal(keys.justPressed("KeyR"), false);
  keys.destroy();
  send("keydown");
  assert.equal(keys.isDown("KeyR"), false);
});

test("60/120/144 Гц дають ті самі 300 кроків і позицію за 5 секунд", (t) => {
  let callback;
  const fakeRaf = (fn) => {
    callback = fn;
    return 1;
  };
  globalThis.requestAnimationFrame = fakeRaf;
  globalThis.cancelAnimationFrame = () => {
    callback = undefined;
  };
  t.after(() => {
    delete globalThis.requestAnimationFrame;
    delete globalThis.cancelAnimationFrame;
  });

  function run(displayHz) {
    let ship = createShip(480, 270);
    let steps = 0;
    let rendered = 0;
    const loop = createLoop({
      simulate(dt) {
        assert.equal(dt, STEP);
        ship = wrapShip(integrate(ship, { turn: 0, thrust: true }, dt), ARENA);
        steps += 1;
      },
      render(alpha) {
        assert.ok(alpha >= 0 && alpha < 1);
        rendered += 1;
      },
    });
    loop.start();
    loop.start();
    for (let i = 0; i <= displayHz * 5; i += 1)
      callback((i * 1000) / displayHz);
    loop.stop();
    assert.equal(callback, undefined);
    assert.equal(rendered, displayHz * 5 + 1);
    return { ship, steps };
  }

  const base = run(60);
  assert.equal(base.steps, 300);
  assert.deepEqual(run(120), base);
  assert.deepEqual(run(144), base);
  let steps = 0;
  const loop = createLoop({
    simulate: () => {
      steps += 1;
    },
    render: () => {},
  });
  loop.start();
  callback(0);
  callback(5000);
  loop.stop();
  assert.equal(steps, 15);
});
