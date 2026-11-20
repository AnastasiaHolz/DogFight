import type { Arena } from "@dogfight/shared/protocol";
import { ArenaSchema, errorText } from "@dogfight/shared/protocol";
import type { Diagnostics } from "./diagnostics.ts";
import { diagnosticManifest } from "./diagnostics.ts";
import { HttpError, timedSignal, withRetry } from "./http.ts";
import type { AssetRetry, Progress } from "./loader.ts";
import { loadAll, loadJson, ManifestSchema } from "./loader.ts";

const required = {
  ships: "image",
  objects: "image",
  fired: "audio",
  hit: "audio",
  exploded: "audio",
  arena: "json",
};

export type Assets = {
  ships: HTMLImageElement;
  objects: HTMLImageElement;
  fired: AudioBuffer;
  hit: AudioBuffer;
  exploded: AudioBuffer;
  arena: Arena;
};

export function validArena(arena: unknown): arena is Arena {
  return ArenaSchema.safeParse(arena).success;
}

export async function prepareAssets(
  audioContext: AudioContext,
  diagnostics: Diagnostics,
  {
    signal,
    onProgress,
    onRetry,
  }: {
    signal: AbortSignal;
    onProgress(progress: Progress): void;
    onRetry(info: AssetRetry): void;
  },
): Promise<{ assets: Assets; elapsed: number; total: number }> {
  const raw = await withRetry(
    () => loadJson("/assets/manifest.json", timedSignal(signal, 5500)),
    { signal },
  );
  const manifest = ManifestSchema.safeParse(raw);
  if (
    !manifest.success ||
    !Object.entries(required).every(([id, kind]) =>
      manifest.data.some((item) => item.id === id && item.kind === kind),
    )
  ) {
    throw new Error("Маніфест не містить усіх обов’язкових ресурсів.");
  }

  const list = diagnosticManifest(manifest.data, diagnostics);
  const started = performance.now();
  const { ships, objects, fired, hit, exploded, arena } = await loadAll(list, {
    audioContext,
    signal,
    onProgress,
    onRetry,
    sequential: diagnostics.sequential,
  });
  const elapsed = performance.now() - started;
  if (
    !(ships instanceof HTMLImageElement) ||
    !(objects instanceof HTMLImageElement) ||
    !(fired instanceof AudioBuffer) ||
    !(hit instanceof AudioBuffer) ||
    !(exploded instanceof AudioBuffer) ||
    !validArena(arena)
  )
    throw new Error("Некоректний ресурс або конфіг арени.");
  return {
    assets: { ships, objects, fired, hit, exploded, arena },
    elapsed,
    total: list.length,
  };
}

export function describeLoadError(error: unknown): string {
  if (error instanceof HttpError && error.status === 404)
    return "Ресурс не знайдено (HTTP 404).";
  if (error instanceof Error && error.name === "TimeoutError")
    return "Таймаут мережі. Сервер не відповів вчасно.";
  if (error instanceof Error && error.name === "AbortError")
    return "Завантаження скасовано.";
  if (error instanceof SyntaxError)
    return "Некоректний JSON. Не вдалося прочитати конфігурацію.";
  return `Не вдалося завантажити ресурси. ${errorText(error)}`;
}
