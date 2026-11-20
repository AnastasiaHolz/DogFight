import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { RoomConnection, webSocketUrl } from "../src/network/connection.js";

class FakeSocket extends EventTarget {
  static OPEN = 1;
  static created = new EventTarget();
  readyState = 0;
  bufferedAmount = 0;
  outgoing = [];

  constructor() {
    super();
    FakeSocket.created.dispatchEvent(
      new CustomEvent("socket", { detail: this }),
    );
  }

  send(value) {
    this.outgoing.push(JSON.parse(value));
  }

  open() {
    this.readyState = 1;
    this.dispatchEvent(new Event("open"));
  }

  accept() {
    this.dispatchEvent(
      new MessageEvent("message", { data: '{"v":0,"type":"joined"}' }),
    );
  }

  close(code = 1000) {
    this.readyState = 3;
    this.dispatchEvent(Object.assign(new Event("close"), { code }));
  }
}

test("send queue waits for joined and a dropped link rejoins before flushing", async (t) => {
  const connection = new RoomConnection({
    url: "ws://test/ws",
    room: "orbit",
    name: "Nova",
    Socket: FakeSocket,
    backoff: 2,
  });
  t.after(() => connection.stop());
  const first = once(FakeSocket.created, "socket");
  connection.connect();
  const [{ detail: a }] = await first;
  assert.equal(connection.send("first"), true);
  a.open();
  assert.deepEqual(
    a.outgoing.map((row) => row.type),
    ["join"],
  );
  a.accept();
  assert.equal(a.outgoing.at(-1).text, "first");

  const second = once(FakeSocket.created, "socket");
  a.close(1006);
  assert.equal(connection.send("queued"), true);
  const [{ detail: b }] = await second;
  b.open();
  assert.deepEqual(
    b.outgoing.map((row) => row.type),
    ["join"],
  );
  b.accept();
  assert.equal(b.outgoing.at(-1).text, "queued");
  connection.stop();
  assert.equal(b.outgoing.at(-1).type, "leave");
});

test("HTTPS uses wss on the same host", () => {
  assert.equal(
    webSocketUrl(new URL("https://example.test/game")),
    "wss://example.test/ws",
  );
});
