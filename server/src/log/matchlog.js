import { createWriteStream } from "node:fs";
import { rename } from "node:fs/promises";
import { join } from "node:path";
import { PassThrough, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export class JsonLinesTransform extends Transform {
  constructor() {
    super({ writableObjectMode: true });
  }

  _transform(event, _encoding, done) {
    try {
      done(null, `${JSON.stringify(event)}\n`);
    } catch (error) {
      done(error);
    }
  }
}

export class MatchLog {
  #input = new PassThrough({ objectMode: true, highWaterMark: 16 });
  #pending = [];
  #blocked = false;
  #closing = false;
  #failed = false;

  constructor(dir, id, onError) {
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
      .catch((error) => {
        this.#failed = true;
        this.#pending.length = 0;
        onError(error);
      });
  }

  append(event) {
    if (this.#closing || this.#failed || this.#pending.length >= 128)
      return false;
    this.#pending.push(event);
    this.#flush();
    return true;
  }

  #flush() {
    while (this.#pending.length > 0 && !this.#blocked) {
      this.#blocked = !this.#input.write(this.#pending.shift());
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
