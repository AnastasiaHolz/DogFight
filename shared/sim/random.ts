export function nextRandom(seed: number) {
  let value = seed >>> 0 || 1;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return value >>> 0;
}

export function seededRandom(seed: number) {
  return () => {
    seed = nextRandom(seed);
    return seed / 0x100000000;
  };
}
