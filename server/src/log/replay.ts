import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { errorCode, parseJson } from "@dogfight/shared/protocol";

export function replayPath(directory: string, id: string) {
  if (!/^[a-z0-9-]{1,90}$/.test(id)) return null;
  return join(directory, `${id}.ndjson`);
}

export async function* replayEvents(file: string): AsyncGenerator<unknown> {
  const stream = createReadStream(file, { encoding: "utf8" });
  let tail = "";
  for await (const chunk of stream) {
    const value: unknown = chunk;
    if (typeof value !== "string") throw new TypeError("Expected UTF-8 replay");
    const lines = (tail + value).split("\n");
    tail = lines.pop() ?? "";
    if (tail.length > 64 * 1024) throw new Error("Replay line is too long");
    for (const line of lines) {
      if (line.trim()) yield readLine(line);
    }
  }
  if (tail.trim()) yield readLine(tail);
}

function readLine(text: string): unknown {
  const row = parseJson(text);
  if (!row.ok) throw new SyntaxError(row.message);
  return row.value;
}

export async function streamReplay(
  directory: string,
  id: string,
  request: IncomingMessage,
  response: ServerResponse,
) {
  const file = replayPath(directory, id);
  if (!file) return false;
  const info = await stat(file).catch((error: unknown) => {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  });
  if (!info?.isFile()) return false;

  response.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Content-Length": info.size,
    "Content-Disposition": `attachment; filename="${id}.ndjson"`,
    "Cache-Control": "no-store",
  });
  if (request.method === "HEAD") response.end();
  else await pipeline(createReadStream(file), response);
  return true;
}
