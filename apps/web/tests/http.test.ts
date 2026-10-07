import { describe, expect, it, vi } from "vitest";
import { Automations } from "../src/server/automation/service";

import { httpFixture as fixture } from "./http-fixture";

describe("administrative boundary", () => {
  it("keeps the Jarvis session independent of an existing Rosie browser cookie", async () => {
    const f = await fixture();
    try {
      const login = await fetch(`${f.url}/api/v1/login`, {
        method: "POST",
        headers: {
          origin: f.url,
          "content-type": "application/json",
          cookie: "rosie-session=other-service",
        },
        body: JSON.stringify({ username: "admin", password: "fixture-user-password" }),
      });
      expect(login.status).toBe(200);
      const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
      expect(cookie).toMatch(/^jarvis-session=/);
      const session = await fetch(`${f.url}/api/v1/session`, {
        headers: { cookie: `rosie-session=other-service; ${cookie}` },
      });
      expect(session.status).toBe(200);
      expect(await session.json()).toMatchObject({ user: { username: "admin" } });
    } finally {
      await f.close();
    }
  });
  it("protects resident calendar bindings with owner sessions, origin checks and bounded schemas", async () => {
    const f = await fixture();
    try {
      await f.rt.catalog.save("residents", { name: "Caio", homeId: "home" });
      const path = `${f.url}/api/v1/catalog/residents/caio/calendar`;
      expect((await fetch(path)).status).toBe(401);
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
      expect(await (await fetch(path, { headers })).json()).toMatchObject({
        binding: null,
        options: [],
        connected: false,
      });
      expect(
        (
          await fetch(path, {
            method: "PUT",
            headers: { ...headers, origin: "https://evil.invalid" },
            body: "{}",
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await fetch(path, {
            method: "PUT",
            headers,
            body: JSON.stringify({
              binding: { entityId: "light.office", enabled: true, allowCreate: true },
              revision: null,
            }),
          })
        ).status,
      ).toBe(422);
      expect(
        (await fetch(`${f.url}/api/v1/catalog/residents/missing/calendar`, { headers })).status,
      ).toBe(409);
      const events = await f.repo.db.event.findMany();
      expect(events.some((v) => v.kind === "resident_calendar_saved")).toBe(false);
    } finally {
      await f.close();
    }
  });
  it("protects voice enrollment and never returns the stored voice reference", async () => {
    const f = await fixture();
    try {
      await f.rt.catalog.save("residents", { name: "Caio", homeId: "home" });
      const path = `${f.url}/api/v1/catalog/residents/caio/voice`;
      expect((await fetch(path)).status).toBe(401);
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
      expect(await (await fetch(path, { headers })).json()).toEqual({
        registered: false,
        enrolledAt: null,
        enrollment: null,
      });
      expect(
        (
          await fetch(`${path}/enroll`, {
            method: "POST",
            headers: { ...headers, origin: "https://evil.invalid" },
            body: '{"endpointId":"one"}',
          })
        ).status,
      ).toBe(403);
      expect(
        (await fetch(`${path}/enroll`, { method: "POST", headers, body: '{"endpointId":"one"}' }))
          .status,
      ).toBe(409);
      expect((await fetch(path, { method: "DELETE", headers })).status).toBe(200);
    } finally {
      await f.close();
    }
  });
  it("requires owner authorization for voice previews and binds unsaved voice choice to the assistant home", async () => {
    const f = await fixture();
    const synthesize = vi.fn(async () => Buffer.alloc(6400));
    f.rt.voice.synthesize = synthesize;
    f.rt.voice.health = async () => ({
      ready: true,
      busy: false,
      voices: ["ha-cloud-FranciscaNeural"],
      cloudHomeId: "home",
      cloudError: undefined,
    });
    let cookie = "";
    const post = (body: unknown, origin = f.url) =>
      fetch(`${f.url}/api/v1/voice-preview`, {
        method: "POST",
        headers: { cookie, origin, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    try {
      const choice = {
        assistantId: "rosie",
        voice: "ha-cloud-FranciscaNeural",
        homeId: "injected",
      };
      expect((await post(choice)).status).toBe(401);
      const login = await fetch(`${f.url}/api/v1/login`, {
        method: "POST",
        headers: { origin: f.url, "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "fixture-user-password" }),
      });
      cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
      expect((await post(choice, "https://evil.invalid")).status).toBe(403);
      expect((await post({ ...choice, voice: "not-available" })).status).toBe(422);
      expect((await post({ ...choice, assistantId: "unknown" })).status).toBe(404);
      expect(synthesize).not.toHaveBeenCalled();
      const sample = await post(choice);
      expect(sample.status).toBe(200);
      expect(sample.headers.get("content-type")).toBe("audio/wav");
      expect(sample.headers.get("cache-control")).toBe("no-store");
      expect(synthesize).toHaveBeenCalledWith(
        expect.any(String),
        "ha-cloud-FranciscaNeural",
        "fast",
        expect.any(AbortSignal),
        "home",
      );
      expect((await f.repo.catalog()).assistants[0].voice).toBe("kokoro-pf_dora");
    } finally {
      await f.close();
    }
  });
  it("protects search consumption and saves the search cap through the existing owner settings", async () => {
    const f = await fixture();
    try {
      f.rt.automations = new Automations(f.repo);
      expect((await fetch(`${f.url}/api/v1/status`)).status).toBe(401);
      const login = await fetch(`${f.url}/api/v1/login`, {
        method: "POST",
        headers: { origin: f.url, "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "fixture-user-password" }),
      });
      const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
      const headers = { cookie, origin: f.url, "content-type": "application/json" };
      const saved = await fetch(`${f.url}/api/v1/settings`, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          mqttEnabled: false,
          webSearchEnabled: true,
          webSearchMonthlyBudgetUsd: 5,
          webSearchCacheEnabled: true,
        }),
      });
      expect(saved.status).toBe(200);
      const status = await (await fetch(`${f.url}/api/v1/status`, { headers })).json();
      expect(status.webSearch).toMatchObject({
        enabled: true,
        configured: false,
        budgetUsd: 5,
        accountedUsd: 0,
        remainingUsd: 5,
        cacheEnabled: true,
      });
      expect(status.voiceReferences).toEqual({});
      const invalid = await fetch(`${f.url}/api/v1/settings`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ webSearchMonthlyBudgetUsd: -1 }),
      });
      expect(invalid.status).toBe(422);
      f.rt.automations.close();
    } finally {
      await f.close();
    }
  });
  it("requires login, validates origin, redacts secrets, pairs once and revokes logout", async () => {
    const f = await fixture();
    try {
      const call = (
        path: string,
        method = "GET",
        data?: unknown,
        cookie?: string,
        origin = f.url,
      ) =>
        fetch(f.url + path, {
          method,
          headers: { origin, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
          body: data === undefined ? undefined : JSON.stringify(data),
        });
      expect((await call("/api/v1/settings")).status).toBe(401);
      expect(
        (
          await call(
            "/api/v1/login",
            "POST",
            { username: "admin", password: "fixture-user-password" },
            undefined,
            "https://wrong.example",
          )
        ).status,
      ).toBe(403);
      const login = await call("/api/v1/login", "POST", {
        username: "admin",
        password: "fixture-user-password",
      });
      expect(login.status).toBe(200);
      const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
      expect(login.headers.get("set-cookie")).toContain("HttpOnly");
      const settings = await call("/api/v1/settings", "GET", undefined, cookie);
      expect((await settings.json()).openaiKey).toBe("");
      const endpoints = await call("/api/v1/catalog/endpoints", "GET", undefined, cookie);
      expect(JSON.stringify(await endpoints.json())).not.toContain("fixture-credential");
      const pin = await (await call("/api/v1/endpoints/one/pair-code", "POST", {}, cookie)).json();
      const paired = await call("/api/pair", "POST", { pin: pin.pin });
      expect((await paired.json()).token).toBe("fixture-credential-one");
      expect((await call("/api/pair", "POST", { pin: pin.pin })).status).toBe(401);
      expect((await call("/api/v1/logout", "POST", {}, cookie)).status).toBe(200);
      expect((await call("/api/v1/session", "GET", undefined, cookie)).status).toBe(401);
    } finally {
      await f.close();
    }
  });
  it("isolates panel conversation and reset from physical wake sessions", async () => {
    const f = await fixture();
    const originalFetch = globalThis.fetch;
    try {
      await f.repo.db.setting.update({
        where: { id: "settings" },
        data: { data: { openaiKey: "fixture-key" } },
      });
      let cookie = "";
      const post = (path: string, data: unknown) =>
        originalFetch(`${f.url}/api/v1${path}`, {
          method: "POST",
          headers: { origin: f.url, cookie, "content-type": "application/json" },
          body: JSON.stringify(data),
        });
      expect((await post("/conversation/reset", { endpointId: "one" })).status).toBe(401);
      const login = await post("/login", { username: "admin", password: "fixture-user-password" });
      cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
      const first = await (
        await post("/conversation", { endpointId: "one", text: "bom dia" })
      ).json();
      let captured!: () => void, release!: () => void;
      const started = new Promise<void>((resolve) => {
        captured = resolve;
      });
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });
      const payloads: unknown[] = [];
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        if (String(input).startsWith("https://api.openai.com/")) {
          payloads.push(JSON.parse(String(init?.body)));
          captured();
          await blocked;
          return new Response(
            JSON.stringify({
              choices: [
                {
                  finish_reason: "stop",
                  message: {
                    content: JSON.stringify({ text: "Continuação", expression: "happy" }),
                  },
                },
              ],
              usage: {},
            }),
          );
        }
        return originalFetch(input, init);
      });
      const pending = post("/conversation", { endpointId: "one", text: "e depois?" });
      await started;
      f.rt.conversation.reset("one");
      release();
      expect((await pending).status).toBe(200);
      expect(JSON.stringify(payloads[0])).toContain(first.text);
      expect((await post("/conversation/reset", { endpointId: "one" })).status).toBe(200);
      await post("/conversation", { endpointId: "one", text: "outra conversa" });
      expect(JSON.stringify(payloads[1])).not.toContain(first.text);
      const physicalReset = vi.spyOn(f.rt.conversation, "reset");
      const stopped = await post("/conversation", {
        endpointId: "one",
        text: "Rosie, chega por hoje, obrigada.",
      });
      expect(stopped.status).toBe(200);
      expect((await stopped.json()).text).toBe("Conversa encerrada.");
      expect(payloads).toHaveLength(2);
      expect(physicalReset).not.toHaveBeenCalled();
      await post("/conversation", { endpointId: "one", text: "começar outro assunto" });
      expect(payloads).toHaveLength(3);
      expect(JSON.stringify(payloads[2])).not.toContain("Continuação");
    } finally {
      vi.restoreAllMocks();
      await f.close();
    }
  });
  it("rejects expired sessions and rate-limits guessing", async () => {
    const f = await fixture();
    try {
      const login = await fetch(`${f.url}/api/v1/login`, {
        method: "POST",
        headers: { origin: f.url, "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "fixture-user-password" }),
      });
      const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
      await f.repo.db.userSession.updateMany({ data: { expiresAt: new Date(0) } });
      expect((await fetch(`${f.url}/api/v1/session`, { headers: { cookie } })).status).toBe(401);
      for (let i = 0; i < 10; i++)
        await fetch(`${f.url}/api/v1/login`, {
          method: "POST",
          headers: { origin: f.url, "content-type": "application/json" },
          body: '{"password":"wrong"}',
        });
      expect(
        (
          await fetch(`${f.url}/api/v1/login`, {
            method: "POST",
            headers: { origin: f.url, "content-type": "application/json" },
            body: '{"password":"wrong"}',
          })
        ).status,
      ).toBe(429);
    } finally {
      await f.close();
    }
  });
});

