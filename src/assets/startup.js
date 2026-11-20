import { diagnosticManifest } from "./diagnostics.js";
import { timedSignal, withRetry } from "./http.js";
import { loadAll, loadJson } from "./loader.js";

const required = {
  ships: "image",
  objects: "image",
  fired: "audio",
  hit: "audio",
  exploded: "audio",
  arena: "json",
};

export function validArena(arena) {
  if (!arena) return false;
  const dimensions = [arena.width, arena.height].every(
    (number) => Number.isInteger(number) && number >= 320 && number <= 2000,
  );
  const extra = arena.extraAsteroids ?? 0;
  return dimensions && Number.isInteger(extra) && extra >= 0 && extra <= 2;
}

export async function prepareAssets(
  audioContext,
  diagnostics,
  { signal, onProgress, onRetry },
) {
  const manifest = await withRetry(
    () => loadJson("/assets/manifest.json", timedSignal(signal, 5500)),
    { signal },
  );
  const valid =
    Array.isArray(manifest) &&
    Object.entries(required).every(([id, kind]) =>
      manifest.some(
        (item) =>
          item?.id === id && item.kind === kind && typeof item.url === "string",
      ),
    );
  if (!valid)
    throw new Error("Маніфест не містить усіх обов’язкових ресурсів.");

  const list = diagnosticManifest(manifest, diagnostics);
  const started = performance.now();
  const assets = await loadAll(list, {
    audioContext,
    signal,
    onProgress,
    onRetry,
    sequential: diagnostics.sequential,
  });
  const elapsed = performance.now() - started;
  if (!validArena(assets.arena)) throw new Error("Некоректний конфіг арени.");
  return { assets, elapsed, total: list.length };
}

export function describeLoadError(error) {
  if (error.status === 404) return "Ресурс не знайдено (HTTP 404).";
  if (error.name === "TimeoutError")
    return "Таймаут мережі. Сервер не відповів вчасно.";
  if (error.name === "AbortError") return "Завантаження скасовано.";
  if (error instanceof SyntaxError)
    return "Некоректний JSON. Не вдалося прочитати конфігурацію.";
  return `Не вдалося завантажити ресурси. ${error.message}`;
}
