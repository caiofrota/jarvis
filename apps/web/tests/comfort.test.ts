import { json } from "@rosie/db";
import { schemas } from "@rosie/types";
import { DomainError } from "@rosie/types/context";
import { afterEach, expect, it, vi } from "vitest";
import { comfortFeeling } from "../src/server/automation/comfort";
import { Automations, type ComfortState } from "../src/server/automation/service";
import { Conversation } from "../src/server/conversation/service";
import { repositoryFixture } from "./fixture";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const ac = schemas.devices.parse({
  id: "ac-office",
  name: "Ar do escritório",
  homeId: "home",
  roomId: "office",
  kind: "climate",
  connection: "home-assistant",
  haEntityId: "climate.office",
  actions: { on: "turn_on", off: "turn_off", set_temperature: "set_temperature" },
});
const fan = schemas.devices.parse({
  id: "fan-office",
  name: "Ventilador",
  homeId: "home",
  roomId: "office",
  kind: "fan",
  connection: "home-assistant",
  haEntityId: "fan.office",
  actions: { on: "turn_on", off: "turn_off" },
});
const cool: ComfortState = {
  mode: "cool",
  temperature: 20,
  min: 17,
  max: 27,
  step: 1,
  modes: ["cool", "off"],
};
async function fixture(devices = [ac]) {
  const f = await repositoryFixture(),
    automation = new Automations(f.repo);
  for (const d of devices)
    await f.repo.db.entry.create({
      data: { collection: "devices", id: d.id, name: d.name, data: json(d) },
    });
  const states = new Map<string, ComfortState>(devices.map((d) => [d.id, { ...cool }]));
  const state = vi
    .spyOn(automation.addons.homeAssistant, "comfortState")
    .mockImplementation((d) => {
      const s = states.get(d.id);
      if (!s || s.mode === "unavailable") throw new DomainError("Aparelho indisponível.");
      return { ...s };
    });
  vi.spyOn(automation.addons.homeAssistant, "status").mockReturnValue({
    enabled: true,
    connected: true,
    ready: true,
    entities: devices.length,
    error: null,
  });
  vi.spyOn(automation.addons.homeAssistant, "validateTemperature").mockImplementation((d, t) => {
    if (!d.actions.set_temperature || t < 17 || t > 27) throw new DomainError("Fora dos limites.");
  });
  const send = vi.spyOn(automation.addons.homeAssistant, "execute").mockResolvedValue(undefined),
    fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const conversation = new Conversation(f.repo, automation);
  return {
    ...f,
    automation,
    conversation,
    states,
    state,
    send,
    fetcher,
    say: (text: string, endpoint = "one") =>
      conversation.respond(endpoint, text, AbortSignal.timeout(3000)),
    close: async () => {
      automation.close();
      await automation.settled();
      await f.close();
    },
  };
}

it.each([
  "tô com frio",
  "eu estou com muito frio aqui",
  "estamos com um pouco de frio",
  "tá frio aqui",
  "estou sentindo frio",
  "eu sinto muito frio aqui",
  "estou passando frio",
  "nossa, tô com um frio danado aqui, viu",
])("recognizes cold without a model: %s", (text) => expect(comfortFeeling(text)).toBe("cold"));
it.each([
  "Rosie, eu tô com frio",
  "estou sentindo frio, Rosie",
  "oi Rosie, tô com frio aqui no escritório",
  "tô com friozinho, por favor",
])("accepts spoken addresses and same-room context: %s", (text) => {
  expect(comfortFeeling(text, ["Rosie"], ["Escritório"])).toBe("cold");
});
it.each(["tô com calor", "estou com bastante calor", "que calor", "tá muito quente aqui"])(
  "recognizes heat without a model: %s",
  (text) => expect(comfortFeeling(text)).toBe("hot"),
);
it.each([
  "não estou com frio",
  "se eu estiver com calor",
  "ela está com frio",
  "qual o clima lá fora",
  "tô com frio, mas não mexa no ar",
  "Rosie, não estou com frio",
  "estou com frio na barriga",
  "o que fazer quando estou com frio",
  "tô com frio na cozinha",
  "estava com frio ontem",
])("does not turn unrelated speech into an implicit request: %s", (text) =>
  expect(comfortFeeling(text)).toBeNull(),
);

