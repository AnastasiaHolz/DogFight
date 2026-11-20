import { inputMessage } from "../protocol/messages.ts";
import type { EntityId, Input } from "../protocol.ts";
import { seqNumber } from "../protocol.ts";
import { ARENA } from "./arena.ts";
import type { BattleState } from "./battle.ts";
import { addPilot, advanceWorld, createBattle, stateHash } from "./battle.ts";

export function runScenario({
  ticks = 480,
  seed = 202605,
  collect,
}: {
  ticks?: number;
  seed?: number;
  collect?: (state: BattleState, input: Input) => void;
} = {}) {
  let state = createBattle(seed, ARENA);
  const pilots: EntityId[] = [];
  for (let i = 0; i < 4; i += 1) {
    const joined = addPilot(state, ARENA);
    pilots.push(joined.id);
    state = joined.state;
  }
  for (let i = 1; i <= ticks; i += 1) {
    const inputs = new Map(
      pilots.map((id, index) => [
        id,
        inputMessage(seqNumber(i), {
          thrust: (i + index * 9) % 80 < 63,
          turn: turnFor(i, index),
          fire: (i + index * 5) % 53 < 46,
          homing: (i + index * 11) % 89 > 78,
        }),
      ]),
    );
    state = advanceWorld(state, inputs, ARENA);
    const first = pilots[0];
    const sample = first === undefined ? undefined : inputs.get(first);
    if (sample) collect?.(state, sample);
  }
  return stateHash(state);
}

function turnFor(i: number, index: number): Input["turn"] {
  const bucket = (Math.floor((i + index * 7) / 37) + index) % 3;
  return bucket === 0 ? -1 : bucket === 1 ? 0 : 1;
}
