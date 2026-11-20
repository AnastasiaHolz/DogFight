import "./style.css";
import { createExperiment } from "./experiments.js";
import { createInput } from "./input.js";
import { startLab01 } from "./lab01.js";
import { createLoop } from "./loop.js";
import { createCanvas } from "./render/canvas.js";
import { drawWorld } from "./render/world-draw.js";
import { Game } from "./sim/game.js";

const canvas = createCanvas(document.querySelector("#arena"));
const keyboard = createInput(window);
const experiment = createExperiment();

function readControls() {
  const left = keyboard.isDown("KeyA") || keyboard.isDown("ArrowLeft");
  const right = keyboard.isDown("KeyD") || keyboard.isDown("ArrowRight");
  const fire = keyboard.justPressed("Space") || keyboard.isDown("Space");
  const homing = keyboard.justPressed("KeyH") || keyboard.isDown("KeyH");

  return {
    turn: Number(right) - Number(left),
    thrust: keyboard.isDown("KeyW") || keyboard.isDown("ArrowUp"),
    fire,
    homing,
  };
}

function startGame() {
  let game = new Game();
  const loop = createLoop({
    simulate(dt) {
      if (keyboard.justPressed("KeyR")) game = new Game();
      game.step(dt, readControls());
    },
    render(alpha, stats) {
      drawWorld(canvas.resize(), game, alpha, stats);
    },
  });
  loop.start();
  return loop;
}

const loop = experiment
  ? startLab01({ canvas, keyboard, experiment, readControls })
  : startGame();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    loop.stop();
    keyboard.destroy();
    experiment?.destroy();
  });
}
