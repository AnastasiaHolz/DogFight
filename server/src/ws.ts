import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { binaryCodec } from "@dogfight/shared/codec/binary";
import { encodeJson, jsonCodec } from "@dogfight/shared/codec/json";
import type {
  ClientMessage,
  CodecName,
  Player,
  ServerMessage,
} from "@dogfight/shared/protocol";
import { parseClientMessage, unreachable } from "@dogfight/shared/protocol";
import { WebSocket, WebSocketServer } from "ws";
import { Match } from "./match.ts";
import type { RateOptions } from "./protocol.ts";
import { CLOSE, MAX_PAYLOAD, tokenBucket, VERSION } from "./protocol.ts";
import type { Room, RoomManager } from "./rooms.ts";

const MAX_QUEUED_BYTES = 64 * 1024;
type SocketWriter = Pick<
  WebSocket,
  "readyState" | "bufferedAmount" | "close" | "send" | "terminate"
>;
type Unversioned<T> = T extends { v: 0 } ? Omit<T, "v"> : never;
export type ErrorLogger = (scope: string, error: unknown) => void;
export type SocketOptions = {
  joinMs?: number;
  heartbeatMs?: number;
  onError?: ErrorLogger;
  rateOptions?: RateOptions;
  matches?: Map<string, Match>;
  onReject?: (message: string) => void;
};
type Peer = {
  allowed: () => boolean;
  allowedInput: () => boolean;
  codec: CodecName;
  waitingPong: boolean;
  missed: number;
  session?: { room: Room; match: Match; player: Player };
};

function sendFrame(
  socket: SocketWriter,
  frame: string | ArrayBuffer,
  critical = false,
) {
  if (socket.readyState !== WebSocket.OPEN) return false;
  if (socket.bufferedAmount > MAX_QUEUED_BYTES) {
    if (critical) socket.close(CLOSE.busy, "Client cannot keep up");
    return false;
  }
  socket.send(frame, (error) => {
    if (error) socket.terminate();
  });
  return true;
}

export function send(
  socket: SocketWriter,
  message: Unversioned<ServerMessage>,
  critical = false,
) {
  return sendFrame(socket, encodeJson({ v: VERSION, ...message }), critical);
}

