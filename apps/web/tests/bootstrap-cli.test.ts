import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { repositoryFixture } from "./fixture";

it("creates the first account through the real hidden-input terminal", async () => {
  const f = await repositoryFixture();
  try {
    for (const name of ["admin", "voice"])
      writeFileSync(join(f.dir, name), `fixture-${name}-credential`, { mode: 0o600 });
    const env = {
      ...process.env,
      DATABASE_URL: `file:${f.dir}/test.sqlite`,
      ROSIE_ADMIN_TOKEN_FILE: join(f.dir, "admin"),
      ROSIE_VOICE_TOKEN_FILE: join(f.dir, "voice"),
      ROSIE_ORIGIN: "http://127.0.0.1:8877",
    };
    const result = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
      const child = spawn("python3", ["tests/cli-bootstrap.py", process.execPath], {
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk;
      });
      child.stderr.on("data", (chunk) => {
        output += chunk;
      });
      child.on("error", reject);
      child.on("exit", (code) => resolve({ code, output }));
    });
    expect(result.code, result.output).toBe(0);
    expect(await f.repo.db.user.count()).toBe(1);
    expect(await f.repo.db.user.findFirst({ select: { username: true, role: true } })).toEqual({
      username: "cli-admin",
      role: "admin",
    });
  } finally {
    await f.close();
  }
}, 45000);
