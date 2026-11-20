import type { CreateRoom, RoomInfo } from "@dogfight/shared/protocol";
import { RoomSchema } from "@dogfight/shared/protocol";
import { delay, fetchJson, HttpError, timedSignal } from "../assets/http.ts";
import { Bus } from "../bus.ts";

async function* ticks(period: number, signal: AbortSignal) {
  while (!signal.aborted) {
    yield;
    await delay(period, signal);
  }
}

export type LobbyJoin = { room: RoomInfo; playerName: string };
type LobbyEvents = {
  roomsChanged: RoomInfo[];
  roomsError: unknown;
  joinError: string;
  roomCreated: RoomInfo;
  joined: LobbyJoin;
};

export class Lobby extends Bus<LobbyEvents> {
  #session?: AbortController;
  #pending?: Promise<void>;
  #rooms: RoomInfo[] = [];
  readonly url: string;
  readonly refreshMs: number;
  readonly timeoutMs: number;
  readonly request: typeof fetchJson;

  constructor({
    url = "/api/rooms",
    refreshMs = 4000,
    timeoutMs = 2200,
    request = fetchJson,
  }: {
    url?: string;
    refreshMs?: number;
    timeoutMs?: number;
    request?: typeof fetchJson;
  } = {}) {
    super();
    this.url = url;
    this.refreshMs = refreshMs;
    this.timeoutMs = timeoutMs;
    this.request = request;
  }

  show() {
    if (this.#session) return;
    this.#session = new AbortController();
    void this.poll(this.#session.signal);
  }

  hide() {
    this.#session?.abort();
    this.#session = undefined;
    this.#pending = undefined;
  }

  async poll(signal: AbortSignal) {
    try {
      for await (const _tick of ticks(this.refreshMs, signal)) {
        await this.refresh();
      }
    } catch (error: unknown) {
      if (!signal.aborted) this.emit("roomsError", error);
    }
  }

  refresh() {
    const session = this.#session;
    if (!session) return Promise.resolve();
    if (!this.#pending)
      this.#pending = Promise.resolve().then(() => this.readRooms(session));
    return this.#pending;
  }

  async readRooms(session: AbortController) {
    try {
      session.signal.throwIfAborted();
      const raw = await this.request(
        this.url,
        timedSignal(session.signal, this.timeoutMs),
      );
      if (this.#session !== session) return;
      const rooms = RoomSchema.array().parse(raw);
      this.#rooms = rooms;
      this.emit("roomsChanged", rooms);
    } catch (error: unknown) {
      if (this.#session === session && !session.signal.aborted)
        this.emit("roomsError", error);
    } finally {
      if (this.#session === session) this.#pending = undefined;
    }
  }

  async create(name: string, preset: CreateRoom["preset"]) {
    const session = this.#session;
    if (!session) return;
    try {
      const raw = await this.request(
        this.url,
        timedSignal(session.signal, this.timeoutMs),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim(), preset }),
        },
      );
      await this.#pending;
      if (this.#session !== session) return;
      const room = RoomSchema.parse(raw);
      this.#rooms = [
        ...this.#rooms.filter((item) => item.id !== room.id),
        room,
      ];
      this.emit("roomsChanged", this.#rooms);
      this.emit("roomCreated", room);
    } catch (error: unknown) {
      if (this.#session !== session) return;
      const reason =
        error instanceof HttpError && error.status === 409
          ? "Досягнуто ліміту кімнат."
          : error instanceof HttpError && error.status === 400
            ? "Перевірте назву кімнати й арену."
            : "Не вдалося створити кімнату.";
      this.emit("joinError", reason);
    }
  }

  join(roomId: string, name: string) {
    if (!this.#session) return false;
    const room = this.#rooms.find((item) => item.id === roomId);
    const playerName = name.trim();
    if (!room || !playerName || playerName.length > 24) {
      this.emit(
        "joinError",
        "Оберіть кімнату та введіть ім’я від 1 до 24 символів.",
      );
      return false;
    }
    this.hide();
    this.emit("joined", { room, playerName });
    return true;
  }
}
