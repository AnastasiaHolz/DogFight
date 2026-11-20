import { resolve } from "node:path";
import { defineConfig, loadEnv } from "vite";

function installRoutes(server) {
  server.middlewares.use((request, response, next) => {
    if (request.method !== "GET" || !request.url) return next();
    const url = new URL(request.url, "http://localhost");

    if (url.pathname === "/__lab03/missing-sprite") {
      response.statusCode = 404;
      response.end("Sprite not found");
      return;
    }
    if (url.pathname === "/__lab03/bad-json") {
      response.setHeader("Content-Type", "application/json");
      response.end('{"width":');
      return;
    }

    const delays = { bench: 120, timeout: 1300, abort: 3500 };
    const delay = delays[url.searchParams.get("labDelay")];
    if (url.pathname.startsWith("/assets/") && Number.isInteger(delay)) {
      const timer = setTimeout(next, delay);
      response.once("close", () => clearTimeout(timer));
      return;
    }
    next();
  });
}

export default defineConfig(({ mode }) => {
  const root = resolve(import.meta.dirname, "..");
  const env = loadEnv(mode, root, "");
  const port = process.env.PORT ?? env.PORT ?? "3000";
  const host = process.env.HOST ?? env.HOST ?? "127.0.0.1";
  const targetHost =
    host === "::"
      ? "[::1]"
      : host === "0.0.0.0"
        ? "127.0.0.1"
        : host.includes(":")
          ? `[${host}]`
          : host;
  const target = `http://${targetHost}:${port}`;
  return {
    envDir: root,
    server: {
      proxy: {
        "/api": target,
        "/health": target,
        "/ws": { target, ws: true },
      },
    },
    plugins: [
      {
        name: "dogfight-asset-diagnostics",
        configureServer: installRoutes,
      },
    ],
  };
});
