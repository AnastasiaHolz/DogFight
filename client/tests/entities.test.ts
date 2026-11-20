import assert from "node:assert/strict";
import test from "node:test";
import { Asteroid } from "@dogfight/shared/sim/asteroid";
import { Bullet } from "@dogfight/shared/sim/bullet";
import { collisionPairs, offsetBetween } from "@dogfight/shared/sim/collision";
import { createHoming } from "@dogfight/shared/sim/components";
import { Entity } from "@dogfight/shared/sim/entity";
import { Game } from "@dogfight/shared/sim/game";
import { Pickup } from "@dogfight/shared/sim/pickup";
import { Ship } from "@dogfight/shared/sim/ship";
import { Vector2 } from "@dogfight/shared/sim/vector";
import { World } from "@dogfight/shared/sim/world";

const STEP = 1 / 60;

test("Vector2 повертає нові значення й не змінює вхідні вектори", () => {
  const a = new Vector2(3, 4);
  const b = new Vector2(1, 2);
  assert.deepEqual(a.add(b), new Vector2(4, 6));
  assert.deepEqual(a.sub(b), new Vector2(2, 2));
  assert.deepEqual(a.scale(2), new Vector2(6, 8));
  assert.equal(a.dot(b), 11);
  assert.equal(a.length(), 5);
  assert.ok(Math.abs(a.normalize().length() - 1) < 1e-9);
  assert.deepEqual(new Vector2().normalize(), new Vector2());
  assert.ok(
    Vector2.fromAngle(0)
      .rotate(Math.PI / 2)
      .sub(new Vector2(0, 1))
      .length() < 1e-9,
  );
  assert.deepEqual(a, new Vector2(3, 4));
  assert.deepEqual(b, new Vector2(1, 2));
});

test("Entity зберігає приватний ID, а метод класу спільний для екземплярів", () => {
  const first = new Ship();
  const second = new Ship();
  assert.ok(first instanceof Entity);
  assert.equal(Object.getPrototypeOf(Ship.prototype), Entity.prototype);
  assert.equal(first.fire, second.fire);
  assert.notEqual(first.id, second.id);
  assert.throws(() => {
    Object.assign(first, { id: second.id });
  }, TypeError);
  assert.throws(() => {
    Object.assign(first, { hp: 0 });
  }, TypeError);
});

test("World відкладає появу та видалення сутностей до завершення кроку", () => {
  const world = new World();
  const removed = new Entity({ kind: "target" });
  const created = new Entity({ kind: "child" });
  let childUpdates = 0;
  created.update = () => {
    childUpdates += 1;
  };
  const parent = new Entity({ kind: "parent" });
  parent.update = () => {
    world.despawn(removed.id);
    assert.equal(world.get(removed.id), removed);
    assert.equal(removed.alive, false);
    world.spawn(created);
    assert.equal(world.get(created.id), undefined);
    world.despawn(parent.id);
  };
  world.spawn(parent);
  world.spawn(removed);
  const parents = world.ofKind("parent");
  assert.equal(parents.next().value, parent);
  assert.equal(parents.next().done, true);
  world.step(STEP);
  assert.deepEqual([...world], [created]);
  assert.equal(world.get(removed.id), undefined);
  assert.equal(childUpdates, 0);
  world.step(STEP);
  assert.equal(childUpdates, 1);
});

test("постріл потребує this корабля, успадковує швидкість і зникає за TTL", () => {
  const world = new World();
  const ship = world.spawn(new Ship({ pos: new Vector2(100, 100) }));
  ship.vel = new Vector2(40, 5);

  const fire = ship.fire;
  assert.throws(() => fire(world), TypeError);
  assert.throws(() => fire.call(new EventTarget(), world), TypeError);
  const shot = (() => ship.fire(world))();
  assert.ok(shot instanceof Bullet);
  assert.deepEqual(shot.pos, new Vector2(123, 100));
  assert.deepEqual(shot.vel, new Vector2(500, 5));
  assert.equal(shot.ownerId, ship.id);
  assert.equal(ship.fire(world), null);
  for (let i = 0; i < 94; i += 1) world.step(STEP);
  assert.equal(world.get(shot.id), undefined);
});

