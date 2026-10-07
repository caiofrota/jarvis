import { schemas } from "@rosie/types";
import { context } from "@rosie/types/context";
import { describe, expect, it, vi } from "vitest";
import { localCommand, resolveDevice, routineSteps } from "../src/server/automation/resolver";
import { Automations } from "../src/server/automation/service";
import { migrateLegacy } from "../src/server/catalog/migration";
import { CatalogService, queryFrom } from "../src/server/catalog/service";
import { Conversation } from "../src/server/conversation/service";
import { catalogFixture, repositoryFixture } from "./fixture";

describe("room-aware automations", () => {
  it("turns off a light backed by a relay without an LLM call or another room's light", async () => {
    const f = await repositoryFixture(),
      automations = new Automations(f.repo);
    try {
      const device = (await f.repo.catalog()).devices[0];
      await new CatalogService(f.repo).save(
        "devices",
        {
          ...device,
          connection: "home-assistant",
          haEntityId: "switch.office",
          actions: { on: "turn_on", off: "turn_off" },
        },
        device.id,
        1,
      );
      const execute = vi
        .spyOn(automations.addons.homeAssistant, "execute")
        .mockResolvedValue(undefined);
      vi.spyOn(automations.addons.homeAssistant, "status").mockReturnValue({
        enabled: true,
        ready: true,
        connected: true,
        entities: 1,
        error: null,
      });
      const conversation = new Conversation(f.repo, automations);
      const reply = await conversation.respond("one", "apaga a luz", AbortSignal.timeout(1000));
      expect(reply.text).toBe("Comando enviado para Luz.");
      expect(execute).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          id: "light-office",
          kind: "light",
          haEntityId: "switch.office",
          roomId: "office",
        }),
        "off",
      );
    } finally {
      automations.close();
      await f.close();
    }
  });
  it("uses the endpoint room, honors explicit rooms and never falls back from a miss", () => {
    const c = catalogFixture(),
      ctx = context(c, "one");
    expect(resolveDevice(c, ctx, "luz").id).toBe("light-office");
    expect(resolveDevice(c, ctx, "luz", "Cozinha").id).toBe("light-kitchen");
    expect(() => resolveDevice(c, ctx, "luz", "garagem")).toThrow();
    expect(localCommand("liga a luz da cozinha")).toEqual({
      target: "luz",
      room: "cozinha",
      action: "on",
      routine: false,
    });
  });
  it("requires a default or clarification for ambiguous devices", () => {
    const c = catalogFixture(),
      ctx = context(c, "one");
    c.devices.push({ ...c.devices[0], id: "second", name: "Abajur" });
    expect(() => resolveDevice(c, ctx, "luz")).toThrow(/Qual deles/);
    c.rooms[0].defaultDevices.light = "second";
    expect(resolveDevice(c, context(c, "one"), "light").id).toBe("second");
  });
  it("validates every step and respects cross-room opt-in", () => {
    const c = catalogFixture(),
      ctx = context(c, "one");
    c.routines = [
      schemas.routines.parse({
        id: "night",
        name: "Boa noite",
        homeId: "home",
        steps: [{ deviceId: "light-kitchen", action: "off" }],
      }),
    ];
    expect(() => routineSteps(c, ctx, "Boa noite")).toThrow(/limitada/);
    c.routines[0].crossRoom = true;
    expect(routineSteps(c, ctx, "Boa noite").steps[0].device.roomId).toBe("kitchen");
    c.devices[1].enabled = false;
    expect(() => routineSteps(c, ctx, "Boa noite")).toThrow();
  });
});
it.each([
  ["sensor.outside", "light", {}],
  ["binary_sensor.door", "switch", { on: "turn_on" }],
  ["switch.office", "sensor", {}],
  ["switch.office", "light", { on: "toggle" }],
  ["scene.night", "other", { off: "turn_off" }],
])("rejects invalid HA device roles or actions for %s / %s", (haEntityId, kind, actions) => {
  expect(
    schemas.devices.safeParse({
      id: "invalid",
      name: "Invalid",
      homeId: "home",
      roomId: "office",
      connection: "home-assistant",
      haEntityId,
      kind,
      actions,
    }).success,
  ).toBe(false);
});
it("migrates physical identity, credentials, audio values and installed voice without modifying source", () => {
  const old = {
    settings: {
      volume: 80,
      prefill_ms: 600,
      listen_seconds: 10,
      drowsy_seconds: 5,
      tts_voice: "kokoro-pf_dora",
      provider: "openai",
      api_key: "fixture-key",
    },
    rooms: [{ id: "office", name: "Escritório" }],
    robots: [{ id: "rosie", name: "Rosie", room: "office", token: "fixture-existing-token" }],
    devices: [],
    routines: [],
    intents: [],
  };
  const snapshot = JSON.stringify(old),
    result = migrateLegacy(old);
  expect(JSON.stringify(old)).toBe(snapshot);
  expect(result.catalog.endpoints[0]).toMatchObject({
    id: "rosie",
    token: "fixture-existing-token",
    assistantId: "rosie",
    volume: 80,
    listenSeconds: 10,
  });
  expect(result.catalog.assistants[0].voice).toBe("kokoro-pf_dora");
  expect(result.settings.openaiKey).toBe("fixture-key");
});
it("paginates deterministically, rejects invalid sorts, protects references and concurrent edits", async () => {
  const f = await repositoryFixture();
  try {
    const service = new CatalogService(f.repo);
    expect(() => queryFrom(new URLSearchParams("sort=token"))).toThrow();
    expect(() => queryFrom(new URLSearchParams("pageSize=15"))).toThrow();
    const row = (await service.list("endpoints", queryFrom(new URLSearchParams()))).items[0];
    expect(row).not.toHaveProperty("token");
    const source = (await f.repo.catalog()).endpoints[0];
    await service.save("endpoints", { ...source, name: "Updated" }, source.id, 1);
    await expect(service.save("endpoints", source, source.id, 1)).rejects.toThrow(/alterado/);
    await expect(service.remove("rooms", "office", 1)).rejects.toThrow();
    for (let n = 0; n < 22; n++)
      await service.save("residents", { name: `Person ${n}`, homeId: "home" });
    const first = await service.list("residents", queryFrom(new URLSearchParams("pageSize=10"))),
      second = await service.list(
        "residents",
        queryFrom(new URLSearchParams("pageSize=10&page=2")),
      );
    expect(first.items).toHaveLength(10);
    expect(second.items).toHaveLength(10);
    expect(first.items.at(-1)?.name).toBe("Person 9");
    expect(second.items[0].name).toBe("Person 10");
  } finally {
    await f.close();
  }
});
it("keeps history per endpoint while sharing persona and scopes", async () => {
  const f = await repositoryFixture(),
    payloads: Record<string, unknown>[] = [];
  try {
    await f.repo.db.setting.update({
      where: { id: "settings" },
      data: { data: { openaiKey: "fixture-key" } },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        payloads.push(JSON.parse(init.body));
        return new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: "stop",
                message: { content: JSON.stringify({ text: "Tudo certo.", expression: "happy" }) },
              },
            ],
            usage: { prompt_tokens: 25, completion_tokens: 10 },
          }),
        );
      }),
    );
    const conversation = new Conversation(f.repo, {} as Automations);
    const signal = AbortSignal.timeout(10000);
    await conversation.respond("one", "história privada", signal);
    await conversation.respond("two", "outra história", signal);
    await conversation.respond("one", "continue", signal);
    expect(JSON.stringify(payloads[1])).not.toContain("história privada");
    expect(JSON.stringify(payloads[2])).toContain("história privada");
    conversation.reset("one");
    await conversation.respond("one", "recomeçar", signal);
    expect(JSON.stringify(payloads[3])).not.toContain("história privada");
    expect((await conversation.respond("two", "bom dia", signal)).text).toContain("Cozinha");
  } finally {
    vi.unstubAllGlobals();
    await f.close();
  }
});
