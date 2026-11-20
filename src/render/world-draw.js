import { ARENA, lerpWrapped } from "../sim/arena.js";
import { drawArena, drawHud, drawShip, drawWrapped } from "./draw.js";

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

function asteroid(ctx, entity, x, y, angle) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  for (const [i, factor] of [1, 0.78, 1, 0.88, 1, 0.74, 0.96, 0.87].entries()) {
    const a = (i / 8) * TAU;
    const px = Math.cos(a) * entity.radius * factor;
    const py = Math.sin(a) * entity.radius * factor;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = entity.homing ? "#553a71" : "#5c5559";
  ctx.strokeStyle = entity.homing ? "#d0a4ff" : "#c9a68e";
  ctx.lineWidth = 2;
  ctx.fill();
  ctx.stroke();
  circle(ctx, entity.radius * 0.3, 0, entity.radius * 0.18, "#282b47");
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

function paintEntity(ctx, entity, x, y, angle) {
  switch (entity.kind) {
    case "ship": {
      if (entity.shield > 0 || entity.protected) {
        ring(ctx, x, y, 23, entity.shield > 0 ? "#ffdf70" : "#91bdf58a");
      }
      const color = entity.team === "player" ? "#64e8d1" : "#f98c9e";
      drawShip(ctx, { x, y, angle, thrust: entity.thrust, color });
      if (entity.team === "rival") {
        ctx.fillStyle = "#071323";
        ctx.fillRect(x - 15, y - 28, 30, 4);
        ctx.fillStyle = color;
        ctx.fillRect(x - 15, y - 28, (30 * entity.hp) / 100, 4);
      }
      break;
    }
    case "asteroid":
      asteroid(ctx, entity, x, y, angle);
      break;
    case "bullet": {
      const color = entity.homing
        ? "#9ac7ff"
        : entity.team === "player"
          ? "#f6ffd2"
          : "#ffa480";
      circle(ctx, x, y, entity.radius, color);
      if (entity.homing) ring(ctx, x, y, entity.radius + 3, color);
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

function paintAtInterpolatedPosition(ctx, entity, alpha) {
  const x =
    entity.edge === "wrap"
      ? lerpWrapped(entity.prevPos.x, entity.pos.x, alpha, ARENA.width)
      : entity.prevPos.x + (entity.pos.x - entity.prevPos.x) * alpha;
  const y =
    entity.edge === "wrap"
      ? lerpWrapped(entity.prevPos.y, entity.pos.y, alpha, ARENA.height)
      : entity.prevPos.y + (entity.pos.y - entity.prevPos.y) * alpha;
  const angle = lerpWrapped(entity.prevAngle, entity.angle, alpha, TAU);

  if (entity.edge === "wrap") {
    const margin = entity.kind === "explosion" ? 76 : 34;
    drawWrapped(ctx, x, y, margin, (context, frameX, frameY) => {
      paintEntity(context, entity, frameX, frameY, angle);
    });
  } else {
    paintEntity(ctx, entity, x, y, angle);
  }
}

function drawScore({ ctx, width }, game) {
  const x = width - 137;
  ctx.fillStyle = "#0b1523";
  ctx.fillRect(x, 12, 125, 64);
  ctx.fillStyle = "#edf5ff";
  ctx.font = "13px monospace";
  ctx.fillText(`SCORE  ${game.score}`, x + 8, 31);
  ctx.fillText(`HP     ${game.player.hp}`, x + 8, 48);
  if (game.respawnIn !== null) {
    ctx.fillStyle = "#ffb887";
    ctx.fillText(`RESPAWN ${game.respawnIn.toFixed(1)}s`, x + 8, 65);
  } else {
    ctx.fillStyle = game.player.shield > 0 ? "#ffdf70" : "#a7b8cd";
    ctx.fillText(
      `SHIELD ${game.player.shield > 0 ? `${game.player.shield.toFixed(1)}s` : "—"}`,
      x + 8,
      65,
    );
  }
}

export function drawWorld(surface, game, alpha, stats) {
  drawArena(surface, (ctx) => {
    for (const entity of game.world) {
      if (entity.alive) paintAtInterpolatedPosition(ctx, entity, alpha);
    }
  });
  drawHud(surface.ctx, stats);
  drawScore(surface, game);
}
