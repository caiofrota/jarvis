import { json, Repository } from "@rosie/db";
import { schemas, settingsSchema } from "@rosie/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { searchDay, searchMonth, WebSearchAddon } from "../src/server/addons/web-search";
import { Automations } from "../src/server/automation/service";
import { Conversation } from "../src/server/conversation/service";
import { searchPresentation } from "../src/server/conversation/weather-request";
import {
  eventPeriod,
  missingFlightDetails,
  resolveFlightDefaults,
  searchArguments,
  searchQuery,
} from "../src/server/conversation/web-search";
import { repositoryFixture } from "./fixture";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const signal = () => AbortSignal.timeout(10000);
const ctx = { endpointId: "one", city: "Fortaleza", timezone: "America/Fortaleza" };
const searchResponse = (flight = false) =>
  new Response(
    JSON.stringify({
      status: "completed",
      output: [
        { type: "web_search_call", status: "completed" },
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: flight
                ? JSON.stringify({ offers: [] })
                : "Encontrei a programação oficial. ([example.org](https://example.org/agenda)) citeturn0search0",
              annotations: [
                {
                  type: "url_citation",
                  title: "Agenda cultural",
                  url: "https://example.org/agenda",
                },
                { type: "url_citation", title: "Invalid", url: "javascript:alert(1)" },
                {
                  type: "url_citation",
                  title: "Invalid credentials",
                  url: "https://secret@example.org/",
                },
              ],
            },
          ],
        },
      ],
      usage: { input_tokens: 8500, output_tokens: 80, total_tokens: 8580 },
    }),
  );
async function fixture(limit = 5) {
  const f = await repositoryFixture();
  const settings = settingsSchema.parse({
    openaiKey: "fixture-key",
    webSearchEnabled: true,
    webSearchMonthlyBudgetUsd: limit,
    mqttEnabled: false,
  });
  await f.repo.db.setting.update({ where: { id: "settings" }, data: { data: json(settings) } });
  const addon = new WebSearchAddon(f.repo);
  await addon.configure(settings);
  return { ...f, addon, settings };
}
const chatResponse = (message: unknown) =>
  new Response(
    JSON.stringify({
      choices: [{ finish_reason: "stop", message }],
      usage: { prompt_tokens: 20, completion_tokens: 30 },
    }),
  );
const searchCall = (query: string, id = "search") => ({
  id,
  type: "function",
  function: { name: "search_web", arguments: JSON.stringify({ query }) },
});

