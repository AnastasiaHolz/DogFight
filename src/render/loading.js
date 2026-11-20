export function drawLoading(
  { ctx, width, height },
  { done = 0, total = 0, id = "", status },
) {
  if (width === 0 || height === 0) return;

  const background = ctx.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, "#111d32");
  background.addColorStop(1, "#131529");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#243a55";
  for (let i = 0; i < 52; i += 1) {
    ctx.fillRect(
      (27 + i * 137) % width,
      (17 + i * 79) % height,
      i % 5 === 0 ? 2 : 1,
      1,
    );
  }

  const x = width / 2;
  const y = height / 2;
  const barWidth = Math.min(width - 36, 410);
  if (barWidth <= 0) return;
  const progress = total > 0 ? done / total : 0;

  ctx.save();
  ctx.textAlign = "center";
  ctx.fillStyle = "#86f6d1";
  ctx.font = "600 12px monospace";
  ctx.fillText("DOGFIGHT // ПЕРЕДПОЛІТНА ПІДГОТОВКА", x, y - 58, width - 20);
  ctx.fillStyle = "#edf5ff";
  ctx.font = "600 23px system-ui";
  ctx.fillText(status, x, y - 17, width - 26);

  ctx.fillStyle = "#2d4560";
  ctx.fillRect(x - barWidth / 2, y + 13, barWidth, 10);
  ctx.fillStyle = "#86f6d1";
  ctx.fillRect(x - barWidth / 2, y + 13, barWidth * progress, 10);

  ctx.fillStyle = "#abc1dc";
  ctx.font = "13px monospace";
  ctx.fillText(
    `${done}/${total} · ${Math.round(progress * 100)}% ${id ? `· ${id}` : ""}`,
    x,
    y + 55,
  );
  ctx.restore();
}
