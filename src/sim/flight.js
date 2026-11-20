export const TAU = 2 * Math.PI;
export const TURN_SPEED = 3.2;
export const ACCELERATION = 240;
export const DRAG = 0.75;
export const MAX_SPEED = 290;

export function createShip(x, y) {
  return { x, y, vx: 0, vy: 0, angle: 0, thrust: false };
}

export function integrate(ship, input, dt) {
  const angle =
    (((ship.angle + input.turn * TURN_SPEED * dt) % TAU) + TAU) % TAU;
  const acceleration = input.thrust ? ACCELERATION : 0;
  const damping = Math.exp(-DRAG * dt);

  let vx = (ship.vx + Math.cos(angle) * acceleration * dt) * damping;
  let vy = (ship.vy + Math.sin(angle) * acceleration * dt) * damping;

  const speed = Math.hypot(vx, vy);
  if (speed > MAX_SPEED) {
    vx *= MAX_SPEED / speed;
    vy *= MAX_SPEED / speed;
  }

  return {
    x: ship.x + vx * dt,
    y: ship.y + vy * dt,
    vx,
    vy,
    angle,
    thrust: input.thrust,
  };
}
