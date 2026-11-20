export const VERSION = 0;
export const MAX_PAYLOAD = 4096;
export const CLOSE = Object.freeze({
  unsupported: 1003,
  invalidJson: 1007,
  badMessage: 1008,
  oversize: 1009,
  busy: 1013,
  full: 4403,
  missing: 4404,
  joinTimeout: 4408,
  rate: 4429,
});

export type RateOptions = { rate?: number; burst?: number; now?: () => number };

export function tokenBucket({
  rate = 8,
  burst = 12,
  now = () => performance.now(),
}: RateOptions = {}) {
  let tokens = burst;
  let last = now();
  return () => {
    const time = now();
    tokens = Math.min(burst, tokens + ((time - last) / 1000) * rate);
    last = time;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}
