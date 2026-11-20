import type { ChildProcess } from "node:child_process";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

const ReadySchema = z.object({
  type: z.literal("ready"),
  port: z.number(),
  at: z.number(),
  rss: z.number(),
});
type Context = z.infer<typeof ReadySchema> & {
  worker: ChildProcess;
  base: string;
  directory: string;
};

export async function withServer<T>(
  mode: "loop" | "replay",
  run: (server: Context) => Promise<T>,
  prepare: (dir: string) => void | Promise<void> = () => {},
): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "dogfight-"));
  let worker: ChildProcess | undefined;
  let exit: Promise<unknown[]> | undefined;
  try {
    await prepare(directory);
    worker = fork(new URL("./worker.ts", import.meta.url), [directory, mode], {
      stdio: ["ignore", "ignore", "inherit", "ipc"],
    });
    exit = once(worker, "exit");
    const [raw]: unknown[] = await Promise.race([
      once(worker, "message"),
      exit.then(([code]) => {
        throw new Error(`Worker failed: ${code}`);
      }),
    ]);
    const ready = ReadySchema.parse(raw);
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