it("offers the actual room AC setpoint, waits for consent and dispatches only once with no LLM", async () => {
  const f = await fixture();
  try {
    expect((await f.say("Rosie, estou sentindo frio aqui no escritório")).text).toMatch(
      /20 graus.*aumente para 22/,
    );
    expect(f.send).not.toHaveBeenCalled();
    expect((await f.say("sim, por favor, Rosie")).text).toContain("22 graus");
    expect(f.send).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: ac.id }),
      "set_temperature",
      22,
    );
    expect((await f.say("sim")).text).toContain("Não há uma sugestão");
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.fetcher).not.toHaveBeenCalled();
  } finally {
    await f.close();
  }
});

it.each(["não", "não, obrigada", "deixa pra lá", "pode desligar"])(
  "does not execute the offered adjustment for %s",
  async (text) => {
    const f = await fixture();
    try {
      await f.say("tô com frio");
      await f.say(text);
      await f.say("sim");
      expect(f.send).not.toHaveBeenCalled();
    } finally {
      await f.close();
    }
  },
);

it("expires offers and invalidates them on a different question or a new session", async () => {
  const f = await fixture();
  try {
    vi.useFakeTimers({ toFake: ["Date"] });
    await f.say("tô com frio");
    vi.setSystemTime(Date.now() + 61000);
    expect((await f.say("sim")).text).toContain("Não há uma sugestão");
    await f.say("tô com frio");
    await f.say("bom dia");
    await f.say("sim");
    await f.say("tô com frio");
    f.conversation.reset("one");
    await f.say("sim");
    expect(f.send).not.toHaveBeenCalled();
    expect(f.fetcher).not.toHaveBeenCalled();
  } finally {
    await f.close();
  }
});

it("requires fresh consent when the appliance state changes before yes", async () => {
  const f = await fixture();
  try {
    await f.say("tô com frio");
    f.states.set(ac.id, { ...cool, temperature: 23 });
    expect((await f.say("sim")).text).toMatch(/estado.*mudou.*23 graus.*25/);
    expect(f.send).not.toHaveBeenCalled();
    await f.say("pode ajustar");
    expect(f.send).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: ac.id }),
      "set_temperature",
      25,
    );
  } finally {
    await f.close();
  }
});

it("checks state again at dispatch, after the plan has been admitted", async () => {
  const f = await fixture();
  try {
    await f.say("tô com frio");
    // Reads at confirmation, preflight, then immediately before transport.
    f.state
      .mockReturnValueOnce({ ...cool })
      .mockReturnValueOnce({ ...cool })
      .mockReturnValue({ ...cool, mode: "off" });
    expect((await f.say("sim")).text).toContain("Não executei");
    expect(f.send).not.toHaveBeenCalled();
  } finally {
    await f.close();
  }
});

it("does not share offers across endpoints, previews or changed catalog context", async () => {
  const f = await fixture();
  try {
    expect((await f.say("tô com calor", "two")).text).toContain("Não tenho ar-condicionado");
    await f.say("tô com frio");
    await f.say("sim", "two");
    await new Conversation(f.repo, f.automation).respond("one", "sim", AbortSignal.timeout(3000));
    await f.repo.db.entry.update({
      where: { collection_id: { collection: "devices", id: ac.id } },
      data: { data: json({ ...ac, actions: { on: "turn_on", off: "turn_off" } }) },
    });
    expect((await f.say("sim")).text).toContain("cadastro mudou");
    expect(f.send).not.toHaveBeenCalled();
  } finally {
    await f.close();
  }
});

