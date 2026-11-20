import assert from "node:assert/strict";
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
} from "../src/assets/http.ts";
import type { ManifestEntry } from "../src/assets/loader.ts";
import { loadAll, loadAudio } from "../src/assets/loader.ts";
import { Lobby } from "../src/lobby/lobby.ts";

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
  const waits: number[] = [];
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
  const complete = new Map<string, (value: number) => void>();
  t.mock.method(
    globalThis,
    "fetch",
    (url: string) =>
      new Promise<Response>((resolve) => {
        complete.set(url, (value) => resolve(Response.json(value)));
      }),
  );
  const manifest: ManifestEntry[] = [
    { id: "first", kind: "json", url: "/first" },
    { id: "second", kind: "json", url: "/second" },
  ];
  const progress: [number, number, string | undefined][] = [];
  const result = loadAll(manifest, {
    onProgress: ({ done, total, id }) => progress.push([done, total, id]),
  });
  assert.equal(complete.size, 2);
  const second = complete.get("/second");
  assert.ok(second);
  second(2);
  await delay(1);
  assert.deepEqual(progress, [
    [0, 2, undefined],
    [1, 2, "second"],
  ]);
  const first = complete.get("/first");
  assert.ok(first);
  first(1);
  assert.deepEqual(await result, { first: 1, second: 2 });
  assert.deepEqual(progress.at(-1), [2, 2, "first"]);
});

test("скасування групи зупиняє незавершені запити", async (t) => {
  const signals: AbortSignal[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (url: string, { signal }: { signal: AbortSignal }) => {
      signals.push(signal);
      if (url === "/missing") return new Response("", { status: 404 });
      await delay(1000, signal);
      return Response.json({});
    },
  );
  const entries: ManifestEntry[] = [
    { id: "missing", kind: "json", url: "/missing" },
    { id: "slow", kind: "json", url: "/slow" },
  ];
  await assert.rejects(() => loadAll(entries), HttpError);
  assert.ok(signals[1]?.aborted);
  const controller = new AbortController();
  const loading = loadAll(entries.slice(1), { signal: controller.signal });
  controller.abort();
  await assert.rejects(loading, { name: "AbortError" });
  assert.ok(signals[2]?.aborted);
});

test("декодування аудіо очікується, але очікування можна скасувати", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response(new Uint8Array([1, 2, 3])),
  );
  const controller = new AbortController();
  const context = {
    decodeAudioData(bytes: ArrayBuffer) {
      assert.equal(bytes.byteLength, 3);
      controller.abort();
      return Promise.reject(new Error("Decoding was aborted"));
    },
  };
  await assert.rejects(() => loadAudio(context, "/sound", controller.signal), {
    name: "AbortError",
  });
});

test("лобі опитує API та скасовує запит саме в момент Join", async (t) => {
  const rooms = [
    {
      id: "orbit",
      name: "Orbit",
      preset: "orbit",
      arena: { width: 960, height: 540 },
      players: 0,
      maxPlayers: 6,
    },
  ];
  let calls = 0;
  const upcoming: { signal?: AbortSignal } = {};
  const lobby = new Lobby({
    refreshMs: 8,
    async request(url, signal) {
      assert.equal(url, "/api/rooms");
      calls += 1;
      if (calls === 1) return rooms;
      upcoming.signal = signal;
      await delay(1000, signal);
      return rooms;
    },
  });
  t.after(() => lobby.hide());
  const received = lobby.next("roomsChanged");
  lobby.show();
  const first = await received;
  assert.deepEqual(first.detail, rooms);
  await delay(20);
  assert.equal(calls, 2);
  assert.ok(upcoming.signal);
  const pending = lobby.refresh();
  const joined = lobby.next("joined");
  assert.equal(lobby.join("orbit", " Nova "), true);
  const event = await joined;
  assert.deepEqual(event.detail, { room: rooms[0], playerName: "Nova" });
  assert.ok(upcoming.signal.aborted);
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
  const failure = lobby.next("roomsError");
  lobby.show();
  const event = await failure;
  assert.ok(event.detail instanceof Error);
  assert.equal(event.detail.name, "TimeoutError");
  lobby.hide();
});

test("симуляція повідомляє fired, hit, exploded без залежності від аудіо й HUD", () => {
  const events = new EventTarget();
  const game = new Game({ demo: false, events });
  const names: [string, unknown][] = [];
  for (const name of ["fired", "hit", "exploded"]) {
    events.addEventListener(name, (event) => {
      if (event instanceof CustomEvent) names.push([event.type, event.detail]);
    });
  }
  game.world.spawn(new Asteroid({ pos: new Vector2(557, 270), hp: 30 }));
  for (let i = 0; i < 30; i += 1) {
    game.step(1 / 60, { turn: 0, thrust: false, fire: i === 0 });
  }
  assert.deepEqual(
    names.map(([name]) => name),
    ["fired", "hit", "exploded"],
  );
  const payload = names[2]?.[1];
  assert.ok(payload && typeof payload === "object" && "score" in payload);
  assert.equal(payload.score, 100);
});
