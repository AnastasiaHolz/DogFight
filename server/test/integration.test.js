import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";
import { createApp } from "../src/app.js";
import { readConfig } from "../src/config.js";
import { replayEvents } from "../src/log/replay.js";
import { CLOSE, tokenBucket } from "../src/protocol.js";
import { send } from "../src/ws.js";

async function boot(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "dogfight-test-"));
  await writeFile(join(directory, "index.html"), "<h1>Dogfight</h1>");
  const app = await createApp(
    {
      host: "127.0.0.1",
      port: 0,
      clientDir: directory,
      logDir: directory,
      demo: false,
    },
    {
      ...options,
      onError: () => {},
      sockets: { onReject: () => {}, ...options.sockets },
    },
  );
  const { port } = await app.start();
  t.after(async () => {
    await app.stop();
    await rm(directory, { recursive: true, force: true });
  });
  function raw(target) {
    return new Promise((resolve, reject) => {
      const req = request(
        { host: "127.0.0.1", port, path: target },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      );
      req.once("error", reject);
      req.end();
    });
  }
  return {
    app,
    directory,
    base: `http://127.0.0.1:${port}`,
    ws: `ws://127.0.0.1:${port}/ws`,
    raw,
  };
}

function post(base, data) {
  return fetch(`${base}/api/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

async function socketAt(t, url, options) {
  const socket = new WebSocket(url, options);
  socket.on("error", () => {});
  t.after(() => socket.terminate());
  await once(socket, "open");
  return socket;
}

function waitMessage(socket, type, matches = () => true) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("message", receive);
      reject(new Error(`Missing ${type}`));
    }, 1500);
    function receive(raw, binary) {
      if (binary) return;
      const event = JSON.parse(raw);
      if (event.type !== type || !matches(event)) return;
      clearTimeout(timer);
      socket.off("message", receive);
      resolve(event);
    }
    socket.on("message", receive);
  });
}

function message(socket, type, fields = {}) {
  socket.send(JSON.stringify({ v: 0, type, ...fields }));
}

test("config validates port, host, log directory and loopback demo", () => {
  assert.equal(readConfig({}).port, 3000);
  assert.throws(() => readConfig({ PORT: "70000" }), /PORT/);
  assert.throws(() => readConfig({ LOG_DIR: "" }), /LOG_DIR/);
  assert.throws(() => readConfig({ HOST: "invalid/path" }), /HOST/);
  assert.throws(
    () => readConfig({ HOST: "0.0.0.0", LAB04_DEMO: "1" }),
    /loopback/,
  );
});

test("HTTP serves build, limits request body and rejects invalid paths", async (t) => {
  const { base, raw } = await boot(t, { rooms: { maxRooms: 1 } });
  const page = await fetch(base);
  assert.match(page.headers.get("content-type"), /^text\/html/);
  assert.match(await page.text(), /Dogfight/);
  assert.deepEqual(await fetch(`${base}/health`).then((res) => res.json()), {
    status: "ok",
  });
  assert.equal(await raw("/assets/../index.html"), 400);
  assert.equal(await raw("/%2e%2e/package.json"), 400);
  assert.equal((await fetch(`${base}/api/slow`)).status, 404);
  assert.equal(
    (await post(base, { name: "Orbit", preset: "missing" })).status,
    400,
  );
  assert.equal((await post(base, { name: "x".repeat(2100) })).status, 413);
  assert.equal(
    (await post(base, { name: "Orbit", preset: "nebula" })).status,
    201,
  );
  assert.equal((await post(base, { name: "Second" })).status, 409);
  assert.equal(
    (await fetch(`${base}/api/rooms`).then((res) => res.json()))[0].arena.width,
    1120,
  );
});

test("two sockets exchange roster and chat, then finalized replay streams from disk", async (t) => {
  const { base, ws, directory } = await boot(t);
  const room = await post(base, { name: "Orbit" }).then((res) => res.json());
  const nova = await socketAt(t, ws);
  const ray = await socketAt(t, ws);

  const joined = waitMessage(nova, "joined");
  message(nova, "join", { room: room.id, name: "Nova" });
  const { replayId } = await joined;
  const roster = waitMessage(
    nova,
    "roster",
    (event) => event.players.length === 2,
  );
  message(ray, "join", { room: room.id, name: "Ray" });
  assert.deepEqual(
    (await roster).players.map((player) => player.name),
    ["Nova", "Ray"],
  );

  const incoming = waitMessage(ray, "chat");
  message(nova, "chat", { text: "Привіт\nорбіта" });
  assert.equal((await incoming).player.name, "Nova");
  const replayUrl = `${base}/api/replays/${replayId}`;
  assert.equal((await fetch(replayUrl)).status, 404);

  const oneLeft = waitMessage(
    nova,
    "roster",
    (event) => event.players.length === 1,
  );
  message(ray, "leave");
  assert.equal((await oneLeft).players[0].name, "Nova");
  const closed = once(nova, "close");
  message(nova, "leave");
  await closed;
  assert.deepEqual(
    await fetch(`${base}/api/rooms`).then((res) => res.json()),
    [],
  );

  let archive;
  for (let i = 0; i < 15; i += 1) {
    archive = await fetch(replayUrl);
    if (archive.ok) break;
    await delay(15);
  }
  assert.equal(archive.status, 200);
  assert.match(archive.headers.get("content-type"), /application\/x-ndjson/);
  const rows = (await archive.text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    rows.map((entry) => entry.type),
    ["join", "join", "chat", "leave", "leave"],
  );
  assert.equal(rows[2].text, "Привіт\nорбіта");
  const parsed = [];
  for await (const row of replayEvents(join(directory, `${replayId}.ndjson`)))
    parsed.push(row);
  assert.deepEqual(parsed, rows);
});

test("WebSocket rejects invalid JSON, unknown types, oversize and late join", async (t) => {
  const { ws } = await boot(t, { sockets: { joinMs: 120 } });
  for (const [data, expected] of [
    ["{", CLOSE.invalidJson],
    ['{"v":0,"type":"movement"}', CLOSE.badMessage],
    ["x".repeat(4200), CLOSE.oversize],
    [undefined, CLOSE.joinTimeout],
  ]) {
    const client = await socketAt(t, ws);
    const close = once(client, "close");
    if (data !== undefined) client.send(data);
    assert.equal((await close)[0], expected);
  }
});

test("rate limit and heartbeat remove clients; two missed pongs are enough", async (t) => {
  const { base, ws } = await boot(t, {
    sockets: {
      heartbeatMs: 45,
      rateOptions: { rate: 0, burst: 2 },
    },
  });
  const room = await post(base, { name: "Heartbeat" }).then((res) =>
    res.json(),
  );
  const chatty = await socketAt(t, ws);
  const noisyJoin = waitMessage(chatty, "joined");
  message(chatty, "join", { room: room.id, name: "Chatty" });
  await noisyJoin;
  const quiet = await socketAt(t, ws, { autoPong: false });
  const quietJoin = waitMessage(quiet, "joined");
  message(quiet, "join", { room: room.id, name: "Quiet" });
  await quietJoin;
  const quietClose = once(quiet, "close");
  const noisyClose = once(chatty, "close");
  message(chatty, "chat", { text: "one" });
  message(chatty, "chat", { text: "two" });
  assert.equal((await noisyClose)[0], CLOSE.rate);
  assert.equal((await quietClose)[0], 1006);
});

test("token bucket refills and a slow socket loses only noncritical broadcasts", () => {
  let now = 0;
  const accept = tokenBucket({ rate: 2, burst: 2, now: () => now });
  assert.deepEqual([accept(), accept(), accept()], [true, true, false]);
  now = 500;
  assert.deepEqual([accept(), accept()], [true, false]);

  let closed;
  const socket = {
    readyState: WebSocket.OPEN,
    bufferedAmount: 100_000,
    send() {
      assert.fail("should not enqueue");
    },
    close(code) {
      closed = code;
    },
  };
  assert.equal(send(socket, { type: "chat" }), false);
  assert.equal(closed, undefined);
  assert.equal(send(socket, { type: "roster" }, true), false);
  assert.equal(closed, CLOSE.busy);
});

test("server stop closes active sockets and flushes the last match log", async (t) => {
  const { app, base, ws, directory } = await boot(t);
  const room = await post(base, { name: "Closing" }).then((res) => res.json());
  const client = await socketAt(t, ws);
  const joined = waitMessage(client, "joined");
  message(client, "join", { room: room.id, name: "Player" });
  const { replayId } = await joined;
  const closed = once(client, "close");
  await app.stop();
  assert.equal((await closed)[0], 1001);
  const rows = [];
  for await (const event of replayEvents(join(directory, `${replayId}.ndjson`)))
    rows.push(event.type);
  assert.deepEqual(rows, ["join", "leave"]);
});
