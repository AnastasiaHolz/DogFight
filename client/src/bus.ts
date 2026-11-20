type Listener<T> = (event: { detail: T }) => void;
type Options = { once?: boolean; signal?: AbortSignal };

export class Bus<Events extends object> {
  #listeners: { [K in keyof Events]?: Map<Listener<Events[K]>, Options> } = {};

  addEventListener<K extends keyof Events>(
    name: K,
    listener: Listener<Events[K]>,
    options: Options = {},
  ): void {
    if (options.signal?.aborted) return;
    const listeners =
      this.#listeners[name] ?? new Map<Listener<Events[K]>, Options>();
    this.#listeners[name] = listeners;
    listeners.set(listener, options);
    options.signal?.addEventListener(
      "abort",
      () => listeners.delete(listener),
      { once: true },
    );
  }

  emit<K extends keyof Events>(name: K, detail: Events[K]): void {
    const listeners = this.#listeners[name];
    if (!listeners) return;
    for (const [listener, options] of [...listeners]) {
      if (options.signal?.aborted || !listeners.has(listener)) continue;
      if (options.once) listeners.delete(listener);
      listener({ detail });
    }
  }

  next<K extends keyof Events>(name: K): Promise<{ detail: Events[K] }> {
    return new Promise((resolve) =>
      this.addEventListener(name, resolve, { once: true }),
    );
  }
}

export type GameEvents = {
  fired: undefined;
  hit: undefined;
  exploded: undefined;
};
