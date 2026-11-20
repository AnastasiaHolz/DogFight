import { Buffer } from "node:buffer";

export const VERSION = 0;
export const MAX_PAYLOAD = 4096;
export const CLOSE = Object.freeze({
  unsupported: 1003,
  invalidJson: 1007,
  badMessage: 1008,
  oversize: 1009,
  busy: 1013,
  full: 4403,
  missing: 4404,
  joinTimeout: 4408,
  rate: 4429,
});

export class ProtocolError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function cleanText(value, maxChars, maxBytes) {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  if (
    !cleaned ||
    cleaned.length > maxChars ||
    Buffer.byteLength(cleaned) > maxBytes
  )
    return null;
  return cleaned;
}

function onlyFields(message, fields) {
  return Object.keys(message).every((key) => fields.includes(key));
}

export function decode(data, binary = false) {
  if (binary) throw new ProtocolError(CLOSE.unsupported, "Text frames only");
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (bytes.byteLength > MAX_PAYLOAD)
    throw new ProtocolError(CLOSE.oversize, "Message too large");

  let message;
  try {
    message = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new ProtocolError(CLOSE.invalidJson, "Invalid JSON");
  }

  if (
    !message ||
    typeof message !== "object" ||
    Array.isArray(message) ||
    message.v !== VERSION
  ) {
    throw new ProtocolError(CLOSE.badMessage, "Invalid version or shape");
  }

  if (
    message.type === "join" &&
    onlyFields(message, ["v", "type", "room", "name"])
  ) {
    const name = cleanText(message.name, 24, 96);
    if (
      name &&
      typeof message.room === "string" &&
      /^[a-z0-9-]{1,50}$/.test(message.room)
    ) {
      return { type: "join", room: message.room, name };
    }
  } else if (
    message.type === "chat" &&
    onlyFields(message, ["v", "type", "text"])
  ) {
    const text = cleanText(message.text, 240, 960);
    if (text) return { type: "chat", text };
  } else if (message.type === "leave" && onlyFields(message, ["v", "type"])) {
    return { type: "leave" };
  }

  throw new ProtocolError(CLOSE.badMessage, "Unknown type or invalid fields");
}

export function tokenBucket({
  rate = 8,
  burst = 12,
  now = () => performance.now(),
} = {}) {
  let tokens = burst;
  let last = now();
  return () => {
    const time = now();
    tokens = Math.min(burst, tokens + ((time - last) / 1000) * rate);
    last = time;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}
