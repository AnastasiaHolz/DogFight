import type {
  Arena,
  CodecName,
  Controls,
  EntityId,
  SnapshotEntity,
} from "@dogfight/shared/protocol";
import { unreachable } from "@dogfight/shared/protocol";
import { KINDS, STEP } from "@dogfight/shared/protocol/messages";
import { EXPLOSION_TICKS } from "@dogfight/shared/sim/battle";
import { seededRandom } from "@dogfight/shared/sim/random";
import { Vector2 } from "@dogfight/shared/sim/vector";
import type { Assets } from "../assets/startup.ts";
import type { GameAudio } from "../audio.ts";
import type { GameEvents } from "../bus.ts";
import { Bus } from "../bus.ts";
import type { createInput } from "../input.ts";
import { createLoop } from "../loop.ts";
import type { CanvasSurface } from "../render/canvas.ts";
import { drawHud } from "../render/draw.ts";
import { drawScore } from "../render/hud.ts";
import type { Particle, RenderEntity } from "../render/world-draw.ts";
import { drawWorld } from "../render/world-draw.ts";
import type { RoomConnection } from "./connection.ts";
import { drawNetgraph } from "./netgraph.ts";
import { Prediction } from "./prediction.ts";
import type { NetworkSettings } from "./settings.ts";

function shape(
  e: SnapshotEntity,
  player: EntityId,
  seed: number,
  particleCache: Map<EntityId, Particle[]>,
): RenderEntity {
  const pos = { x: e.x, y: e.y };
  const edge: RenderEntity["edge"] =
    e.kind === "asteroid" || e.kind === "pickup" ? "none" : "wrap";
  const render = {
    pos,
    prevPos: pos,
    radius: e.r,
    angle: e.angle,
    prevAngle: e.angle,
    alive: e.kind !== "ship" || e.hp > 0,
    edge,
  };
  const team = e.owner === player ? "player" : "rival";
  switch (e.kind) {
    case "ship":
      return {
        ...render,
        kind: e.kind,
        team,
        hp: e.hp,
        thrust: e.thrust,
        shield: e.shield * STEP,
        protected: e.guard > 0,
      };
    case "asteroid":
      return { ...render, kind: e.kind, homing: e.homing };
    case "bullet":
      return { ...render, kind: e.kind, team, homing: e.homing };
    case "pickup":
      return { ...render, kind: e.kind };
    case "explosion": {
      let particles = particleCache.get(e.id);
      if (!particles) {
        const random = seededRandom(seed ^ e.id);
        particles = Array.from({ length: 14 }, (_, index) => ({
          vel: Vector2.fromAngle((index / 14) * 2 * Math.PI).scale(
            32 + random() * 105,
          ),
          radius: 1.2 + random() * 2.3,
        }));
        particleCache.set(e.id, particles);
      }
      return {
        ...render,
        kind: e.kind,
        particles,
        color: "#ffce92",
        progress: 1 - e.ttl / EXPLOSION_TICKS,
        age: (EXPLOSION_TICKS - e.ttl) * STEP,
      };
    }
    default:
      return unreachable(e);
  }
}

export function startSession({
  connection,
  info,
  settings,
  canvas,
  keyboard,
  assets,
  audio,
  readControls,
}: {
  connection: RoomConnection;
  info: { seed: number; arena: Arena; netId: EntityId; codec: CodecName };
  settings: NetworkSettings;
  canvas: CanvasSurface;
  keyboard: ReturnType<typeof createInput>;
  assets: Assets;
  audio: GameAudio;
  readControls: (keyboard: ReturnType<typeof createInput>) => Controls;
}) {
  const lifecycle = new AbortController();
  const { signal } = lifecycle;
  const { seed, arena, netId, codec } = info;
  const model = new Prediction({ player: netId, arena, settings });
  const effects = new Bus<GameEvents>();
  const particleCache = new Map<EntityId, Particle[]>();
  const traffic: { time: number; sent?: number; received?: number }[] = [];
  const probes = new Map<number, number>();
  let probe = 0;
  let lastProbe = -Infinity;
  let rtt: number | undefined;
  audio.listen(effects, assets, signal);

  function sound(name: keyof GameEvents) {
    effects.emit(name, undefined);
  }

  connection.addEventListener(
    "traffic",
    ({ detail }) => {
      traffic.push({ ...detail, time: performance.now() });
    },
    { signal },
  );
  connection.addEventListener(
    "pong",
    ({ detail }) => {
      const start = probes.get(detail.id);
      if (start !== undefined) {
        rtt = performance.now() - start;
        probes.delete(detail.id);
      }
    },
    { signal },
  );
  connection.addEventListener(
    "snapshot",
    ({ detail }) => {
      const prior = model.latest?.snapshot.entities;
      if (!model.receive(detail, performance.now()) || !prior) return;
      const memory = new Map(prior.map((e) => [e.id, e]));
      for (const item of detail.entities) {
        const old = memory.get(item.id);
        if (!old && item.k === KINDS.explosion) sound("exploded");
        else if (
          !old &&
          item.k === KINDS.bullet &&
          (item.owner !== netId || !settings.predict)
        )
          sound("fired");
        else if (
          old &&
          (item.k === KINDS.ship || item.k === KINDS.asteroid) &&
          item.hp < old.hp
        )
          sound("hit");
      }
    },
    { signal },
  );

  const loop = createLoop({
    step: STEP,
    simulate() {
      if (!connection.ready) return;
      const shot = model.next(readControls(keyboard), (input) =>
        connection.sendInput(input),
      );
      if (shot) sound("fired");
    },
    render(_alpha, stats) {
      const now = performance.now();
      if (connection.ready && now - lastProbe >= 1000) {
        for (const [id, start] of probes)
          if (now - start >= 5000) probes.delete(id);
        lastProbe = now;
        probe += 1;
        probes.set(probe, now);
        connection.probe(probe);
      }
      while (traffic[0] && now - traffic[0].time >= 1000) traffic.shift();
      const down = traffic.reduce(
        (sum, record) => sum + (record.received ?? 0),
        0,
      );
      const up = traffic.reduce((sum, record) => sum + (record.sent ?? 0), 0);
      const own = model.authoritative;
      const entities = model.scene(now);
      const activeParticles = new Set(
        entities.filter((e) => e.k === KINDS.explosion).map((e) => e.id),
      );
      for (const id of particleCache.keys())
        if (!activeParticles.has(id)) particleCache.delete(id);
      const surface = canvas.resize();
      drawWorld(
        surface,
        {
          world: {
            arena,
            *[Symbol.iterator]() {
              for (const raw of entities)
                yield shape(raw, netId, seed, particleCache);
            },
          },
        },
        1,
        assets,
      );
      drawHud(surface.ctx, stats);
      drawScore(
        surface,
        {
          player: { hp: own?.hp ?? 0, shield: (own?.shield ?? 0) * STEP },
          respawnIn: own && own.hp === 0 ? own.respawn * STEP : null,
        },
        own?.score ?? 0,
      );
      const estimatedAge =
        model.latest && now - model.latest.now + (rtt ?? 0) / 2;
      drawNetgraph(surface, {
        ...settings,
        codec,
        rtt: rtt === undefined ? "—" : Math.round(rtt),
        age: estimatedAge === undefined ? "—" : Math.round(estimatedAge),
        down,
        up,
        pending: model.pending.length,
        correction: model.correction,
        average: model.average,
        tick: model.latest?.snapshot.tick ?? 0,
      });
    },
  });
  loop.start();
  return () => {
    loop.stop();
    lifecycle.abort();
  };
}
