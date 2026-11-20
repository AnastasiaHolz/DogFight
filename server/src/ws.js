import { randomUUID } from "node:crypto";
import { decodeInput, encodeSnapshot } from "@dogfight/shared/codec/binary";
import { decodeJsonInput, encodeJson } from "@dogfight/shared/codec/json";
import { WebSocket, WebSocketServer } from "ws";
import { Match } from "./match.js";
import {
  CLOSE,
  decode,
  MAX_PAYLOAD,
  ProtocolError,
  tokenBucket,
  VERSION,
} from "./protocol.js";

const MAX_QUEUED_BYTES = 64 * 1024;

function sendFrame(socket, frame, critical = false) {
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

export function send(socket, message, critical = false) {
  return sendFrame(
    socket,
    JSON.stringify({ v: VERSION, ...message }),
    critical,
  );
}

export function attachWebSockets(
  server,
  rooms,
  {
    joinMs = 5000,
    heartbeatMs = 15_000,
    onError = console.error,
    rateOptions,
    matches = new Map(),
    onReject = console.warn,
  } = {},
) {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_PAYLOAD,
    perMessageDeflate: false,
  });
  const states = new Map();
  const subscriptions = new WeakMap();
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

  function watchRoom(room) {
    if (subscriptions.has(room)) return subscriptions.get(room);
    const members = new Set();
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

  function detach(socket, state) {
    if (!state.room) return;
    const { room, player } = state;
    state.room = undefined;
    subscriptions.get(room)?.delete(socket);
    room.leave(player.id);
    state.match.leave(player.netId);
    if (room.size === 0) {
      state.match.stop();
      matches.delete(room.id);
    }
  }

  function reject(socket, code, reason) {
    onReject(`ws rejected ${code} ${reason}`);
    socket.close(code, reason);
  }

  wss.on("connection", (socket, request) => {
    const state = {
      allowed: tokenBucket(rateOptions),
      allowedInput: tokenBucket({ rate: 45, burst: 24 }),
      codec:
        new URL(request.url, "http://localhost").searchParams.get("codec") ===
        "json"
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
      if (error.code === "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH")
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
      try {
        const text = binary ? "" : data.toString("utf8");
        let header;
        if (!binary) {
          try {
            header = JSON.parse(text);
          } catch {}
        }
        if (binary || (header?.v === 1 && header.type === "input")) {
          if (!state.room)
            throw new ProtocolError(CLOSE.badMessage, "Join first");
          if (!state.allowedInput())
            throw new ProtocolError(CLOSE.rate, "Input rate exceeded");
          if (binary !== (state.codec === "binary"))
            throw new ProtocolError(CLOSE.badMessage, "Wrong codec");
          let input;
          try {
            input = binary ? decodeInput(data) : decodeJsonInput(text);
          } catch {
            throw new ProtocolError(CLOSE.badMessage, "Invalid input packet");
          }
          state.match.accept(state.player.netId, input);
          return;
        }

        if (!state.allowed())
          throw new ProtocolError(CLOSE.rate, "Rate limit exceeded");
        if (header?.v === 1 && header.type === "ping") {
          if (
            !state.room ||
            Object.keys(header).length !== 3 ||
            !Number.isInteger(header.id) ||
            header.id < 1 ||
            header.id > 0xffffffff
          ) {
            throw new ProtocolError(CLOSE.badMessage, "Invalid ping");
          }
          sendFrame(socket, encodeJson({ v: 1, type: "pong", id: header.id }));
          return;
        }

        const message = decode(data, binary);
        if (message.type === "join") {
          if (state.room)
            throw new ProtocolError(CLOSE.badMessage, "Already joined");
          const room = rooms.get(message.room);
          if (!room) throw new ProtocolError(CLOSE.missing, "Room not found");
          if (room.size >= room.maxPlayers)
            throw new ProtocolError(CLOSE.full, "Room full");
          let match = matches.get(room.id);
          if (!match) {
            match = new Match(room.arena);
            matches.set(room.id, match);
            match.start();
          }
          const netId = match.join((snapshot) => {
            const packet =
              state.codec === "json"
                ? encodeJson(snapshot)
                : encodeSnapshot(snapshot);
            sendFrame(socket, packet);
          });
          const player = { id: randomUUID(), name: message.name, netId };
          const members = watchRoom(room);
          room.join(player);
          state.room = room;
          state.match = match;
          state.player = player;
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

        if (!state.room)
          throw new ProtocolError(CLOSE.badMessage, "Join first");
        if (message.type === "leave") {
          detach(socket, state);
          socket.close(1000, "Left room");
        } else {
          state.room.chat(state.player.id, message.text);
        }
      } catch (error) {
        if (error instanceof ProtocolError)
          reject(socket, error.code, error.message);
        else {
          onError("websocket message", error);
          socket.close(1011, "Internal error");
        }
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
      return new Promise((resolve) => wss.close(() => resolve()));
    },
    terminate() {
      for (const socket of states.keys()) socket.terminate();
    },
  };
}
