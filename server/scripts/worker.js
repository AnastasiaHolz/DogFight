import { createApp } from "../src/app.js";

const [, , logDir, mode] = process.argv;
const app = await createApp({
  host: "127.0.0.1",
  port: 0,
  logDir,
  demo: mode === "loop",
});
const { port } = await app.start();
const readMemory = () => ({ at: Date.now(), rss: process.memoryUsage.rss() });
const ticker =
  mode === "replay"
    ? setInterval(
        () => process.send?.({ type: "sample", ...readMemory() }),
        500,
      )
    : undefined;

process.send?.({ type: "ready", port, ...readMemory() });
process.on("message", async (message) => {
  if (message !== "stop") return;
  clearInterval(ticker);
  await app.stop();
  process.disconnect();
});
