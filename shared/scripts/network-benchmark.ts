import {
  decodeInput,
  decodeSnapshot,
  encodeInput,
  encodeSnapshot,
} from "../codec/binary.ts";
import {
  decodeJsonInput,
  decodeJsonSnapshot,
  encodeJson,
  encodeJsonSnapshot,
} from "../codec/json.ts";
import { snapshotMessage, TICK_RATE } from "../protocol/messages.ts";
import type { Input, Snapshot } from "../protocol.ts";
import { runScenario } from "../sim/scenario.ts";

const trace: [Snapshot, Input][] = [];
const hash = runScenario({
  collect(state, input) {
    trace.push([snapshotMessage(state, input.seq), input]);
  },
});
const text = new TextEncoder();

function result<T extends string | ArrayBuffer>(
  codec: string,
  encodeState: (message: Snapshot) => T,
  decodeState: (packet: T) => Snapshot,
  encodeAction: (message: Input) => T,
  decodeAction: (packet: T) => Input,
) {
  const size = (packet: T) =>
    typeof packet === "string"
      ? text.encode(packet).byteLength
      : packet.byteLength;
  let snapshotBytes = 0;
  let inputBytes = 0;
  for (const [state, input] of trace) {
    const packet = encodeState(state);
    const command = encodeAction(input);
    decodeState(packet);
    decodeAction(command);
    snapshotBytes += size(packet);
    inputBytes += size(command);
  }
  const times = [];
  for (let run = 0; run < 5; run += 1) {
    const start = performance.now();
    for (let repeat = 0; repeat < 12; repeat += 1) {
      for (const [snapshot] of trace) decodeState(encodeState(snapshot));
    }
    times.push(((performance.now() - start) * 1000) / (trace.length * 12));
  }
  const avg = snapshotBytes / trace.length;
  return {
    codec,
    snapshotBytes: avg,
    downKBps: (avg * TICK_RATE) / 1000,
    upKBps: ((inputBytes / trace.length) * TICK_RATE) / 1000,
    roundTripUs: times.sort((a, b) => a - b)[2] ?? 0,
  };
}

console.log(
  JSON.stringify(
    {
      node: process.version,
      players: 4,
      tickRate: TICK_RATE,
      snapshots: trace.length,
      hash,
      results: [
        result(
          "json",
          encodeJsonSnapshot,
          decodeJsonSnapshot,
          encodeJson,
          decodeJsonInput,
        ),
        result(
          "binary",
          encodeSnapshot,
          decodeSnapshot,
          encodeInput,
          decodeInput,
        ),
      ],
    },
    null,
    2,
  ),
);
