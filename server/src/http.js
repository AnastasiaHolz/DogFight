import { Buffer } from "node:buffer";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { streamReplay } from "./log/replay.js";
import { cleanText } from "./protocol.js";
import { PRESETS } from "./rooms.js";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wav": "audio/wav",
  ".ico": "image/x-icon",
};
const BODY_LIMIT = 2048;

export class HttpProblem extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(response, status, value) {
  const data = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": data.byteLength,
    "Cache-Control": "no-store",
  });
  response.end(data);
}

export function safePath(target = "") {
  const raw = target.split("?")[0];
  let decoded;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    throw new HttpProblem(400, "Malformed path");
  }
  if (
    !decoded.startsWith("/") ||
    decoded.startsWith("//") ||
    ["\\", "\0", ":", "%"].some((value) => decoded.includes(value)) ||
    decoded.split("/").includes("..")
  ) {
    throw new HttpProblem(400, "Invalid path");
  }
  return decoded;
}

function inside(root, target) {
  const path = relative(root, target);
  return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

async function serveStatic(root, path, request, response) {
  const filename = path === "/" ? "index.html" : path.slice(1);
  const candidate = resolve(root, filename);
  if (!inside(root, candidate)) throw new HttpProblem(400, "Invalid path");

  let file;
  let info;
  try {
    const canonical = await realpath(root);
    file = await realpath(candidate);
    if (!inside(canonical, file)) throw new HttpProblem(400, "Invalid path");
    info = await stat(file);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return false;
    throw error;
  }
  if (!info.isFile()) return false;

  response.writeHead(200, {
    "Content-Type": MIME[extname(file)] ?? "application/octet-stream",
    "Content-Length": info.size,
    "X-Content-Type-Options": "nosniff",
  });
  if (request.method === "HEAD") response.end();
  else await pipeline(createReadStream(file), response);
  return true;
}

function oversized(request, response) {
  response.setHeader("Connection", "close");
  request.resume();
  throw new HttpProblem(413, "Body too large");
}

async function readJson(request, response) {
  if (
    !/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] ?? "")
  ) {
    throw new HttpProblem(415, "Content-Type must be application/json");
  }
  if (Number(request.headers["content-length"]) > BODY_LIMIT)
    oversized(request, response);
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    bytes += chunk.byteLength;
    if (bytes > BODY_LIMIT) oversized(request, response);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks, bytes).toString("utf8"));
  } catch {
    throw new HttpProblem(400, "Invalid JSON");
  }
}

function method(response, options) {
  response.setHeader("Allow", options);
  json(response, 405, { error: "Method not allowed" });
}

async function route(request, response, config, rooms) {
  const path = safePath(request.url);
  if (path === "/health") {
    if (request.method !== "GET") return method(response, "GET");
    return json(response, 200, { status: "ok" });
  }
  if (path === "/api/rooms") {
    if (request.method === "GET") return json(response, 200, rooms.list());
    if (request.method !== "POST") return method(response, "GET, POST");

    const data = await readJson(request, response);
    const name = cleanText(data?.name, 40, 160);
    const preset = data?.preset ?? "orbit";
    if (
      !name ||
      !Object.keys(data).every((key) => key === "name" || key === "preset") ||
      typeof preset !== "string" ||
      !Object.hasOwn(PRESETS, preset)
    ) {
      throw new HttpProblem(400, "Invalid room name or preset");
    }
    const room = rooms.create({ name, preset });
    if (!room) throw new HttpProblem(409, "Room limit reached");
    return json(response, 201, room.info());
  }
  if (path.startsWith("/api/replays/")) {
    if (request.method !== "GET" && request.method !== "HEAD")
      return method(response, "GET, HEAD");
    const id = path.slice("/api/replays/".length);
    if (await streamReplay(config.logDir, id, request, response)) return;
    throw new HttpProblem(404, "Replay not found");
  }
  if (path === "/api/slow" && config.demo) {
    if (request.method !== "GET") return method(response, "GET");
    const deadline = performance.now() + 300;
    while (performance.now() < deadline) {}
    return json(response, 200, { blockedMs: 300 });
  }
  if (path.startsWith("/api/"))
    throw new HttpProblem(404, "API route not found");
  if (request.method !== "GET" && request.method !== "HEAD")
    return method(response, "GET, HEAD");
  if (await serveStatic(config.clientDir, path, request, response)) return;
  throw new HttpProblem(
    404,
    path === "/" ? "Client not built. Run npm run build." : "File not found",
  );
}

export function httpHandler(config, rooms, onError) {
  return (request, response) => {
    void route(request, response, config, rooms).catch((error) => {
      if (
        error instanceof HttpProblem &&
        !response.headersSent &&
        !response.destroyed
      ) {
        json(response, error.status, { error: error.message });
      } else if (
        error.code !== "ERR_STREAM_PREMATURE_CLOSE" &&
        error.code !== "ECONNRESET"
      ) {
        onError("http request", error);
        if (!response.headersSent && !response.destroyed)
          json(response, 500, { error: "Internal error" });
        else response.destroy();
      }
    });
  };
}
