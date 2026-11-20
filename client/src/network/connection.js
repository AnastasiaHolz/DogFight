import { decodeSnapshot, encodeInput } from "@dogfight/shared/codec/binary";
import { decodeJsonSnapshot, encodeJson } from "@dogfight/shared/codec/json";

const terminalCodes = new Set([1000, 1003, 1007, 1008, 1009, 4403, 4404, 4429]);
const events = new Set(["joined", "roster", "chat"]);
const reasons = {
  4403: "У кімнаті вже немає вільних місць.",
  4404: "Кімнату закрито або вона більше не існує.",
  4429: "Надіслано забагато повідомлень.",
};

export function webSocketUrl(location) {
  const url = new URL("/ws", location.href);
  url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
}

export class RoomConnection extends EventTarget {
  #socket;
  #gameTimers = new Set();
  #codec;
  #queue = [];
  #attempt = 0;
  #timer;
  #pumpTimer;
  #joined = false;
  #stopped = false;

  constructor({
    url,
    room,
    name,
    Socket = WebSocket,
    backoff = 250,
    maxBackoff = 4000,
    network = { latency: 0, jitter: 0, loss: 0 },
  }) {
    super();
    this.url = url;
    this.room = room;
    this.name = name;
    this.Socket = Socket;
    this.backoff = backoff;
    this.maxBackoff = maxBackoff;
    this.network = network;
  }

  connect() {
    if (this.#stopped || this.#socket || this.#timer !== undefined) return;
    const socket = new this.Socket(this.url);
    this.#socket = socket;
    socket.binaryType = "arraybuffer";
    this.#emit("status", "Підключення до сервера…");

    socket.addEventListener("open", () => {
      if (this.#socket !== socket) return;
      socket.send(
        JSON.stringify({
          v: 0,
          type: "join",
          room: this.room,
          name: this.name,
        }),
      );
    });

    socket.addEventListener("message", ({ data }) => {
      if (this.#socket !== socket) return;
      if (data instanceof ArrayBuffer) {
        this.#emit("traffic", { received: data.byteLength });
        if (this.#joined)
          this.#later(socket, () => this.#readSnapshot(data), true);
        return;
      }
      let message;
      try {
        message = JSON.parse(data);
      } catch {
        return;
      }
      if (message?.v === 1 && message.type === "snapshot") {
        this.#emit("traffic", {
          received: new TextEncoder().encode(data).byteLength,
        });
        if (this.#joined)
          this.#later(socket, () => this.#readSnapshot(data), true);
        return;
      }
      if (message?.v === 1 && message.type === "pong") {
        this.#later(socket, () => this.#emit("pong", message), false);
        return;
      }
      if (message?.v !== 0 || !events.has(message.type)) return;
      if (message.type === "joined") {
        this.#joined = true;
        this.#codec = message.codec;
        this.#attempt = 0;
        this.#emit("status", "Підключено.");
      }
      this.#emit(message.type, message);
      this.#flush();
    });

    socket.addEventListener("error", () => {
      if (this.#socket === socket) this.#emit("status", "З’єднання перервано.");
    });
    socket.addEventListener("close", ({ code }) => {
      if (this.#socket !== socket) return;
      this.#socket = undefined;
      this.#joined = false;
      this.#clearGameTimers();
      clearTimeout(this.#pumpTimer);
      this.#pumpTimer = undefined;
      if (this.#stopped) return;
      if (terminalCodes.has(code)) {
        this.#stopped = true;
        this.#queue.length = 0;
        this.#emit("terminal", reasons[code] ?? "Сервер закрив з’єднання.");
        return;
      }
      const wait = Math.min(this.maxBackoff, this.backoff * 2 ** this.#attempt);
      this.#attempt += 1;
      this.#emit("status", `З’єднання втрачено. Повтор через ${wait} мс…`);
      this.#timer = setTimeout(() => {
        this.#timer = undefined;
        this.connect();
      }, wait);
    });
  }

  #clearGameTimers() {
    for (const timer of this.#gameTimers) clearTimeout(timer);
    this.#gameTimers.clear();
  }

  #later(socket, work, droppable) {
    if (
      droppable &&
      this.network.loss > 0 &&
      Math.random() * 100 < this.network.loss
    )
      return;
    const spread = this.network.jitter
      ? (Math.random() * 2 - 1) * this.network.jitter
      : 0;
    const delay = Math.max(0, this.network.latency + spread);
    if (!delay) {
      work();
      return;
    }
    if (this.#gameTimers.size >= 256) return;
    const task = setTimeout(() => {
      this.#gameTimers.delete(task);
      if (this.#socket === socket) work();
    }, delay);
    this.#gameTimers.add(task);
  }

  #readSnapshot(data) {
    try {
      this.#emit(
        "snapshot",
        typeof data === "string"
          ? decodeJsonSnapshot(data)
          : decodeSnapshot(data),
      );
    } catch {}
  }

  get ready() {
    return this.#joined && this.#socket?.readyState === this.Socket.OPEN;
  }

  sendInput(input) {
    if (!this.ready) return false;
    const socket = this.#socket;
    const packet =
      this.#codec === "json" ? encodeJson(input) : encodeInput(input);
    const bytes =
      typeof packet === "string"
        ? new TextEncoder().encode(packet).byteLength
        : packet.byteLength;
    this.#later(
      socket,
      () => {
        if (
          socket.readyState !== this.Socket.OPEN ||
          socket.bufferedAmount > 64 * 1024
        )
          return;
        socket.send(packet);
        this.#emit("traffic", { sent: bytes });
      },
      true,
    );
    return true;
  }

  probe(id) {
    if (!this.ready) return;
    const socket = this.#socket;
    this.#later(
      socket,
      () => {
        if (socket.readyState === this.Socket.OPEN)
          socket.send(encodeJson({ v: 1, type: "ping", id }));
      },
      false,
    );
  }

  #emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }

  #flush() {
    const socket = this.#socket;
    if (
      this.#pumpTimer !== undefined ||
      !this.#joined ||
      socket?.readyState !== this.Socket.OPEN ||
      this.#queue.length === 0
    )
      return;

    if (socket.bufferedAmount <= 64 * 1024) socket.send(this.#queue.shift());
    this.#pumpTimer = setTimeout(() => {
      this.#pumpTimer = undefined;
      this.#flush();
    }, 150);
  }

  send(text) {
    const clean = text.trim();
    if (
      this.#stopped ||
      !clean ||
      clean.length > 240 ||
      this.#queue.length >= 16
    )
      return false;
    this.#queue.push(JSON.stringify({ v: 0, type: "chat", text: clean }));
    this.#flush();
    return true;
  }

  stop() {
    this.#stopped = true;
    this.#clearGameTimers();
    clearTimeout(this.#timer);
    clearTimeout(this.#pumpTimer);
    this.#timer = undefined;
    this.#pumpTimer = undefined;
    this.#queue.length = 0;
    const socket = this.#socket;
    this.#socket = undefined;
    if (!socket) return;
    if (this.#joined && socket.readyState === this.Socket.OPEN) {
      socket.send(JSON.stringify({ v: 0, type: "leave" }));
      this.#joined = false;
    }
    socket.close(1000, "User left");
  }
}
