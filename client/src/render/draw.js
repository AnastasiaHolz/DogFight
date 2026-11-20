import { ARENA, lerpWrapped } from "../sim/arena.js";
import { TAU } from "../sim/flight.js";

export function interpolateShip(previous, current, alpha) {
  return {
    ...current,
    x: lerpWrapped(previous.x, current.x, alpha, ARENA.width),
    y: lerpWrapped(previous.y, current.y, alpha, ARENA.height),
    angle: lerpWrapped(previous.angle, current.angle, alpha, TAU),
  };
}

function drawGrid(ctx, arena) {
  ctx.strokeStyle = arena.grid ?? "#233950";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= arena.width; x += 48) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, arena.height);
  }
  for (let y = 0; y <= arena.height; y += 45) {
    ctx.moveTo(0, y);
    ctx.lineTo(arena.width, y);
  }
  ctx.stroke();
  ctx.fillStyle = "#6a9ab5";
  for (let i = 0; i < 40; i += 1) {
    const x = (i * 137 + 17) % arena.width;
    const y = (i * 79 + 29) % arena.height;
    ctx.fillRect(x, y, i % 4 === 0 ? 2 : 1, 1);
  }
}

function shipPath(ctx, points, color, outline) {
  ctx.beginPath();
  ctx.moveTo(...points[0]);
  for (const [x, y] of points.slice(1)) ctx.lineTo(x, y);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  if (outline) {
    ctx.strokeStyle = outline;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

export function drawShip(ctx, ship) {
  ctx.save();
  ctx.translate(ship.x, ship.y);
  ctx.rotate(ship.angle);

  if (ship.thrust) {
    shipPath(
      ctx,
      [
        [-9, -4],
        [-26, 0],
        [-9, 4],
      ],
      "#ffb86f",
    );
  }
  shipPath(
    ctx,
    [
      [19, 0],
      [-12, -10],
      [-7, 0],
      [-12, 10],
    ],
    ship.color ?? "#64e8d1",
    "#e8f9ff",
  );
  ctx.restore();
}

export function drawHud(ctx, stats) {
  ctx.fillStyle = "#0b1523";
  ctx.fillRect(12, 12, 143, 64);
  ctx.fillStyle = "#c7fdf2";
  ctx.font = "13px monospace";
  ctx.fillText(`steps/s  ${stats.stepsPerSecond.toFixed(1)}`, 21, 31);
  ctx.fillText(`frames/s ${stats.framesPerSecond.toFixed(1)}`, 21, 48);
  ctx.fillText(`frame ms ${stats.frameMs.toFixed(1)}`, 21, 65);
}

export function drawArena({ ctx, width, height }, paint, arena = ARENA) {
  ctx.fillStyle = "#101c2b";
  ctx.fillRect(0, 0, width, height);
  const scale = Math.min(width / arena.width, height / arena.height);
  const offsetX = (width - arena.width * scale) / 2;
  const offsetY = (height - arena.height * scale) / 2;
  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);
  ctx.beginPath();
  ctx.rect(0, 0, arena.width, arena.height);
  ctx.clip();
  ctx.fillStyle = arena.background ?? "#132237";
  ctx.fillRect(0, 0, arena.width, arena.height);
  drawGrid(ctx, arena);
  paint(ctx);
  ctx.restore();
}

export function drawWrapped(ctx, x, y, margin, paint, arena = ARENA) {
  const xs = [0];
  const ys = [0];
  if (x < margin) xs.push(arena.width);
  if (x > arena.width - margin) xs.push(-arena.width);
  if (y < margin) ys.push(arena.height);
  if (y > arena.height - margin) ys.push(-arena.height);
  for (const dx of xs) {
    for (const dy of ys) paint(ctx, x + dx, y + dy);
  }
}

export function drawScene(surface, ship, stats) {
  drawArena(surface, (ctx) => {
    drawWrapped(ctx, ship.x, ship.y, 28, (context, x, y) => {
      drawShip(context, { ...ship, x, y });
    });
  });
  drawHud(surface.ctx, stats);
}
