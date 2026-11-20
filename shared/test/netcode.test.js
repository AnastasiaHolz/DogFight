import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeInput,
  decodeSnapshot,
  encodeInput,
  encodeSnapshot,
} from "../codec/binary.js";
import { decodeJsonInput } from "../codec/json.js";
import {
  inputMessage,
  NEUTRAL,
  snapshotMessage,
} from "../protocol/messages.js";
import { ARENA, shortestDelta } from "../sim/arena.js";
import {
  addPilot,
  advanceWorld,
  createBattle,
  stateHash,
} from "../sim/battle.js";
import { TAU } from "../sim/flight.js";
import { runScenario } from "../sim/scenario.js";

test("input is little endian, seven bytes and has no coordinates", () => {
  const input = inputMessage(0x12345678, {
    ...NEUTRAL,
    turn: -1,
    thrust: true,
  });
  const bytes = new Uint8Array(encodeInput(input));
  assert.deepEqual([...bytes], [1, 1, 0x78, 0x56, 0x34, 0x12, 4]);
  const wrapped = new Uint8Array(24);
  wrapped.set(bytes, 9);
  assert.deepEqual(decodeInput(wrapped.subarray(9, 16)), input);
  assert.throws(() => decodeJsonInput(JSON.stringify({ ...input, x: 605 })));
  assert.throws(() => decodeInput(bytes.subarray(0, 6)));
  bytes[6] = 0xff;
  assert.throws(() => decodeInput(bytes));
});

test("snapshot round-trip preserves tick, ack, ids and angles within quantization", () => {
  const { state } = addPilot(createBattle(74, ARENA), ARENA);
  state.entities.at(-1).angle = TAU - 0.00001;
  const packet = snapshotMessage(state, 321);
  const restored = decodeSnapshot(encodeSnapshot(packet));
  assert.equal(restored.lastProcessedSeq, 321);
  assert.equal(restored.tick, packet.tick);
  for (const [i, before] of packet.entities.entries()) {
    const after = restored.entities[i];
    assert.ok(
      Math.abs(shortestDelta(before.angle, after.angle, TAU)) <=
        Math.PI / 65536 + 1e-10,
    );
    for (const field of ["x", "y", "vx", "vy"])
      assert.ok(Math.abs(before[field] - after[field]) <= 0.0001);
    assert.deepEqual(
      {
        ...before,
        x: after.x,
        y: after.y,
        vx: after.vx,
        vy: after.vy,
        angle: after.angle,
      },
      after,
    );
  }
  const bytes = new Uint8Array(encodeSnapshot(packet));
  bytes[0] = 2;
  assert.throws(() => decodeSnapshot(bytes));
});

test("world is deterministic, independent between matches and leaves inputs untouched", () => {
  assert.equal(typeof document, "undefined");
  const fingerprint = runScenario();
  assert.match(fingerprint, /^[a-f0-9]{8}$/);
  assert.equal(runScenario(), fingerprint);
  assert.notEqual(runScenario({ seed: 19 }), fingerprint);
  const { state, id } = addPilot(createBattle(55, ARENA), ARENA);
  const before = stateHash(state);
  const command = Object.freeze(
    inputMessage(1, { ...NEUTRAL, thrust: true, fire: true }),
  );
  advanceWorld(state, new Map([[id, command]]), ARENA);
  assert.equal(stateHash(state), before);
});
