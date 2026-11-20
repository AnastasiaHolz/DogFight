import { isIP } from "node:net";
import { resolve } from "node:path";

export const projectRoot = resolve(import.meta.dirname, "../..");

export function readConfig(env = process.env, root = projectRoot) {
  const port = env.PORT ?? "3000";
  if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  const host = env.HOST ?? "127.0.0.1";
  if (host !== "localhost" && !isIP(host)) {
    throw new Error("HOST must be localhost or an IP address");
  }

  const logPath = env.LOG_DIR ?? "logs";
  if (
    logPath.trim() !== logPath ||
    logPath.length === 0 ||
    logPath.includes("\0")
  ) {
    throw new Error("LOG_DIR must be a nonempty directory path");
  }

  const demo = env.LAB04_DEMO ?? "0";
  if (demo !== "0" && demo !== "1")
    throw new Error("LAB04_DEMO must be 0 or 1");
  if (demo === "1" && !["127.0.0.1", "::1", "localhost"].includes(host)) {
    throw new Error("LAB04_DEMO requires a loopback HOST");
  }

  return {
    port: Number(port),
    host,
    logDir: resolve(root, logPath),
    clientDir: resolve(root, "client/dist"),
    demo: demo === "1",
  };
}
