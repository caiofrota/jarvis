import { randomUUID } from "node:crypto";
import { companionProfileSchema } from "@rosie/types";
import { expect, it } from "vitest";
import { CompanionConversation } from "../src/server/conversation/companion";
import { httpFixture } from "./http-fixture";

it("isolates personal assistants, enforces member permissions and preserves installation credentials", async () => {
  const f = await httpFixture();
  const client = async (username: string) => {
    const login = await fetch(`${f.url}/api/v1/login`, {
      method: "POST",
      headers: { origin: f.url, "content-type": "application/json" },
      body: JSON.stringify({ username, password: "fixture-user-password" }),
    });
    const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
    return (path: string, method = "GET", data?: unknown) =>
      fetch(`${f.url}/api/v1${path}`, {
        method,
        headers: { cookie, origin: f.url, "content-type": "application/json" },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      });
  };
  try {
    const admin = await client("admin");
    expect(
      (
        await admin("/users", "POST", {
          username: "partner",
          name: "Partner",
          password: "fixture-user-password",
          role: "member",
          enabled: true,
        })
      ).status,
    ).toBe(201);
    const member = await client("partner");
    for (const path of ["/settings", "/users", "/catalog/devices", "/status", "/assistant-default"])
      expect((await member(path)).status, path).toBe(403);
    const before = await (await member("/me/profile")).json();
    const assistant = {
      ...companionProfileSchema.parse({ name: "Atlas", voice: "fixture-voice" }),
      id: "",
    };
    const created = await member("/me/assistants", "POST", {
      revision: before.revision,
      assistant,
    });
    expect(created.status).toBe(201);
    const saved = await created.json();
    expect(saved.profile.defaultAssistantId).toBe(saved.profile.assistants[0].id);
    expect((await (await admin("/me/profile")).json()).profile.assistants).toEqual([]);
    expect((await member("/me/profile", "PUT", { ...saved, owner: "other" })).status).toBe(422);
    expect((await member("/me/profile", "PUT", { ...saved, revision: null })).status).toBe(409);
    expect(
      (
        await member("/me/profile", "PUT", {
          ...saved,
          profile: { ...saved.profile, defaultAssistantId: randomUUID() },
        })
      ).status,
    ).toBe(422);
    const user = await f.repo.db.user.findUniqueOrThrow({ where: { username: "partner" } });
    const conversation = new CompanionConversation(f.repo, {} as never, f.rt.profiles);
    expect(
      (
        await conversation.profile(
          { sessionId: randomUUID(), assistantId: null, areaId: null },
          user.id,
        )
      ).name,
    ).toBe("Atlas");
    const administrator = await f.repo.db.user.findUniqueOrThrow({ where: { username: "admin" } });
    await expect(
      conversation.profile(
        { sessionId: randomUUID(), assistantId: saved.profile.defaultAssistantId, areaId: null },
        administrator.id,
      ),
    ).rejects.toThrow("não pertence");
    const shared = await member("/me/profile", "PUT", {
      ...saved,
      profile: { ...saved.profile, defaultAssistantId: null, defaultSharedAssistantId: "rosie" },
    });
    expect(shared.status).toBe(200);
    const selectedShared = await shared.json();
    expect(
      (
        await conversation.profile(
          { sessionId: randomUUID(), assistantId: null, areaId: null },
          user.id,
        )
      ).name,
    ).toBe("Rosie");
    expect(
      (
        await conversation.profile(
          { sessionId: randomUUID(), assistantId: "rosie", areaId: null },
          user.id,
        )
      ).name,
    ).toBe("Rosie");
    expect(
      (
        await member("/me/profile", "PUT", {
          ...selectedShared,
          profile: {
            ...selectedShared.profile,
            defaultSharedAssistantId: saved.profile.assistants[0].id,
          },
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await member("/me/profile", "PUT", {
          ...selectedShared,
          profile: {
            ...selectedShared.profile,
            defaultAssistantId: saved.profile.assistants[0].id,
          },
        })
      ).status,
    ).toBe(422);
    const settings = await f.repo.settings();
    const original = await f.repo.db.setting.findUniqueOrThrow({ where: { id: "settings" } });
    await f.repo.db.setting.update({
      where: { id: "settings" },
      data: { data: { ...settings, openaiKey: "fixture-private-key" } },
    });
    const defaults = await (await admin("/assistant-default")).json();
    expect(
      (
        await admin("/assistant-default", "PUT", {
          ...defaults,
          profile: { ...defaults.profile, name: "New default" },
        })
      ).status,
    ).toBe(200);
    expect((await f.repo.settings()).openaiKey).toBe("fixture-private-key");
    expect((await admin("/assistant-default", "PUT", defaults)).status).toBe(409);
    expect(JSON.stringify(await (await member("/me/assistant-options")).json())).not.toContain(
      "fixture-private-key",
    );
    await f.repo.db.setting.update({
      where: { id: "settings" },
      data: { data: original.data as never },
    });
  } finally {
    await f.close();
  }
}, 15000);
