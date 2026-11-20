import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { httpHandler } from "./http.js";
import { RoomManager } from "./rooms.js";
import { attachWebSockets } from "./ws.js";

export async function createApp(
  config,
  { rooms: roomOptions, sockets, onError = console.error } = {},
) {
  await mkdir(config.logDir, { recursive: true });
  const rooms = new RoomManager({
    logDir: config.logDir,
    onError,
    ...roomOptions,
  });
  const matches = new Map();
  const server = createServer(
    { requestTimeout: 10_000, headersTimeout: 8_000 },
    httpHandler(config, rooms, onError, matches),
  );

  server.on("error", (error) => {
    if (server.listening) onError("http server", error);
  });
  server.on("clientError", (_error, socket) => {
    if (socket.writable)
      socket.end(
        "HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
      );
    else socket.destroy();
  });
  const ws = attachWebSockets(server, rooms, { onError, matches, ...sockets });

  let stopping;
  return {
    start() {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(config.port, config.host, () => {
          server.off("error", reject);
          resolve(server.address());
        });
      });
    },
    stop() {
      if (stopping) return stopping;

      const httpClosed = new Promise((resolve) =>
        server.close(() => resolve()),
      );
      server.closeIdleConnections();
      const complete = ws.stop().then(() => rooms.shutdown());
      const force = setTimeout(() => {
        ws.terminate();
        server.closeAllConnections();
      }, 2500);

      stopping = Promise.all([httpClosed, complete]).finally(() =>
        clearTimeout(force),
      );
      return stopping;
    },
  };
}
