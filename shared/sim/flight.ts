export const TAU = 2 * Math.PI;
export const TURN_SPEED = 3.2;
export const ACCELERATION = 240;
export const DRAG = 0.75;
export const MAX_SPEED = 290;

export type FlightState = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  thrust: boolean;
};
export type FlightInput = {
  turn: number;
  thrust: boolean;
  fire?: boolean;
  homing?: boolean;
};

export function createShip(x: number, y: number): FlightState {
  return { x, y, vx: 0, vy: 0, angle: 0, thrust: false };
}

export function integrate(
  ship: FlightState,
  input: FlightInput,
  dt: number,
): FlightState {
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
