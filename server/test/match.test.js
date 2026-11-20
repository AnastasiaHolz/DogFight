import assert from "node:assert/strict";
import test from "node:test";
import {
  inputMessage,
  KINDS,
  NEUTRAL,
} from "@dogfight/shared/protocol/messages";
import { ARENA } from "@dogfight/shared/sim/arena";
import { Match } from "../src/match.js";

test("server consumes at most one command per tick, validates order and bounds lookahead", () => {
  const match = new Match(ARENA, 551);
  const output = [];
  const id = match.join((packet) => output.push(packet));
  const action = { ...NEUTRAL, fire: true, thrust: true };
  for (const seq of [4, 3, 2, 1, 1, 45000])
    match.accept(id, inputMessage(seq, action));
  for (let i = 0; i < 9; i += 1) match.step();
  assert.deepEqual(
    output.map((e) => e.lastProcessedSeq),
    [0, 1, 2, 3, 4, 4, 4, 4, 4],
  );
  assert.equal(
    output.at(-1).entities.filter((e) => e.k === KINDS.bullet).length,
    1,
  );
  assert.equal(match.stats().tickRate, 30);
  match.leave(id);
  assert.ok(!match.state.entities.some((e) => e.owner === id));
});
