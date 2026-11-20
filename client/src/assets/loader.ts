import { unreachable } from "@dogfight/shared/protocol";
import { z } from "zod";
import type { RetryInfo } from "./http.ts";

export const ManifestSchema = z.array(
  z.strictObject({
    id: z.string().min(1),
    kind: z.enum(["image", "audio", "json"]),
    url: z.string().startsWith("/"),
    timeoutMs: z.int().positive().optional(),
  }),
);
export type ManifestEntry = z.infer<typeof ManifestSchema>[number];
export type Progress = { done: number; total: number; id?: string };
export type AssetRetry = RetryInfo & { id: string };
type Decoder = Pick<BaseAudioContext, "decodeAudioData">;

import {
  abortable,
  fetchChecked,
  fetchJson,
  timedSignal,
  withRetry,
} from "./http.ts";

export async function loadImage(
  url: string,
  signal?: AbortSignal,
): Promise<HTMLImageElement> {
  const response = await fetchChecked(url, signal);
  const blob = await response.blob();
  signal?.throwIfAborted();
  const source = URL.createObjectURL(blob);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      function cleanup() {
        image.onload = null;
        image.onerror = null;
        signal?.removeEventListener("abort", cancel);
      }
      function cancel() {
        cleanup();
        image.removeAttribute("src");
        reject(signal?.reason);
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

export async function loadAudio(
  context: Decoder,
  url: string,
  signal?: AbortSignal,
) {
  const response = await fetchChecked(url, signal);
  const bytes = await response.arrayBuffer();
  signal?.throwIfAborted();
  return abortable(context.decodeAudioData(bytes), signal);
}

export function loadJson(url: string, signal?: AbortSignal) {
  return fetchJson(url, signal);
}

async function loadEntry(
  entry: ManifestEntry,
  {
    signal,
    audioContext,
    timeoutMs,
    onRetry,
  }: {
    signal: AbortSignal;
    audioContext?: Decoder;
    timeoutMs: number;
    onRetry(info: AssetRetry): void;
  },
): Promise<unknown> {
  const load = (request: AbortSignal): Promise<unknown> => {
    const { kind } = entry;
    switch (kind) {
      case "image":
        return loadImage(entry.url, request);
      case "audio": {
        if (!audioContext) throw new Error("Missing audio decoder");
        return loadAudio(audioContext, entry.url, request);
      }
      case "json":
        return loadJson(entry.url, request);
      default:
        return unreachable(kind);
    }
  };
  return withRetry(
    () => load(timedSignal(signal, entry.timeoutMs ?? timeoutMs)),
    { signal, onRetry: (info) => onRetry({ id: entry.id, ...info }) },
  );
}

export async function loadAll(
  manifest: readonly ManifestEntry[],
  {
    onProgress = () => {},
    onRetry = () => {},
    signal,
    audioContext,
    timeoutMs = 5500,
    sequential = false,
  }: {
    onProgress?: (progress: Progress) => void;
    onRetry?: (info: AssetRetry) => void;
    signal?: AbortSignal;
    audioContext?: Decoder;
    timeoutMs?: number;
    sequential?: boolean;
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

  async function tracked(entry: ManifestEntry): Promise<[string, unknown]> {
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
    const entries: [string, unknown][] = [];
    if (sequential) {
      for (const entry of manifest) entries.push(await tracked(entry));
    } else {
      entries.push(...(await Promise.all(manifest.map(tracked))));
    }
    return Object.fromEntries<unknown>(entries);
  } catch (error: unknown) {
    group.abort();
    throw error;
  }
}
