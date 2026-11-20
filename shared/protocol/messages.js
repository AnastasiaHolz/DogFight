export const VERSION = 1;
export const TICK_RATE = 30;
export const TICK_MS = 1000 / TICK_RATE;
export const STEP = 1 / TICK_RATE;
export const MAX_ENTITIES = 96;
export const TYPES = { input: 1, snapshot: 2 };
export const KINDS = {
  ship: 1,
  bullet: 2,
  asteroid: 3,
  pickup: 4,
  explosion: 5,
};
export const NEUTRAL = { turn: 0, thrust: false, fire: false, homing: false };

export function isInput(message) {
  return (
    message !== null &&
    typeof message === "object" &&
    Object.keys(message).length === 7 &&
    message.v === VERSION &&
    message.type === "input" &&
    Number.isInteger(message.seq) &&
    message.seq > 0 &&
    message.seq <= 0xffffffff &&
    [-1, 0, 1].includes(message.turn) &&
    ["thrust", "fire", "homing"].every(
      (key) => typeof message[key] === "boolean",
    )
  );
}

export function inputMessage(seq, controls) {
  const { turn, thrust, fire, homing } = controls;
  return { v: VERSION, type: "input", seq, turn, thrust, fire, homing };
}

export function snapshotMessage(state, lastProcessedSeq) {
  return {
    v: VERSION,
    type: "snapshot",
    tick: state.tick,
    lastProcessedSeq,
    entities: state.entities,
  };
}
