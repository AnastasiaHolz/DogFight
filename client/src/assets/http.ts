export class HttpError extends Error {
  readonly status: number;
  constructor(response: Response, url: string) {
    super(`HTTP ${response.status}: ${url}`);
    this.name = "HttpError";
    this.status = response.status;
  }
}

export async function fetchChecked(
  url: string,
  signal?: AbortSignal,
  options?: RequestInit,
) {
  const response = await fetch(url, { ...options, signal, cache: "no-store" });
  if (!response.ok) throw new HttpError(response, url);
  return response;
}

export async function fetchJson(
  url: string,
  signal?: AbortSignal,
  options?: RequestInit,
): Promise<unknown> {
  const response = await fetchChecked(url, signal, options);
  return response.json();
}

export function abortable<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const cancel = () => reject(signal?.reason);
    signal.addEventListener("abort", cancel, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", cancel);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", cancel);
        reject(error);
      },
    );
    if (signal.aborted) cancel();
  });
}

export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal?.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", cancel);
      resolve();
    }, ms);
    function cancel() {
      clearTimeout(timer);
      reject(signal?.reason);
    }
    signal?.addEventListener("abort", cancel, { once: true });
  });
}

export function timedSignal(
  signal: AbortSignal | undefined,
  timeoutMs: number,
) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function retryable(error: unknown) {
  if (error instanceof HttpError) return error.status >= 500;
  return (
    (error instanceof Error && error.name === "TimeoutError") ||
    error instanceof TypeError
  );
}

export type RetryInfo = { attempt: number; wait: number; error: unknown };

export async function withRetry<T>(
  work: () => Promise<T>,
  {
    attempts = 3,
    baseMs = 120,
    signal,
    random = Math.random,
    onRetry = () => {},
  }: {
    attempts?: number;
    baseMs?: number;
    signal?: AbortSignal;
    random?: () => number;
    onRetry?: (info: RetryInfo) => void;
  } = {},
) {
  for (let attempt = 1; ; attempt += 1) {
    signal?.throwIfAborted();
    try {
      return await work();
    } catch (error: unknown) {
      signal?.throwIfAborted();
      if (attempt >= attempts || !retryable(error)) throw error;
      const wait = baseMs * 2 ** (attempt - 1) + random() * baseMs;
      onRetry({ attempt, wait, error });
      await delay(wait, signal);
    }
  }
}