describe("bounded web search addon", () => {
  it("records bounded failure stages and does not cache or retry an incomplete answer", async () => {
    const f = await fixture();
    try {
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              status: "incomplete",
              output: [],
              usage: { input_tokens: 8500, output_tokens: 600, total_tokens: 9100 },
            }),
          ),
        )
        .mockResolvedValueOnce(searchResponse());
      vi.stubGlobal("fetch", fetcher);
      await expect(f.addon.search("Agenda atual", ctx, signal())).rejects.toThrow("Não consegui");
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect((await f.addon.status()).cacheEntries).toBe(0);
      const event = await f.repo.db.event.findFirst({ where: { kind: "web_search_failed" } });
      expect(event?.detail).toMatchObject({
        stage: "provider_output",
        provider_status: 200,
        provider_output_status: "incomplete",
      });
      const result = await f.addon.search("Agenda atual", ctx, signal());
      expect(result.web?.cache).toBe("fresh");
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      await f.close();
    }
  });
  it("defaults off and renews the budget at the Fortaleza month boundary", () => {
    expect(settingsSchema.parse({})).toMatchObject({
      webSearchEnabled: false,
      webSearchMonthlyBudgetUsd: 5,
      webSearchCacheEnabled: true,
    });
    expect(searchDay(new Date("2026-09-24T02:59:59Z"))).toBe("2026-09-23");
    expect(searchDay(new Date("2026-09-24T03:00:00Z"))).toBe("2026-09-24");
    expect(searchMonth(new Date("2026-10-01T02:59:59Z"))).toBe("2026-09");
    expect(searchMonth(new Date("2026-10-01T03:00:00Z"))).toBe("2026-10");
  });
  it("bounds the hosted tool, supplies location, returns safe citations and persists usage across restart", async () => {
    const f = await fixture();
    try {
      const fetcher = vi.fn().mockResolvedValue(searchResponse());
      vi.stubGlobal("fetch", fetcher);
      const result = await f.addon.search(
        "Eventos em Fortaleza neste fim de semana",
        ctx,
        signal(),
      );
      expect(result.text).toBe("Encontrei a programação oficial.");
      expect(result.web?.sources).toEqual([
        { title: "Agenda cultural", url: "https://example.org/agenda" },
      ]);
      const payload = JSON.parse(fetcher.mock.calls[0][1].body);
      expect(payload).toMatchObject({
        store: false,
        model: "gpt-4.1-mini",
        max_tool_calls: 1,
        parallel_tool_calls: false,
        tool_choice: "required",
      });
      expect(payload.tools).toHaveLength(1);
      expect(payload.tools[0]).toMatchObject({
        type: "web_search",
        user_location: { city: "Fortaleza" },
      });
      const restarted = new WebSearchAddon(new Repository(f.repo.db));
      expect(await restarted.status()).toMatchObject({
        requests: 1,
        accountedUsd: 0.013528,
        reservedUsd: 0,
        remainingUsd: 4.986472,
      });
      const logs = JSON.stringify(await f.repo.db.event.findMany());
      expect(logs).toContain("web_search_usage");
      expect(logs).not.toContain("fixture-key");
      expect(logs).not.toContain("Eventos em Fortaleza");
      expect(logs).not.toContain("programação oficial");
    } finally {
      await f.close();
    }
  });
  it("reserves the shared budget before concurrent dispatch and settles known costs", async () => {
    const f = await fixture(0.13);
    try {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const fetcher = vi.fn().mockImplementation(async () => {
        await gate;
        return searchResponse();
      });
      vi.stubGlobal("fetch", fetcher);
      const pending = Promise.allSettled(
        Array.from({ length: 8 }, (_, i) =>
          f.addon.search(
            `Agenda atual ${i}`,
            { ...ctx, endpointId: i % 2 ? "two" : "one" },
            signal(),
          ),
        ),
      );
      await vi.waitFor(async () =>
        expect(await f.addon.status()).toMatchObject({
          requests: 2,
          accountedUsd: 0.13,
          reservedUsd: 0.13,
          remainingUsd: 0,
        }),
      );
      expect(fetcher).toHaveBeenCalledTimes(2);
      // Wait until every competing reservation has been rejected before settling the first two.
      await f.repo.monthlySearchBudget(searchMonth(), 65000, () => undefined);
      release();
      const results = await pending;
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
      expect(await f.addon.status()).toMatchObject({
        requests: 2,
        accountedUsd: 0.027056,
        reservedUsd: 0,
      });
      await f.repo.db.event.deleteMany();
      expect(await new WebSearchAddon(new Repository(f.repo.db)).status()).toMatchObject({
        requests: 2,
        accountedUsd: 0.027056,
      });
    } finally {
      await f.close();
    }
  });
  it("keeps uncertain failures reserved across restart and never retries", async () => {
    const f = await fixture(0.07);
    try {
      const fetcher = vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 }));
      vi.stubGlobal("fetch", fetcher);
      await expect(f.addon.search("Agenda atual", ctx, signal())).rejects.toThrow(
        "Não fiz outra tentativa",
      );
      const restarted = new WebSearchAddon(new Repository(f.repo.db));
      expect(await restarted.status()).toMatchObject({
        requests: 1,
        accountedUsd: 0.065,
        reservedUsd: 0.065,
        remainingUsd: 0.005,
      });
      await expect(restarted.search("Agenda atual", ctx, signal())).rejects.toThrow("saldo mensal");
      expect(fetcher).toHaveBeenCalledTimes(1);
      await f.repo.db.setting.update({
        where: { id: "settings" },
        data: { data: json({ ...f.settings, webSearchEnabled: false }) },
      });
      await expect(f.addon.search("Agenda atual", ctx, signal())).rejects.toThrow("desligada");
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      await f.close();
    }
  });
  it("fails closed on corrupt budget records instead of resetting spending", async () => {
    const f = await fixture();
    try {
      const fetcher = vi.fn().mockImplementation(async () => searchResponse());
      vi.stubGlobal("fetch", fetcher);
      await f.repo.db.setting.create({
        data: { id: `budget:web-search:${searchMonth()}`, data: { accountedMicros: "invalid" } },
      });
      await expect(f.addon.search("Agenda atual", ctx, signal())).rejects.toThrow();
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      await f.close();
    }
  });
  it("reuses sourced results within a home even without budget, but explicit refresh spends again", async () => {
    const f = await fixture();
    try {
      const fetcher = vi.fn().mockImplementation(async () => searchResponse());
      vi.stubGlobal("fetch", fetcher);
      const home = { ...ctx, homeId: "home" };
      const original = await f.addon.search("Eventos Fortaleza", home, signal());
      await f.repo.db.setting.update({
        where: { id: "settings" },
        data: { data: json({ ...f.settings, webSearchMonthlyBudgetUsd: 0 }) },
      });
      await f.addon.configure(await f.repo.settings());
      const cached = await f.addon.search(
        "  Eventos  Fortaleza?",
        { ...home, endpointId: "two" },
        signal(),
      );
      expect(cached.web).toMatchObject({ ...original.web, cache: "hit" });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(await f.addon.status()).toMatchObject({
        requests: 1,
        cacheHits: 1,
        cacheEntries: 1,
        remainingUsd: 0,
      });
      await expect(
        f.addon.search("Eventos Fortaleza", { ...home, fresh: true }, signal()),
      ).rejects.toThrow("saldo mensal");
      expect(fetcher).toHaveBeenCalledTimes(1);
      await f.repo.db.setting.update({
        where: { id: "settings" },
        data: { data: json(f.settings) },
      });
      await f.addon.search("Eventos Fortaleza", { ...home, fresh: true }, signal());
      expect(fetcher).toHaveBeenCalledTimes(2);
      await f.addon.configure({ ...f.settings, openaiKey: "changed-key" });
      expect((await f.addon.status()).cacheEntries).toBe(0);
    } finally {
      await f.close();
    }
  });
  it("cancels in-flight lookup without delivering stale output or making another request", async () => {
    const f = await fixture();
    try {
      const abort = new AbortController();
      const fetcher = vi.fn().mockImplementation(async () => {
        abort.abort();
        return searchResponse();
      });
      vi.stubGlobal("fetch", fetcher);
      await expect(f.addon.search("Agenda atual", ctx, abort.signal)).rejects.toThrow();
      expect(fetcher).toHaveBeenCalledTimes(1);
      await vi.waitFor(async () => expect(await f.repo.db.event.count()).toBeGreaterThan(0));
      expect(await f.addon.status()).toMatchObject({ requests: 1, cacheEntries: 0 });
      await expect(f.addon.search("Agenda atual", ctx, AbortSignal.abort())).rejects.toThrow();
      expect(await f.addon.status()).toMatchObject({ requests: 1 });
    } finally {
      await f.close();
    }
  });
  it("refuses an answer without verified source annotations", async () => {
    const f = await fixture();
    try {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              status: "completed",
              output: [
                { type: "web_search_call", status: "completed" },
                { type: "message", content: [{ type: "output_text", text: "Preço inventado" }] },
              ],
            }),
          ),
        ),
      );
      await expect(f.addon.search("Agenda atual", ctx, signal())).rejects.toThrow(
        "resposta com fontes",
      );
      expect(await f.addon.status()).toMatchObject({ requests: 1 });
    } finally {
      await f.close();
    }
  });
});

