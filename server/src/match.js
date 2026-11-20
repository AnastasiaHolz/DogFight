import { randomBytes } from "node:crypto";
import {
  NEUTRAL,
  snapshotMessage,
  TICK_MS,
} from "@dogfight/shared/protocol/messages";
import {
  addPilot,
  advanceWorld,
  createBattle,
  removePilot,
} from "@dogfight/shared/sim/battle";

const INPUT_WINDOW = 120;
const BUFFER_TICKS = 2;
const MAX_CATCH_UP = 4;

class InputStream {
  #queue = new Map();
  #readyAt;
  #previous = NEUTRAL;
  #held = 0;
  lastProcessedSeq = 0;

  accept(input, tick) {
    if (
      input.seq <= this.lastProcessedSeq ||
      input.seq > this.lastProcessedSeq + INPUT_WINDOW
    )
      return;
    if (this.#queue.has(input.seq)) return;
    this.#queue.set(input.seq, input);
    this.#readyAt ??= tick + BUFFER_TICKS;
  }

  fallback() {
    this.#held += 1;
    return this.#held <= 4
      ? { ...this.#previous, fire: false, homing: false }
      : NEUTRAL;
  }

  take(tick) {
    if (!this.#queue.size || tick < this.#readyAt) {
      return this.fallback();
    }
    const expected = this.lastProcessedSeq + 1;
    const next = this.#queue.get(expected);
    this.lastProcessedSeq = expected;
    if (!next) return this.fallback();
    this.#queue.delete(expected);
    this.#previous = next;
    this.#held = 0;
    return next;
  }
}

export class Match {
  #pilots = new Map();
  #timer;
  #deadline;
  #jitter = 0;
  #work = 0;
  #skipped = 0;
  #samples = 0;

  constructor(arena, seed = randomBytes(4).readUInt32LE()) {
    this.arena = arena;
    this.seed = seed;
    this.state = createBattle(seed, arena);
  }

  join(deliver) {
    const { id, state } = addPilot(this.state, this.arena);
    this.state = state;
    this.#pilots.set(id, { deliver, input: new InputStream() });
    return id;
  }

  leave(id) {
    this.state = removePilot(this.state, id);
    this.#pilots.delete(id);
  }

  accept(id, input) {
    this.#pilots.get(id)?.input.accept(input, this.state.tick);
  }

  step() {
    const inputs = new Map();
    for (const [id, { input }] of this.#pilots) {
      inputs.set(id, input.take(this.state.tick + 1));
    }
    this.state = advanceWorld(this.state, inputs, this.arena);
    for (const { input, deliver } of this.#pilots.values()) {
      deliver(snapshotMessage(this.state, input.lastProcessedSeq));
    }
  }

  start() {
    if (this.#timer) return;
    this.#deadline = performance.now() + TICK_MS;
    this.#schedule();
  }

  #schedule() {
    this.#timer = setTimeout(
      () => {
        let count = 0;
        while (performance.now() >= this.#deadline && count < MAX_CATCH_UP) {
          const started = performance.now();
          this.#jitter += started - this.#deadline;
          this.step();
          this.#work += performance.now() - started;
          this.#samples += 1;
          this.#deadline += TICK_MS;
          count += 1;
        }
        const late = performance.now() - this.#deadline;
        if (late >= 0) {
          const skipped = Math.floor(late / TICK_MS) + 1;
          this.#skipped += skipped;
          this.#deadline += skipped * TICK_MS;
        }
        this.#schedule();
      },
      Math.max(1, Math.ceil(this.#deadline - performance.now())),
    );
    this.#timer.unref();
  }

  stop() {
    clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  stats() {
    const samples = Math.max(1, this.#samples);
    return {
      tick: this.state.tick,
      tickRate: 30,
      durationMs: this.#work / samples,
      jitterMs: this.#jitter / samples,
      missedDeadlines: this.#skipped,
    };
  }
}
