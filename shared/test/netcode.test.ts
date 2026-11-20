import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeInput,
  decodeSnapshot,
  encodeInput,
  encodeSnapshot,
} from "../codec/binary.ts";
import {
  decodeJsonInput,
  decodeJsonSnapshot,
  encodeJsonSnapshot,
} from "../codec/json.ts";
import {
  inputMessage,
  NEUTRAL,
  snapshotMessage,
} from "../protocol/messages.ts";
import type { EntityId, Seq, Tick } from "../protocol.ts";
import {
  parseClientMessage,
  parseServerMessage,
  seqNumber,
} from "../protocol.ts";
import { ARENA, shortestDelta } from "../sim/arena.ts";
import {
  addPilot,
  advanceWorld,
  createBattle,
  stateHash,
} from "../sim/battle.ts";
import { TAU } from "../sim/flight.ts";
import { runScenario } from "../sim/scenario.ts";

test("input is little endian, seven bytes and has no coordinates", () => {
  const input = inputMessage(seqNumber(0x12345678), {
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
  const last = state.entities.at(-1);
  assert.ok(last);
  last.angle = TAU - 0.00001;
  const packet = snapshotMessage(state, seqNumber(321));
  const restored = decodeSnapshot(encodeSnapshot(packet));
  const json = encodeJsonSnapshot(packet);
  assert.doesNotMatch(json, /"kind"/);
  assert.deepEqual(decodeJsonSnapshot(json), packet);
  assert.equal(restored.lastProcessedSeq, 321);
  assert.equal(restored.tick, packet.tick);
  for (const [i, before] of packet.entities.entries()) {
    const after = restored.entities[i];
    assert.ok(after);
    assert.ok(
      Math.abs(shortestDelta(before.angle, after.angle, TAU)) <=
        Math.PI / 65536 + 1e-10,
    );
    const coordinates: ("x" | "y" | "vx" | "vy")[] = ["x", "y", "vx", "vy"];
    for (const field of coordinates)
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
  assert.equal("document" in globalThis, false);
  const fingerprint = runScenario();
  assert.equal(fingerprint, "46f28136");
  assert.equal(runScenario(), fingerprint);
  assert.notEqual(runScenario({ seed: 19 }), fingerprint);
  const { state, id } = addPilot(createBattle(55, ARENA), ARENA);
  const before = stateHash(state);
  const command = Object.freeze(
    inputMessage(seqNumber(1), { ...NEUTRAL, thrust: true, fire: true }),
  );
  advanceWorld(state, new Map([[id, command]]), ARENA);
  assert.equal(stateHash(state), before);
});

export type DistinctIds = Assert<
  Seq extends EntityId
    ? false
    : Tick extends Seq
      ? false
      : EntityId extends Tick
        ? false
        : true
>;
type Assert<T extends true> = T;

test("JSON boundary rejects unknown types without throwing and binary payload checks numeric ranges", () => {
  assert.deepEqual(
    parseClientMessage({ v: 0, type: "chat", text: "  orbit " }),
    {
      ok: true,
      value: { v: 0, type: "chat", text: "orbit" },
    },
  );
  const malformed = parseClientMessage("{");
  assert.ok(!malformed.ok && malformed.reason === "json");
  const wrongTurn = parseClientMessage({
    ...inputMessage(seqNumber(1), NEUTRAL),
    turn: 1e9,
  });
  assert.ok(!wrongTurn.ok && wrongTurn.reason === "schema");
  assert.equal(
    parseServerMessage({ v: 0, type: "roster", players: [null] }).ok,
    false,
  );
  const state = addPilot(createBattle(72, ARENA), ARENA).state;
  const buffer = encodeSnapshot(snapshotMessage(state, seqNumber(0)));
  new DataView(buffer).setFloat32(12 + 12, Infinity, true);
  assert.throws(() => decodeSnapshot(buffer));
});
