import "./style.css";
import { readDiagnostics } from "./assets/diagnostics.js";
import { abortable } from "./assets/http.js";
import {
  describeLoadError,
  prepareAssets,
  validArena,
} from "./assets/startup.js";
import { GameAudio } from "./audio.js";
import { createExperiment } from "./experiments.js";
import { createInput } from "./input.js";
import { startLab01 } from "./lab01.js";
import { Lobby } from "./lobby/lobby.js";
import { mountLobbyView } from "./lobby/view.js";
import { createLoop } from "./loop.js";
import { createCanvas } from "./render/canvas.js";
import { createHud } from "./render/hud.js";
import { drawLoading } from "./render/loading.js";
import { drawWorld } from "./render/world-draw.js";
import { Game } from "./sim/game.js";

const arenaCanvas = document.querySelector("#arena");
const canvas = createCanvas(arenaCanvas);
const experiment = createExperiment();

function readControls(keyboard) {
  const left = keyboard.isDown("KeyA") || keyboard.isDown("ArrowLeft");
  const right = keyboard.isDown("KeyD") || keyboard.isDown("ArrowRight");
  return {
    turn: Number(right) - Number(left),
    thrust: keyboard.isDown("KeyW") || keyboard.isDown("ArrowUp"),
    fire: keyboard.justPressed("Space") || keyboard.isDown("Space"),
    homing: keyboard.justPressed("KeyH") || keyboard.isDown("KeyH"),
  };
}

function nextPaint() {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  );
}

function startApplication() {
  const scope = new AbortController();
  const { signal } = scope;
  const audio = new GameAudio();
  const lobby = new Lobby();
  const diagnostics = readDiagnostics(window.location.search);
  const loadingPanel = document.querySelector("#loading-panel");
  const lobbyPanel = document.querySelector("#lobby-panel");
  const gamePanel = document.querySelector("#game-panel");
  const keys = document.querySelector("#keys");
  const loadStart = document.querySelector("#load-start");
  const loadCancel = document.querySelector("#load-cancel");
  const loadStatus = document.querySelector("#load-status");
  const startupSummary = document.querySelector("#startup-summary");
  const mute = document.querySelector("#mute-audio");
  let loading;
  let loaded;
  let stopGame;
  let muted = false;
  let view = "loading";
  let progress = { status: "Очікування запуску" };

  function show(name) {
    view = name;
    loadingPanel.hidden = name !== "loading";
    lobbyPanel.hidden = name !== "lobby";
    gamePanel.hidden = name !== "game";
    keys.hidden = name !== "game";
    arenaCanvas.hidden = name === "lobby";
  }

  function paintLoading() {
    if (view === "loading") drawLoading(canvas.resize(), progress);
  }

  function loadingState(state) {
    progress = { ...progress, ...state };
    paintLoading();
  }

  function showLobby() {
    stopGame?.();
    stopGame = undefined;
    show("lobby");
    lobby.show();
  }

  async function load() {
    if (loading) return;
    const operation = new AbortController();
    loading = operation;
    const attempt = { ...diagnostics };
    diagnostics.fault = null;
    loadStart.hidden = true;
    loadCancel.hidden = false;
    loadStatus.textContent = "Читаємо маніфест…";
    loadingState({
      done: 0,
      total: 0,
      id: "",
      status: "Завантаження ресурсів",
    });
    try {
      await abortable(audio.unlock(), operation.signal);
      const result = await prepareAssets(audio.context, attempt, {
        signal: operation.signal,
        onProgress({ done, total, id }) {
          loadStatus.textContent = `Ресурси: ${done}/${total}`;
          loadingState({ done, total, id: id ?? "" });
        },
        onRetry({ id, attempt: number }) {
          loadStatus.textContent = `Повтор завантаження ${id} (${number + 1}/3)…`;
        },
      });

      loadingState({ id: "", status: "Ресурси готові" });
      await abortable(nextPaint(), operation.signal);
      loaded = result.assets;
      const strategy = attempt.sequential ? "послідовно" : "одночасно";
      startupSummary.textContent = `Ресурси: ${result.total}/${result.total} · ${result.elapsed.toFixed(1)} мс · ${strategy}`;
      showLobby();
    } catch (error) {
      if (signal.aborted) return;
      loadStatus.textContent = describeLoadError(error);
      loadingState({
        status:
          error.name === "AbortError"
            ? "Завантаження скасовано"
            : "Завантаження перервано",
      });
      loadStart.textContent = "Retry";
      loadStart.hidden = false;
    } finally {
      loading = undefined;
      loadCancel.hidden = true;
    }
  }

  function play({ room, playerName }) {
    const override = { ...loaded.arena, ...room.arena };
    const arena = validArena(override) ? override : loaded.arena;
    const keyboard = createInput(window);
    const events = new EventTarget();
    const match = new AbortController();
    const hud = createHud(events, match.signal);
    let game = new Game({ arena, events });
    audio.listen(events, loaded, match.signal);
    document.querySelector("#game-room").textContent =
      `${playerName} · ${room.name} · ${arena.width} × ${arena.height}`;
    show("game");

    const loop = createLoop({
      simulate(dt) {
        if (keyboard.justPressed("KeyR")) {
          game = new Game({ arena, events });
          hud.reset();
        }
        game.step(dt, readControls(keyboard));
      },
      render(alpha, stats) {
        const surface = canvas.resize();
        drawWorld(surface, game, alpha, loaded);
        hud.draw(surface, game, stats);
      },
    });
    loop.start();
    stopGame = () => {
      loop.stop();
      keyboard.destroy();
      match.abort();
    };
  }

  mountLobbyView(lobby, lobbyPanel, signal);
  lobby.addEventListener("joined", ({ detail }) => play(detail), { signal });
  loadStart.addEventListener("click", () => void load(), { signal });
  loadCancel.addEventListener("click", () => loading?.abort(), { signal });
  document
    .querySelector("#leave-room")
    .addEventListener("click", showLobby, { signal });
  mute.addEventListener(
    "click",
    () => {
      muted = !muted;
      audio.muted = muted;
      mute.textContent = muted ? "Увімкнути звук" : "Вимкнути звук";
      mute.setAttribute("aria-pressed", String(muted));
    },
    { signal },
  );

  const resize = new ResizeObserver(paintLoading);
  resize.observe(arenaCanvas);
  paintLoading();
  return () => {
    scope.abort();
    loading?.abort();
    lobby.hide();
    stopGame?.();
    resize.disconnect();
    void audio.dispose()?.catch(() => {});
  };
}

let dispose;
if (experiment) {
  document.querySelector("#loading-panel").hidden = true;
  document.querySelector("#keys").hidden = false;
  const keyboard = createInput(window);
  const loop = startLab01({
    canvas,
    keyboard,
    experiment,
    readControls: () => readControls(keyboard),
  });
  dispose = () => {
    loop.stop();
    keyboard.destroy();
    experiment.destroy();
  };
} else {
  dispose = startApplication();
}

if (import.meta.hot) import.meta.hot.dispose(dispose);
