import type { Input, Snapshot } from "../protocol.ts";

export interface Codec<Frame, Incoming = Frame> {
  encodeInput(message: Input): Frame;
  decodeInput(frame: Incoming): Input;
  encodeSnapshot(message: Snapshot): Frame;
  decodeSnapshot(frame: Incoming): Snapshot;
}