export function attachWebSockets(
  server: Server,
  rooms: RoomManager,
  {
    joinMs = 5000,
    heartbeatMs = 15_000,
    onError = console.error,
    rateOptions,
    matches = new Map(),
    onReject = console.warn,
  }: SocketOptions = {},
) {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_PAYLOAD,
    perMessageDeflate: false,
  });
  const states = new Map<WebSocket, Peer>();
  const subscriptions = new WeakMap<Room, Set<WebSocket>>();
  let closing = false;

  wss.on("error", (error) => onError("websocket server", error));
  server.on("upgrade", (request, socket, head) => {
    if (closing || request.url?.split("?")[0] !== "/ws") {
      const status = closing ? "503 Service Unavailable" : "404 Not Found";
      socket.end(
        `HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
      );
      return;
    }
    wss.handleUpgrade(request, socket, head, (client) =>
      wss.emit("connection", client, request),
    );
  });

  function watchRoom(room: Room): Set<WebSocket> {
    const previous = subscriptions.get(room);
    if (previous) return previous;
    const members = new Set<WebSocket>();
    subscriptions.set(room, members);
    const roster = () => {
      for (const member of members)
        send(member, { type: "roster", players: room.players }, true);
    };
    room.on("join", roster);
    room.on("leave", roster);
    room.on("chat", ({ player, text }) => {
      for (const member of members)
        send(member, { type: "chat", player, text });
    });
    return members;
  }

  function detach(socket: WebSocket, state: Peer) {
    if (!state.session) return;
    const { room, match, player } = state.session;
    state.session = undefined;
    subscriptions.get(room)?.delete(socket);
    room.leave(player.id);
    match.leave(player.netId);
    if (!room.size) {
      match.stop();
      matches.delete(room.id);
    }
  }

  function reject(socket: WebSocket, code: number, reason: string) {
    onReject(`ws rejected ${code} ${reason}`);
    socket.close(code, reason);
  }

  function handle(
    socket: WebSocket,
    state: Peer,
    message: ClientMessage,
    deadline: NodeJS.Timeout,
  ) {
    const session = state.session;
    switch (message.type) {
      case "join": {
        if (session) return reject(socket, CLOSE.badMessage, "Already joined");
        const room = rooms.get(message.room);
        if (!room) return reject(socket, CLOSE.missing, "Room not found");
        if (room.size >= room.maxPlayers)
          return reject(socket, CLOSE.full, "Room full");
        let match = matches.get(room.id);
        if (!match) {
          match = new Match(room.arena);
          matches.set(room.id, match);
          match.start();
        }
        const netId = match.join((snapshot) => {
          const packet =
            state.codec === "json"
              ? jsonCodec.encodeSnapshot(snapshot)
              : binaryCodec.encodeSnapshot(snapshot);
          sendFrame(socket, packet);
        });
        const player = { id: randomUUID(), name: message.name, netId };
        const members = watchRoom(room);
        room.join(player);
        state.session = { room, match, player };
        members.add(socket);
        clearTimeout(deadline);
        send(
          socket,
          {
            type: "joined",
            room: room.info(),
            player,
            replayId: room.replayId,
            seed: match.seed,
            codec: state.codec,
          },
          true,
        );
        send(socket, { type: "roster", players: room.players }, true);
        return;
      }
      case "input":
        if (!session) return reject(socket, CLOSE.badMessage, "Join first");
        session.match.accept(session.player.netId, message);
        return;
      case "ping":
        if (!session) return reject(socket, CLOSE.badMessage, "Join first");
        sendFrame(socket, encodeJson({ v: 1, type: "pong", id: message.id }));
        return;
      case "chat":
        if (!session) return reject(socket, CLOSE.badMessage, "Join first");
        session.room.chat(session.player.id, message.text);
        return;
      case "leave":
        if (!session) return reject(socket, CLOSE.badMessage, "Join first");
        detach(socket, state);
        socket.close(1000, "Left room");
        return;
      default:
        return unreachable(message);
    }
  }

  wss.on("connection", (socket, request) => {
    const state: Peer = {
      allowed: tokenBucket(rateOptions),
      allowedInput: tokenBucket({ rate: 45, burst: 24 }),
      codec:
        new URL(request.url ?? "/ws", "http://localhost").searchParams.get(
          "codec",
        ) === "json"
          ? "json"
          : "binary",
      waitingPong: false,
      missed: 0,
    };
    states.set(socket, state);
    const deadline = setTimeout(
      () => reject(socket, CLOSE.joinTimeout, "Join deadline"),
      joinMs,
    );
    deadline.unref();
    socket.on("error", (error) => {
      if ("code" in error && error.code === "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH")
        onReject("ws rejected 1009 Message too large");
      else onError("websocket connection", error);
    });
    socket.on("pong", () => {
      state.waitingPong = false;
      state.missed = 0;
    });
    socket.once("close", () => {
      clearTimeout(deadline);
      detach(socket, state);
      states.delete(socket);
    });
    socket.on("message", (data, binary) => {
      if (socket.readyState !== WebSocket.OPEN || closing) return;
      const bytes = Array.isArray(data)
        ? Buffer.concat(data)
        : Buffer.isBuffer(data)
          ? data
          : Buffer.from(data);
      let message: ClientMessage;
      if (binary) {
        if (!state.allowedInput())
          return reject(socket, CLOSE.rate, "Input rate exceeded");
        if (!state.session || state.codec !== "binary")
          return reject(socket, CLOSE.badMessage, "Wrong binary packet");
        try {
          message = binaryCodec.decodeInput(bytes);
        } catch (_error: unknown) {
          return reject(socket, CLOSE.badMessage, "Invalid input packet");
        }
      } else {
        const parsed = parseClientMessage(bytes.toString("utf8"));
        if (!parsed.ok) {
          return reject(
            socket,
            parsed.reason === "json" ? CLOSE.invalidJson : CLOSE.badMessage,
            parsed.reason === "json"
              ? "Invalid JSON"
              : "Invalid message shape or version",
          );
        }
        message = parsed.value;
        const allowed =
          message.type === "input" ? state.allowedInput : state.allowed;
        if (!allowed())
          return reject(socket, CLOSE.rate, "Rate limit exceeded");
        if (message.type === "input" && state.codec !== "json")
          return reject(socket, CLOSE.badMessage, "Wrong codec");
      }

      try {
        handle(socket, state, message, deadline);
      } catch (error: unknown) {
        onError("websocket message", error);
        socket.close(1011, "Internal error");
      }
    });
  });

  const timer = setInterval(() => {
    for (const [socket, state] of states) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      if (state.waitingPong) state.missed += 1;
      if (state.missed >= 2) socket.terminate();
      else {
        state.waitingPong = true;
        socket.ping();
      }
    }
  }, heartbeatMs);
  timer.unref();

  return {
    stop() {
      closing = true;
      clearInterval(timer);
      for (const socket of states.keys())
        socket.close(1001, "Server shutting down");
      return new Promise<void>((resolve) => wss.close(() => resolve()));
    },
    terminate() {
      for (const socket of states.keys()) socket.terminate();
    },
  };
}
