import { isIP } from "node:net";
import { resolve } from "node:path";
import { z } from "zod";

export const projectRoot = resolve(import.meta.dirname, "../..");
const EnvSchema = z
  .object({
    PORT: z
      .string()
      .regex(/^\d{1,5}$/)
      .transform(Number)
      .pipe(z.int().min(1).max(65535))
      .default(3000),
    HOST: z
      .string()
      .refine((value) => value === "localhost" || Boolean(isIP(value)))
      .default("127.0.0.1"),
    LOG_DIR: z
      .string()
      .min(1)
      .refine((value) => value.trim() === value && !value.includes("\0"))
      .default("logs"),
    LAB04_DEMO: z.enum(["0", "1"]).default("0"),
  })
  .refine(
    (value) =>
      value.LAB04_DEMO === "0" ||
      ["127.0.0.1", "::1", "localhost"].includes(value.HOST),
    { path: ["LAB04_DEMO"], message: "LAB04_DEMO requires a loopback HOST" },
  );

export function readConfig(env: unknown = process.env, root = projectRoot) {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      issue
        ? `${issue.path.join(".")}: ${issue.message}`
        : "Invalid server configuration",
    );
  }
  const { PORT, HOST, LOG_DIR, LAB04_DEMO } = parsed.data;
  return {
    port: PORT,
    host: HOST,
    logDir: resolve(root, LOG_DIR),
    clientDir: resolve(root, "client/dist"),
    demo: LAB04_DEMO === "1",
  };
}
export type ServerConfig = ReturnType<typeof readConfig>;
