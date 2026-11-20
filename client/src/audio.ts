import type { Bus, GameEvents } from "./bus.ts";

const gains = { fired: 0.28, hit: 0.34, exploded: 0.45 };

export class GameAudio {
  #context?: AudioContext;
  #output?: GainNode;
  #muted = false;

  unlock() {
    if (!this.#context) {
      this.#context = new AudioContext();
      this.#output = this.#context.createGain();
      this.#output.gain.value = this.#muted ? 0 : 1;
      this.#output.connect(this.#context.destination);
    }
    return this.#context.resume().then(() => {
      if (!this.#context) throw new Error("AudioContext unavailable");
      return this.#context;
    });
  }

  get context() {
    return this.#context;
  }

  set muted(value: boolean) {
    this.#muted = value;
    if (this.#output) this.#output.gain.value = value ? 0 : 1;
  }

  listen(
    events: Bus<GameEvents>,
    buffers: Record<keyof GameEvents, AudioBuffer>,
    signal: AbortSignal,
  ) {
    const types: (keyof GameEvents)[] = ["fired", "hit", "exploded"];
    for (const type of types) {
      events.addEventListener(
        type,
        () => this.play(buffers[type], gains[type]),
        { signal },
      );
    }
  }

  play(buffer: AudioBuffer, volume: number) {
    if (!buffer || !this.#output || this.#context?.state !== "running") return;
    const source = this.#context.createBufferSource();
    const gain = this.#context.createGain();
    source.buffer = buffer;
    gain.gain.value = volume;
    source.connect(gain);
    gain.connect(this.#output);
    source.addEventListener(
      "ended",
      () => {
        source.disconnect();
        gain.disconnect();
      },
      { once: true },
    );
    source.start();
  }

  dispose() {
    return this.#context?.close();
  }
}
