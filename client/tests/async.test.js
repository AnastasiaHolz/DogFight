import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { Asteroid } from "@dogfight/shared/sim/asteroid";
import { Game } from "@dogfight/shared/sim/game";
import { Vector2 } from "@dogfight/shared/sim/vector";
import {
  delay,
  fetchJson,
  HttpError,
  timedSignal,
  withRetry,
} from "../src/assets/http.js";
import { loadAll, loadAudio } from "../src/assets/loader.js";
import { Lobby } from "../src/lobby/lobby.js";

test("HTTP 404 і битий JSON не ретраяться, а 5xx ретраїться з backoff", async (t) => {
  const statuses = [404, 200, 503, 503, 200];
  const fetch = t.mock.method(globalThis, "fetch", async () => {
    const status = statuses.shift();
    return new Response(statuses.length === 3 ? "{" : '{"ok":true}', {
      status,
    });
  });
  const settings = { baseMs: 2, random: () => 0.5 };
  await assert.rejects(
    () => withRetry(() => fetchJson("/sprite"), settings),
    HttpError,
  );
  assert.equal(fetch.mock.callCount(), 1);
  await assert.rejects(
    () => withRetry(() => fetchJson("/arena"), settings),
    SyntaxError,
  );
  assert.equal(fetch.mock.callCount(), 2);
  const waits = [];
  const value = await withRetry(() => fetchJson("/manifest"), {
    ...settings,
    onRetry: ({ wait }) => waits.push(wait),
  });
  assert.deepEqual(value, { ok: true });
  assert.deepEqual(waits, [3, 5]);
  assert.equal(fetch.mock.callCount(), 5);
});

test("таймаут використовує новий сигнал на кожну спробу", async () => {
  let calls = 0;
  const result = await withRetry(
    async () => {
      calls += 1;
      if (calls === 1) await delay(100, timedSignal(undefined, 5));
      return calls;
    },
    { attempts: 2, baseMs: 0 },
  );
  assert.equal(result, 2);
});

test("loadAll запускає всі ресурси й рахує фактичні завершення", async (t) => {
  const complete = new Map();
  t.mock.method(
    globalThis,
    "fetch",
    (url) =>
      new Promise((resolve) => {
        complete.set(url, (value) => resolve(Response.json(value)));
      }),
  );
  const manifest = [
    { id: "first", kind: "json", url: "/first" },
    { id: "second", kind: "json", url: "/second" },
  ];
  const progress = [];
  const result = loadAll(manifest, {
    onProgress: ({ done, total, id }) => progress.push([done, total, id]),
  });
  assert.equal(complete.size, 2);
  complete.get("/second")(2);
  await delay(1);
  assert.deepEqual(progress, [
    [0, 2, undefined],
    [1, 2, "second"],
  ]);
  complete.get("/first")(1);
  assert.deepEqual(await result, { first: 1, second: 2 });
  assert.deepEqual(progress.at(-1), [2, 2, "first"]);
});

test("скасування групи зупиняє незавершені запити", async (t) => {
  const signals = [];
  t.mock.method(globalThis, "fetch", async (url, { signal }) => {
    signals.push(signal);
    if (url === "/missing") return new Response("", { status: 404 });
    await delay(1000, signal);
    return Response.json({});
  });
  const entries = [
    { id: "missing", kind: "json", url: "/missing" },
    { id: "slow", kind: "json", url: "/slow" },
  ];
  await assert.rejects(() => loadAll(entries), HttpError);
  assert.ok(signals[1].aborted);
  const controller = new AbortController();
  const loading = loadAll(entries.slice(1), { signal: controller.signal });
  controller.abort();
  await assert.rejects(loading, { name: "AbortError" });
  assert.ok(signals[2].aborted);
});

test("декодування аудіо очікується, але очікування можна скасувати", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response(new Uint8Array([1, 2, 3])),
  );
  const controller = new AbortController();
  const context = {
    decodeAudioData(bytes) {
      assert.equal(bytes.byteLength, 3);
      controller.abort();
      return Promise.resolve("decoded");
    },
  };
  await assert.rejects(() => loadAudio(context, "/sound", controller.signal), {
    name: "AbortError",
  });
});

test("лобі опитує API та скасовує запит саме в момент Join", async (t) => {
  const rooms = [{ id: "orbit", name: "Orbit" }];
  let calls = 0;
  let pendingSignal;
  const lobby = new Lobby({
    refreshMs: 8,
    async request(url, signal) {
      assert.equal(url, "/api/rooms");
      calls += 1;
      if (calls === 1) return rooms;
      pendingSignal = signal;
      await delay(1000, signal);
      return rooms;
    },
  });
  t.after(() => lobby.hide());
  const received = once(lobby, "roomsChanged");
  lobby.show();
  const [first] = await received;
  assert.deepEqual(first.detail, rooms);
  await delay(20);
  assert.equal(calls, 2);
  assert.ok(pendingSignal);
  const pending = lobby.refresh();
  const joined = once(lobby, "joined");
  assert.equal(lobby.join("orbit", " Nova "), true);
  const [event] = await joined;
  assert.deepEqual(event.detail, { room: rooms[0], playerName: "Nova" });
  assert.ok(pendingSignal.aborted);
  await pending;
  await delay(20);
  assert.equal(calls, 2);
});

test("лобі розрізняє таймаут запиту та звичайний вихід", async (t) => {
  const lobby = new Lobby({
    timeoutMs: 5,
    request: (_url, signal) => delay(1000, signal),
  });
  t.after(() => lobby.hide());
  const failure = once(lobby, "roomsError");
  lobby.show();
  const [event] = await failure;
  assert.equal(event.detail.name, "TimeoutError");
  lobby.hide();
});

test("симуляція повідомляє fired, hit, exploded без залежності від аудіо й HUD", () => {
  const events = new EventTarget();
  const game = new Game({ demo: false, events });
  const names = [];
  for (const name of ["fired", "hit", "exploded"]) {
    events.addEventListener(name, (event) =>
      names.push([event.type, event.detail]),
    );
  }
  game.world.spawn(new Asteroid({ pos: new Vector2(557, 270), hp: 30 }));
  for (let i = 0; i < 30; i += 1) {
    game.step(1 / 60, { turn: 0, thrust: false, fire: i === 0 });
  }
  assert.deepEqual(
    names.map(([name]) => name),
    ["fired", "hit", "exploded"],
  );
  assert.equal(names[2][1].score, 100);
});
