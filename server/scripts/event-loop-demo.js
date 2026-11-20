import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";
import { withServer } from "./worker-client.js";

await withServer("loop", async ({ base, port }) => {
  const room = await fetch(`${base}/api/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Loop demo" }),
  }).then((response) => response.json());

  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  socket.on("error", (error) => console.error(error));
  await once(socket, "open");

  function receive(type, expected) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.off("message", handle);
        reject(new Error(`Missing ${type}`));
      }, 3000);
      function handle(raw) {
        const message = JSON.parse(raw);
        if (message.type !== type || (expected && message.text !== expected))
          return;
        clearTimeout(timer);
        socket.off("message", handle);
        resolve(message);
      }
      socket.on("message", handle);
    });
  }

  try {
    const joined = receive("joined");
    socket.send(
      JSON.stringify({ v: 0, type: "join", room: room.id, name: "Nova" }),
    );
    await joined;
    async function timedChat(text) {
      const reply = receive("chat", text);
      const start = performance.now();
      socket.send(JSON.stringify({ v: 0, type: "chat", text }));
      await reply;
      return performance.now() - start;
    }
    await fetch(`${base}/health`).then((response) => response.json());
    console.log(
      `Chat RTT without blocking: ${(await timedChat("baseline")).toFixed(1)} ms`,
    );
    const slow = fetch(`${base}/api/slow`).then((response) => response.json());
    await delay(45);
    console.log(
      `Chat RTT during /api/slow: ${(await timedChat("during")).toFixed(1)} ms`,
    );
    console.log("HTTP:", await slow);
  } finally {
    socket.close();
  }
});

const emitter =
  'import { EventEmitter } from "node:events"; const e = new EventEmitter();';
const emit = 'e.emit("error", new Error("demo error"));';
for (const listener of [
  "",
  'e.on("error", (error) => console.log("handled:", error.message));',
]) {
  const child = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", `${emitter}${listener}${emit}`],
    {
      encoding: "utf8",
    },
  );
  const message = listener
    ? child.stdout.trim()
    : child.stderr.split("\n").find((line) => line.startsWith("Error:"));
  console.log(`EventEmitter → exit ${child.status} · ${message}`);
}
