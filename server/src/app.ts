import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { ServerConfig } from "./config.ts";
import { httpHandler } from "./http.ts";
import type { Match } from "./match.ts";
import type { RoomManagerOptions } from "./rooms.ts";
import { RoomManager } from "./rooms.ts";
import type { ErrorLogger, SocketOptions } from "./ws.ts";
import { attachWebSockets } from "./ws.ts";

export async function createApp(
  config: ServerConfig,
  {
    rooms: roomOptions,
    sockets,
    onError = console.error,
  }: {
    rooms?: Partial<RoomManagerOptions>;
    sockets?: SocketOptions;
    onError?: ErrorLogger;
  } = {},
) {
  await mkdir(config.logDir, { recursive: true });
  const rooms = new RoomManager({
    logDir: config.logDir,
    onError,
    ...roomOptions,
  });
  const matches = new Map<string, Match>();
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

  let stopping: Promise<undefined> | undefined;
  return {
    start() {
      return new Promise<AddressInfo>((resolve, reject) => {
        server.once("error", reject);
        server.listen(config.port, config.host, () => {
          server.off("error", reject);
          const address = server.address();
          if (address && typeof address !== "string") resolve(address);
          else reject(new Error("Server did not open a TCP address"));
        });
      });
    },
    stop() {
      if (stopping) return stopping;

      const httpClosed = new Promise<void>((resolve) =>
        server.close(() => resolve()),
      );
      server.closeIdleConnections();
      const complete = ws.stop().then(() => rooms.shutdown());
      const force = setTimeout(() => {
        ws.terminate();
        server.closeAllConnections();
      }, 2500);

      stopping = Promise.all([httpClosed, complete])
        .then(() => undefined)
        .finally(() => clearTimeout(force));
      return stopping;
    },
  };
}
