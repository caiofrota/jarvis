import { json } from "@rosie/db";
import { afterEach, expect, it, vi } from "vitest";
import {
  type Command,
  timingClarification,
  validatePlanTiming,
} from "../src/server/automation/commands";
import { planSetting } from "../src/server/automation/plans";
import { localCommand } from "../src/server/automation/resolver";
import { Automations } from "../src/server/automation/service";
import { CatalogService } from "../src/server/catalog/service";
import { Conversation } from "../src/server/conversation/service";
import { repositoryFixture } from "./fixture";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const step = (action = "on", delaySeconds = 0, room: string | null = null): Command => ({
  target: "luz",
  action,
  delaySeconds,
  room,
  routine: false,
});
const later = () => [step(), step("off", 5)];

it("uses the recognized resident for scoped routines and pins it for delayed steps without modifying the box", async () => {
  const f = await fixture();
  try {
    const catalog = new CatalogService(f.repo);
    await catalog.save("residents", { name: "Caio", homeId: "home" });
    await catalog.save("routines", {
      name: "Meu descanso",
      homeId: "home",
      aliases: ["meu descanso"],
      scope: { residentIds: ["caio"] },
      steps: [{ deviceId: "light-office", action: "off" }],
    });
    const conversation = new Conversation(f.repo, f.automations);
    const unknown = await conversation.respond(
      "one",
      "meu descanso",
      new AbortController().signal,
      null,
    );
    expect(unknown.text).not.toContain("Comando enviado");
    expect(f.send).not.toHaveBeenCalled();
    await conversation.respond("one", "meu descanso", new AbortController().signal, "caio");
    expect(f.send).toHaveBeenCalledTimes(1);
    f.send.mockClear();
    vi.useFakeTimers();
    await f.automations.executePlan("one", [step("off", 5)], undefined, undefined, "caio");
    await vi.advanceTimersByTimeAsync(5000);
    await f.automations.settled();
    expect(f.send).toHaveBeenCalledTimes(1);
    expect((await f.repo.catalog()).endpoints[0].residentId).toBeNull();
    f.send.mockClear();
    await f.automations.executePlan("one", [step("off", 5)], undefined, undefined, "caio");
    const endpoint = (await f.repo.catalog()).endpoints[0];
    await catalog.save("endpoints", { ...endpoint, residentId: "caio" }, endpoint.id, 1);
    await vi.advanceTimersByTimeAsync(5000);
    await f.automations.settled();
    expect(f.send).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
    await f.close();
  }
});
async function fixture() {
  const f = await repositoryFixture(),
    automations = new Automations(f.repo);
  const devices = (await f.repo.catalog()).devices;
  for (const device of devices)
    await new CatalogService(f.repo).save(
      "devices",
      {
        ...device,
        connection: "home-assistant",
        haEntityId: `switch.${device.roomId}`,
        actions: { on: "turn_on", off: "turn_off" },
      },
      device.id,
      1,
    );
  const install = (service: Automations) => {
    vi.spyOn(service.addons.homeAssistant, "status").mockReturnValue({
      enabled: true,
      connected: true,
      ready: true,
      entities: 2,
      error: null,
    });
    return vi.spyOn(service.addons.homeAssistant, "execute").mockResolvedValue(undefined);
  };
  const send = install(automations);
  return {
    ...f,
    automations,
    send,
    install,
    close: async () => {
      automations.close();
      await automations.settled();
      await f.close();
    },
  };
}
it.each([
  "acende a luz e depois de 5 segundos apaga",
  "apaga a luz da sala e do corredor e liga a tv",
])("does not greedily parse a compound command: %s", (phrase) => {
  expect(localCommand(phrase)).toBeNull();
});
it.each([
  "acende a luz e apaga depois de 5",
  "apaga a luz amanhã",
  "apaga em 5,5 segundos",
  "apaga em -5 segundos",
  "apaga em meia hora",
  "apaga em cento e cinco segundos",
])("requires clarification for unsupported or ambiguous timing: %s", (phrase) => {
  expect(timingClarification(phrase)).toBeTruthy();
});
it("rejects omitted/invented delays before dispatch, accepts numeric and spoken seconds", () => {
  for (const text of [
    "acende a luz e apaga depois de 5 segundos",
    "acende a luz e apaga depois de cinco segundos",
  ]) {
    expect(() => validatePlanTiming(text, later())).not.toThrow();
    expect(() => validatePlanTiming(text, [step(), step("off")])).toThrow(/intervalos/);
  }
  expect(() => validatePlanTiming("acende a luz", [step("on", 5)])).toThrow();
  expect(() =>
    validatePlanTiming("apaga em vinte e cinco segundos", [step("off", 25)]),
  ).not.toThrow();
});
it("waits five seconds without blocking another endpoint and pins the original target", async () => {
  const f = await fixture();
  try {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const reply = await f.automations.executePlan("one", later());
    expect(reply).toContain("5 segundos");
    expect(f.send).toHaveBeenCalledTimes(1);
    await f.automations.execute("two", "luz", "off");
    await vi.advanceTimersByTimeAsync(4999);
    await f.automations.settled();
    expect(f.send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await f.automations.settled();
    expect(f.send).toHaveBeenLastCalledWith(expect.objectContaining({ id: "light-office" }), "off");
    expect(f.send).toHaveBeenCalledTimes(3);
  } finally {
    await f.close();
  }
});
it("preflights every device before dispatch and controls explicit rooms in order", async () => {
  const f = await fixture();
  try {
    await expect(
      f.automations.executePlan("one", [step("off", 0, "Cozinha"), { ...step(), target: "tv" }]),
    ).rejects.toThrow(/Não encontrei/);
    expect(f.send).not.toHaveBeenCalled();
    await f.automations.executePlan("one", [step("off", 0, "Cozinha"), step()]);
    expect(f.send.mock.calls.map(([d, a]) => [d.id, a])).toEqual([
      ["light-kitchen", "off"],
      ["light-office", "on"],
    ]);
  } finally {
    await f.close();
  }
});
it("handles a combined light/light/TV request as one model plan", async () => {
  const f = await fixture();
  try {
    await new CatalogService(f.repo).save("devices", {
      name: "TV",
      homeId: "home",
      roomId: "office",
      kind: "other",
      connection: "home-assistant",
      haEntityId: "switch.tv",
      actions: { on: "turn_on", off: "turn_off" },
    });
    await f.repo.db.setting.update({
      where: { id: "settings" },
      data: { data: { openaiKey: "fixture-key" } },
    });
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: "tool_calls",
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: "plan",
                      type: "function",
                      function: {
                        name: "control_home",
                        arguments: JSON.stringify({
                          steps: [
                            step("off", 0, "office"),
                            step("off", 0, "kitchen"),
                            { ...step(), target: "TV" },
                          ],
                        }),
                      },
                    },
                  ],
                },
              },
            ],
            usage: {},
          }),
        ),
    );
    vi.stubGlobal("fetch", fetcher);
    const reply = await new Conversation(f.repo, f.automations).respond(
      "one",
      "apaga a luz do escritório e da cozinha e liga a TV",
      AbortSignal.timeout(5000),
    );
    expect(reply.text).toContain("Comandos enviados");
    expect(f.send.mock.calls.map(([device, action]) => [device.id, action])).toEqual([
      ["light-office", "off"],
      ["light-kitchen", "off"],
      ["tv", "on"],
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  } finally {
    await f.close();
  }
});
it("rejects oversized plans, excessive waits and late timers without sending commands", async () => {
  const f = await fixture();
  try {
    await expect(
      f.automations.executePlan(
        "one",
        Array.from({ length: 9 }, () => step()),
      ),
    ).rejects.toThrow();
    await expect(
      f.automations.executePlan("one", [step("on", 3600), step("off", 1)]),
    ).rejects.toThrow(/hora/);
    expect(f.send).not.toHaveBeenCalled();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    await f.automations.executePlan("one", [step("on", 5)]);
    vi.setSystemTime(Date.now() + 20000);
    await vi.advanceTimersByTimeAsync(5000);
    await f.automations.settled();
    expect(f.send).not.toHaveBeenCalled();
  } finally {
    await f.close();
  }
});
it("rechecks a delayed routine's authorization after its definition changes", async () => {
  const f = await fixture();
  try {
    const service = new CatalogService(f.repo);
    await service.save("routines", {
      name: "Boa noite",
      homeId: "home",
      steps: [{ deviceId: "light-office", action: "off" }],
    });
    const routine = (await f.repo.catalog()).routines[0];
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    await f.automations.executePlan("one", [
      { ...step("run", 5), target: "Boa noite", routine: true },
    ]);
    await service.save("routines", { ...routine, enabled: false }, String(routine.id), 1);
    await vi.advanceTimersByTimeAsync(5000);
    await f.automations.settled();
    expect(f.send).not.toHaveBeenCalled();
  } finally {
    await f.close();
  }
});
it.each(["cancel", "supersede", "disabled", "moved"])(
  "suppresses a delayed action after %s",
  async (change) => {
    const f = await fixture();
    try {
      vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
      await f.automations.executePlan("one", later());
      if (change === "cancel") await f.automations.cancelPending("one");
      if (change === "supersede") await f.automations.execute("one", "luz", "on");
      if (change === "disabled") {
        const device = (await f.repo.catalog()).devices[0];
        await new CatalogService(f.repo).save(
          "devices",
          { ...device, enabled: false },
          device.id,
          2,
        );
      }
      if (change === "moved") {
        const endpoint = (await f.repo.catalog()).endpoints[0];
        await new CatalogService(f.repo).save(
          "endpoints",
          { ...endpoint, roomId: "kitchen" },
          endpoint.id,
          1,
        );
      }
      await vi.advanceTimersByTimeAsync(5000);
      await f.automations.settled();
      expect(f.send.mock.calls.every(([, action]) => action === "on")).toBe(true);
    } finally {
      await f.close();
    }
  },
);
it("does not cancel another endpoint's timer", async () => {
  const f = await fixture();
  try {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    await f.automations.executePlan("one", later());
    expect(await f.automations.cancelPending("two")).toContain("não tem");
    await vi.advanceTimersByTimeAsync(5000);
    await f.automations.settled();
    expect(f.send).toHaveBeenCalledTimes(2);
  } finally {
    await f.close();
  }
});
it("does not execute later steps after uncertain transport or request cancellation", async () => {
  const f = await fixture();
  try {
    f.send.mockRejectedValueOnce(new Error("lost ack"));
    await expect(f.automations.executePlan("one", later())).rejects.toThrow(/não vou repeti/);
    expect(f.send).toHaveBeenCalledTimes(1);
    expect((await f.repo.db.setting.findUnique({ where: { id: planSetting } }))?.data).toEqual([]);
    const controller = new AbortController();
    controller.abort();
    await expect(f.automations.executePlan("one", later(), controller.signal)).rejects.toThrow();
    expect(f.send).toHaveBeenCalledTimes(1);
  } finally {
    await f.close();
  }
});
it.each(["future", "overdue", "uncertain"])(
  "recovers %s work without replaying the first action",
  async (mode) => {
    const f = await fixture();
    let restored: Automations | undefined;
    try {
      vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
      await f.automations.executePlan("one", later());
      f.automations.close();
      if (mode === "overdue") await vi.advanceTimersByTimeAsync(6000);
      if (mode === "uncertain") {
        const row = await f.repo.db.setting.findUniqueOrThrow({ where: { id: planSetting } });
        const plans = JSON.parse(JSON.stringify(row.data));
        plans[0].phase = "dispatching";
        await f.repo.db.setting.update({ where: { id: planSetting }, data: { data: json(plans) } });
      }
      restored = new Automations(f.repo);
      const send = f.install(restored);
      vi.spyOn(restored.addons, "configure").mockResolvedValue(undefined);
      await restored.configure();
      await vi.advanceTimersByTimeAsync(5000);
      await restored.settled();
      expect(send).toHaveBeenCalledTimes(mode === "future" ? 1 : 0);
      if (mode === "future")
        expect(send).toHaveBeenLastCalledWith(
          expect.objectContaining({ id: "light-office" }),
          "off",
        );
    } finally {
      restored?.close();
      await restored?.settled();
      await f.close();
    }
  },
);
it.each([true, false])(
  "validates the model's entire timed plan (correct delay: %s)",
  async (correct) => {
    const f = await fixture();
    try {
      await f.repo.db.setting.update({
        where: { id: "settings" },
        data: { data: { openaiKey: "fixture-key" } },
      });
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                choices: [
                  {
                    finish_reason: "tool_calls",
                    message: {
                      content: null,
                      tool_calls: [
                        {
                          id: "plan",
                          type: "function",
                          function: {
                            name: "control_home",
                            arguments: JSON.stringify({
                              steps: correct ? later() : [step(), step("off")],
                            }),
                          },
                        },
                      ],
                    },
                  },
                ],
                usage: {},
              }),
            ),
        ),
      );
      const result = await new Conversation(f.repo, f.automations).respond(
        "one",
        "acenda a luz e depois de 5 segundos apague",
        AbortSignal.timeout(5000),
      );
      expect(result.text).toContain(correct ? "5 segundos" : "Nenhum comando");
      expect(f.send).toHaveBeenCalledTimes(correct ? 1 : 0);
    } finally {
      await f.close();
    }
  },
);
