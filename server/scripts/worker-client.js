import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function withServer(mode, run, prepare = () => {}) {
  const directory = await mkdtemp(join(tmpdir(), "dogfight-"));
  let worker;
  let exit;
  try {
    await prepare(directory);
    worker = fork(new URL("./worker.js", import.meta.url), [directory, mode], {
      stdio: ["ignore", "ignore", "inherit", "ipc"],
    });
    exit = once(worker, "exit");
    const [ready] = await Promise.race([
      once(worker, "message"),
      exit.then(([code]) => {
        throw new Error(`Worker failed: ${code}`);
      }),
    ]);
    return await run({
      worker,
      ...ready,
      base: `http://127.0.0.1:${ready.port}`,
      directory,
    });
  } finally {
    if (worker) {
      if (worker.connected) worker.send("stop");
      await exit;
    }
    await rm(directory, { recursive: true, force: true });
  }
}