it.each(["light", "switch"])(
  "protects HA configuration, import as light from %s and token secrecy",
  async (domain) => {
    const f = await fixture();
    f.rt.automations = new Automations(f.repo);
    vi.spyOn(f.rt.automations.addons.homeAssistant, "configure").mockResolvedValue(undefined);
    vi.spyOn(f.rt.automations.addons.homeAssistant, "discover").mockResolvedValue([
      {
        id: `${domain}.office`,
        name: "Luz do escritório",
        state: "off",
        kind: domain,
        areaId: "office",
        aliases: [],
        areaName: "Escritório",
        available: true,
      },
    ]);
    try {
      expect((await fetch(`${f.url}/api/v1/home-assistant/entities`)).status).toBe(401);
      expect((await fetch(`${f.url}/api/v1/home-assistant/package/one`)).status).toBe(401);
      const login = await fetch(`${f.url}/api/v1/login`, {
        method: "POST",
        headers: { origin: f.url, "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "fixture-user-password" }),
      });
      const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0],
        headers = { cookie, origin: f.url, "content-type": "application/json" };
      const save = (data: unknown) =>
        fetch(`${f.url}/api/v1/settings`, { method: "PUT", headers, body: JSON.stringify(data) });
      expect(
        (await save({ homeAssistantEnabled: true, homeAssistantHomeId: "missing" })).status,
      ).toBe(409);
      expect(
        (
          await save({
            mqttEnabled: false,
            homeAssistantEnabled: true,
            homeAssistantUrl: "http://127.0.0.1:8123",
            homeAssistantToken: "fixture-ha-secret",
            homeAssistantHomeId: "home",
          })
        ).status,
      ).toBe(200);
      const settings = await (await fetch(`${f.url}/api/v1/settings`, { headers })).json();
      expect(settings.homeAssistantToken).toBe("");
      expect(settings.credentials.homeAssistantToken).toBe(true);
      expect(JSON.stringify(settings)).not.toContain("fixture-ha-secret");
      expect((await save(settings)).status).toBe(200);
      expect((await f.repo.settings()).homeAssistantToken).toBe("fixture-ha-secret");
      const entities = await (
        await fetch(`${f.url}/api/v1/home-assistant/entities?pageSize=10&q=escrit%C3%B3rio`, {
          headers,
        })
      ).json();
      expect(entities.total).toBe(1);
      const importEntity = (roomId: string) =>
        fetch(`${f.url}/api/v1/home-assistant/import`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            entityId: `${domain}.office`,
            roomId,
            name: "Luz HA",
            ...(domain === "switch" ? { kind: "light" } : {}),
          }),
        });
      expect((await importEntity("unknown")).status).toBe(409);
      expect((await importEntity("office")).status).toBe(201);
      expect(
        (await f.repo.catalog()).devices.find((v) => v.haEntityId === `${domain}.office`),
      ).toMatchObject({
        kind: "light",
        actions: { on: "turn_on", off: "turn_off" },
      });
      expect((await importEntity("office")).status).toBe(409);
      const pack = await fetch(`${f.url}/api/v1/home-assistant/package/one`, { headers });
      expect(pack.status).toBe(200);
      const yaml = await pack.text();
      expect(yaml).toContain("rosie/home/one/request");
      expect(yaml).toContain("wait_template");
      expect(yaml).not.toContain("fixture-ha-secret");
      const submit = vi.fn(async () => ({ status: "played" as const }));
      f.rt.interactions.submit = submit;
      expect(
        (
          await fetch(`${f.url}/api/v1/endpoints/one/interact`, {
            method: "POST",
            headers: { ...headers, origin: "http://evil.invalid" },
            body: "{}",
          })
        ).status,
      ).toBe(403);
      expect(submit).not.toHaveBeenCalled();
    } finally {
      f.rt.automations.close();
      await f.close();
      vi.restoreAllMocks();
    }
  },
);