test("компонент homing повертає і кулю, і астероїд до цілі", () => {
  const world = new World({ findPairs: () => [] });
  world.spawn(new Ship({ pos: new Vector2(150, 200) }));
  const guidance = createHoming({
    kinds: ["ship"],
    range: 300,
    turnRate: 3,
    speed: 50,
  });
  const bullet = world.spawn(
    new Bullet({
      pos: new Vector2(150, 100),
      vel: new Vector2(50, 0),
      homing: guidance,
    }),
  );
  const asteroid = world.spawn(
    new Asteroid({
      pos: new Vector2(100, 100),
      vel: new Vector2(50, 0),
      homing: guidance,
    }),
  );
  world.step(0.1);
  assert.ok(bullet.vel.y > 0);
  assert.ok(asteroid.vel.y > 0);
  assert.ok(Math.abs(bullet.vel.length() - 50) < 1e-9);
  assert.equal(bullet.homing, asteroid.homing);
});

test("колізії охоплюють перехід через край і не включають вибухи", () => {
  const world = new World();
  const left = world.spawn(new Ship({ pos: new Vector2(3, 230) }));
  const right = world.spawn(new Bullet({ pos: new Vector2(955, 230) }));
  const decor = world.spawn(
    new Entity({
      pos: new Vector2(950, 230),
      radius: 60,
      collidable: false,
      kind: "explosion",
    }),
  );
  assert.deepEqual([...collisionPairs(world)], [[left, right]]);
  assert.ok(decor.alive);
});

test("кулі знищують астероїд і дрон, створюють вибух і додають очки", () => {
  const game = new Game({ demo: false, random: () => 0.25 });
  const rock = game.world.spawn(
    new Asteroid({ pos: new Vector2(670, 270), hp: 30 }),
  );
  const rival = game.world.spawn(
    new Ship({ pos: new Vector2(740, 330), team: "rival" }),
  );
  const targets: [Asteroid | Ship, number][] = [
    [rock, 35],
    [rival, 100],
  ];
  for (const [target, damage] of targets) {
    game.world.spawn(
      new Bullet({
        pos: target.pos,
        team: "player",
        ownerId: game.player.id,
        damage,
      }),
    );
    game.step(STEP);
    assert.equal(target.alive, false);
    assert.equal(game.world.get(target.id), undefined);
  }
  assert.equal(game.score, 350);
  assert.equal([...game.world.ofKind("explosion")].length, 2);
  for (let i = 0; i < 37; i += 1) game.step(STEP);
  assert.equal([...game.world.ofKind("explosion")].length, 0);
});

test("pickup стоїть на місці, дає щит і безпечно зникає після колізії", () => {
  const game = new Game({ demo: false });
  const pos = new Vector2(540, 270);
  const shield = game.world.spawn(new Pickup({ pos }));
  game.step(STEP);
  assert.equal(shield.pos, pos);
  game.player.pos = pos;
  game.step(STEP);
  assert.equal(game.player.shield, 6);
  assert.equal(game.world.get(shield.id), undefined);
  assert.equal(game.player.damage(35), false);
  assert.equal(game.player.hp, 100);
  for (let i = 0; i < 361; i += 1) game.step(STEP);
  game.player.damage(35);
  assert.equal(game.player.hp, 65);
});

test("корабель зникає на 2 с і відновлюється з новим ID у безпечній точці", () => {
  const game = new Game({ demo: false, random: () => 0.5 });
  const first = game.player;
  const rock = game.world.spawn(new Asteroid({ pos: new Vector2(550, 270) }));
  game.world.spawn(new Bullet({ pos: first.pos, team: "rival", damage: 120 }));
  game.step(STEP);
  assert.equal(first.alive, false);
  assert.equal(game.player.id, first.id);
  assert.equal(game.respawnIn, 2);
  for (let i = 0; i < 119; i += 1) game.step(STEP);
  assert.equal(game.player, first);
  game.step(STEP);
  assert.notEqual(game.player.id, first.id);
  assert.equal(game.player.hp, 100);
  assert.equal(game.respawnIn, null);
  const clearance = offsetBetween(game.player, rock, game.world.arena).length();
  assert.ok(clearance >= 85 + rock.radius);
  assert.ok(game.player.protected);
});

test("астероїд відбивається від межі, а корабель загортається", () => {
  const world = new World();
  const rock = world.spawn(
    new Asteroid({ pos: new Vector2(25, 140), vel: new Vector2(-100, 0) }),
  );
  const ship = world.spawn(new Ship({ pos: new Vector2(959, 270) }));
  ship.vel = new Vector2(120, 0);
  world.step(0.1);
  assert.equal(rock.pos.x, rock.radius);
  assert.ok(rock.vel.x > 0);
  assert.ok(ship.pos.x < 20);
  assert.equal(ship.prevPos.x, 959);
});
