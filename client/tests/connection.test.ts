import assert from "node:assert/strict";
import test from "node:test";
import type { ClientMessage } from "@dogfight/shared/protocol";
import { parseClientMessage } from "@dogfight/shared/protocol";
import { Bus } from "../src/bus.ts";
import { RoomConnection, webSocketUrl } from "../src/network/connection.ts";

class FakeSocket extends EventTarget {
  static OPEN = 1;
  static created = new Bus<{ socket: FakeSocket }>();
  readyState = 0;
  bufferedAmount = 0;
  binaryType: BinaryType = "arraybuffer";
  outgoing: ClientMessage[] = [];

  constructor() {
    super();
    FakeSocket.created.emit("socket", this);
  }

  send(value: unknown) {
    const parsed = parseClientMessage(value);
    if (parsed.ok) this.outgoing.push(parsed.value);
  }

  open() {
    this.readyState = 1;
    this.dispatchEvent(new Event("open"));
  }

  accept() {
    this.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({
          v: 0,
          type: "joined",
          room: {
            id: "orbit",
            name: "Orbit",
            preset: "orbit",
            arena: { width: 960, height: 540 },
            players: 1,
            maxPlayers: 6,
          },
          player: {
            id: "11223344-1234-4abc-819a-112233445566",
            netId: 5,
            name: "Nova",
          },
          seed: 1,
          codec: "binary",
          replayId: "orbit",
        }),
      }),
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
  const first = FakeSocket.created.next("socket");
  connection.connect();
  const { detail: a } = await first;
  assert.equal(connection.send("first"), true);
  a.open();
  assert.deepEqual(
    a.outgoing.map((row) => row.type),
    ["join"],
  );
  a.accept();
  const firstChat = a.outgoing.at(-1);
  assert.ok(firstChat?.type === "chat");
  assert.equal(firstChat.text, "first");

  const second = FakeSocket.created.next("socket");
  a.close(1006);
  assert.equal(connection.send("queued"), true);
  const { detail: b } = await second;
  b.open();
  assert.deepEqual(
    b.outgoing.map((row) => row.type),
    ["join"],
  );
  b.accept();
  const secondChat = b.outgoing.at(-1);
  assert.ok(secondChat?.type === "chat");
  assert.equal(secondChat.text, "queued");
  connection.stop();
  assert.equal(b.outgoing.at(-1)?.type, "leave");
});

test("HTTPS uses wss on the same host", () => {
  assert.equal(
    webSocketUrl(new URL("https://example.test/game")),
    "wss://example.test/ws",
  );
});
