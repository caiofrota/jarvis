import { json } from "@rosie/db";
import { schemas, settingsSchema } from "@rosie/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatSearchAnswer, searchAnswerInstructions } from "../src/server/addons/search-answer";
import { cacheKey } from "../src/server/addons/search-cache";
import { Automations } from "../src/server/automation/service";
import { Conversation } from "../src/server/conversation/service";
import {
  asksCurrentHomeWeather,
  searchPresentation,
} from "../src/server/conversation/weather-request";
import { VoiceClient } from "../src/server/voice/client";
import { spokenText } from "../src/server/voice/text";
import { repositoryFixture } from "./fixture";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("weather speech and scope", () => {
  it("recognizes current home weather without taking over other cities, forecasts or unrelated questions", () => {
    for (const text of [
      "Qual o clima lá fora?",
      "Como está o tempo?",
      "Qual é a temperatura agora?",
      "Como está o clima em Fortaleza?",
    ])
      expect(asksCurrentHomeWeather(text, "Fortaleza, Ceará, Brasil"), text).toBe(true);
    for (const text of [
      "Como está o clima amanhã?",
      "Como está o clima em Recife?",
      "Como está o clima político?",
      "Qual o clima lá fora e liga a luz?",
    ])
      expect(asksCurrentHomeWeather(text, "Fortaleza, Ceará, Brasil"), text).toBe(false);
    expect(searchPresentation("Qual o clima lá fora?", "Previsão semanal Fortaleza")).toMatchObject(
      { weather: true, period: "now", fahrenheit: false },
    );
    expect(searchPresentation("Previsão do tempo em 30/09")).toMatchObject({ period: "requested" });
    expect(searchPresentation("Clima amanhã em Fahrenheit")).toMatchObject({
      period: "requested",
      fahrenheit: true,
    });
    const question = "Como fica a previsão meteorológica para amanhã cedo em Fortaleza?";
    const morning = searchPresentation(question, "Fortaleza amanhã");
    expect(asksCurrentHomeWeather(question, "Fortaleza")).toBe(false);
    expect(morning).toMatchObject({ weather: true, period: "requested", dayparts: ["morning"] });
    expect(searchAnswerInstructions(morning)).toContain("pediu especificamente manhã");
    expect(searchAnswerInstructions(morning)).toContain("se só encontrar dados diários, avise");
  });
  it("removes unsolicited weekly reports and speaks a single Celsius temperature naturally", () => {
    const profile = searchPresentation("Qual o clima lá fora?");
    const raw =
      "Em Fortaleza, **nuvens espaçadas**, 86°F (30°C). citesource0 Previsão diária: Sexta: 87°F. Sábado: 90°F. Domingo: 88°F.";
    expect(formatSearchAnswer(raw, profile)).toBe(
      "Em Fortaleza, algumas nuvens, 30 graus Celsius.",
    );
    expect(formatSearchAnswer("Agora são 30°C (86°F).", profile)).toBe(
      "Agora são 30 graus Celsius.",
    );
    expect(formatSearchAnswer("Agora são 86°F.", profile)).toBe("Agora são 30 graus Celsius.");
    expect(formatSearchAnswer("Agora são 14℉.", profile)).toBe("Agora são menos 10 graus Celsius.");
  });
  it("preserves an explicitly requested unit and separates it from the default cached answer", () => {
    const c = searchPresentation("Qual o clima lá fora?"),
      f = searchPresentation("Qual o clima lá fora em Fahrenheit?");
    expect(formatSearchAnswer("Agora são 30°C (86°F).", f)).toBe("Agora são 86 graus Fahrenheit.");
    const ctx = {
      endpointId: "one",
      homeId: "home",
      city: "Fortaleza",
      timezone: "America/Fortaleza",
    };
    expect(cacheKey("Clima Fortaleza", { ...ctx, presentation: c })).not.toBe(
      cacheKey("Clima Fortaleza", { ...ctx, presentation: f }),
    );
    expect(cacheKey("Clima Fortaleza", { ...ctx, presentation: c })).not.toBe(
      cacheKey("Clima Fortaleza", { ...ctx, presentation: { ...c, period: "requested" } }),
    );
    expect(cacheKey("Clima Fortaleza amanhã", { ...ctx, presentation: c })).not.toBe(
      cacheKey("Clima Fortaleza amanhã", {
        ...ctx,
        presentation: { ...c, dayparts: ["morning"] },
      }),
    );
  });
  it("bounds full sentences without clipping a word or decimal and allows requested details", () => {
    const text =
      "A temperatura é 29.5°C. Há algumas nuvens. A chance de chuva é 20%. O vento está fraco. Amanhã pode chover.";
    const brief = formatSearchAnswer(text, searchPresentation("Clima hoje"));
    expect(brief).toBe(
      "A temperatura é 29,5 graus Celsius. Há algumas nuvens. A chance de chuva é 20 por cento.",
    );
    const detailed = formatSearchAnswer(text, searchPresentation("Detalhe o clima hoje e amanhã"));
    expect(detailed).toContain("Amanhã pode chover.");
    const oversized = formatSearchAnswer(
      `${"palavra ".repeat(300)}.`,
      searchPresentation("Clima hoje"),
    );
    expect(oversized).not.toContain("palavra");
    expect(oversized.length).toBeLessThan(180);
  });
  it("cleans the exact payload submitted to the local voice worker", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(new Uint8Array([0, 0])));
    vi.stubGlobal("fetch", fetcher);
    await new VoiceClient("http://localhost:9999", "fixture-private").synthesize(
      "**Agora:** 29.5°C ☀️. Chuva: 20%. [Fonte](https://example.org).",
      "test",
      "fast",
    );
    expect(JSON.parse(fetcher.mock.calls[0][1].body).text).toBe(
      "Agora: 29,5 graus Celsius. Chuva: 20 por cento. Fonte.",
    );
    expect(spokenText("- **Olá**\n- Tudo bem? citesource0")).toBe("Olá Tudo bem?");
    expect(spokenText("São 10h35. O voo sai às 08:05 e chega às 10h00.")).toBe(
      "São 10 e 35. O voo sai às 8 e 5 e chega às 10 horas.",
    );
    expect(spokenText("1h00, 25h70, 10:35:42, R$ 10,35")).toBe(
      "1 hora, 25h70, 10:35:42, dez reais e trinta e cinco centavos",
    );
  });
  it("uses the available current reading for the reported question without a paid search", async () => {
    const f = await repositoryFixture();
    try {
      const catalog = await f.repo.catalog();
      await f.repo.db.setting.update({
        where: { id: "settings" },
        data: {
          data: json(settingsSchema.parse({ openaiKey: "fixture", webSearchEnabled: true })),
        },
      });
      await f.repo.db.entry.update({
        where: { collection_id: { collection: "homes", id: "home" } },
        data: {
          data: json({
            ...catalog.homes[0],
            weatherLocation: { name: "Fortaleza", latitude: -3.71722, longitude: -38.54306 },
          }),
        },
      });
      const intent = schemas.intents.parse({
        ...catalog.intents[0],
        id: "weather",
        name: "Clima",
        matchMode: "semantic",
        responseMode: "generated",
        dataSource: "weather",
        topicTerms: ["clima"],
        description: "Condições atuais da cidade",
        instructions: "Use a leitura atual, em uma frase curta e graus Celsius.",
      });
      await f.repo.db.entry.create({
        data: { collection: "intents", id: intent.id, name: intent.name, data: json(intent) },
      });
      const fetcher = vi.fn().mockImplementation(async (url, init) => {
        if (String(url).startsWith("https://api.open-meteo.com/"))
          return new Response(
            JSON.stringify({
              current: {
                time: Math.floor(Date.now() / 1000),
                temperature_2m: 29.6,
                weather_code: 2,
              },
            }),
          );
        expect(String(url)).toBe("https://api.openai.com/v1/chat/completions");
        const body = JSON.parse(init.body);
        expect(body.tool_choice).toBe("none");
        expect(body.messages[0].content).toContain("29.6");
        return new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: "stop",
                message: {
                  content: JSON.stringify({
                    text: "Em Fortaleza, agora faz 29,6 graus Celsius, com algumas nuvens.",
                    expression: "neutral",
                    serious: false,
                    intent: { id: "weather", parameters: [] },
                  }),
                },
              },
            ],
            usage: { prompt_tokens: 200, completion_tokens: 30 },
          }),
        );
      });
      vi.stubGlobal("fetch", fetcher);
      const reply = await new Conversation(f.repo, new Automations(f.repo)).respond(
        "one",
        "Qual o clima lá fora?",
        AbortSignal.timeout(5000),
      );
      expect(reply.text).toContain("29,6 graus");
      expect(reply.web).toBeUndefined();
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(await f.repo.db.event.count({ where: { kind: "web_search_usage" } })).toBe(0);
    } finally {
      await f.close();
    }
  });
});
