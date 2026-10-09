import { json } from "@rosie/db";
import {
  numericReading,
  responseRuleSchema,
  schemas,
  selectResponseRule,
  settingsSchema,
} from "@rosie/types";
import { context, validateReferences } from "@rosie/types/context";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WeatherAddon } from "../src/server/addons/weather";
import type { Automations } from "../src/server/automation/service";
import { prepareIntent } from "../src/server/conversation/response-rules";
import { Conversation } from "../src/server/conversation/service";
import { Readings } from "../src/server/readings/service";
import { WeatherSource } from "../src/server/readings/weather";
import { catalogFixture, repositoryFixture } from "./fixture";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const rule = (values: object) => responseRuleSchema.parse({ name: "rule", ...values });
const abort = () => AbortSignal.timeout(10000);
const weatherReply = (temperature = 31) =>
  new Response(
    JSON.stringify({
      current: {
        temperature_2m: temperature,
        weather_code: 2,
        time: Math.floor(Date.now() / 1000),
      },
    }),
  );
const location = { name: "Fortaleza, Ceará, Brasil", latitude: -3.72, longitude: -38.54 };

describe("conditional response contracts", () => {
  it("validates ranges, sources, markers and household references", () => {
    const c = catalogFixture(),
      base = c.intents[0];
    expect(schemas.intents.parse(base).responseRules).toEqual([]);
    for (const value of [
      { minValue: 20, maxValue: 20 },
      { startTime: "22:00" },
      { startTime: "08:00", endTime: "08:00" },
      {},
    ])
      expect(responseRuleSchema.safeParse({ name: "test", ...value }).success).toBe(false);
    expect(() =>
      schemas.intents.parse({
        ...base,
        responseRules: [rule({ minValue: 20, responses: ["Quente"] })],
      }),
    ).toThrow();
    const numeric = schemas.intents.parse({
      ...base,
      dataSource: "weather",
      responseRules: [rule({ minValue: 20, responses: ["{valor}, {condicao}"] })],
    });
    expect(() =>
      schemas.intents.parse({
        ...numeric,
        responseRules: [{ ...numeric.responseRules[0], responses: ["{unregistered}"] }],
      }),
    ).toThrow();
    expect(() =>
      schemas.intents.parse({
        ...numeric,
        responseRules: [{ ...numeric.responseRules[0], responses: [] }],
      }),
    ).toThrow();
    c.homes.push(schemas.homes.parse({ id: "elsewhere", name: "Other" }));
    c.residents.push(
      schemas.residents.parse({ id: "foreign", name: "Foreign", homeId: "elsewhere" }),
    );
    c.intents[0] = schemas.intents.parse({
      ...base,
      responseRules: [rule({ residentIds: ["foreign"], responses: ["Hello"] })],
    });
    expect(() => validateReferences(c)).toThrow(/outra casa/);
  });
  it("uses inclusive lower/exclusive upper ranges and never coerces missing or arbitrary readings into zero", () => {
    const rules = [
      rule({ name: "cold", maxValue: 20 }),
      rule({ name: "mild", minValue: 20, maxValue: 30 }),
      rule({ name: "hot", minValue: 30 }),
    ];
    const choose = (value?: string) => selectResponseRule(rules, { timezone: "UTC", value })?.name;
    expect(choose("19,9")).toBe("cold");
    expect(choose("20")).toBe("mild");
    expect(choose("30")).toBe("hot");
    for (const value of [undefined, "", "unavailable", "0x20", "false", "30 °F", "NaN"]) {
      expect(choose(value)).toBeUndefined();
      expect(numericReading(value)).toBeUndefined();
    }
  });
  it("combines time, resident and mode using the home timezone and ordered priority", () => {
    const rules = [
      rule({
        name: "personal night",
        startTime: "22:00",
        endTime: "06:00",
        residentIds: ["resident"],
        modeIds: ["quiet"],
      }),
      rule({ name: "all night", startTime: "22:00", endTime: "06:00" }),
    ];
    const ctx = { timezone: "America/Fortaleza", residentId: "resident", modeId: "quiet" };
    expect(selectResponseRule(rules, ctx, new Date("2026-09-23T01:00:00Z"))?.name).toBe(
      "personal night",
    );
    expect(
      selectResponseRule(rules, { ...ctx, residentId: undefined }, new Date("2026-09-23T01:00:00Z"))
        ?.name,
    ).toBe("all night");
    expect(selectResponseRule(rules, ctx, new Date("2026-09-23T09:00:00Z"))).toBeUndefined();
    expect(selectResponseRule(rules, ctx, new Date("2026-09-23T00:59:00Z"))).toBeUndefined();
  });
  it("blocks numeric rules when a registered reading is invalid instead of using a misleading fallback", async () => {
    const c = catalogFixture(),
      ctx = context(c, "one");
    const intent = schemas.intents.parse({
      ...c.intents[0],
      deviceId: "sensor",
      responseRules: [rule({ minValue: 20, responses: ["Hot"] })],
    });
    const prepared = await prepareIntent(
      intent,
      c,
      ctx,
      new Readings({ value: () => "unavailable" } as unknown as Automations),
      abort(),
    );
    expect(prepared.error).toContain("numérico");
  });
});

