import { errorText } from "@dogfight/shared/protocol";
import { createApp } from "./app.ts";
import { readConfig } from "./config.ts";

try {
  const config = readConfig();
  const app = await createApp(config);
  const { address, port } = await app.start();
  const host = address.includes(":") ? `[${address}]` : address;

  let stopping = false;
  function stop() {
    if (stopping) return;
    stopping = true;
    void app.stop().then(
      () => {
        console.log("Sockets closed; match logs flushed.");
        process.exitCode = 0;
      },
      (error) => {
        console.error(error);
        process.exitCode = 1;
      },
    );
  }
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  console.log(`Dogfight: http://${host}:${port}`);
} catch (error: unknown) {
  console.error(errorText(error));
  process.exitCode = 1;
}
