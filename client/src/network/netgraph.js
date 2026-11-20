export function drawNetgraph({ ctx, height, width }, stats) {
  const w = Math.min(263, width - 24);
  const top = height - 147;
  ctx.fillStyle = "#071522f2";
  ctx.fillRect(12, top, w, 135);
  ctx.fillStyle = "#78f3d5";
  ctx.font = "bold 12px monospace";
  ctx.fillText(`NETGRAPH / ${stats.codec.toUpperCase()}`, 21, top + 19, w - 16);
  ctx.fillStyle = "#cde2ef";
  ctx.font = "12px monospace";
  const lines = [
    `RTT ${stats.rtt} ms   AGE ~${stats.age} ms`,
    `↓ ${stats.down} B/s  ↑ ${stats.up} B/s`,
    `PENDING ${stats.pending}   TICK ${stats.tick}`,
    `FIX ${stats.correction.toFixed(2)}  AVG ${stats.average.toFixed(2)} px`,
    `INTERP ${stats.interpolation} ms   ${stats.predict ? "PRED ON" : "PRED OFF"}`,
    `${stats.latency}±${stats.jitter} ms · ${stats.loss}% loss${stats.drift ? " · DRIFT" : ""}`,
  ];
  for (const [i, text] of lines.entries())
    ctx.fillText(text, 21, top + 39 + i * 16, w - 16);
}
