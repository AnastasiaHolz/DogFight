import { createLoop } from "./loop.js";
import { drawScene, interpolateShip } from "./render/draw.js";
import { ARENA, wrapShip } from "./sim/arena.js";
import { createShip, integrate } from "./sim/flight.js";

export function startLab01({ canvas, keyboard, experiment, readControls }) {
  let current = createShip(ARENA.width / 2, ARENA.height / 2);
  let previous = current;

  function resetShip() {
    current = createShip(ARENA.width / 2, ARENA.height / 2);
    previous = current;
  }

  const loop = createLoop({
    clock: experiment.clock,
    variable: experiment.variable,

    simulate(dt) {
      if (keyboard.justPressed("KeyR") && !experiment.isFlight) resetShip();
      const physicsDt = experiment.flightStep(dt);
      if (physicsDt === 0) return;
      const input = experiment.isFlight
        ? { turn: 0, thrust: true }
        : readControls();
      previous = current;
      current = wrapShip(integrate(current, input, physicsDt), ARENA);
    },

    render(alpha, stats) {
      experiment.beforeDraw();
      const ship = interpolateShip(previous, current, alpha);
      drawScene(canvas.resize(), ship, stats);
      experiment.afterDraw(stats, current);
    },
  });

  drawScene(canvas.resize(), current, {
    stepsPerSecond: 0,
    framesPerSecond: 0,
    frameMs: 0,
  });
  experiment.setup(loop, resetShip);
  return loop;
}
