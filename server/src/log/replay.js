import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";

export function replayPath(directory, id) {
  if (!/^[a-z0-9-]{1,90}$/.test(id)) return null;
  return join(directory, `${id}.ndjson`);
}

export async function* replayEvents(file) {
  const stream = createReadStream(file, { encoding: "utf8" });
  let tail = "";
  for await (const chunk of stream) {
    const lines = (tail + chunk).split("\n");
    tail = lines.pop();
    if (tail.length > 64 * 1024) throw new Error("Replay line is too long");
    for (const line of lines) {
      if (line.trim()) yield JSON.parse(line);
    }
  }
  if (tail.trim()) yield JSON.parse(tail);
}

export async function streamReplay(directory, id, request, response) {
  const file = replayPath(directory, id);
  if (!file) return false;
  const info = await stat(file).catch((error) => {
    if (error.code === "ENOENT") return null;
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
