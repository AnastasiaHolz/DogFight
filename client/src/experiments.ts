import type { Point } from "@dogfight/shared/sim/vector";
import { element } from "./dom.ts";
import type { FrameStats, Loop } from "./loop.ts";

const titles = {
  busy: "Дослід 1 · rAF + busy-wait",
  raf: "Контроль / дослід 2 · rAF",
  interval: "Дослід 2 · setInterval(16)",
  fixed: "Дослід 3 · Фіксований крок",
  variable: "Дослід 3 · Змінний крок",
};

const FLIGHT_SECONDS = 5;
const EPSILON = 1e-9;

function round(value: number) {
  return Number(value.toFixed(2));
}

function timing(samples: readonly number[]) {
  if (samples.length === 0) return "немає кадрів";
  const low = Math.min(...samples);
  const high = Math.max(...samples);
  const sorted = [...samples].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? low;
  return `${round(low)}–${round(high)} мс (розмах ${round(high - low)} мс, медіана ${round(median)} мс)`;
}

type Mode = keyof typeof titles;
function isMode(value: string | null): value is Mode {
  return value !== null && Object.hasOwn(titles, value);
}

export type Experiment = {
  clock: "interval" | "raf";
  variable: boolean;
  isFlight: boolean;
  setup(loop: Loop, reset: () => void): void;
  destroy(): void;
  flightStep(dt: number): number;
  beforeDraw(): void;
  afterDraw(stats: FrameStats, ship: Point): void;
};
export function createExperiment(): Experiment | null {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get("lab");
  if (!isMode(mode)) return null;

  const section = element("#experiment", HTMLElement);
  const title = element("#experiment-title", HTMLElement);
  const status = element("#experiment-status", HTMLElement);
  const button = element("#experiment-start", HTMLButtonElement);
  const result = element("#experiment-result", HTMLElement);
  const isFlight = mode === "fixed" || mode === "variable";
  const backgroundTest = !isFlight && mode !== "busy";
  const stress = isFlight && params.get("stress") === "1";

  let loop: Loop | undefined;
  let resetShip: (() => void) | undefined;
  let frames = 0;
  let blocks = 0;
  let postBlockIntervals: number[] = [];
  let firstTimestamp: number | undefined;
  let samples: number[] = [];
  let flightTime = 0;
  let flightSteps = 0;
  let longestFrame = 0;
  let visibleResult: string[] | undefined;
  let hiddenAt: number | undefined;
  let hiddenFrames = 0;
  let lastHiddenTimestamp: number | undefined;
  let hiddenSamples: number[] = [];
  let waitingForTab = false;
  let workSeed = 1;

  function finish(lines: readonly string[]) {
    loop?.stop();
    result.textContent = lines.join("\n");
    status.textContent =
      "Готово. Скопіюй результат у README або повтори вимірювання.";
    button.disabled = false;
  }

  function onStart() {
    resetShip?.();
    frames = 0;
    blocks = 0;
    postBlockIntervals = [];
    firstTimestamp = undefined;
    samples = [];
    flightTime = 0;
    flightSteps = 0;
    longestFrame = 0;
    visibleResult = undefined;
    hiddenAt = undefined;
    hiddenFrames = 0;
    lastHiddenTimestamp = undefined;
    hiddenSamples = [];
    waitingForTab = false;
    workSeed = 1;
    button.disabled = true;
    result.textContent = "";
    status.textContent = isFlight
      ? "Автопілот утримує тягу 5 секунд симуляції. Клавіші не потрібні."
      : "Залиш цю вкладку активною, доки не закінчиться замір на 10 секунд.";
    loop?.start();
  }

  function onVisibility() {
    if (!waitingForTab) return;

    if (document.hidden) {
      hiddenAt = performance.now();
      hiddenFrames = 0;
      lastHiddenTimestamp = undefined;
      hiddenSamples = [];
    } else if (hiddenAt !== undefined) {
      const hiddenSeconds = (performance.now() - hiddenAt) / 1000;
      hiddenAt = undefined;
      if (hiddenSeconds < 4.5) {
        status.textContent =
          "Вкладка була у фоні замало. Перемкнись ще раз приблизно на 5 секунд.";
        return;
      }
      waitingForTab = false;
      finish([
        ...(visibleResult ?? []),
        `Фон: ${round(hiddenSeconds)} с, ${hiddenFrames} кадрів (${round(hiddenFrames / hiddenSeconds)} кадрів/с)`,
        `Інтервали між фоновими кадрами: ${timing(hiddenSamples)}`,
      ]);
    }
  }

  return {
    clock: mode === "interval" ? "interval" : "raf",
    variable: mode === "variable",
    isFlight,

    setup(gameLoop, reset) {
      loop = gameLoop;
      resetShip = reset;
      section.hidden = false;
      title.textContent = `${titles[mode]}${stress ? " + однакове навантаження" : ""}`;
      status.textContent = "Натисни кнопку, щоб почати контрольований запуск.";
      button.addEventListener("click", onStart);
      document.addEventListener("visibilitychange", onVisibility);
    },

    destroy() {
      button.removeEventListener("click", onStart);
      document.removeEventListener("visibilitychange", onVisibility);
    },

    flightStep(dt) {
      if (!isFlight) return dt;
      const remaining = FLIGHT_SECONDS - flightTime;
      if (remaining < EPSILON) return 0;
      const physicsDt = mode === "fixed" ? dt : Math.min(dt, remaining);
      flightTime += physicsDt;
      flightSteps += 1;
      return physicsDt;
    },

    beforeDraw() {
      if (stress) {
        for (let i = 0; i < 1_000_000; i += 1) {
          workSeed = Math.imul(workSeed ^ i, 31);
        }
      }
      if (mode === "busy" && (frames + 1) % 60 === 0) {
        const start = performance.now();
        while (performance.now() < start + 100) {}
        blocks += 1;
      }
    },

    afterDraw(stats, ship) {
      if (mode === "busy" && frames > 0 && frames % 60 === 0) {
        postBlockIntervals.push(stats.frameMs);
      }
      frames += 1;
      firstTimestamp ??= stats.now;
      longestFrame = Math.max(longestFrame, stats.frameMs);
      const elapsed = (stats.now - firstTimestamp) / 1000;

      if (isFlight) {
        if (flightTime < FLIGHT_SECONDS - EPSILON) return;
        finish([
          `Симуляція: ${flightTime.toFixed(3)} с, ${flightSteps} кроків`,
          `Позиція: x = ${ship.x.toFixed(4)}, y = ${ship.y.toFixed(4)}`,
          `Кадри: ${frames - 1} за ${round(elapsed)} с (${round((frames - 1) / elapsed)} кадрів/с)`,
          `Найдовший інтервал: ${round(longestFrame)} мс`,
          ...(stress ? [`Контрольна сума навантаження: ${workSeed}`] : []),
        ]);
        return;
      }

      if (waitingForTab) {
        if (document.hidden && hiddenAt !== undefined) {
          hiddenFrames += 1;
          if (lastHiddenTimestamp !== undefined) {
            hiddenSamples.push(stats.now - lastHiddenTimestamp);
          }
          lastHiddenTimestamp = stats.now;
        }
        return;
      }

      if (stats.frameMs > 0) samples.push(stats.frameMs);
      if (elapsed < 10) return;

      visibleResult = [
        `Активна вкладка: ${round(elapsed)} с, ${samples.length} інтервалів (${round(samples.length / elapsed)} кадрів/с)`,
        `Інтервали між кадрами: ${timing(samples)}`,
        `HUD на кінець заміру: ${round(stats.stepsPerSecond)} кроків/с, ${round(stats.framesPerSecond)} кадрів/с`,
      ];
      if (backgroundTest) {
        result.textContent = visibleResult.join("\n");
        status.textContent =
          "Тепер перемкнись на іншу вкладку приблизно на 5 секунд, а потім повернись.";
        waitingForTab = true;
      } else {
        finish([
          ...(visibleResult ?? []),
          `Кількість блокувань: ${blocks} × 100 мс`,
          `Інтервали одразу після блокувань: ${timing(postBlockIntervals)}`,
        ]);
      }
    },
  };
}