describe("conversation web search boundary", () => {
  it("keeps a weather fallback short, current and Celsius when the local source fails", async () => {
    const f = await fixture();
    try {
      const catalog = await f.repo.catalog();
      await f.repo.db.entry.update({
        where: { collection_id: { collection: "homes", id: "home" } },
        data: {
          data: json({
            ...catalog.homes[0],
            weatherLocation: { name: "Fortaleza", latitude: -3.71722, longitude: -38.54306 },
          }),
        },
      });
      const weather = schemas.intents.parse({
        ...catalog.intents[0],
        id: "weather",
        name: "Clima",
        description: "Perguntas sobre o clima atual da cidade da casa.",
        matchMode: "semantic",
        dataSource: "weather",
        topicTerms: ["clima"],
      });
      await f.repo.db.entry.create({
        data: { collection: "intents", id: weather.id, name: weather.name, data: json(weather) },
      });
      const result = await searchResponse().json();
      result.output[1].content[0].text =
        "Agora, em Fortaleza, nuvens espaçadas e 86°F (30°C). Previsão diária: Sexta 87°F. Sábado 88°F. Domingo 89°F.";
      const fetcher = vi.fn().mockImplementation(async (url, init) => {
        if (String(url).startsWith("https://api.open-meteo.com/"))
          return new Response("unavailable", { status: 503 });
        if (String(url).endsWith("/chat/completions")) {
          expect(JSON.parse(init.body).tool_choice).toBe("auto");
          return chatResponse({
            content: null,
            tool_calls: [searchCall("Clima de Fortaleza nesta semana")],
          });
        }
        expect(String(url)).toBe("https://api.openai.com/v1/responses");
        const body = JSON.parse(init.body);
        expect(body.max_output_tokens).toBe(600);
        expect(body.instructions).toContain("Somente as condições atuais");
        expect(body.instructions).toContain("graus Celsius");
        return new Response(JSON.stringify(result));
      });
      vi.stubGlobal("fetch", fetcher);
      const automations = new Automations(f.repo);
      const conversation = new Conversation(f.repo, automations);
      const permission = await conversation.respond("one", "Qual o clima lá fora?", signal());
      expect(permission.text).toContain("Posso fazer uma pesquisa");
      expect((await f.addon.status()).requests).toBe(0);
      const reply = await conversation.respond("one", "sim", signal());
      expect(reply.text).toBe("Agora, em Fortaleza, algumas nuvens e 30 graus Celsius.");
      expect(reply.web?.sources).toHaveLength(1);
      expect(fetcher).toHaveBeenCalledTimes(3); // Weather read, model decision, single hosted search.
      expect((await f.addon.status()).requests).toBe(1);
      const cacheReply = await automations.addons.webSearch.search(
        "Clima de Fortaleza nesta semana",
        { ...ctx, homeId: "home", presentation: searchPresentation("Qual o clima lá fora?") },
        signal(),
      );
      expect(cacheReply.text).toBe(reply.text);
      expect(cacheReply.web?.cache).toBe("hit");
      expect(fetcher).toHaveBeenCalledTimes(3);
    } finally {
      await f.close();
    }
  });
  it("calculates weekends in the home timezone and validates flight offers before dispatch", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-23T21:00:00Z"));
    try {
      expect(
        eventPeriod("neste fim de semana", "America/Fortaleza", new Date("2026-09-23T21:00:00Z")),
      ).toEqual({ from: "2026-09-26", to: "2026-09-27" });
      expect(
        eventPeriod("neste fim de semana", "America/Fortaleza", new Date("2026-09-28T02:00:00Z")),
      ).toEqual({ from: "2026-09-26", to: "2026-09-27" });
      expect(
        eventPeriod("próximo fim de semana", "America/Fortaleza", new Date("2026-09-27T21:00:00Z")),
      ).toEqual({ from: "2026-10-03", to: "2026-10-04" });
      const args = searchArguments.parse({ query: "passagens aéreas Fortaleza" });
      expect(missingFlightDetails(args, "Quero ver uma passagem aérea", "Fortaleza")).toContain(
        "destino",
      );
      const complete = {
        ...args,
        flight: {
          origin: "Fortaleza",
          destination: "Recife",
          departureDate: "2026-10-01",
          returnDate: null,
          oneWay: true,
          passengers: 1,
        },
      };
      expect(missingFlightDetails(complete, "Uma passagem só de ida", "Fortaleza")).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
  it("blocks a model request to search flights with missing details without consuming quota", async () => {
    const f = await fixture();
    try {
      const conversation = new Conversation(f.repo, new Automations(f.repo));
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(
          chatResponse({ content: null, tool_calls: [searchCall("passagens aéreas Fortaleza")] }),
        );
      vi.stubGlobal("fetch", fetcher);
      const result = await conversation.respond("one", "Quero ver uma passagem aérea", signal());
      expect(result.text).toContain("Antes de pesquisar");
      expect(result.text).toContain("destino");
      expect(result.text).not.toContain("data");
      expect(result.text).not.toMatch(/origem|partida|quantas pessoas|passageiros/);
      expect(result.web).toBeUndefined();
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(await f.addon.status()).toMatchObject({ requests: 0 });
    } finally {
      await f.close();
    }
  });
  it("defaults only omitted flight origin and passenger count and asks only for missing criteria", () => {
    const original = searchArguments.parse({
      query: "Passagens para Recife em 10 de novembro, só ida",
      flight: {
        origin: null,
        destination: "Recife",
        departureDate: "2026-11-10",
        returnDate: null,
        oneWay: true,
        passengers: null,
        tripScope: "domestic",
      },
    });
    const defaults = resolveFlightDefaults(original, "Fortaleza");
    if (!defaults.flight) throw new Error("Expected flight criteria");
    expect(defaults.flight).toMatchObject({ origin: "Fortaleza", passengers: 1 });
    expect(original.flight).toMatchObject({ origin: null, passengers: null });
    expect(missingFlightDetails(defaults, original.query, "Fortaleza")).toBeUndefined();
    expect(searchQuery(defaults)).toContain("Preço por pessoa");
    const explicit = { ...original, flight: { ...defaults.flight, origin: "GRU", passengers: 2 } };
    expect(resolveFlightDefaults(explicit, "Fortaleza").flight).toMatchObject({
      origin: "GRU",
      passengers: 2,
    });
    expect(searchQuery(explicit)).not.toBe(searchQuery(defaults));
    expect(missingFlightDetails(original, original.query, "")).toContain("partida");
    expect(
      missingFlightDetails(
        { ...defaults, flight: { ...defaults.flight, oneWay: false } },
        "",
        "Fortaleza",
      ),
    ).toBeUndefined();
    expect(
      missingFlightDetails(
        { ...defaults, flight: { ...defaults.flight, oneWay: false, returnDate: "2026-11-09" } },
        "",
        "Fortaleza",
      ),
    ).toContain("A volta precisa");
    expect(
      searchQuery({
        ...defaults,
        query: "q".repeat(700),
        flight: { ...defaults.flight, origin: "o".repeat(120), destination: "d".repeat(100) },
      }).length,
    ).toBeLessThanOrEqual(700);
  });
  it.each([
    { origin: null, passengers: null, expectedOrigin: "Fortaleza", expectedPassengers: 1 },
    { origin: "GRU", passengers: 2, expectedOrigin: "GRU", expectedPassengers: 2 },
  ])(
    "dispatches one flight search with resolved defaults or explicit overrides: $expectedOrigin/$expectedPassengers",
    async ({ origin, passengers, expectedOrigin, expectedPassengers }) => {
      const f = await fixture();
      try {
        const automations = new Automations(f.repo);
        const conversation = new Conversation(f.repo, automations);
        const args = {
          query: "Passagens para Recife em 10 de novembro de 2026 só ida",
          flight: {
            origin,
            passengers,
            destination: "Recife",
            departureDate: "2026-11-10",
            returnDate: null,
            oneWay: true,
          },
        };
        const fetcher = vi
          .fn()
          .mockResolvedValueOnce(
            chatResponse({
              content: null,
              tool_calls: [
                {
                  id: "flight",
                  type: "function",
                  function: { name: "search_web", arguments: JSON.stringify(args) },
                },
              ],
            }),
          )
          .mockResolvedValueOnce(searchResponse(true));
        vi.stubGlobal("fetch", fetcher);
        const reply = await conversation.respond("one", `Pesquise ${args.query}`, signal());
        expect(reply.web?.sources).toHaveLength(1);
        expect(fetcher).toHaveBeenCalledTimes(2);
        const primary = JSON.parse(fetcher.mock.calls[0][1].body);
        expect(primary.messages[0].content).toContain("Não peça confirmação desses padrões");
        const hosted = JSON.parse(fetcher.mock.calls[1][1].body);
        expect(hosted.input).toContain(`de ${expectedOrigin} para Recife`);
        expect(hosted.input).toContain(`Passageiros: ${expectedPassengers}`);
        expect(hosted.input).toContain("Preço por pessoa");
        expect(hosted.instructions).toContain("Preserve aeroportos explícitos");
        expect(hosted.instructions).toContain("não multiplique uma tarifa individual");
        expect(await automations.addons.webSearch.status()).toMatchObject({ requests: 1 });
      } finally {
        await f.close();
      }
    },
  );
  it("uses only the first search call and never runs simultaneous home commands or another generation", async () => {
    const f = await fixture();
    try {
      const automations = new Automations(f.repo),
        execute = vi.spyOn(automations, "execute");
      const conversation = new Conversation(f.repo, automations);
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(
          chatResponse({
            content: null,
            tool_calls: [
              searchCall("Eventos Fortaleza setembro 2026"),
              searchCall("Mais eventos", "second"),
              {
                id: "home",
                type: "function",
                function: {
                  name: "control_home",
                  arguments: JSON.stringify({
                    target: "Luz",
                    action: "on",
                    room: null,
                    routine: false,
                  }),
                },
              },
            ],
          }),
        )
        .mockResolvedValueOnce(searchResponse());
      vi.stubGlobal("fetch", fetcher);
      const permission = await conversation.respond(
        "one",
        "Quais eventos tem na cidade?",
        signal(),
      );
      expect(permission.text).toContain("Posso fazer uma pesquisa");
      expect(fetcher).toHaveBeenCalledTimes(1);
      const result = await conversation.respond("one", "sim", signal());
      expect(result.web?.sources).toHaveLength(1);
      expect(fetcher).toHaveBeenCalledTimes(2); // Main decision + exactly one hosted search request.
      expect(execute).not.toHaveBeenCalled();
      expect(await automations.addons.webSearch.status()).toMatchObject({ requests: 1 });
      expect(conversation.webReferences().one).toBeDefined();
      expect(conversation.webReferences().two).toBeUndefined();
      expect(new Conversation(f.repo, automations).webReferences()).toEqual({});
      vi.useFakeTimers();
      vi.setSystemTime(Date.now() + 31 * 60000);
      expect(conversation.webReferences()).toEqual({});
    } finally {
      vi.useRealTimers();
      await f.close();
    }
  });
  it("does not search for local greetings or clarification of missing flight details", async () => {
    const f = await fixture();
    try {
      const conversation = new Conversation(f.repo, new Automations(f.repo));
      const fetcher = vi.fn().mockResolvedValue(
        chatResponse({
          content: JSON.stringify({
            text: "Qual destino e quais datas?",
            expression: "neutral",
            serious: false,
          }),
        }),
      );
      vi.stubGlobal("fetch", fetcher);
      await conversation.respond("one", "bom dia", signal());
      expect(fetcher).not.toHaveBeenCalled();
      const answer = await conversation.respond("one", "Quanto custa uma passagem?", signal());
      expect(answer.text).toContain("destino");
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(JSON.parse(fetcher.mock.calls[0][1].body).messages[0].content).toContain(
        "critérios incompletos",
      );
      expect(await f.addon.status()).toMatchObject({ requests: 0 });
    } finally {
      await f.close();
    }
  });
});