it("respects room defaults, rejects ambiguity and never falls back to another room", async () => {
  const f = await fixture([ac, { ...ac, id: "second-ac" }]);
  try {
    expect((await f.say("tô com frio")).text).toContain("Qual deles");
    const c = await f.repo.catalog(),
      room = c.rooms.find((v) => v.id === "office");
    await f.repo.db.entry.update({
      where: { collection_id: { collection: "rooms", id: "office" } },
      data: { data: json({ ...room, defaultDevices: { climate: ac.id } }) },
    });
    expect((await f.say("tô com frio")).text).toContain("aumente para 22");
    await f.say("sim");
    expect(f.send).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: ac.id }),
      "set_temperature",
      22,
    );
  } finally {
    await f.close();
  }
});

it.each([
  ["calor", { ...cool, mode: "off" }, "ligue", "on", undefined],
  ["calor", { ...cool, temperature: 18 }, "diminua para 17", "set_temperature", 17],
  ["frio", { ...cool, temperature: 27 }, "desligue", "off", undefined],
  ["frio", { ...cool, temperature: 26.5, step: 0.5 }, "aumente para 27", "set_temperature", 27],
] as const)(
  "offers a bounded action for %s and %j",
  async (feeling, state, wording, action, temperature) => {
    const f = await fixture();
    try {
      f.states.set(ac.id, { ...state });
      expect((await f.say(`tô com ${feeling}`)).text).toContain(wording);
      expect(f.send).not.toHaveBeenCalled();
      await f.say("sim");
      expect(f.send.mock.calls[0][1]).toBe(action);
      expect(f.send.mock.calls[0][2]).toBe(temperature);
    } finally {
      await f.close();
    }
  },
);

it("uses a room fan when the AC cannot cool further, and turns an active fan off for cold", async () => {
  const f = await fixture([ac, fan]);
  try {
    f.states.set(ac.id, { ...cool, temperature: 17 });
    f.states.set(fan.id, { mode: "off" });
    expect((await f.say("tô com calor")).text).toMatch(/Ventilador.*ligue/);
    await f.say("sim");
    expect(f.send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: fan.id }), "on");
    f.send.mockClear();
    f.states.set(ac.id, { ...cool, mode: "off" });
    f.states.set(fan.id, { mode: "on" });
    expect((await f.say("tô com frio")).text).toMatch(/Ventilador.*desligue/);
    await f.say("sim");
    expect(f.send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: fan.id }), "off");
  } finally {
    await f.close();
  }
});

it("does not guess unavailable state or turn on an AC that may restore heating", async () => {
  const f = await fixture();
  try {
    f.states.set(ac.id, { ...cool, mode: "unavailable" });
    expect((await f.say("tô com calor")).text).toContain("Não consegui consultar");
    await f.say("sim");
    f.states.set(ac.id, { ...cool, mode: "off", modes: ["cool", "heat", "off"] });
    expect((await f.say("tô com calor")).text).toContain("Não encontrei um ajuste");
    await f.say("sim");
    expect(f.send).not.toHaveBeenCalled();
  } finally {
    await f.close();
  }
});

it("explains the AC minimum instead of inventing a lower target when no fan is registered", async () => {
  const f = await fixture();
  try {
    f.states.set(ac.id, { ...cool, temperature: 17 });
    expect((await f.say("tô com calor")).text).toContain("temperatura mínima de 17 graus");
    await f.say("sim");
    expect(f.send).not.toHaveBeenCalled();
  } finally {
    await f.close();
  }
});

it("reads MQTT fan on/off state with a short freshness limit and refuses unknown payloads", async () => {
  const f = await fixture([]);
  try {
    const device = schemas.devices.parse({
      ...fan,
      connection: "mqtt",
      haEntityId: null,
      commandTopic: "fan/set",
      stateTopic: "fan/state",
      actions: { on: "ON", off: "OFF" },
    });
    const read = vi.spyOn(f.automation.addons.mqtt, "value").mockReturnValue("ON");
    expect(f.automation.comfortState(device)).toEqual({ mode: "on" });
    expect(read).toHaveBeenCalledWith(device, 120);
    read.mockReturnValue("unknown");
    expect(() => f.automation.comfortState(device)).toThrow(/Não consegui identificar/);
  } finally {
    await f.close();
  }
});
