import { ARENA, lerpWrapped } from "../sim/arena.js";
import { TAU } from "../sim/ship.js";

export function interpolateShip(previous, current, alpha) {
  return {
    ...current,
    x: lerpWrapped(previous.x, current.x, alpha, ARENA.width),
    y: lerpWrapped(previous.y, current.y, alpha, ARENA.height),
    angle: lerpWrapped(previous.angle, current.angle, alpha, TAU),
  };
}

function drawGrid(ctx) {
  ctx.strokeStyle = "#233950";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= ARENA.width; x += 48) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, ARENA.height);
  }
  for (let y = 0; y <= ARENA.height; y += 45) {
    ctx.moveTo(0, y);
    ctx.lineTo(ARENA.width, y);
  }
  ctx.stroke();
  ctx.fillStyle = "#6a9ab5";
  for (let i = 0; i < 40; i += 1) {
    const x = (i * 137 + 17) % ARENA.width;
    const y = (i * 79 + 29) % ARENA.height;
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
    "#64e8d1",
    "#dfffef",
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

export function drawScene({ ctx, width, height }, ship, stats) {
  ctx.fillStyle = "#101c2b";
  ctx.fillRect(0, 0, width, height);

  // Арена має постійний розмір у симуляції. Зміна вікна лише масштабує картинку.
  const scale = Math.min(width / ARENA.width, height / ARENA.height);
  const offsetX = (width - ARENA.width * scale) / 2;
  const offsetY = (height - ARENA.height * scale) / 2;
  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);
  ctx.beginPath();
  ctx.rect(0, 0, ARENA.width, ARENA.height);
  ctx.clip();
  ctx.fillStyle = "#132237";
  ctx.fillRect(0, 0, ARENA.width, ARENA.height);
  drawGrid(ctx);

  // Біля краю малюємо копію з іншого боку, щоб корабель не обрізався різко.
  const xs = [0];
  const ys = [0];
  if (ship.x < 28) xs.push(ARENA.width);
  if (ship.x > ARENA.width - 28) xs.push(-ARENA.width);
  if (ship.y < 28) ys.push(ARENA.height);
  if (ship.y > ARENA.height - 28) ys.push(-ARENA.height);
  for (const x of xs) {
    for (const y of ys)
      drawShip(ctx, { ...ship, x: ship.x + x, y: ship.y + y });
  }

  ctx.restore();
  drawHud(ctx, stats);
}
