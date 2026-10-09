import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { json } from "@rosie/db";
import { schemas, settingsSchema } from "@rosie/types";
import { context } from "@rosie/types/context";
import { afterEach, expect, it, vi } from "vitest";
import { WebSocketServer } from "ws";
import { HomeAssistantAddon } from "../src/server/addons/home-assistant";
import {
  type Command,
  timingClarification,
  validatePlanTiming,
} from "../src/server/automation/commands";
import { planSetting } from "../src/server/automation/plans";
import { localCommand, resolveDevice } from "../src/server/automation/resolver";
import { Automations } from "../src/server/automation/service";
import {
  localTemperatureCommand,
  validateTemperatureValues,
} from "../src/server/automation/temperature";
import { Conversation } from "../src/server/conversation/service";
import { catalogFixture, repositoryFixture } from "./fixture";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const ac = schemas.devices.parse({
  id: "ac-office",
  name: "AC Escritório",
  homeId: "home",
  roomId: "office",
  kind: "climate",
  connection: "home-assistant",
  haEntityId: "climate.office",
  aliases: ["ar", "ar condicionado", "gelinho"],
  actions: { on: "turn_on", off: "turn_off", set_temperature: "set_temperature" },
});
const command = (temperature = 20, delaySeconds = 0): Command => ({
  target: "ar",
  room: null,
  action: "set_temperature",
  routine: false,
  temperature,
  delaySeconds,
});

it.each([
  ["coloca o ar no 20", "ar", 20, null],
  ["coloque o ar condicionado em vinte graus", "ar condicionado", 20, null],
  ["ajusta a temperatura do ar para 22", "ar", 22, null],
  ["ajusta o ar pra 22", "ar", 22, null],
  ["ajustar o ar pra 22", "ar", 22, null],
  ["põe o ar-condicionado no vinte e cinco", "ar-condicionado", 25, null],
  ["você pode colocar o gelinho em 20,5 graus Celsius?", "gelinho", 20.5, null],
  ["por favor, deixa o ar da cozinha no 21", "ar", 21, "cozinha"],
  ["coloca o ar no 20 da cozinha, por favor", "ar", 20, "cozinha"],
])("recognizes local temperature instruction: %s", (text, target, temperature, room) => {
  expect(localTemperatureCommand(String(text))).toMatchObject({
    target,
    temperature,
    room,
    action: "set_temperature",
    delaySeconds: 0,
  });
});

it.each([
  "não coloca o ar no 20",
  "se estiver quente coloca o ar no 20",
  "coloca o ar no 20 depois de 5 segundos",
  "coloca o ar no 20 e apaga a luz",
  "qual a temperatura do ar?",
  "coloca o ar no 20 e o da cozinha no 22",
])("does not immediately execute a conditional, compound or delayed instruction: %s", (text) => {
  expect(localTemperatureCommand(text)).toBeNull();
});

it("recognizes aliases with and without hyphens in the correct room, retaining ambiguity checks", () => {
  const c = catalogFixture();
  c.devices.push(ac, { ...ac, id: "ac-kitchen", roomId: "kitchen" });
  for (const target of ["ar", "ar condicionado", "ar-condicionado", "gelinho", "AC Escritório"])
    expect(resolveDevice(c, context(c, "one"), target).id).toBe(ac.id);
  expect(resolveDevice(c, context(c, "one"), "ar", "Cozinha").id).toBe("ac-kitchen");
  c.devices.push({ ...ac, id: "second-ac" });
  expect(() => resolveDevice(c, context(c, "one"), "ar")).toThrow(/Qual deles/);
  expect(localCommand("liga o ar no 20")).toBeNull();
});

it("preserves temperature and explicit delay as different quantities", () => {
  const text = "coloque o ar em 20 graus e apague a luz depois de cinco segundos";
  const steps = [
    command(),
    { target: "luz", action: "off", room: null, routine: false, delaySeconds: 5 },
  ];
  expect(timingClarification(text)).toBeNull();
  expect(() => validatePlanTiming(text, steps)).not.toThrow();
  expect(() => validateTemperatureValues(text, steps)).not.toThrow();
  expect(() =>
    validateTemperatureValues(text, [{ ...command(), temperature: 22 }, steps[1]]),
  ).toThrow(/temperaturas/);
  expect(() =>
    validateTemperatureValues(text, [{ ...command(), action: "on", temperature: null }, steps[1]]),
  ).toThrow(/temperaturas/);
  expect(() => validatePlanTiming(text, [command(), { ...steps[1], delaySeconds: 0 }])).toThrow(
    /intervalos/,
  );
  expect(timingClarification("coloca o ar no 20 e apaga a luz em 5")).toBeTruthy();
  expect(timingClarification("coloca o ar no 20 e apaga a luz em 20")).toBeTruthy();
  expect(() => localTemperatureCommand("coloca o ar em 68 graus Fahrenheit")).toThrow(/Celsius/);
  expect(() =>
    validateTemperatureValues("ajustar o ar pra 22", [
      { ...command(22) },
      { ...command(), action: "off", temperature: null },
    ]),
  ).toThrow(/não autoriza/);
});

