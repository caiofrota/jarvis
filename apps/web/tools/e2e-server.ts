import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Accounts } from "../src/server/auth/accounts";
import { repositoryFixture } from "../tests/fixture";
import { mockVoice } from "../tests/mock-voice";

const f = await repositoryFixture(),
  voice = await mockVoice();
await new Accounts(f.repo.db).bootstrap({
  username: "admin",
  name: "Test administrator",
  password: "fixture-user-password",
  role: "admin",
  enabled: true,
});
for (const name of ["admin", "voice"])
  writeFileSync(join(f.dir, name), `fixture-${name}-credential`, { mode: 0o600 });
const child = spawn(process.execPath, ["--import", "tsx", "server.ts"], {
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_ENV: "production",
    PORT: "8877",
    HOST: "127.0.0.1",
    ROSIE_ORIGIN: "http://127.0.0.1:8877",
    DATABASE_URL: `file:${f.dir}/test.sqlite`,
    ROSIE_ADMIN_TOKEN_FILE: join(f.dir, "admin"),
    ROSIE_VOICE_TOKEN_FILE: join(f.dir, "voice"),
    ROSIE_VOICE_URL: voice.url,
  },
});
let closing = false;
const stop = async () => {
  if (closing) return;
  closing = true;
  child.kill("SIGTERM");
  await voice.close();
  await f.close();
};
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
child.on("exit", () => {
  void stop().then(() => process.exit(0));
});
