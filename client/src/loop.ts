export type FrameStats = {
  stepsPerSecond: number;
  framesPerSecond: number;
  frameMs: number;
  now: number;
};
export type Loop = { start(): void; stop(): void };

export const STEP = 1 / 60;
const MAX_FRAME_SECONDS = 0.25;
const EPSILON = 1e-9;

export function createLoop({
  step = STEP,
  simulate,
  render,
  clock = "raf",
  variable = false,
}: {
  step?: number;
  simulate(dt: number): void;
  render(alpha: number, stats: FrameStats): void;
  clock?: "raf" | "interval";
  variable?: boolean;
}): Loop {
  let running = false;
  let requestId: number | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let lastTime: number | undefined;
  let accumulator = 0;
  let windowStart: number | undefined;
  let steps = 0;
  let frames = 0;
  let stepsPerSecond = 0;
  let framesPerSecond = 0;

  function frame(now: number) {
    if (!running) return;

    const frameMs = lastTime === undefined ? 0 : now - lastTime;
    lastTime = now;
    windowStart ??= now;
    const dt = Math.min(frameMs / 1000, MAX_FRAME_SECONDS);

    if (variable) {
      if (dt > 0) {
        simulate(dt);
        steps += 1;
      }
    } else {
      accumulator += dt;
      while (accumulator + EPSILON >= step) {
        simulate(step);
        steps += 1;
        accumulator = Math.max(0, accumulator - step);
      }
    }

    frames += 1;
    const windowMs = now - windowStart;
    if (windowMs >= 1000) {
      stepsPerSecond = (steps * 1000) / windowMs;
      framesPerSecond = (frames * 1000) / windowMs;
      windowStart = now;
      steps = 0;
      frames = 0;
    }

    render(variable ? 1 : accumulator / step, {
      stepsPerSecond,
      framesPerSecond,
      frameMs,
      now,
    });

    if (running && clock === "raf") requestId = requestAnimationFrame(frame);
  }

  function start() {
    if (running) return;
    running = true;
    lastTime = undefined;
    windowStart = undefined;
    accumulator = 0;
    steps = 0;
    frames = 0;
    stepsPerSecond = 0;
    framesPerSecond = 0;
    if (clock === "interval")
      timer = setInterval(() => frame(performance.now()), 16);
    else requestId = requestAnimationFrame(frame);
  }

  function stop() {
    if (!running) return;
    running = false;
    if (clock === "interval") clearInterval(timer);
    else if (requestId !== undefined) cancelAnimationFrame(requestId);
  }

  return { start, stop };
}
