import { delay, fetchJson, timedSignal } from "../assets/http.js";

async function* ticks(period, signal) {
  while (!signal.aborted) {
    yield;
    await delay(period, signal);
  }
}

export class Lobby extends EventTarget {
  #session;
  #pending;
  #rooms = [];

  constructor({
    url = "/api/rooms",
    refreshMs = 4000,
    timeoutMs = 2200,
    request = fetchJson,
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

  async poll(signal) {
    try {
      for await (const _tick of ticks(this.refreshMs, signal)) {
        await this.refresh();
      }
    } catch (error) {
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

  async readRooms(session) {
    try {
      session.signal.throwIfAborted();
      const rooms = await this.request(
        this.url,
        timedSignal(session.signal, this.timeoutMs),
      );
      if (this.#session !== session) return;
      if (
        !Array.isArray(rooms) ||
        rooms.some(
          (room) =>
            typeof room.id !== "string" || typeof room.name !== "string",
        )
      ) {
        throw new Error("Некоректний список кімнат");
      }
      this.#rooms = rooms;
      this.emit("roomsChanged", rooms);
    } catch (error) {
      if (this.#session === session && !session.signal.aborted)
        this.emit("roomsError", error);
    } finally {
      if (this.#session === session) this.#pending = undefined;
    }
  }

  join(roomId, name) {
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

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}