async function fixture() {
  const f = await repositoryFixture();
  await f.repo.db.entry.create({
    data: { collection: "devices", id: ac.id, name: ac.name, data: json(ac) },
  });
  const automations = new Automations(f.repo);
  const install = (service: Automations) => {
    vi.spyOn(service.addons.homeAssistant, "status").mockReturnValue({
      enabled: true,
      connected: true,
      ready: true,
      entities: 1,
      error: null,
    });
    vi.spyOn(service.addons.homeAssistant, "validateTemperature").mockImplementation(
      (_device, t) => {
        if (t < 17 || t > 27) throw new Error("fixture bounds");
      },
    );
    return vi.spyOn(service.addons.homeAssistant, "execute").mockResolvedValue(undefined);
  };
  return {
    ...f,
    automations,
    send: install(automations),
    install,
    close: async () => {
      automations.close();
      await automations.settled();
      await f.close();
    },
  };
}

it("executes an aliased temperature locally without calling an LLM, then rejects missing/wrong parameters before any send", async () => {
  const f = await fixture(),
    fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  try {
    const reply = await new Conversation(f.repo, f.automations).respond(
      "one",
      "coloca o ar condicionado no 20",
      AbortSignal.timeout(2000),
    );
    expect(reply.text).toContain("20 graus");
    expect(f.send).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: ac.id }),
      "set_temperature",
      20,
    );
    expect(fetcher).not.toHaveBeenCalled();
    f.send.mockClear();
    for (const step of [
      { ...command(), temperature: undefined },
      { ...command(), action: "on" },
      { ...command(), routine: true },
      { ...command(), target: "luz" },
    ])
      await expect(f.automations.executePlan("one", [command(), step])).rejects.toThrow();
    expect(f.send).not.toHaveBeenCalled();
  } finally {
    await f.close();
  }
});

it("includes aliases and typed temperature in the conversational path with one model request", async () => {
  const f = await fixture();
  try {
    await f.repo.db.setting.update({
      where: { id: "settings" },
      data: { data: { openaiKey: "fixture-key" } },
    });
    const provider = vi.fn().mockResolvedValue(
      Response.json({
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              content: null,
              tool_calls: [
                {
                  id: "one",
                  type: "function",
                  function: {
                    name: "control_home",
                    arguments: JSON.stringify({ steps: [command()] }),
                  },
                },
              ],
            },
          },
        ],
        usage: {},
      }),
    );
    vi.stubGlobal("fetch", provider);
    await new Conversation(f.repo, f.automations).respond(
      "one",
      "Quero que o gelinho fique em 20 graus, por gentileza",
      AbortSignal.timeout(2000),
    );
    expect(provider).toHaveBeenCalledTimes(1);
    const body = JSON.parse(provider.mock.calls[0][1].body);
    expect(body.messages[0].content).toContain('"aliases":["ar","ar condicionado","gelinho"]');
    expect(
      body.tools.find((t: { function: { name: string } }) => t.function.name === "control_home")
        .function.parameters.properties.steps.items.properties.temperature,
    ).toBeDefined();
    expect(f.send).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: ac.id }),
      "set_temperature",
      20,
    );
  } finally {
    await f.close();
  }
});

it("retains temperature in a pending plan across restart and sends it only after its deadline", async () => {
  const f = await fixture();
  let restarted: Automations | undefined;
  try {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    await f.automations.executePlan("one", [command(20, 5)]);
    expect(f.send).not.toHaveBeenCalled();
    expect(
      JSON.stringify((await f.repo.db.setting.findUnique({ where: { id: planSetting } }))?.data),
    ).toContain('"temperature":20');
    f.automations.close();
    await f.automations.settled();
    restarted = new Automations(f.repo);
    const send = f.install(restarted);
    vi.spyOn(restarted.addons, "configure").mockResolvedValue(undefined);
    await restarted.configure();
    await vi.advanceTimersByTimeAsync(4999);
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await restarted.settled();
    expect(send).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: ac.id }),
      "set_temperature",
      20,
    );
  } finally {
    restarted?.close();
    await restarted?.settled();
    await f.close();
  }
});

