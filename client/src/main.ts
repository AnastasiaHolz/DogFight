import type {
  CodecName,
  Controls,
  EntityId,
  RoomInfo,
} from "@dogfight/shared/protocol";
import type { Assets } from "./assets/startup.ts";
import { element } from "./dom.ts";
import type { LobbyJoin } from "./lobby/lobby.ts";
import type { LoadingProgress } from "./render/loading.ts";
import "./style.css";
import { readDiagnostics } from "./assets/diagnostics.ts";
import { abortable } from "./assets/http.ts";
import {
  describeLoadError,
  prepareAssets,
  validArena,
} from "./assets/startup.ts";
import { GameAudio } from "./audio.ts";
import { createExperiment } from "./experiments.ts";
import { createInput } from "./input.ts";
import { startLab01 } from "./lab01.ts";
import { Lobby } from "./lobby/lobby.ts";
import { mountLobbyView } from "./lobby/view.ts";
import { mountChatView } from "./network/chat-view.ts";
import { RoomConnection, webSocketUrl } from "./network/connection.ts";
import { startSession } from "./network/session.ts";
import {
  mountNetworkSettings,
  readNetworkSettings,
} from "./network/settings.ts";
import { createCanvas } from "./render/canvas.ts";
import { drawLoading } from "./render/loading.ts";

const arenaCanvas = element("#arena", HTMLCanvasElement);
const canvas = createCanvas(arenaCanvas);
const experiment = createExperiment();

function readControls(keyboard: ReturnType<typeof createInput>): Controls {
  const left = keyboard.isDown("KeyA") || keyboard.isDown("ArrowLeft");
  const right = keyboard.isDown("KeyD") || keyboard.isDown("ArrowRight");
  return {
    turn: left === right ? 0 : right ? 1 : -1,
    thrust: keyboard.isDown("KeyW") || keyboard.isDown("ArrowUp"),
    fire: keyboard.justPressed("Space") || keyboard.isDown("Space"),
    homing: keyboard.justPressed("KeyH") || keyboard.isDown("KeyH"),
  };
}

function nextPaint() {
  return new Promise<DOMHighResTimeStamp>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  );
}

function startApplication() {
  const scope = new AbortController();
  const { signal } = scope;
  const audio = new GameAudio();
  const lobby = new Lobby();
  const diagnostics = readDiagnostics(window.location.search);
  const network = readNetworkSettings(window.location.search);
  mountNetworkSettings(
    network,
    element("#network-settings", HTMLElement),
    signal,
  );
  const loadingPanel = element("#loading-panel", HTMLElement);
  const lobbyPanel = element("#lobby-panel", HTMLElement);
  const gamePanel = element("#game-panel", HTMLElement);
  const keys = element("#keys", HTMLElement);
  const loadStart = element("#load-start", HTMLButtonElement);
  const loadCancel = element("#load-cancel", HTMLButtonElement);
  const loadStatus = element("#load-status", HTMLElement);
  const startupSummary = element("#startup-summary", HTMLElement);
  const mute = element("#mute-audio", HTMLButtonElement);
  const notice = element("#room-notice", HTMLElement);
  const replayInfo = element("#replay-info", HTMLElement);
  const replayLink = element("#replay-link", HTMLAnchorElement);
  let replayId: string | undefined;
  let loading: AbortController | undefined;
  let loaded: Assets | undefined;
  let stopGame: (() => void) | undefined;
  let muted = false;
  type View = "loading" | "lobby" | "game";
  let view: View = "loading";
  let progress: LoadingProgress = { status: "Очікування запуску" };

  function show(name: View) {
    view = name;
    loadingPanel.hidden = name !== "loading";
    lobbyPanel.hidden = name !== "lobby";
    gamePanel.hidden = name !== "game";
    keys.hidden = name !== "game";
    arenaCanvas.hidden = name === "lobby";
    replayInfo.hidden = name !== "lobby" || !replayId;
  }

  function paintLoading() {
    if (view === "loading") drawLoading(canvas.resize(), progress);
  }

  function loadingState(state: Partial<LoadingProgress>) {
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
      const context = await abortable(audio.unlock(), operation.signal);
      const result = await prepareAssets(context, attempt, {
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
    } catch (error: unknown) {
      if (signal.aborted) return;
      loadStatus.textContent = describeLoadError(error);
      loadingState({
        status:
          error instanceof Error && error.name === "AbortError"
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

  function play({
    room,
    playerName,
    connection,
    seed,
    netId,
    codec,
  }: {
    room: RoomInfo;
    playerName: string;
    connection: RoomConnection;
    seed: number;
    netId: EntityId;
    codec: CodecName;
  }) {
    if (!loaded) throw new Error("Assets must be loaded before joining");
    const override = { ...loaded.arena, ...room.arena };
    const arena = validArena(override) ? override : loaded.arena;
    const keyboard = createInput(window);
    element("#game-room", HTMLElement).textContent =
      `${playerName} · ${room.name} · ${arena.width} × ${arena.height}`;
    arenaCanvas.tabIndex = 0;
    arenaCanvas.focus({ preventScroll: true });
    const stop = startSession({
      connection,
      settings: network,
      canvas,
      keyboard,
      assets: loaded,
      audio,
      readControls,
      info: { seed, arena, netId, codec },
    });
    return () => {
      stop();
      keyboard.destroy();
    };
  }

  function enter({ room, playerName }: LobbyJoin) {
    notice.textContent = "";
    const url = new URL(webSocketUrl(window.location));
    if (!network.binary) url.searchParams.set("codec", "json");
    const connection = new RoomConnection({
      url: url.href,
      network,
      room: room.id,
      name: playerName,
    });
    const networkScope = new AbortController();
    const networkOptions = { signal: networkScope.signal };
    let stopLocal: (() => void) | undefined;
    show("game");
    element("#game-room", HTMLElement).textContent =
      `${playerName} · ${room.name}`;
    drawLoading(canvas.resize(), { status: "Приєднання до кімнати" });
    mountChatView(connection, gamePanel, networkScope.signal);

    stopGame = () => {
      networkScope.abort();
      connection.stop();
      stopLocal?.();
    };
    connection.addEventListener(
      "joined",
      ({ detail }) => {
        replayId = detail.replayId;
        replayLink.href = `/api/replays/${encodeURIComponent(replayId)}`;
        stopLocal?.();
        stopLocal = play({
          room: detail.room,
          playerName,
          connection,
          netId: detail.player.netId,
          seed: detail.seed,
          codec: detail.codec,
        });
      },
      networkOptions,
    );
    connection.addEventListener(
      "terminal",
      ({ detail }) => {
        notice.textContent = detail;
        showLobby();
      },
      networkOptions,
    );
    connection.connect();
  }

  mountLobbyView(lobby, lobbyPanel, signal);
  lobby.addEventListener("joined", ({ detail }) => enter(detail), { signal });
  loadStart.addEventListener("click", () => void load(), { signal });
  loadCancel.addEventListener("click", () => loading?.abort(), { signal });
  element("#leave-room", HTMLButtonElement).addEventListener(
    "click",
    showLobby,
    { signal },
  );
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

let dispose: () => void;
if (experiment) {
  element("#loading-panel", HTMLElement).hidden = true;
  element("#keys", HTMLElement).hidden = false;
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
