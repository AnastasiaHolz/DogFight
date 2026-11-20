import { createWriteStream } from "node:fs";
import { rename } from "node:fs/promises";
import { join } from "node:path";
import type { TransformCallback } from "node:stream";
import { PassThrough, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { RoomEvent } from "../rooms.ts";

export class JsonLinesTransform extends Transform {
  constructor() {
    super({ writableObjectMode: true });
  }

  _transform(
    event: unknown,
    _encoding: BufferEncoding,
    done: TransformCallback,
  ) {
    try {
      done(null, `${JSON.stringify(event)}\n`);
    } catch (error: unknown) {
      done(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

export class MatchLog {
  readonly done: Promise<void>;
  #input = new PassThrough({ objectMode: true, highWaterMark: 16 });
  #pending: RoomEvent[] = [];
  #blocked = false;
  #closing = false;
  #failed = false;

  constructor(dir: string, id: string, onError: (error: unknown) => void) {
    const final = join(dir, `${id}.ndjson`);
    const partial = `${final}.part`;
    this.#input.on("drain", () => {
      this.#blocked = false;
      this.#flush();
    });

    this.done = pipeline(
      this.#input,
      new JsonLinesTransform(),
      createWriteStream(partial, { flags: "wx" }),
    )
      .then(() => rename(partial, final))
      .catch((error: unknown) => {
        this.#failed = true;
        this.#pending.length = 0;
        onError(error);
      });
  }

  append(event: RoomEvent) {
    if (this.#closing || this.#failed || this.#pending.length >= 128)
      return false;
    this.#pending.push(event);
    this.#flush();
    return true;
  }

  #flush() {
    while (this.#pending.length > 0 && !this.#blocked) {
      const event = this.#pending.shift();
      if (event) this.#blocked = !this.#input.write(event);
    }
    if (
      this.#closing &&
      this.#pending.length === 0 &&
      !this.#input.writableEnded
    ) {
      this.#input.end();
    }
  }

  close() {
    if (!this.#failed) {
      this.#closing = true;
      this.#flush();
    }
    return this.done;
  }
}
