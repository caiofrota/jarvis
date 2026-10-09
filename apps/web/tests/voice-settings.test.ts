import { expect, it } from "vitest";
import { httpFixture } from "./http-fixture";

it("keeps the ElevenLabs credential on the server and preserves it on ordinary settings saves", async () => {
  const f = await httpFixture();
  try {
    const login = await fetch(`${f.url}/api/v1/login`, {
      method: "POST",
      headers: { origin: f.url, "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "fixture-user-password" }),
    });
    const headers = {
      cookie: (login.headers.get("set-cookie") ?? "").split(";")[0],
      origin: f.url,
      "content-type": "application/json",
    };
    const read = async () => (await fetch(`${f.url}/api/v1/settings`, { headers })).json();
    const settings = await read();
    expect(
      (
        await fetch(`${f.url}/api/v1/settings`, {
          method: "PUT",
          headers,
          body: JSON.stringify({ ...settings, elevenlabsKey: "fixture-private-eleven-key" }),
        })
      ).status,
    ).toBe(200);
    const saved = await read();
    expect(saved.elevenlabsKey).toBe("");
    expect(saved.credentials.elevenlabsKey).toBe(true);
    expect(JSON.stringify(saved)).not.toContain("fixture-private-eleven-key");
    expect(
      (
        await fetch(`${f.url}/api/v1/settings`, {
          method: "PUT",
          headers,
          body: JSON.stringify(saved),
        })
      ).status,
    ).toBe(200);
    expect((await f.repo.settings()).elevenlabsKey).toBe("fixture-private-eleven-key");
    const options = await (await fetch(`${f.url}/api/v1/me/assistant-options`, { headers })).json();
    expect(JSON.stringify(options)).not.toContain("fixture-private-eleven-key");
    expect((await fetch(`${f.url}/api/v1/settings`)).status).toBe(401);
  } finally {
    await f.close();
  }
});
