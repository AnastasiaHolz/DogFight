import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { decodeSnapshot, encodeInput } from "@dogfight/shared/codec/binary";
import type {
  CodecName,
  ServerMessage,
  Snapshot,
} from "@dogfight/shared/protocol";
import {
  parseServerMessage,
  RoomSchema,
  seqNumber,
} from "@dogfight/shared/protocol";
import { inputMessage, NEUTRAL } from "@dogfight/shared/protocol/messages";
import WebSocket from "ws";
import { z } from "zod";
import { createApp } from "../src/app.ts";
import { readConfig } from "../src/config.ts";

async function client(port: number, room: string, codec: CodecName) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?codec=${codec}`);
  socket.on("error", () => {});
  const snapshots = new Map<number, Snapshot>();
  let joined: Extract<ServerMessage, { type: "joined" }> | undefined;
  const ready = new Promise<void>((resolve) => {
    socket.on("message", (data, binary) => {
      if (!Buffer.isBuffer(data)) return;
      if (binary) {
        const snapshot = decodeSnapshot(data);
        snapshots.set(snapshot.tick, snapshot);
        return;
      }
      const parsed = parseServerMessage(data.toString("utf8"));
      if (!parsed.ok) return;
      const message = parsed.value;
      if (message.type === "joined") {
        joined = message;
        resolve();
      }
      if (message.type === "snapshot") snapshots.set(message.tick, message);
    });
  });
  await once(socket, "open");
  socket.send(JSON.stringify({ v: 0, type: "join", name: codec, room }));
  await ready;
  assert.ok(joined);
  return { socket, snapshots, joined };
}

test("both codecs receive one authoritative world, distinct ACKs and reject client coordinates", {
  timeout: 5000,
}, async (t) => {
  const logDir = await mkdtemp(join(tmpdir(), "dogfight-net-"));
  const app = await createApp(
    { ...readConfig({}), host: "127.0.0.1", port: 0, logDir },
    {
      sockets: { onReject: () => {} },
    },
  );
  t.after(async () => {
    await app.stop();
    await rm(logDir, { recursive: true, force: true });
  });
  const { port } = await app.start();
  const base = `http://127.0.0.1:${port}`;
  const room = RoomSchema.parse(
    await fetch(`${base}/api/rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Two pilots" }),
    }).then((response) => response.json()),
  );

  const binary = await client(port, room.id, "binary");
  const json = await client(port, room.id, "json");
  t.after(() => binary.socket.terminate());
  t.after(() => json.socket.terminate());
  assert.notEqual(binary.joined.player.netId, json.joined.player.netId);
  assert.equal(binary.joined.seed, json.joined.seed);

  for (let seq = 1; seq <= 4; seq += 1) {
    binary.socket.send(
      encodeInput(inputMessage(seqNumber(seq), { ...NEUTRAL, thrust: true })),
    );
  }
  json.socket.send(JSON.stringify(inputMessage(seqNumber(1), NEUTRAL)));

  let common: [Snapshot, Snapshot] | undefined;
  for (let i = 0; i < 40 && !common; i += 1) {
    await delay(20);
    for (const [tick, packet] of binary.snapshots) {
      const same = json.snapshots.get(tick);
      if (packet.lastProcessedSeq === 4 && same?.lastProcessedSeq === 1) {
        common = [packet, same];
        break;
      }
    }
  }
  assert.ok(common);
  const [first, second] = common;
  assert.deepEqual(
    first.entities.map((e) => e.id),
    second.entities.map((e) => e.id),
  );
  for (const [i, a] of first.entities.entries()) {
    const b = second.entities[i];
    assert.ok(b);
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 0.001);
  }
  const stats = z
    .object({
      matches: z.array(z.object({ tickRate: z.number(), tick: z.number() })),
    })
    .parse(
      await fetch(`${base}/api/stats`).then((response) => response.json()),
    );
  const running = stats.matches[0];
  assert.ok(running);
  assert.equal(running.tickRate, 30);
  assert.ok(running.tick >= first.tick);
  const rejected = once(json.socket, "close");
  json.socket.send(
    JSON.stringify({ ...inputMessage(seqNumber(2), NEUTRAL), x: 805 }),
  );
  assert.equal((await rejected)[0], 1008);
});
