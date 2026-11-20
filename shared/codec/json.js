import { isInput, MAX_ENTITIES, VERSION } from "../protocol/messages.js";

export function encodeJson(message) {
  return JSON.stringify(message);
}

export function decodeJsonInput(text) {
  const value = JSON.parse(text);
  if (!isInput(value)) throw new TypeError("Invalid input");
  return value;
}

export function decodeJsonSnapshot(text) {
  const value = JSON.parse(text);
  if (
    value?.v !== VERSION ||
    value.type !== "snapshot" ||
    !Array.isArray(value.entities) ||
    value.entities.length > MAX_ENTITIES ||
    !Number.isInteger(value.tick) ||
    !Number.isInteger(value.lastProcessedSeq)
  )
    throw new TypeError("Invalid snapshot");
  return value;
}
