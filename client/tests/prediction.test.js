import assert from "node:assert/strict";
import test from "node:test";
import {
  KINDS,
  NEUTRAL,
  snapshotMessage,
} from "@dogfight/shared/protocol/messages";
import { ARENA } from "@dogfight/shared/sim/arena";
import {
  addPilot,
  advanceWorld,
  createBattle,
} from "@dogfight/shared/sim/battle";
import { Prediction } from "../src/network/prediction.js";

test("pending inputs replay exactly once and the authoritative bullet replaces prediction", () => {
  const { state, id } = addPilot(createBattle(51, ARENA), ARENA);
  const settings = { predict: true, drift: false, interpolation: 120 };
  const model = new Prediction({ player: id, arena: ARENA, settings });
  model.receive(snapshotMessage(state, 0), 0);
  const inputs = [];
  const send = (input) => {
    inputs.push(input);
    return true;
  };
  const localShot = model.next({ ...NEUTRAL, fire: true, thrust: true }, send);
  assert.ok(localShot);
  model.next({ ...NEUTRAL, thrust: true }, send);
  assert.equal(model.scene(0).filter((e) => e.k === KINDS.bullet).length, 1);

  const confirmed = advanceWorld(state, new Map([[id, inputs[0]]]), ARENA);
  assert.ok(model.receive(snapshotMessage(confirmed, 1), 45));
  assert.equal(model.pending.length, 1);
  assert.equal(model.bullets.length, 0);
  assert.equal(model.scene(45).filter((e) => e.k === KINDS.bullet).length, 1);
  assert.ok(model.correction < 1e-8);
  assert.equal(model.receive(snapshotMessage(state, 0), 60), false);
});

test("snapshot-only mode holds the last authoritative pose and preserves input order", () => {
  const { state, id } = addPilot(createBattle(51, ARENA), ARENA);
  const settings = { predict: false, drift: false, interpolation: 120 };
  const model = new Prediction({ player: id, arena: ARENA, settings });
  model.receive(snapshotMessage(state, 0), 0);
  model.next({ ...NEUTRAL, thrust: true }, () => true);
  assert.equal(model.local(20).x, model.authoritative.x);
  settings.predict = true;
  model.next({ ...NEUTRAL, thrust: true }, () => true);
  assert.ok(model.local(25).x > model.authoritative.x);
  assert.deepEqual(
    model.pending.map((e) => e.seq),
    [1, 2],
  );
});
