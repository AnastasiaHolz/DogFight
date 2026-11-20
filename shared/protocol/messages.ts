import type {
  Controls,
  Input,
  Seq,
  Snapshot,
  Tick,
  WireEntity,
} from "../protocol.ts";
import { InputSchema, toEntity, VERSION } from "../protocol.ts";

export { MAX_ENTITIES, VERSION } from "../protocol.ts";
export const TICK_RATE = 30;
export const TICK_MS = 1000 / TICK_RATE;
export const STEP = 1 / TICK_RATE;
export const TYPES = Object.freeze({ input: 1, snapshot: 2 });
export const KINDS = Object.freeze<{
  ship: 1;
  bullet: 2;
  asteroid: 3;
  pickup: 4;
  explosion: 5;
}>({
  ship: 1,
  bullet: 2,
  asteroid: 3,
  pickup: 4,
  explosion: 5,
});
export const NEUTRAL: Readonly<Controls> = {
  turn: 0,
  thrust: false,
  fire: false,
  homing: false,
};

export function inputMessage(seq: Seq, controls: Controls): Input {
  const { turn, thrust, fire, homing } = controls;
  return { v: VERSION, type: "input", seq, turn, thrust, fire, homing };
}

export function isInput(value: unknown): value is Input {
  return InputSchema.safeParse(value).success;
}

export function snapshotMessage(
  state: { tick: Tick; entities: readonly WireEntity[] },
  lastProcessedSeq: Seq,
): Snapshot {
  return {
    v: VERSION,
    type: "snapshot",
    tick: state.tick,
    lastProcessedSeq,
    entities: state.entities.map(toEntity),
  };
}
