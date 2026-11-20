import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { MatchLog } from "./log/matchlog.js";

export const PRESETS = Object.freeze({
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

export class Room extends EventEmitter {
  #players = new Map();

  constructor({ name, preset, maxPlayers }) {
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

  info() {
    return {
      id: this.id,
      name: this.name,
      preset: this.preset,
      arena: this.arena,
      players: this.size,
      maxPlayers: this.maxPlayers,
    };
  }

  #notify(type, detail) {
    this.emit("event", { t: Date.now(), type, ...detail });
    this.emit(type, detail);
  }

  join(player) {
    if (this.size >= this.maxPlayers || this.#players.has(player.id))
      return false;
    this.#players.set(player.id, player);
    this.#notify("join", { player });
    return true;
  }

  leave(id) {
    const player = this.#players.get(id);
    if (!player) return;
    this.#players.delete(id);
    this.#notify("leave", { player });
    if (this.size === 0) this.emit("empty");
  }

  chat(id, text) {
    const player = this.#players.get(id);
    if (player) this.#notify("chat", { player, text });
  }
}

export class RoomManager {
  #rooms = new Map();
  #logs = new Set();

  constructor({
    logDir,
    maxRooms = 16,
    maxPlayers = 6,
    emptyMs = 90_000,
    onError = console.error,
  }) {
    this.logDir = logDir;
    this.maxRooms = maxRooms;
    this.maxPlayers = maxPlayers;
    this.emptyMs = emptyMs;
    this.onError = onError;
  }

  get(id) {
    return this.#rooms.get(id)?.room;
  }

  list() {
    return [...this.#rooms.values()].map(({ room }) => room.info());
  }

  create({ name, preset }) {
    if (this.#rooms.size >= this.maxRooms) return null;
    const room = new Room({ name, preset, maxPlayers: this.maxPlayers });
    let log;
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
        void log.done.then(() => this.#logs.delete(log.done));
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

  remove(id) {
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
