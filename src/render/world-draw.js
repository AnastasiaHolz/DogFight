import { lerpWrapped } from "../sim/arena.js";
import { drawArena, drawWrapped } from "./draw.js";

const TAU = 2 * Math.PI;

function circle(ctx, x, y, radius, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, TAU);
  ctx.fill();
}

function ring(ctx, x, y, radius, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, TAU);
  ctx.stroke();
}

function tile(ctx, sheet, frame, x, y, size, angle = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.drawImage(sheet, frame * 64, 0, 64, 64, -size / 2, -size / 2, size, size);
  ctx.restore();
}

function flame(ctx, x, y, angle) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = "#ffb86f";
  ctx.beginPath();
  ctx.moveTo(-13, -4);
  ctx.lineTo(-27, 0);
  ctx.lineTo(-13, 4);
  ctx.fill();
  ctx.restore();
}

function pickup(ctx, x, y) {
  ring(ctx, x, y, 13, "#ffdf70");
  ctx.fillStyle = "#ffdf70";
  ctx.beginPath();
  ctx.moveTo(x, y - 8);
  ctx.lineTo(x + 7, y - 3);
  ctx.lineTo(x + 5, y + 5);
  ctx.lineTo(x, y + 9);
  ctx.lineTo(x - 5, y + 5);
  ctx.lineTo(x - 7, y - 3);
  ctx.closePath();
  ctx.fill();
}

function paintEntity(ctx, entity, x, y, angle, assets) {
  switch (entity.kind) {
    case "ship": {
      if (entity.shield > 0 || entity.protected) {
        ring(ctx, x, y, 23, entity.shield > 0 ? "#ffdf70" : "#91bdf58a");
      }
      const color = entity.team === "player" ? "#64e8d1" : "#f98c9e";
      if (entity.thrust) flame(ctx, x, y, angle);
      tile(
        ctx,
        assets.ships,
        entity.team === "player" ? 0 : 1,
        x,
        y,
        54,
        angle,
      );
      if (entity.team === "rival") {
        ctx.fillStyle = "#071323";
        ctx.fillRect(x - 15, y - 28, 30, 4);
        ctx.fillStyle = color;
        ctx.fillRect(x - 15, y - 28, (30 * entity.hp) / 100, 4);
      }
      break;
    }
    case "asteroid":
      tile(
        ctx,
        assets.objects,
        entity.homing ? 1 : 0,
        x,
        y,
        entity.radius * 2.2,
        angle,
      );
      break;
    case "bullet": {
      const frame = entity.homing ? 3 : entity.team === "player" ? 2 : 4;
      tile(ctx, assets.objects, frame, x, y, entity.radius * 3.5);
      break;
    }
    case "pickup":
      pickup(ctx, x, y);
      break;
    case "explosion":
      ctx.save();
      ctx.globalAlpha = 1 - entity.progress;
      for (const particle of entity.particles) {
        const offset = particle.vel.scale(entity.age);
        circle(ctx, x + offset.x, y + offset.y, particle.radius, entity.color);
      }
      ctx.restore();
      break;
    default:
      break;
  }
}

function paintAtInterpolatedPosition(ctx, entity, alpha, assets, arena) {
  const x =
    entity.edge === "wrap"
      ? lerpWrapped(entity.prevPos.x, entity.pos.x, alpha, arena.width)
      : entity.prevPos.x + (entity.pos.x - entity.prevPos.x) * alpha;
  const y =
    entity.edge === "wrap"
      ? lerpWrapped(entity.prevPos.y, entity.pos.y, alpha, arena.height)
      : entity.prevPos.y + (entity.pos.y - entity.prevPos.y) * alpha;
  const angle = lerpWrapped(entity.prevAngle, entity.angle, alpha, TAU);

  if (entity.edge === "wrap") {
    const margin = entity.kind === "explosion" ? 76 : 34;
    drawWrapped(
      ctx,
      x,
      y,
      margin,
      (context, frameX, frameY) => {
        paintEntity(context, entity, frameX, frameY, angle, assets);
      },
      arena,
    );
  } else {
    paintEntity(ctx, entity, x, y, angle, assets);
  }
}

export function drawWorld(surface, game, alpha, assets) {
  const arena = game.world.arena;
  drawArena(
    surface,
    (ctx) => {
      for (const entity of game.world) {
        if (entity.alive)
          paintAtInterpolatedPosition(ctx, entity, alpha, assets, arena);
      }
    },
    arena,
  );
}
