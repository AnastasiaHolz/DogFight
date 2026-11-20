import type { Surface } from "./canvas.ts";
export function drawScore(
  { ctx, width }: Surface,
  game: { player: { hp: number; shield: number }; respawnIn: number | null },
  score: number,
) {
  const x = width - 137;
  ctx.fillStyle = "#0b1523";
  ctx.fillRect(x, 12, 125, 64);
  ctx.fillStyle = "#edf5ff";
  ctx.font = "13px monospace";
  ctx.fillText(`SCORE  ${score}`, x + 8, 31);
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
