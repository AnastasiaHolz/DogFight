import type { Input, Snapshot } from "../protocol.ts";
import { parseClientMessage, parseServerMessage } from "../protocol.ts";
import type { Codec } from "./types.ts";

export function encodeJson(message: unknown): string {
  return JSON.stringify(message);
}

export function encodeJsonSnapshot(message: Snapshot): string {
  return encodeJson({
    ...message,
    entities: message.entities.map(({ kind: _kind, ...entity }) => entity),
  });
}

export function decodeJsonInput(text: string): Input {
  const parsed = parseClientMessage(text);
  if (!parsed.ok || parsed.value.type !== "input")
    throw new TypeError("Invalid input");
  return parsed.value;
}

export function decodeJsonSnapshot(text: string): Snapshot {
  const parsed = parseServerMessage(text);
  if (!parsed.ok || parsed.value.type !== "snapshot")
    throw new TypeError("Invalid snapshot");
  return parsed.value;
}

export const jsonCodec: Codec<string> = {
  encodeInput: encodeJson,
  decodeInput: decodeJsonInput,
  encodeSnapshot: encodeJsonSnapshot,
  decodeSnapshot: decodeJsonSnapshot,
};