describe("weather addon", () => {
  it("deduplicates current requests, caches results and rejects expired upstream data", async () => {
    let now = 1_800_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const fetch = vi.fn(async () => weatherReply());
    vi.stubGlobal("fetch", fetch);
    const source = new WeatherSource();
    const results = await Promise.all([source.read(location), source.read(location)]);
    expect(results[0]).toEqual(results[1]);
    expect(fetch).toHaveBeenCalledTimes(1);
    await source.read(location);
    expect(fetch).toHaveBeenCalledTimes(1);
    now += 11 * 60000;
    fetch.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            current: { temperature_2m: 30, weather_code: 0, time: (now - 100 * 60000) / 1000 },
          }),
        ),
    );
    await expect(source.read(location)).rejects.toThrow(/atualizado/);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("can be disabled independently and never starts a request without a selected city", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const addon = new WeatherAddon();
    await addon.configure(settingsSchema.parse({ weatherEnabled: false }));
    await expect(addon.read(location)).rejects.toThrow(/desativado/);
    await addon.configure(settingsSchema.parse({ weatherEnabled: true }));
    await expect(addon.read(null)).rejects.toThrow(/cidade/);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("contextual conversation", () => {
  it("selects local response sets without an LLM and supplies only the matched style to generation", async () => {
    const f = await repositoryFixture();
    try {
      const base = (await f.repo.catalog()).intents[0];
      const assistant = (await f.repo.catalog()).assistants[0];
      await f.repo.db.entry.update({
        where: { collection_id: { collection: "assistants", id: assistant.id } },
        data: {
          data: json({ ...assistant, worldview: "Perspectiva marxista em temas políticos." }),
        },
      });

      const intent = schemas.intents.parse({
        ...base,
        deviceId: "sensor",
        responseRules: [
          rule({ name: "cold", maxValue: 20, responses: ["Frio: {valor}."] }),
          rule({ name: "hot", minValue: 30, responses: ["Calor: {valor}."] }),
        ],
      });
      await f.repo.db.entry.update({
        where: { collection_id: { collection: "intents", id: base.id } },
        data: { data: json(intent) },
      });
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      let value = "31";
      const conversation = new Conversation(f.repo, {
        value: () => value,
      } as unknown as Automations);
      expect((await conversation.respond("one", "bom dia", abort())).text).toBe("Calor: 31.");
      value = "19";
      expect((await conversation.respond("one", "bom dia", abort())).text).toBe("Frio: 19.");
      expect(fetch).not.toHaveBeenCalled();
      await f.repo.db.setting.update({
        where: { id: "settings" },
        data: { data: { openaiKey: "fixture" } },
      });
      await f.repo.db.entry.update({
        where: { collection_id: { collection: "intents", id: base.id } },
        data: {
          data: json({
            ...intent,
            responseMode: "generated",
            instructions: "Descreva a temperatura.",
          }),
        },
      });
      fetch.mockImplementation(async (_url, init) => {
        const body = JSON.parse(init.body);
        expect(body.messages[0].content).toContain("Frio: {valor}");
        expect(body.messages[0].content).toContain("Perspectiva marxista em temas políticos.");
        expect(body.messages[0].content).not.toContain("Calor: {valor}");
        expect(body.messages[0].content).toContain("19");
        return new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: "stop",
                message: {
                  content: JSON.stringify({
                    text: "Está fresco.",
                    expression: "neutral",
                    serious: false,
                    intent: { id: base.id, parameters: [] },
                  }),
                },
              },
            ],
          }),
        );
      });
      expect((await conversation.respond("one", "bom dia", abort())).text).toBe("Está fresco.");
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      await f.close();
    }
  });
  it("keeps serious semantic replies instead of replacing them with a playful template", async () => {
    const f = await repositoryFixture();
    try {
      const base = (await f.repo.catalog()).intents[0];
      await f.repo.db.entry.update({
        where: { collection_id: { collection: "intents", id: base.id } },
        data: {
          data: json({
            ...base,
            matchMode: "semantic",
            description: "Conversa sobre como está o dia.",
            responses: ["Piada do dia!"],
          }),
        },
      });
      await f.repo.db.setting.update({
        where: { id: "settings" },
        data: { data: { openaiKey: "fixture" } },
      });
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url, init) => {
          expect(JSON.parse(init.body).messages[0].content).toContain(
            "prioridade sobre personagem",
          );
          return new Response(
            JSON.stringify({
              choices: [
                {
                  finish_reason: "stop",
                  message: {
                    content: JSON.stringify({
                      text: "Sinto muito. Estou aqui para ouvir.",
                      expression: "happy",
                      serious: true,
                      intent: { id: base.id, parameters: [] },
                    }),
                  },
                },
              ],
            }),
          );
        }),
      );
      const conversation = new Conversation(f.repo, {} as Automations);
      expect(
        await conversation.respond("one", "Meu dia foi péssimo, fale sério", abort()),
      ).toMatchObject({ text: "Sinto muito. Estou aqui para ouvir.", expression: "neutral" });
    } finally {
      await f.close();
    }
  });
});
