import type { Account } from "@rosie/types";
import { describe, expect, it } from "vitest";
import { Accounts } from "../src/server/auth/accounts";
import { verifyPassword } from "../src/server/auth/password";
import { repositoryFixture } from "./fixture";
import { httpFixture } from "./http-fixture";

const first = {
  username: "Admin",
  name: "Administrator",
  password: "fixture-user-password",
  role: "admin",
  enabled: true,
};
function client(url: string, cookie = "") {
  return (path: string, method = "GET", data?: unknown, origin = url) =>
    fetch(`${url}/api/v1${path}`, {
      method,
      headers: { cookie, origin, "content-type": "application/json" },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
}
async function login(url: string, username = "admin", password = "fixture-user-password") {
  const response = await client(url)("/login", "POST", { username, password });
  expect(response.status).toBe(200);
  return response.headers.get("set-cookie")?.split(";")[0] ?? "";
}
describe("installation accounts", () => {
  it("bootstraps once, hashes credentials and preserves the household catalog", async () => {
    const f = await repositoryFixture();
    try {
      const accounts = new Accounts(f.repo.db),
        catalog = await f.repo.catalog();
      const user = await accounts.bootstrap(first);
      expect(user.username).toBe("admin");
      expect(user).not.toHaveProperty("passwordHash");
      const stored = await f.repo.db.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(stored.passwordHash).not.toContain(first.password);
      expect(await verifyPassword(first.password, stored.passwordHash)).toBe(true);
      expect(await verifyPassword("wrong", stored.passwordHash)).toBe(false);
      await expect(accounts.bootstrap({ ...first, username: "second" })).rejects.toThrow(
        "primeiro usuário já existe",
      );
      expect(await f.repo.catalog()).toEqual(catalog);
      expect(await f.repo.db.user.count()).toBe(1);
    } finally {
      await f.close();
    }
  }, 15000);
  it("rejects legacy passwords, normalizes usernames and rotates server-side sessions", async () => {
    const f = await httpFixture();
    try {
      const anon = client(f.url);
      expect((await anon("/login", "POST", { password: "fixture-admin-credential" })).status).toBe(
        401,
      );
      for (const username of ["missing", "admin"]) {
        const r = await anon("/login", "POST", { username, password: "wrong" });
        expect(r.status).toBe(401);
        expect(await r.json()).toEqual({ error: "Usuário ou senha incorretos." });
      }
      const cookie = await login(f.url, " ADMIN ");
      const session = await (await client(f.url, cookie)("/session")).json();
      expect(session.user.username).toBe("admin");
      expect(JSON.stringify(session)).not.toMatch(/passwordHash|scrypt/);
      const second = await client(f.url, cookie)("/login", "POST", {
        username: "admin",
        password: first.password,
      });
      expect(second.status).toBe(200);
      expect((await client(f.url, cookie)("/session")).status).toBe(401);
      expect(await f.repo.db.userSession.count()).toBe(1);
    } finally {
      await f.close();
    }
  }, 15000);
  it("enforces viewer access at the API and keeps sensitive actions private", async () => {
    const f = await httpFixture();
    try {
      const admin = client(f.url, await login(f.url));
      const input = { ...first, username: "reader", name: "Reader", role: "viewer" };
      expect((await admin("/users", "POST", input, "https://untrusted.invalid")).status).toBe(403);
      expect((await admin("/users", "POST", input)).status).toBe(201);
      expect((await admin("/users", "POST", { ...input, username: "READER" })).status).toBe(409);
      const viewer = client(f.url, await login(f.url, "reader"));
      expect((await viewer("/catalog/endpoints")).status).toBe(200);
      expect((await viewer("/endpoints/one/effective")).status).toBe(200);
      for (const [path, method] of [
        ["/users", "GET"],
        ["/settings", "GET"],
        ["/users", "POST"],
        ["/catalog/devices/light-office", "PUT"],
        ["/endpoints/one/pair-code", "POST"],
        ["/endpoints/one/listen", "POST"],
        ["/conversation", "POST"],
        ["/voice-preview", "POST"],
        ["/home-assistant/authorize", "POST"],
      ]) {
        expect(
          (await viewer(path, method, method === "GET" ? undefined : {})).status,
          `${method} ${path}`,
        ).toBe(403);
      }
      const listed = await (await admin("/users?pageSize=10&sort=name&direction=desc")).json();
      expect(listed.total).toBe(2);
      expect(JSON.stringify(listed)).not.toMatch(/scrypt|passwordHash|fixture-user-password/);
    } finally {
      await f.close();
    }
  }, 15000);
  it("protects the last administrator and invalidates sessions on role, status and password changes", async () => {
    const f = await httpFixture();
    try {
      const admin = client(f.url, await login(f.url));
      const actor = (await (await admin("/session")).json()).user as Account;
      expect((await admin(`/users/${actor.id}`, "PUT", { ...actor, enabled: false })).status).toBe(
        409,
      );
      expect((await admin(`/users/${actor.id}`, "PUT", { ...actor, role: "viewer" })).status).toBe(
        409,
      );
      const added = await (
        await admin("/users", "POST", { ...first, username: "reader", role: "viewer" })
      ).json();
      const viewer = client(f.url, await login(f.url, "reader"));
      expect((await admin(`/users/${added.id}`, "PUT", { ...added, enabled: false })).status).toBe(
        200,
      );
      expect((await viewer("/session")).status).toBe(401);
      expect(
        (await client(f.url)("/login", "POST", { username: "reader", password: first.password }))
          .status,
      ).toBe(401);
      expect((await admin(`/users/${added.id}`, "PUT", { ...added, enabled: true })).status).toBe(
        409,
      );
      expect(
        (
          await admin("/me/password", "POST", {
            currentPassword: "wrong",
            password: "replacement-password",
          })
        ).status,
      ).toBe(401);
      expect(
        (
          await admin("/me/password", "POST", {
            currentPassword: first.password,
            password: "replacement-password",
          })
        ).status,
      ).toBe(200);
      expect((await admin("/session")).status).toBe(401);
      expect(
        (await client(f.url)("/login", "POST", { username: "admin", password: first.password }))
          .status,
      ).toBe(401);
      await login(f.url, "admin", "replacement-password");
    } finally {
      await f.close();
    }
  }, 15000);
});
