import { emptyCatalog, settingsSchema } from "@rosie/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HomeAssistantAddon } from "../src/server/addons/home-assistant";
import { CompanionConversation } from "../src/server/conversation/companion";

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
afterEach(() => vi.unstubAllGlobals());
describe("itinerant companion", () => {
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
