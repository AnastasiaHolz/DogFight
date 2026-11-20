import { z } from "zod";

export const VERSION = 1;
export const MAX_ENTITIES = 96;

const u32 = z.int().min(0).max(0xffffffff);
const u16 = z.int().min(0).max(0xffff);
const u8 = z.int().min(0).max(255);
export const EntityIdSchema = u32.brand<"EntityId">();
export const TickSchema = u32.brand<"Tick">();
export const SeqSchema = u32.brand<"Seq">();
export type EntityId = z.infer<typeof EntityIdSchema>;
export type Tick = z.infer<typeof TickSchema>;
export type Seq = z.infer<typeof SeqSchema>;
export const entityId = (value: number): EntityId =>
  EntityIdSchema.parse(value);
export const tickNumber = (value: number): Tick => TickSchema.parse(value);
export const seqNumber = (value: number): Seq => SeqSchema.parse(value);

export const ControlsSchema = z.strictObject({
  turn: z.literal([-1, 0, 1]),
  thrust: z.boolean(),
  fire: z.boolean(),
  homing: z.boolean(),
});
export type Controls = z.infer<typeof ControlsSchema>;
export const InputSchema = ControlsSchema.extend({
  v: z.literal(VERSION),
  type: z.literal("input"),
  seq: SeqSchema.refine((value) => value > 0),
});
export type Input = z.infer<typeof InputSchema>;

const roomId = z.string().regex(/^[a-z0-9-]{1,50}$/);
const replayId = z.string().regex(/^[a-z0-9-]{1,90}$/);
const name = z.string().trim().min(1).max(24);
const chatText = z.string().trim().min(1).max(240);
const preset = z.enum(["orbit", "nebula", "debris"]);
export type CodecName = "json" | "binary";

export const ArenaSchema = z.strictObject({
  width: z.int().min(320).max(2000),
  height: z.int().min(320).max(2000),
  background: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .optional(),
  grid: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .optional(),
  extraAsteroids: z.int().min(0).max(2).optional(),
});
export type Arena = Readonly<z.infer<typeof ArenaSchema>>;

export const CreateRoomSchema = z.strictObject({
  name: z.string().trim().min(1).max(40),
  preset: preset.default("orbit"),
});
export type CreateRoom = z.infer<typeof CreateRoomSchema>;

export const RoomSchema = z.strictObject({
  id: roomId,
  name: z.string().min(1).max(40),
  preset,
  arena: ArenaSchema,
  players: z.int().min(0).max(6),
  maxPlayers: z.int().min(1).max(6),
});
export type RoomInfo = z.infer<typeof RoomSchema>;

const PlayerSchema = z.strictObject({
  id: z.uuid(),
  name,
  netId: EntityIdSchema,
});
export type Player = z.infer<typeof PlayerSchema>;

export const ClientSchema = z.discriminatedUnion("type", [
  z.strictObject({
    v: z.literal(0),
    type: z.literal("join"),
    room: roomId,
    name,
  }),
  z.strictObject({ v: z.literal(0), type: z.literal("chat"), text: chatText }),
  z.strictObject({ v: z.literal(0), type: z.literal("leave") }),
  InputSchema,
  z.strictObject({
    v: z.literal(VERSION),
    type: z.literal("ping"),
    id: u32.min(1),
  }),
]);
export type ClientMessage = z.infer<typeof ClientSchema>;

const body = z.strictObject({
  id: EntityIdSchema.refine((value) => value > 0),
  owner: EntityIdSchema,
  seq: SeqSchema,
  x: z.number().min(0).max(2000),
  y: z.number().min(0).max(2000),
  vx: z.number().min(-900).max(900),
  vy: z.number().min(-900).max(900),
  angle: z
    .number()
    .min(0)
    .max(2 * Math.PI),
  thrust: z.boolean(),
  homing: z.boolean(),
  r: u8,
  hp: u8.max(100),
  cooldown: u8.max(13),
  shield: u8.max(180),
  guard: u8.max(20),
  respawn: u8.max(60),
  ttl: u8.max(46),
  life: u16,
  score: u32,
});

export const WireEntitySchema = z.discriminatedUnion("k", [
  body.extend({ k: z.literal(1) }),
  body.extend({ k: z.literal(2) }),
  body.extend({ k: z.literal(3) }),
  body.extend({ k: z.literal(4) }),
  body.extend({ k: z.literal(5) }),
]);
export type WireEntity = z.infer<typeof WireEntitySchema>;
export type EntityKind =
  | "ship"
  | "bullet"
  | "asteroid"
  | "pickup"
  | "explosion";

function tagged<E extends WireEntity, K extends EntityKind>(
  entity: E,
  kind: K,
): Readonly<E & { kind: K }> {
  return { ...entity, kind };
}

export function unreachable(_value: never): never {
  throw new Error("Unreachable variant");
}

export function toEntity(entity: WireEntity) {
  switch (entity.k) {
    case 1:
      return tagged(entity, "ship");
    case 2:
      return tagged(entity, "bullet");
    case 3:
      return tagged(entity, "asteroid");
    case 4:
      return tagged(entity, "pickup");
    case 5:
      return tagged(entity, "explosion");
    default:
      return unreachable(entity);
  }
}

export type SnapshotEntity = ReturnType<typeof toEntity>;
const DecodedEntitySchema = WireEntitySchema.transform(toEntity);
export const SnapshotSchema = z.strictObject({
  v: z.literal(VERSION),
  type: z.literal("snapshot"),
  tick: TickSchema,
  lastProcessedSeq: SeqSchema,
  entities: z.array(DecodedEntitySchema).max(MAX_ENTITIES).readonly(),
});
export type Snapshot = Readonly<z.infer<typeof SnapshotSchema>>;

export const ServerSchema = z.discriminatedUnion("type", [
  z.strictObject({
    v: z.literal(0),
    type: z.literal("joined"),
    room: RoomSchema,
    player: PlayerSchema,
    replayId,
    seed: u32,
    codec: z.enum(["json", "binary"]),
  }),
  z.strictObject({
    v: z.literal(0),
    type: z.literal("roster"),
    players: z.array(PlayerSchema).max(6),
  }),
  z.strictObject({
    v: z.literal(0),
    type: z.literal("chat"),
    player: PlayerSchema,
    text: chatText,
  }),
  z.strictObject({
    v: z.literal(VERSION),
    type: z.literal("pong"),
    id: u32.min(1),
  }),
  SnapshotSchema,
]);
export type ServerMessage = z.infer<typeof ServerSchema>;

export type ParseResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      reason: "json" | "schema";
      message: string;
    };

export function parseJson(text: string): ParseResult<unknown> {
  try {
    const value: unknown = JSON.parse(text);
    return { ok: true, value };
  } catch (error: unknown) {
    return {
      ok: false,
      reason: "json",
      message: error instanceof Error ? error.message : "Invalid JSON",
    };
  }
}

function parse<T>(schema: z.ZodType<T>, input: unknown): ParseResult<T> {
  const source: ParseResult<unknown> =
    typeof input === "string" ? parseJson(input) : { ok: true, value: input };
  if (!source.ok) return source;
  const result = schema.safeParse(source.value);
  if (result.success) return { ok: true, value: result.data };
  return {
    ok: false,
    reason: "schema",
    message: "Invalid message shape or version",
  };
}

export function parseClientMessage(data: unknown): ParseResult<ClientMessage> {
  return parse(ClientSchema, data);
}

export function parseServerMessage(data: unknown): ParseResult<ServerMessage> {
  return parse(ServerSchema, data);
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function errorCode(error: unknown): string | undefined {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}
