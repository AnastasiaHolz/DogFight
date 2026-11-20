import { inputMessage } from "../protocol/messages.js";
import { ARENA } from "./arena.js";
import { addPilot, advanceWorld, createBattle, stateHash } from "./battle.js";

export function runScenario({ ticks = 480, seed = 202605, collect } = {}) {
  let state = createBattle(seed, ARENA);
  const pilots = [];
  for (let i = 0; i < 4; i += 1) {
    const joined = addPilot(state, ARENA);
    pilots.push(joined.id);
    state = joined.state;
  }
  for (let i = 1; i <= ticks; i += 1) {
    const inputs = new Map(
      pilots.map((id, index) => [
        id,
        inputMessage(i, {
          thrust: (i + index * 9) % 80 < 63,
          turn: ((Math.floor((i + index * 7) / 37) + index) % 3) - 1,
          fire: (i + index * 5) % 53 < 46,
          homing: (i + index * 11) % 89 > 78,
        }),
      ]),
    );
    state = advanceWorld(state, inputs, ARENA);
    collect?.(state, inputs.get(pilots[0]));
  }
  return stateHash(state);
}
