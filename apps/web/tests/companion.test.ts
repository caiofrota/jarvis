import {
  companionProfileSchema,
  emptyCatalog,
  personalProfileSchema,
  schemas,
  settingsSchema,
} from "@rosie/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HomeAssistantAddon } from "../src/server/addons/home-assistant";
import { CompanionConversation } from "../src/server/conversation/companion";
import { assistantIdentity } from "../src/server/conversation/identity";
import { catalogFixture } from "./fixture";

function fixture() {
  const settings = settingsSchema.parse({
    homeAssistantEnabled: true,
    homeAssistantHomeId: "home",
    openaiKey: "fixture-key",
  });
  const areas = [
    { id: "lab", name: "Laboratório Aurora", homeId: "home" },
    { id: "garden", name: "Jardim", homeId: "home" },
  ];
  const entities = [
    {
      id: "switch.relay",
      name: "Luz Aurora",
      kind: "switch",
      areaId: "lab",
      areaName: areas[0].name,
      aliases: ["Luminária Boreal"],
      available: true,
      state: "on",
    },
  ];
  const ha = {
    status: () => ({ ready: true }),
    areas: vi.fn(async () => areas),
    discover: vi.fn(async () => entities),
    exposed: vi.fn(async () => new Set(entities.map((e) => e.id))),
    execute: vi.fn(async () => {}),
  };
  const repo = { settings: async () => settings, catalog: async () => emptyCatalog() };
  const companion = new CompanionConversation(repo, ha as unknown as HomeAssistantAddon);
  const sessionId = companion.create("owner");
  return {
    companion,
    ha,
    settings,
    entities,
    input: { sessionId, assistantId: null, areaId: null },
    send: (text: string) =>
      companion.respond(
        "owner",
        { sessionId, assistantId: null, areaId: null, text },
        AbortSignal.timeout(5000),
      ),
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function proposingProvider(entityId = "switch.relay", action = "off") {
  const provider = vi.fn<typeof fetch>(
    async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "proposal-call",
                    type: "function",
                    function: {
                      name: "propose_home_action",
                      arguments: JSON.stringify({ entityId, action }),
                    },
                  },
                ],
              },
            },
          ],
        }),
      ),
  );
  vi.stubGlobal("fetch", provider);
  return provider;
}
describe("itinerant companion", () => {
  it("uses a registered model proposal for natural requests without executing the offer", async () => {
    const f = fixture(),
      provider = proposingProvider();
    expect((await f.send("Pode ajudar com a iluminação?")).text).toContain(
      "Deseja desligar Luz Aurora",
    );
    const payload = JSON.parse(String(provider.mock.calls[0][1]?.body));
    expect(
      payload.tools.map((tool: { function: { name: string } }) => tool.function.name),
    ).toContain("propose_home_action");
    expect(f.ha.execute).not.toHaveBeenCalled();
    await f.send("Sim");
    expect(f.ha.execute).toHaveBeenCalledTimes(1);
    expect(provider).toHaveBeenCalledTimes(1);
  });
  it("keeps ordinary conversation available when HA discovery fails", async () => {
    const f = fixture();
    f.ha.discover.mockRejectedValue(new Error("HA unavailable"));
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ choices: [{ message: { role: "assistant", content: "Olá!" } }] }),
          ),
      ),
    );
    expect((await f.send("Boa tarde")).text).toBe("Olá!");
    expect(f.ha.execute).not.toHaveBeenCalled();
  });
  it.each([
    ["Luz do Escritório", "light.office", "light", "on", "off", "Sim."],
    ["Extrator Nebulosa", "fan.nebula", "fan", "off", "on", "Pode sim!"],
    ["Bomba Boreal", "switch.pump", "switch", "on", "off", "Confirmo"],
  ])(
    "records the offered action for %s and executes only after confirmation",
    async (name, id, kind, state, action, confirmation) => {
      const f = fixture();
      Object.assign(f.entities[0], { name, id, kind, state });
      const provider = proposingProvider(id, action);
      const reply = await f.send(`${name}.`);
      expect(reply.text).toContain(`Deseja ${action === "on" ? "ligar" : "desligar"} ${name}`);
      expect(f.ha.execute).not.toHaveBeenCalled();
      expect(await f.send(confirmation)).toMatchObject({
        text: expect.stringContaining(`Comando enviado para ${name}`),
      });
      expect(f.ha.execute).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ haEntityId: id }),
        action,
        undefined,
        true,
        expect.any(AbortSignal),
      );
      expect(provider).not.toHaveBeenCalled();
      provider.mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ message: { role: "assistant", content: "Não há ação pendente." } }],
          }),
        ),
      );
      await f.send("Sim");
      expect(f.ha.execute).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["Não.", "Cancelar", "Qual a previsão do tempo?"])(
    "invalidates the offered action after %s",
    async (answer) => {
      const f = fixture(),
        provider = proposingProvider();
      await f.send("Luz Aurora");
      provider.mockImplementation(
        async (_url, init) =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    role: "assistant",
                    content: JSON.parse(String(init?.body)).response_format
                      ? JSON.stringify({ decision: "new_request" })
                      : "Tudo bem.",
                  },
                },
              ],
            }),
          ),
      );
      await f.send(answer);
      await f.send("Sim");
      expect(f.ha.execute).not.toHaveBeenCalled();
    },
  );
  it.each([
    ["Sim, Jáus, por favor.", "confirm"],
    ["Desejo.", "confirm"],
    ["Isso, Aster, faça o que sugeriu.", "confirm"],
    ["Não precisa mais, obrigado.", "cancel"],
    ["Se eu confirmar você desliga?", "unclear"],
    ["desvelhe", "unclear"],
    ["Na verdade quero a bomba do jardim", "new_request"],
  ])("interprets a pending response semantically: %s", async (reply, decision) => {
    const f = fixture();
    await f.send("Luz Aurora");
    const provider = vi.fn<typeof fetch>(async (_url, init) => {
      const payload = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                content: payload.response_format ? JSON.stringify({ decision }) : "Outro pedido.",
              },
            },
          ],
        }),
      );
    });
    vi.stubGlobal("fetch", provider);
    const response = await f.send(reply);
    expect(f.ha.execute).toHaveBeenCalledTimes(decision === "confirm" ? 1 : 0);
    const data = JSON.parse(
      JSON.parse(String(provider.mock.calls[0][1]?.body)).messages[1].content,
    );
    expect(data.proposal).toEqual({ entityId: "switch.relay", action: "off" });
    expect(data.reply).toBe(reply);
    if (decision === "unclear") {
      expect(response.text).toContain("Não entendi");
      await f.send("Sim");
      expect(f.ha.execute).toHaveBeenCalledTimes(1);
    }
  });
  it("bounds speech context to authoritative exposed names without transcript replacements", async () => {
    const f = fixture();
    f.settings.companionProfile.name = "Aster";
    expect(await f.companion.transcriptionContext("owner", f.input)).toBe(
      "Aster, Luz Aurora, Laboratório Aurora, Luminária Boreal",
    );
    f.ha.exposed.mockResolvedValue(new Set());
    expect(await f.companion.transcriptionContext("owner", f.input)).toBe("Aster");
  });
  it.each(["expired", "hidden", "unavailable", "renamed", "moved", "reconfigured"])(
    "rejects %s proposals at confirmation time",
    async (reason) => {
      const f = fixture();
      proposingProvider();
      await f.send("Luz Aurora");
      if (reason === "expired") vi.spyOn(Date, "now").mockReturnValue(Date.now() + 3 * 60000);
      if (reason === "hidden") f.ha.exposed.mockResolvedValue(new Set());
      if (reason === "unavailable") f.entities[0].available = false;
      if (reason === "renamed") f.entities[0].name = "Changed device";
      if (reason === "moved") f.entities[0].areaId = "garden";
      if (reason === "reconfigured") f.settings.homeAssistantUrl = "https://another-ha.test";
      expect((await f.send("Sim")).text).not.toContain("Comando enviado");
      expect(f.ha.execute).not.toHaveBeenCalled();
    },
  );
  it("does not execute an offer from another session or after an area selection change", async () => {
    const f = fixture(),
      provider = proposingProvider();
    await f.send("Luz Aurora");
    expect(() => f.companion.session("another", f.input.sessionId)).toThrow();
    provider.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { role: "assistant", content: "Não há ação pendente." } }],
          }),
        ),
    );
    const other = f.companion.create("owner");
    await f.companion.respond(
      "owner",
      { ...f.input, sessionId: other, text: "Sim" },
      AbortSignal.timeout(5000),
    );
    await f.companion.respond(
      "owner",
      { ...f.input, areaId: "garden", text: "Sim" },
      AbortSignal.timeout(5000),
    );
    expect(f.ha.execute).not.toHaveBeenCalled();
  });
  it("consumes proposals on uncertain dispatch without automatically retrying", async () => {
    const f = fixture(),
      provider = proposingProvider();
    await f.send("Luz Aurora");
    f.ha.execute.mockRejectedValueOnce(new Error("timeout"));
    await expect(f.send("Sim")).rejects.toThrow("não vou repetir automaticamente");
    provider.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { role: "assistant", content: "Não há ação pendente." } }],
          }),
        ),
    );
    await f.send("Sim");
    expect(f.ha.execute).toHaveBeenCalledTimes(1);
  });
  it("rejects guessed, hidden or unsupported targets and combined proposal calls", async () => {
    const f = fixture();
    proposingProvider("light.missing");
    await expect(f.send("Pode ajudar com iluminação?")).rejects.toThrow("não oferece");
    proposingProvider();
    f.ha.exposed.mockResolvedValue(new Set());
    await expect(f.send("Pode ajudar com iluminação?")).rejects.toThrow("não oferece");
    f.ha.exposed.mockResolvedValue(new Set(["switch.relay"]));
    proposingProvider("switch.relay", "set_temperature");
    await expect(f.send("Pode ajudar com iluminação?")).rejects.toThrow();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    role: "assistant",
                    content: null,
                    tool_calls: ["one", "two"].map((id) => ({
                      id,
                      type: "function",
                      function: {
                        name: "propose_home_action",
                        arguments: JSON.stringify({ entityId: "switch.relay", action: "off" }),
                      },
                    })),
                  },
                },
              ],
            }),
          ),
      ),
    );
    await expect(f.send("Pode ajudar com iluminação?")).rejects.toThrow("uma ação por vez");
    expect(f.ha.execute).not.toHaveBeenCalled();
  });
  it("converses with an empty catalog and default profile", async () => {
    const f = fixture();
    const provider = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({ choices: [{ message: { role: "assistant", content: "Olá!" } }] }),
        ),
    );
    vi.stubGlobal("fetch", provider);
    expect(await f.send("Boa tarde")).toMatchObject({ text: "Olá!", voice: "kokoro-pf_dora" });
    const payload = JSON.parse(String(provider.mock.calls[0][1]?.body));
    expect(payload.messages[0].content).toContain("cliente itinerante");
    expect(f.ha.execute).not.toHaveBeenCalled();
  });
  it("resolves HA area and named relay without local homes or rooms", async () => {
    const f = fixture();
    expect(await f.send("Desligar a luz do Laboratório Aurora")).toMatchObject({
      text: expect.stringContaining("Comando enviado"),
    });
    expect(f.ha.execute).toHaveBeenCalledWith(
      expect.objectContaining({ haEntityId: "switch.relay" }),
      "off",
      undefined,
      true,
      expect.any(AbortSignal),
    );
  });
  it("grounds consultations only in current Assist-exposed HA metadata", async () => {
    const f = fixture();
    f.entities.push({ ...f.entities[0], id: "switch.hidden", name: "Hidden appliance" });
    f.ha.exposed.mockResolvedValue(new Set(["switch.relay"]));
    const provider = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              { message: { role: "assistant", content: "O HA informa Luz Aurora ligada." } },
            ],
          }),
        ),
    );
    vi.stubGlobal("fetch", provider);
    await f.send("Quais dispositivos estão disponíveis?");
    const payload = JSON.parse(String(provider.mock.calls[0][1]?.body));
    expect(payload.messages[1].content).toContain("Luz Aurora");
    expect(payload.messages[1].content).not.toContain("Hidden appliance");
    expect(f.ha.execute).not.toHaveBeenCalled();
  });
  it("asks for location and accepts an authoritative area as follow-up", async () => {
    const f = fixture();
    expect(await f.send("apague a luz")).toMatchObject({
      text: expect.stringContaining("qual ambiente"),
    });
    expect(f.ha.execute).not.toHaveBeenCalled();
    await f.send("Laboratório Aurora");
    expect(f.ha.execute).toHaveBeenCalledTimes(1);
  });
  it("allows explicit unique names without a location", async () => {
    const f = fixture();
    await f.send("ligue Luminária Boreal");
    expect(f.ha.execute).toHaveBeenCalledTimes(1);
  });
  it("uses optional current area only when supplied", async () => {
    const f = fixture();
    await f.companion.respond(
      "owner",
      { ...f.input, areaId: "lab", text: "ligue a luz" },
      AbortSignal.timeout(5000),
    );
    expect(f.ha.execute).toHaveBeenCalledTimes(1);
  });
  it("does not confuse arbitrary switches with lights", async () => {
    const f = fixture();
    f.entities[0].name = "Bomba Boreal";
    f.entities[0].aliases = [];
    expect(await f.send("ligue a luz do Laboratório Aurora")).toMatchObject({
      text: expect.stringContaining("Não encontrei"),
    });
    expect(f.ha.execute).not.toHaveBeenCalled();
  });
  it("asks when more than one exposed light matches", async () => {
    const f = fixture();
    f.entities.push({ ...f.entities[0], id: "light.boreal", name: "Luz Boreal", kind: "light" });
    expect(await f.send("ligue a luz do Laboratório Aurora")).toMatchObject({
      text: expect.stringContaining("Qual dispositivo"),
    });
    expect(f.ha.execute).not.toHaveBeenCalled();
    await f.send("Luz Boreal");
    expect(f.ha.execute).toHaveBeenCalledWith(
      expect.objectContaining({ haEntityId: "light.boreal" }),
      "on",
      undefined,
      true,
      expect.any(AbortSignal),
    );
  });
  it("fails closed for discovery errors and hidden entities", async () => {
    const f = fixture();
    f.ha.exposed.mockResolvedValue(new Set());
    await f.send("ligue Luminária Boreal");
    expect(f.ha.execute).not.toHaveBeenCalled();
    f.ha.discover.mockRejectedValue(new Error("discovery unavailable"));
    await expect(f.send("ligue Luminária Boreal")).rejects.toThrow();
    expect(f.ha.execute).not.toHaveBeenCalled();
  });
  it("rejects another user's session and expired sessions", async () => {
    const f = fixture();
    expect(() => f.companion.session("another", f.input.sessionId)).toThrow("expirou");
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31 * 60000);
    try {
      expect(() => f.companion.session("owner", f.input.sessionId)).toThrow("expirou");
    } finally {
      clock.mockRestore();
    }
  });
  it("clears pending location when selection changes", async () => {
    const f = fixture();
    await f.send("ligue a luz");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ choices: [{ message: { role: "assistant", content: "Olá" } }] }),
          ),
      ),
    );
    await f.companion.respond(
      "owner",
      { ...f.input, areaId: "garden", text: "Laboratório Aurora" },
      AbortSignal.timeout(5000),
    );
    expect(f.ha.execute).not.toHaveBeenCalled();
  });
});