it("uses climate.set_temperature with validated HA limits, without turning on or changing HVAC mode", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("port");
  const addon = new HomeAssistantAddon(),
    calls: Record<string, unknown>[] = [];
  const state = {
    entity_id: "climate.office",
    state: "cool",
    attributes: { supported_features: 385, min_temp: 17, max_temp: 27, target_temp_step: 1 },
    last_updated: new Date().toISOString(),
  };
  let peer: import("ws").WebSocket | undefined;
  server.on("connection", (ws) => {
    peer = ws;
    ws.send(JSON.stringify({ type: "auth_required" }));
    ws.on("message", (raw) => {
      const m = JSON.parse(raw.toString());
      calls.push(m);
      if (m.type === "auth") {
        ws.send(JSON.stringify({ type: "auth_ok" }));
        return;
      }
      ws.send(
        JSON.stringify({
          type: "result",
          id: m.id,
          success: true,
          result:
            m.type === "get_states"
              ? [
                  state,
                  {
                    entity_id: "scene.office_20",
                    state: new Date().toISOString(),
                    attributes: {},
                    last_updated: new Date().toISOString(),
                  },
                ]
              : m.type === "get_config"
                ? { unit_system: { temperature: "°C" } }
                : null,
        }),
      );
    });
  });
  try {
    await addon.configure(
      settingsSchema.parse({
        homeAssistantEnabled: true,
        homeAssistantUrl: `http://127.0.0.1:${address.port}`,
        homeAssistantToken: "fixture-token",
        homeAssistantHomeId: "home",
      }),
    );
    for (let i = 0; i < 100 && !addon.status().ready; i++) await delay(10);
    expect(addon.status().ready).toBe(true);
    for (const temperature of [16, 28, 20.5, Number.NaN])
      await expect(addon.execute(ac, "set_temperature", temperature)).rejects.toThrow();
    await expect(addon.execute(ac, "set_temperature")).rejects.toThrow(/temperatura/);
    await expect(addon.execute({ ...ac, homeId: "other" }, "set_temperature", 20)).rejects.toThrow(
      /outra casa/,
    );
    await expect(
      addon.execute({ ...ac, actions: { on: "turn_on" } }, "set_temperature", 20),
    ).rejects.toThrow(/habilitado/);
    await addon.execute(ac, "set_temperature", 20);
    expect(calls.filter((v) => v.type === "call_service")).toEqual([
      expect.objectContaining({
        domain: "climate",
        service: "set_temperature",
        target: { entity_id: ac.haEntityId },
        service_data: { temperature: 20 },
      }),
    ]);
    expect(JSON.stringify(calls.filter((v) => v.type === "call_service"))).not.toContain(
      "hvac_mode",
    );
    const infrared = { ...ac, haTemperatureScenes: { "20": "scene.office_20" } };
    await addon.execute(infrared, "set_temperature", 20);
    expect(calls.filter((v) => v.type === "call_service").at(-1)).toMatchObject({
      domain: "scene",
      service: "turn_on",
      target: { entity_id: "scene.office_20" },
    });
    expect(addon.comfortState(infrared)).toMatchObject({ temperature: 20, source: "command" });
    await expect(addon.execute(infrared, "set_temperature", 21)).rejects.toThrow(/cena/);
    peer?.send(
      JSON.stringify({
        type: "event",
        event: {
          event_type: "state_changed",
          data: {
            new_state: {
              entity_id: "scene.office_20",
              state: "unavailable",
              attributes: {},
              last_updated: new Date().toISOString(),
            },
          },
        },
      }),
    );
    await delay(20);
    await expect(addon.execute(infrared, "set_temperature", 20)).rejects.toThrow(/cena/);
    peer?.send(
      JSON.stringify({
        type: "event",
        event: {
          event_type: "state_changed",
          data: {
            new_state: {
              ...state,
              state: "unavailable",
              last_updated: new Date(Date.now() + 1000).toISOString(),
            },
          },
        },
      }),
    );
    await delay(20);
    await expect(addon.execute(ac, "set_temperature", 20)).rejects.toThrow(/indisponível/);
    expect(calls.filter((v) => v.type === "call_service")).toHaveLength(2);
  } finally {
    addon.close();
    for (const ws of server.clients) ws.terminate();
    await new Promise<void>((r) => server.close(() => r()));
  }
});

it.each([
  { kind: "light", haEntityId: "light.office", actions: { set_temperature: "set_temperature" } },
  { kind: "climate", haEntityId: "climate.office", actions: { on: "set_temperature" } },
  { kind: "climate", haEntityId: "climate.office", actions: { set_temperature: "turn_on" } },
])("rejects incompatible temperature action mappings: %j", (override) => {
  expect(schemas.devices.safeParse({ ...ac, ...override }).success).toBe(false);
});
