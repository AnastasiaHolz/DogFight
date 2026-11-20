import { Buffer } from "node:buffer";
import { createWriteStream } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { setTimeout as delay } from "node:timers/promises";
import { withServer } from "./worker-client.js";

const MiB = 1024 ** 2;
const FILE_MIB = 200;
const RATE_MIB = 8;
const id = "replay-benchmark";
const metadata = { t: 0, type: "chat", text: "" };
const padding = 1024 - Buffer.byteLength(JSON.stringify(metadata)) - 1;
const block = Buffer.from(
  `${JSON.stringify({ ...metadata, text: "x".repeat(padding) })}\n`.repeat(64),
);

function* blocks() {
  for (let i = 0; i < (FILE_MIB * MiB) / block.byteLength; i += 1) yield block;
}

const result = await withServer(
  "replay",
  async ({ worker, base, rss }) => {
    const start = Date.now();
    const started = performance.now();
    const samples = [{ seconds: 0, rssBytes: rss, receivedBytes: 0 }];
    let bytes = 0;
    function sample(message) {
      if (message.type === "sample") {
        samples.push({
          seconds: (message.at - start) / 1000,
          rssBytes: message.rss,
          receivedBytes: bytes,
        });
      }
    }

    worker.on("message", sample);
    try {
      const response = await fetch(`${base}/api/replays/${id}`);
      if (!response.ok) throw new Error(`Replay HTTP ${response.status}`);
      for await (const chunk of response.body) {
        bytes += chunk.byteLength;
        const wait =
          (1000 * bytes) / (RATE_MIB * MiB) - (performance.now() - started);
        if (wait > 0) await delay(wait);
      }
      if (bytes !== FILE_MIB * MiB)
        throw new Error(`Unexpected download length: ${bytes}`);
    } finally {
      worker.off("message", sample);
    }

    return {
      node: process.version,
      platform: process.platform,
      fileMiB: FILE_MIB,
      clientRateMiB: RATE_MIB,
      seconds: (performance.now() - started) / 1000,
      receivedBytes: bytes,
      samples,
    };
  },
  (dir) =>
    pipeline(
      Readable.from(blocks()),
      createWriteStream(join(dir, `${id}.ndjson`)),
    ),
);

console.log(JSON.stringify(result, null, 2));
