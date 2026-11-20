export class HttpError extends Error {
  constructor(response, url) {
    super(`HTTP ${response.status}: ${url}`);
    this.name = "HttpError";
    this.status = response.status;
  }
}

export async function fetchChecked(url, signal) {
  const response = await fetch(url, { signal, cache: "no-store" });
  if (!response.ok) throw new HttpError(response, url);
  return response;
}

export async function fetchJson(url, signal) {
  const response = await fetchChecked(url, signal);
  return response.json();
}

export function abortable(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const cancel = () => reject(signal.reason);
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

export function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", cancel);
      resolve();
    }, ms);
    function cancel() {
      clearTimeout(timer);
      reject(signal.reason);
    }
    signal?.addEventListener("abort", cancel, { once: true });
  });
}

export function timedSignal(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function retryable(error) {
  if (error instanceof HttpError) return error.status >= 500;
  return error.name === "TimeoutError" || error instanceof TypeError;
}

export async function withRetry(
  work,
  {
    attempts = 3,
    baseMs = 120,
    signal,
    random = Math.random,
    onRetry = () => {},
  } = {},
) {
  for (let attempt = 1; ; attempt += 1) {
    signal?.throwIfAborted();
    try {
      return await work();
    } catch (error) {
      signal?.throwIfAborted();
      if (attempt >= attempts || !retryable(error)) throw error;
      const wait = baseMs * 2 ** (attempt - 1) + random() * baseMs;
      onRetry({ attempt, wait, error });
      await delay(wait, signal);
    }
  }
}