it("preserves a shared persona and its household context without assigning a room or resident", async () => {
  const f = fixture(),
    catalog = catalogFixture();
  catalog.assistants[0].worldview = "Perspectiva solidária de esquerda.";
  catalog.assistants[0].facts = "A personagem cuida de um observatório.";
  catalog.homes[0].facts = "A casa tem uma biblioteca.";
  catalog.residents.push(
    schemas.residents.parse({
      id: "unknown-resident",
      name: "Unselected person",
      homeId: "home",
      facts: "Unselected resident context",
    }),
  );
  const provider = vi.fn<typeof fetch>(
    async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "Resposta da personagem" } }],
        }),
      ),
  );
  vi.stubGlobal("fetch", provider);
  const conversation = new CompanionConversation(
    { settings: async () => f.settings, catalog: async () => catalog },
    f.ha as never,
  );
  const sessionId = conversation.create("owner");
  await conversation.respond(
    "owner",
    { sessionId, assistantId: "rosie", areaId: null, text: "Você é de esquerda ou de direita?" },
    AbortSignal.timeout(5000),
  );
  const payload = JSON.parse(String(provider.mock.calls[0][1]?.body));
  expect(payload.messages[0].content).toContain(assistantIdentity(catalog.assistants[0]));
  expect(payload.messages[0].content).toContain("A casa tem uma biblioteca.");
  expect(payload.messages[0].content).toContain("não informa a localização atual");
  expect(payload.messages[0].content).not.toContain("Unselected resident context");
  expect(f.ha.execute).not.toHaveBeenCalled();
});
it("keeps private persona context and resets history when configured values change", async () => {
  const f = fixture();
  const personal = personalProfileSchema.parse({
    assistants: [
      {
        ...companionProfileSchema.parse({
          name: "Atlas",
          worldview: "Valoriza a curiosidade.",
          facts: "Cuida de um jardim.",
        }),
        id: "00000000-0000-4000-8000-000000000001",
      },
    ],
    defaultAssistantId: "00000000-0000-4000-8000-000000000001",
  });
  const provider = vi.fn<typeof fetch>(
    async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { role: "assistant", content: "Resposta" } }] }),
      ),
  );
  vi.stubGlobal("fetch", provider);
  const conversation = new CompanionConversation(
    { settings: async () => f.settings, catalog: async () => emptyCatalog() },
    f.ha as never,
    { get: async () => ({ profile: personal, revision: null }) },
  );
  const sessionId = conversation.create("owner"),
    input = { sessionId, assistantId: null, areaId: null };
  await conversation.respond(
    "owner",
    { ...input, text: "Quais são seus valores?" },
    AbortSignal.timeout(5000),
  );
  await conversation.respond(
    "owner",
    { ...input, text: "E seu jardim?" },
    AbortSignal.timeout(5000),
  );
  const second = JSON.parse(String(provider.mock.calls[1][1]?.body));
  expect(second.messages[0].content).toContain("Valoriza a curiosidade.");
  expect(second.messages[0].content).toContain("Cuida de um jardim.");
  expect(second.messages.filter((value: { role: string }) => value.role === "user")).toHaveLength(
    2,
  );
  personal.assistants[0].worldview = "Valoriza a sustentabilidade.";
  await conversation.respond(
    "owner",
    { ...input, text: "O que mudou?" },
    AbortSignal.timeout(5000),
  );
  const third = JSON.parse(String(provider.mock.calls[2][1]?.body));
  expect(third.messages[0].content).toContain("Valoriza a sustentabilidade.");
  expect(third.messages.filter((value: { role: string }) => value.role === "user")).toHaveLength(1);
});
