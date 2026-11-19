import "./style.css";
import { createExperiment } from "./experiments.js";
import { createInput } from "./input.js";
import { createLoop } from "./loop.js";
import { createCanvas } from "./render/canvas.js";
import { drawScene, interpolateShip } from "./render/draw.js";
import { ARENA, wrapShip } from "./sim/arena.js";
import { createShip, integrate } from "./sim/ship.js";

const canvas = createCanvas(document.querySelector("#arena"));
const keyboard = createInput(window);
const experiment = createExperiment();
let current = createShip(ARENA.width / 2, ARENA.height / 2);
let previous = current;

function resetShip() {
  current = createShip(ARENA.width / 2, ARENA.height / 2);
  previous = current;
}

function readControls() {
  const left = keyboard.isDown("KeyA") || keyboard.isDown("ArrowLeft");
  const right = keyboard.isDown("KeyD") || keyboard.isDown("ArrowRight");

  return {
    turn: Number(right) - Number(left),
    thrust: keyboard.isDown("KeyW") || keyboard.isDown("ArrowUp"),
  };
}

const loop = createLoop({
  clock: experiment?.clock,
  variable: experiment?.variable,

  simulate(dt) {
    if (keyboard.justPressed("KeyR") && !experiment?.isFlight) resetShip();
    const physicsDt = experiment?.flightStep(dt) ?? dt;
    if (physicsDt === 0) return;
    const input = experiment?.isFlight
      ? { turn: 0, thrust: true }
      : readControls();
    previous = current;
    current = wrapShip(integrate(current, input, physicsDt), ARENA);
  },

  render(alpha, stats) {
    experiment?.beforeDraw();
    const ship = interpolateShip(previous, current, alpha);
    drawScene(canvas.resize(), ship, stats);
    experiment?.afterDraw(stats, current);
  },
});

if (experiment) {
  drawScene(canvas.resize(), current, {
    stepsPerSecond: 0,
    framesPerSecond: 0,
    frameMs: 0,
  });
  experiment.setup(loop, resetShip);
} else {
  loop.start();
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    loop.stop();
    keyboard.destroy();
    experiment?.destroy();
  });
}
