import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type {
  Arena,
  CreateRoom,
  Player,
  RoomInfo,
} from "@dogfight/shared/protocol";
import { unreachable } from "@dogfight/shared/protocol";
import { MatchLog } from "./log/matchlog.ts";
import type { ErrorLogger } from "./ws.ts";

export const PRESETS: Readonly<Record<CreateRoom["preset"], Arena>> =
  Object.freeze({
    orbit: {
      width: 960,
      height: 540,
      background: "#132237",
      grid: "#233950",
      extraAsteroids: 0,
    },
    nebula: {
      width: 1120,
      height: 600,
      background: "#211b37",
      grid: "#403055",
      extraAsteroids: 2,
    },
    debris: {
      width: 800,
      height: 450,
      background: "#292223",
      grid: "#463739",
      extraAsteroids: 1,
    },
  });

type PlayerEvent = { player: Player };
type ChatEvent = PlayerEvent & { text: string };
type RoomNotice =
  | ({ type: "join" } & PlayerEvent)
  | ({ type: "leave" } & PlayerEvent)
  | ({ type: "chat" } & ChatEvent);
export type RoomEvent = { t: number } & RoomNotice;
type RoomEvents = {
  join: [PlayerEvent];
  leave: [PlayerEvent];
  chat: [ChatEvent];
  empty: [];
  event: [RoomEvent];
  error: [unknown];
};

export class Room extends EventEmitter<RoomEvents> {
  readonly id: string;
  readonly replayId: string;
  readonly name: string;
  readonly preset: CreateRoom["preset"];
  readonly arena: Arena;
  readonly maxPlayers: number;
  #players = new Map<string, Player>();

  constructor({
    name,
    preset,
    maxPlayers,
  }: CreateRoom & { maxPlayers: number }) {
    super();
    this.id = randomUUID();
    this.replayId = `${this.id}-${Date.now()}`;
    this.name = name;
    this.preset = preset;
    this.arena = PRESETS[preset];
    this.maxPlayers = maxPlayers;
  }

  get size() {
    return this.#players.size;
  }

  get players() {
    return [...this.#players.values()];
  }

  info(): RoomInfo {
    return {
      id: this.id,
      name: this.name,
      preset: this.preset,
      arena: this.arena,
      players: this.size,
      maxPlayers: this.maxPlayers,
    };
  }

  #notify(detail: RoomNotice) {
    this.emit("event", { t: Date.now(), ...detail });
    switch (detail.type) {
      case "join":
        this.emit("join", { player: detail.player });
        return;
      case "leave":
        this.emit("leave", { player: detail.player });
        return;
      case "chat":
        this.emit("chat", { player: detail.player, text: detail.text });
        return;
      default:
        return unreachable(detail);
    }
  }

  join(player: Player) {
    if (this.size >= this.maxPlayers || this.#players.has(player.id))
      return false;
    this.#players.set(player.id, player);
    this.#notify({ type: "join", player });
    return true;
  }

  leave(id: string) {
    const player = this.#players.get(id);
    if (!player) return;
    this.#players.delete(id);
    this.#notify({ type: "leave", player });
    if (this.size === 0) this.emit("empty");
  }

  chat(id: string, text: string) {
    const player = this.#players.get(id);
    if (player) this.#notify({ type: "chat", player, text });
  }
}

export type RoomManagerOptions = {
  logDir: string;
  maxRooms?: number;
  maxPlayers?: number;
  emptyMs?: number;
  onError?: ErrorLogger;
};

export class RoomManager {
  #rooms = new Map<
    string,
    { room: Room; close(): Promise<void> | undefined }
  >();
  #logs = new Set<Promise<void>>();
  readonly logDir: string;
  readonly maxRooms: number;
  readonly maxPlayers: number;
  readonly emptyMs: number;
  readonly onError: ErrorLogger;

  constructor({
    logDir,
    maxRooms = 16,
    maxPlayers = 6,
    emptyMs = 90_000,
    onError = console.error,
  }: RoomManagerOptions) {
    this.logDir = logDir;
    this.maxRooms = maxRooms;
    this.maxPlayers = maxPlayers;
    this.emptyMs = emptyMs;
    this.onError = onError;
  }

  get(id: string) {
    return this.#rooms.get(id)?.room;
  }

  list() {
    return [...this.#rooms.values()].map(({ room }) => room.info());
  }

  create({ name, preset }: CreateRoom) {
    if (this.#rooms.size >= this.maxRooms) return null;
    const room = new Room({ name, preset, maxPlayers: this.maxPlayers });
    let log: MatchLog | undefined;
    let saturated = false;
    const timer = setTimeout(() => this.remove(room.id), this.emptyMs);
    timer.unref();
    room.on("error", (error) => this.onError(`room ${room.id}`, error));
    room.on("event", (event) => {
      if (!log) {
        clearTimeout(timer);
        log = new MatchLog(this.logDir, room.replayId, (error) =>
          room.emit("error", error),
        );
        this.#logs.add(log.done);
        const completion = log.done;
        void completion.then(() => this.#logs.delete(completion));
      }
      if (!log.append(event) && !saturated) {
        saturated = true;
        room.emit("error", new Error("Match log queue unavailable or full"));
      }
    });
    room.once("empty", () => this.remove(room.id));
    this.#rooms.set(room.id, {
      room,
      close() {
        clearTimeout(timer);
        return log?.close();
      },
    });
    return room;
  }

  remove(id: string) {
    const record = this.#rooms.get(id);
    if (!record) return;
    this.#rooms.delete(id);
    void record.close();
  }

  async shutdown() {
    for (const id of this.#rooms.keys()) this.remove(id);
    await Promise.all(this.#logs);
  }
}
