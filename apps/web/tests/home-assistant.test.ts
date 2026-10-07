import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { schemas, settingsSchema } from "@rosie/types";
import { expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { HomeAssistantAddon } from "../src/server/addons/home-assistant";
import { CatalogService } from "../src/server/catalog/service";
import { repositoryFixture } from "./fixture";

it.each([
  { domain: "light", automatic: true },
  { domain: "switch", automatic: true },
  { domain: "switch", automatic: false },
])(
  "controls HA $domain with automatic catalog $automatic, isolates homes and never replays",
  async ({ domain, automatic }) => {
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("port");
    const calls: Record<string, unknown>[] = [];
    let disconnect = false;
    let exposed = true;
    const state = {
      entity_id: `${domain}.office`,
      state: "off",
      attributes: { friendly_name: "Luz do escritório" },
      last_updated: new Date().toISOString(),
    };
    server.on("connection", (ws) => {
      ws.send(JSON.stringify({ type: "auth_required" }));
      ws.on("message", (data) => {
        const message = JSON.parse(data.toString());
        calls.push(message);
        if (message.type === "auth") {
          ws.send(
            JSON.stringify({
              type: message.access_token === "fixture-token" ? "auth_ok" : "auth_invalid",
            }),
          );
          return;
        }
        if (message.type === "call_service" && disconnect) {
          ws.terminate();
          return;
        }
        const values: Record<string, unknown> = {
          "homeassistant/expose_entity/list": {
            exposed_entities: exposed ? { [state.entity_id]: { conversation: true } } : {},
          },
          get_states: [state, { ...state, entity_id: "tts.home_assistant_cloud" }],
          "tts/engine/voices": {
            voices: [
              { voice_id: "FranciscaNeural", name: "Francisca" },
              { voice_id: "FranciscaNeural||calm", name: "Francisca (calm)" },
            ],
          },
          "config/area_registry/list": [{ area_id: "office", name: "Escritório" }],
          "config/entity_registry/list": [
            { entity_id: state.entity_id, device_id: "lamp", area_id: null },
          ],
          "config/device_registry/list": [{ id: "lamp", area_id: "office" }],
        };
        ws.send(
          JSON.stringify({
            type: "result",
            id: message.id,
            success: true,
            result: values[message.type] ?? null,
          }),
        );
      });
    });
    const addon = new HomeAssistantAddon(),
      cfg = settingsSchema.parse({
        homeAssistantEnabled: true,
        homeAssistantAutomaticCatalog: automatic,
        homeAssistantUrl: `http://127.0.0.1:${address.port}`,
        homeAssistantToken: "fixture-token",
        homeAssistantHomeId: "home",
      });
    const device = schemas.devices.parse({
      id: "ha-lamp",
      name: "Luz",
      homeId: "home",
      roomId: "office",
      connection: "home-assistant",
      haEntityId: state.entity_id,
      actions: { on: "turn_on", off: "turn_off" },
    });
    try {
      await addon.configure(cfg);
      for (let i = 0; i < 100 && !addon.status().ready; i++) await delay(10);
      expect(addon.status().ready).toBe(true);
      expect(await addon.cloudVoices("home")).toEqual(["FranciscaNeural"]);
      await expect(addon.cloudVoices("other-home")).rejects.toThrow(/outra casa/);
      expect(calls.find((v) => v.type === "tts/engine/voices")).toMatchObject({
        engine_id: "tts.home_assistant_cloud",
        language: "pt-BR",
      });
      expect((await addon.discover("home"))[0]).toMatchObject({
        id: state.entity_id,
        areaName: "Escritório",
      });
      await expect(addon.discover("other-home")).rejects.toThrow(/outra casa/);
      await addon.execute(device, "on", undefined, !automatic);
      expect(calls.filter((v) => v.type === "call_service")).toEqual([
        expect.objectContaining({
          domain,
          service: "turn_on",
          target: { entity_id: state.entity_id },
        }),
      ]);
      await expect(addon.execute(device, "unregistered")).rejects.toThrow(/não cadastrada/);
      await expect(addon.execute({ ...device, homeId: "other-home" }, "on")).rejects.toThrow(
        /outra casa/,
      );
      for (const ws of server.clients)
        ws.send(
          JSON.stringify({
            type: "event",
            event: {
              event_type: "state_changed",
              data: {
                new_state: { ...state, state: "on", last_updated: new Date().toISOString() },
              },
            },
          }),
        );
      await delay(20);
      expect(addon.value(device, 60)).toBe("on");
      exposed = false;
      await expect(addon.execute(device, "off", undefined, !automatic)).rejects.toThrow(
        /exposto ao Assist/,
      );
      expect(calls.filter((v) => v.type === "call_service")).toHaveLength(1);
      exposed = true;
      disconnect = true;
      await expect(addon.execute(device, "off", undefined, !automatic)).rejects.toThrow(
        /Não vou repeti/,
      );
      await addon.configure({ ...cfg, homeAssistantEnabled: false });
      await delay(20);
      expect(calls.filter((v) => v.type === "call_service")).toHaveLength(2);
      expect(addon.status().ready).toBe(false);
      expect(() => addon.value(device, 60)).toThrow(/desconectado/);
    } finally {
      addon.close();
      for (const ws of server.clients) ws.terminate();
      await new Promise<void>((r) => server.close(() => r()));
    }
  },
);
it("prevents duplicate HA entities under concurrent catalog imports", async () => {
  const f = await repositoryFixture(),
    service = new CatalogService(f.repo);
  try {
    const input = {
      name: "Luz HA",
      homeId: "home",
      roomId: "office",
      connection: "home-assistant",
      haEntityId: "light.office",
      actions: { on: "turn_on", off: "turn_off" },
    };
    const results = await Promise.allSettled([
      service.save("devices", input),
      service.save("devices", input),
    ]);
    expect(results.filter((v) => v.status === "fulfilled")).toHaveLength(1);
    expect(
      (await f.repo.catalog()).devices.filter((v) => v.haEntityId === "light.office"),
    ).toHaveLength(1);
  } finally {
    await f.close();
  }
});
