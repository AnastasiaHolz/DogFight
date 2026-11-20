import { decodeSnapshot, encodeInput } from "@dogfight/shared/codec/binary";
import { encodeJson } from "@dogfight/shared/codec/json";
import type {
  CodecName,
  Input,
  ServerMessage,
  Snapshot,
} from "@dogfight/shared/protocol";
import { parseServerMessage, unreachable } from "@dogfight/shared/protocol";
import { Bus } from "../bus.ts";
import type { NetworkSettings } from "./settings.ts";

const terminalCodes = new Set([1000, 1003, 1007, 1008, 1009, 4403, 4404, 4429]);
const reasons: Readonly<Record<number, string>> = {
  4403: "У кімнаті вже немає вільних місць.",
  4404: "Кімнату закрито або вона більше не існує.",
  4429: "Надіслано забагато повідомлень.",
};

export function webSocketUrl(location: Pick<Location, "href" | "protocol">) {
  const url = new URL("/ws", location.href);
  url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
}

type SocketPort = Pick<
  WebSocket,
  "binaryType" | "readyState" | "bufferedAmount" | "send" | "close"
> &
  EventTarget;
type SocketConstructor = {
  new (url: string): SocketPort;
  readonly OPEN: number;
};
type Incoming<K extends ServerMessage["type"]> = Extract<
  ServerMessage,
  { type: K }
>;
type ConnectionEvents = {
  status: string;
  terminal: string;
  joined: Incoming<"joined">;
  roster: Incoming<"roster">;
  chat: Incoming<"chat">;
  snapshot: Snapshot;
  pong: Incoming<"pong">;
  traffic: { sent?: number; received?: number };
};
type Transport = Pick<NetworkSettings, "latency" | "jitter" | "loss">;

export class RoomConnection extends Bus<ConnectionEvents> {
  readonly url: string;
  readonly room: string;
  readonly name: string;
  readonly Socket: SocketConstructor;
  readonly backoff: number;
  readonly maxBackoff: number;
  readonly network: Transport;
  #socket?: SocketPort;
  #gameTimers = new Set<ReturnType<typeof setTimeout>>();
  #codec: CodecName = "binary";
  #queue: string[] = [];
  #attempt = 0;
  #timer?: ReturnType<typeof setTimeout>;
  #pumpTimer?: ReturnType<typeof setTimeout>;
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
  }: {
    url: string;
    room: string;
    name: string;
    Socket?: SocketConstructor;
    backoff?: number;
    maxBackoff?: number;
    network?: Transport;
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
    this.emit("status", "Підключення до сервера…");

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

    socket.addEventListener("message", (event: Event) => {
      if (this.#socket !== socket || !("data" in event)) return;
      const data: unknown = event.data;
      if (data instanceof ArrayBuffer) {
        this.emit("traffic", { received: data.byteLength });
        if (this.#joined)
          this.#later(socket, () => this.#readSnapshot(data), true);
        return;
      }
      if (typeof data !== "string") return;
      const result = parseServerMessage(data);
      if (!result.ok) return;
      const message = result.value;

      switch (message.type) {
        case "snapshot":
          this.emit("traffic", {
            received: new TextEncoder().encode(data).byteLength,
          });
          if (this.#joined)
            this.#later(socket, () => this.emit("snapshot", message), true);
          return;
        case "pong":
          this.#later(socket, () => this.emit("pong", message), false);
          return;
        case "joined":
          this.#joined = true;
          this.#codec = message.codec;
          this.#attempt = 0;
          this.emit("status", "Підключено.");
          this.emit("joined", message);
          break;
        case "roster":
          this.emit("roster", message);
          break;
        case "chat":
          this.emit("chat", message);
          break;
        default:
          return unreachable(message);
      }
      this.#flush();
    });

    socket.addEventListener("error", () => {
      if (this.#socket === socket) this.emit("status", "З’єднання перервано.");
    });
    socket.addEventListener("close", (event: Event) => {
      const code =
        "code" in event && typeof event.code === "number" ? event.code : 1006;
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
        this.emit("terminal", reasons[code] ?? "Сервер закрив з’єднання.");
        return;
      }
      const wait = Math.min(this.maxBackoff, this.backoff * 2 ** this.#attempt);
      this.#attempt += 1;
      this.emit("status", `З’єднання втрачено. Повтор через ${wait} мс…`);
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

  #later(socket: SocketPort, work: () => void, droppable: boolean) {
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

  #readSnapshot(data: ArrayBuffer) {
    try {
      this.emit("snapshot", decodeSnapshot(data));
    } catch (_error: unknown) {}
  }

  get ready() {
    return this.#joined && this.#socket?.readyState === this.Socket.OPEN;
  }

  sendInput(input: Input) {
    const socket = this.#socket;
    if (!this.ready || !socket) return false;
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
        this.emit("traffic", { sent: bytes });
      },
      true,
    );
    return true;
  }

  probe(id: number) {
    const socket = this.#socket;
    if (!this.ready || !socket) return;
    this.#later(
      socket,
      () => {
        if (socket.readyState === this.Socket.OPEN)
          socket.send(encodeJson({ v: 1, type: "ping", id }));
      },
      false,
    );
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

    if (socket.bufferedAmount <= 64 * 1024) {
      const next = this.#queue.shift();
      if (next) socket.send(next);
    }
    this.#pumpTimer = setTimeout(() => {
      this.#pumpTimer = undefined;
      this.#flush();
    }, 150);
  }

  send(text: string) {
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
