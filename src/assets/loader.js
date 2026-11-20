import {
  abortable,
  fetchChecked,
  fetchJson,
  timedSignal,
  withRetry,
} from "./http.js";

export async function loadImage(url, signal) {
  const response = await fetchChecked(url, signal);
  const blob = await response.blob();
  signal?.throwIfAborted();
  const source = URL.createObjectURL(blob);
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      function cleanup() {
        image.onload = null;
        image.onerror = null;
        signal?.removeEventListener("abort", cancel);
      }
      function cancel() {
        cleanup();
        image.removeAttribute("src");
        reject(signal.reason);
      }

      image.onload = () => {
        cleanup();
        resolve(image);
      };
      image.onerror = () => {
        cleanup();
        reject(new Error(`Не вдалося декодувати зображення: ${url}`));
      };
      signal?.addEventListener("abort", cancel, { once: true });
      image.src = source;
    });
  } finally {
    URL.revokeObjectURL(source);
  }
}

export async function loadAudio(context, url, signal) {
  const response = await fetchChecked(url, signal);
  const bytes = await response.arrayBuffer();
  signal?.throwIfAborted();
  return abortable(context.decodeAudioData(bytes), signal);
}

export function loadJson(url, signal) {
  return fetchJson(url, signal);
}

async function loadEntry(entry, { signal, audioContext, timeoutMs, onRetry }) {
  const load = (request) => {
    if (entry.kind === "image") return loadImage(entry.url, request);
    if (entry.kind === "audio")
      return loadAudio(audioContext, entry.url, request);
    if (entry.kind === "json") return loadJson(entry.url, request);
    throw new Error(`Непідтримуваний тип ресурсу: ${entry.kind}`);
  };
  return withRetry(
    () => load(timedSignal(signal, entry.timeoutMs ?? timeoutMs)),
    { signal, onRetry: (info) => onRetry({ id: entry.id, ...info }) },
  );
}

export async function loadAll(
  manifest,
  {
    onProgress = () => {},
    onRetry = () => {},
    signal,
    audioContext,
    timeoutMs = 5500,
    sequential = false,
  } = {},
) {
  const group = new AbortController();
  const activeSignal = signal
    ? AbortSignal.any([signal, group.signal])
    : group.signal;
  let done = 0;
  const total = manifest.length;
  activeSignal.throwIfAborted();
  onProgress({ done, total });

  async function tracked(entry) {
    const value = await loadEntry(entry, {
      signal: activeSignal,
      audioContext,
      timeoutMs,
      onRetry,
    });
    activeSignal.throwIfAborted();
    done += 1;
    onProgress({ done, total, id: entry.id });
    return [entry.id, value];
  }

  try {
    const entries = [];
    if (sequential) {
      for (const entry of manifest) entries.push(await tracked(entry));
    } else {
      entries.push(...(await Promise.all(manifest.map(tracked))));
    }
    return Object.fromEntries(entries);
  } catch (error) {
    group.abort();
    throw error;
  }
}
