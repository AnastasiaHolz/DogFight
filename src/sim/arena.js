export const ARENA = { width: 960, height: 540 };

export function wrap(value, size) {
  return ((value % size) + size) % size;
}

export function wrapShip(ship, arena) {
  return {
    ...ship,
    x: wrap(ship.x, arena.width),
    y: wrap(ship.y, arena.height),
  };
}

export function lerpWrapped(from, to, alpha, size) {
  const distance = wrap(to - from + size / 2, size) - size / 2;
  return wrap(from + distance * alpha, size);
}
