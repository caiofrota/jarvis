import { expect, it, vi } from "vitest";
import { httpFixture } from "./http-fixture";

it("gates personal integration APIs, protects mutations and redacts installation secrets", async () => {
  const f = await httpFixture();
  const client =
    (cookie = "", origin = f.url) =>
    (path: string, method = "GET", data?: unknown) =>
      fetch(`${f.url}/api/v1${path}`, {
        method,
        redirect: "manual",
        headers: { cookie, origin, "content-type": "application/json" },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      });
  try {
    const anon = client();
    expect((await anon("/personal-integrations")).status).toBe(401);
    const callback = await anon("/personal-integrations/callback?state=invalid&code=private-code");
    expect(callback.status).toBe(303);
    expect(callback.headers.get("location")).toBe("/integrations?oauth_error=1");
    expect(callback.headers.get("referrer-policy")).toBe("no-referrer");
    expect(await callback.text()).not.toContain("private-code");
    const login = await anon("/login", "POST", {
      username: "admin",
      password: "fixture-user-password",
    });
    const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "",
      admin = client(cookie);
    expect(
      (
        await client(cookie, "https://untrusted.test")(
          "/personal-integrations/applications",
          "PUT",
          { provider: "google", clientId: "client", clientSecret: "fixture-secret" },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await admin("/personal-integrations/applications", "PUT", {
          provider: "google",
          clientId: "client",
          clientSecret: "fixture-secret",
        })
      ).status,
    ).toBe(200);
    const path =
      "/personal-integrations/connections/78fce76a-72c3-4e0a-9817-08df074785d1/calendar-preferences";
    const save = vi
      .spyOn(f.rt.personalIntegrations, "calendarPreferences")
      .mockResolvedValue(undefined);
    expect(
      (await client(cookie, "https://untrusted.test")(path, "PUT", { calendars: [] })).status,
    ).toBe(403);
    expect(
      (await admin(path, "PUT", { calendars: [{ id: "work", mode: "priority" }] })).status,
    ).toBe(200);
    expect(save).toHaveBeenCalledWith(expect.any(String), "78fce76a-72c3-4e0a-9817-08df074785d1", {
      calendars: [{ id: "work", mode: "priority" }],
    });
    expect(
      (
        await admin(path, "PUT", {
          calendars: [
            { id: "work", mode: "normal" },
            { id: "work", mode: "excluded" },
          ],
        })
      ).status,
    ).toBe(422);
    expect((await admin(path, "PUT", { owner: "foreign", calendars: [] })).status).toBe(422);
    expect(save).toHaveBeenCalledTimes(1);
    const status = await (await admin("/personal-integrations")).json();
    expect(status.providers[0]).toMatchObject({ configured: true, clientId: "client" });
    expect(JSON.stringify(status)).not.toContain("fixture-secret");
    expect(
      (
        await admin("/personal-integrations/authorize", "POST", {
          provider: "google",
          owner: "foreign",
        })
      ).status,
    ).toBe(422);
    expect(
      (await admin("/personal-integrations/finish", "POST", { state: "invalid-random-state" }))
        .status,
    ).toBe(409);
  } finally {
    await f.close();
  }
});
