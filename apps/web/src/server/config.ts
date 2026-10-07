import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { z } from "zod";

export function loadConfig() {
  if (existsSync(".env")) loadEnvFile(".env");
  const e = z
    .object({
      DATABASE_URL: z.string().startsWith("file:"),
      ROSIE_ADMIN_TOKEN_FILE: z.string().min(1),
      ROSIE_VOICE_TOKEN_FILE: z.string().min(1),
      ROSIE_VOICE_URL: z.url().default("http://127.0.0.1:8766"),
      ROSIE_ORIGIN: z.url(),
      PORT: z.coerce.number().int().min(1).max(65535).default(8765),
      HOST: z.string().default("0.0.0.0"),
    })
    .parse(process.env);
  for (const path of [e.ROSIE_ADMIN_TOKEN_FILE, e.ROSIE_VOICE_TOKEN_FILE])
    if (readFileSync(resolve(path), "utf8").trim().length < 16)
      throw new Error("Credential file is empty or too short");
  return {
    databaseUrl: e.DATABASE_URL,
    adminToken: readFileSync(resolve(e.ROSIE_ADMIN_TOKEN_FILE), "utf8").trim(),
    voiceToken: readFileSync(resolve(e.ROSIE_VOICE_TOKEN_FILE), "utf8").trim(),
    voiceUrl: e.ROSIE_VOICE_URL,
    origin: new URL(e.ROSIE_ORIGIN).origin,
    port: e.PORT,
    host: e.HOST,
  };
}
export type AppConfig = ReturnType<typeof loadConfig>;
