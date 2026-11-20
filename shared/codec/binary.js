import {
  isInput,
  KINDS,
  MAX_ENTITIES,
  TYPES,
  VERSION,
} from "../protocol/messages.js";

const LE = true;
const INPUT_BYTES = 7;
const HEADER = 12;
const STRIDE = 45;
const TURN = 2 * Math.PI;
const ANGLE_UNIT = Math.PI / 32768;

function viewOf(data) {
  if (ArrayBuffer.isView(data))
    return new DataView(data.buffer, data.byteOffset, data.byteLength);
  return new DataView(data);
}

function check(view, type, minLength) {
  if (
    view.byteLength < minLength ||
    view.getUint8(0) !== VERSION ||
    view.getUint8(1) !== type
  ) {
    throw new RangeError("Invalid packet header");
  }
}

export function encodeInput(message) {
  if (!isInput(message)) throw new TypeError("Invalid input");
  const data = new ArrayBuffer(INPUT_BYTES);
  const view = new DataView(data);
  view.setUint8(0, VERSION);
  view.setUint8(1, TYPES.input);
  view.setUint32(2, message.seq, LE);
  view.setUint8(
    6,
    (message.turn + 1) |
      (Number(message.thrust) << 2) |
      (Number(message.fire) << 3) |
      (Number(message.homing) << 4),
  );
  return data;
}

export function decodeInput(data) {
  const view = viewOf(data);
  check(view, TYPES.input, INPUT_BYTES);
  const flags = view.getUint8(6);
  if (view.byteLength !== INPUT_BYTES || flags & 0xe0 || (flags & 3) === 3) {
    throw new RangeError("Invalid input payload");
  }
  const input = {
    v: VERSION,
    type: "input",
    seq: view.getUint32(2, LE),
    turn: (flags & 3) - 1,
    thrust: Boolean(flags & 4),
    fire: Boolean(flags & 8),
    homing: Boolean(flags & 16),
  };
  if (!isInput(input)) throw new TypeError("Invalid input");
  return input;
}

export function encodeSnapshot(message) {
  const entities = message.entities;
  if (entities.length > MAX_ENTITIES) throw new RangeError("Too many entities");
  const data = new ArrayBuffer(HEADER + STRIDE * entities.length);
  const view = new DataView(data);
  view.setUint8(0, VERSION);
  view.setUint8(1, TYPES.snapshot);
  view.setUint32(2, message.tick, LE);
  view.setUint32(6, message.lastProcessedSeq, LE);
  view.setUint16(10, entities.length, LE);
  for (const [i, entity] of entities.entries()) {
    const o = HEADER + i * STRIDE;
    view.setUint32(o, entity.id, LE);
    view.setUint32(o + 4, entity.owner, LE);
    view.setUint32(o + 8, entity.seq, LE);
    view.setFloat32(o + 12, entity.x, LE);
    view.setFloat32(o + 16, entity.y, LE);
    view.setFloat32(o + 20, entity.vx, LE);
    view.setFloat32(o + 24, entity.vy, LE);
    const angle = Math.round(entity.angle / ANGLE_UNIT);
    view.setInt16(o + 28, ((angle & 0xffff) << 16) >> 16, LE);
    view.setUint8(o + 30, entity.k);
    view.setUint8(o + 31, Number(entity.thrust) | (Number(entity.homing) << 1));
    view.setUint8(o + 32, entity.r);
    view.setUint8(o + 33, entity.hp);
    view.setUint8(o + 34, entity.cooldown);
    view.setUint8(o + 35, entity.shield);
    view.setUint8(o + 36, entity.guard);
    view.setUint8(o + 37, entity.respawn);
    view.setUint8(o + 38, entity.ttl);
    view.setUint16(o + 39, entity.life, LE);
    view.setUint32(o + 41, entity.score, LE);
  }
  return data;
}

export function decodeSnapshot(data) {
  const view = viewOf(data);
  check(view, TYPES.snapshot, HEADER);
  const count = view.getUint16(10, LE);
  if (count > MAX_ENTITIES || view.byteLength !== HEADER + count * STRIDE) {
    throw new RangeError("Invalid snapshot length");
  }
  const entities = [];
  for (let i = 0; i < count; i += 1) {
    const o = HEADER + i * STRIDE;
    const k = view.getUint8(o + 30);
    const flags = view.getUint8(o + 31);
    if (k < KINDS.ship || k > KINDS.explosion || flags & 0xfc)
      throw new RangeError("Invalid entity");
    const angle = view.getInt16(o + 28, LE) * ANGLE_UNIT;
    entities.push({
      id: view.getUint32(o, LE),
      owner: view.getUint32(o + 4, LE),
      seq: view.getUint32(o + 8, LE),
      x: view.getFloat32(o + 12, LE),
      y: view.getFloat32(o + 16, LE),
      vx: view.getFloat32(o + 20, LE),
      vy: view.getFloat32(o + 24, LE),
      angle: angle < 0 ? angle + TURN : angle,
      k,
      thrust: Boolean(flags & 1),
      homing: Boolean(flags & 2),
      r: view.getUint8(o + 32),
      hp: view.getUint8(o + 33),
      cooldown: view.getUint8(o + 34),
      shield: view.getUint8(o + 35),
      guard: view.getUint8(o + 36),
      respawn: view.getUint8(o + 37),
      ttl: view.getUint8(o + 38),
      life: view.getUint16(o + 39, LE),
      score: view.getUint32(o + 41, LE),
    });
  }
  return {
    v: VERSION,
    type: "snapshot",
    tick: view.getUint32(2, LE),
    lastProcessedSeq: view.getUint32(6, LE),
    entities,
  };
}
