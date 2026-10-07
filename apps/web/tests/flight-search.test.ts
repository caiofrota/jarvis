import { json } from "@rosie/db";
import { settingsSchema } from "@rosie/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cacheKey } from "../src/server/addons/search-cache";
import { Automations } from "../src/server/automation/service";
import { Conversation } from "../src/server/conversation/service";
import {
  missingFlightDetails,
  resolveFlightDefaults,
  searchArguments,
  searchQuery,
} from "../src/server/conversation/web-search";
import { repositoryFixture } from "./fixture";

const now = new Date("2026-09-25T02:30:00Z"); // Still September 24 in Fortaleza.
const timezone = "America/Fortaleza";
function args(overrides: Record<string, unknown> = {}) {
  return searchArguments.parse({
    query: "Passagens econômicas",
    flight: {
      origin: null,
      destination: "Recife",
      departureDate: null,
      returnDate: null,
      oneWay: null,
      passengers: null,
      tripScope: "domestic",
      ...overrides,
    },
  });
}
const resolve = (input = args()) => resolveFlightDefaults(input, "Fortaleza", timezone, now);
const missing = (input: ReturnType<typeof args>) =>
  missingFlightDetails(input, input.query, "Fortaleza", timezone, now);
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("regional flexible flight defaults", () => {
  it.each([
    ["domestic", "Recife", 2, 7],
    ["south_america", "Buenos Aires", 4, 7],
    ["international", "Lisboa", 7, 20],
  ])(
    "uses round trip, the home's local date and a duration range for %s",
    (tripScope, destination, min, max) => {
      const resolved = resolve(args({ tripScope, destination }));
      expect(resolved.flight).toMatchObject({
        origin: "Fortaleza",
        passengers: 1,
        oneWay: false,
        departureDate: null,
        returnDate: null,
        departureWindow: { from: "2026-09-25", to: "2026-10-24" },
        stayWindow: { min, max },
      });
      expect(missing(resolved)).toBeUndefined();
      expect(resolve(resolved)).toEqual(resolved);
      const query = searchQuery(resolved);
      expect(query).toContain("Ida e volta");
      expect(query).toContain(`Estadia: ${min} a ${max} dias`);
      expect(query).not.toMatch(/null|undefined/);
      expect(query.includes("preferir fim de semana")).toBe(tripScope === "domestic");
    },
  );
  it("preserves explicit one-way trips, airports, people, exact dates and duration", () => {
    const oneWay = resolve(
      args({
        origin: "GRU",
        passengers: 2,
        oneWay: true,
        departureDate: "2026-11-10",
        tripScope: null,
      }),
    );
    expect(oneWay.flight).toMatchObject({
      origin: "GRU",
      passengers: 2,
      oneWay: true,
      returnDate: null,
      stayWindow: null,
    });
    expect(missing(oneWay)).toBeUndefined();
    expect(searchQuery(oneWay)).toContain("Somente ida");
    const fixed = resolve(
      args({ departureDate: "2026-11-10", returnDate: "2026-11-13", tripScope: "international" }),
    );
    expect(fixed.flight?.stayWindow).toBeUndefined();
    expect(searchQuery(fixed)).toContain("Volta: 2026-11-13");
    expect(missing(fixed)).toBeUndefined();
    const duration = resolve(args({ tripScope: "international", stayDays: 3 }));
    expect(searchQuery(duration)).toContain("Estadia: 3 dias");
    expect(duration.flight?.stayWindow).toBeUndefined();
    const range = resolve(args({ stayWindow: { min: 10, max: 12 } }));
    expect(range.flight?.stayWindow).toEqual({ min: 10, max: 12 });
  });
  it("resolves next week/month across calendar boundaries and preserves custom windows", () => {
    const week = resolve(args({ departurePeriod: "next_week" }));
    expect(week.flight?.departureWindow).toEqual({ from: "2026-09-28", to: "2026-10-04" });
    const month = resolveFlightDefaults(
      args({ departurePeriod: "next_month" }),
      "Fortaleza",
      timezone,
      new Date("2026-12-31T12:00:00Z"),
    );
    expect(month.flight?.departureWindow).toEqual({ from: "2027-01-01", to: "2027-01-31" });
    const leap = resolveFlightDefaults(
      args({ departurePeriod: "next_month" }),
      "Fortaleza",
      timezone,
      new Date("2028-01-31T12:00:00Z"),
    );
    expect(leap.flight?.departureWindow).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    const window = { from: "2026-11-02", to: "2026-11-18" };
    expect(resolve(args({ departureWindow: window })).flight?.departureWindow).toEqual(window);
    const returning = resolve(args({ returnDate: "2026-11-10", tripScope: "south_america" }));
    expect(returning.flight?.departureWindow).toEqual({ from: "2026-11-03", to: "2026-11-06" });
  });
  it("blocks ambiguous geography and contradictory criteria without silently choosing a destination", () => {
    expect(
      missing(args({ departureDate: "2026-11-10", returnDate: "2026-11-13", stayDays: 5 })),
    ).toContain("não combinam");
    expect(
      missing(
        args({
          departureWindow: { from: "2026-11-10", to: "2026-11-11" },
          returnDate: "2026-11-20",
          stayWindow: { min: 2, max: 5 },
        }),
      ),
    ).toContain("não combinam");
    expect(missing(args({ destination: null }))).toContain("destino");
    expect(missing(args({ tripScope: null }))).toContain("país do destino");
    expect(missing(args({ tripScope: null, stayDays: 5 }))).toBeUndefined();
    expect(missing(args({ departureDate: "2026-11-10", returnDate: "2026-11-09" }))).toContain(
      "A volta precisa",
    );
    expect(missing(args({ departureWindow: { from: "2026-11-20", to: "2026-11-10" } }))).toContain(
      "começo do período",
    );
    expect(missing(args({ departureDate: "2026-09-23" }))).toContain("passado");
    expect(missing(args({ stayWindow: { min: 10, max: 5 } }))).toContain("duração mínima");
    expect(missing(args({ departureDate: "2026-11-10", departurePeriod: "next_month" }))).toContain(
      "data exata",
    );
  });
  it("separates flexible windows, stays and trip types in the existing cache", () => {
    expect(
      searchQuery(
        resolve({
          ...args({ origin: "o".repeat(100), destination: "d".repeat(100) }),
          query: "q".repeat(700),
        }),
      ).length,
    ).toBeLessThanOrEqual(700);
    const ctx = { endpointId: "one", city: "Fortaleza", timezone };
    const key = (input: ReturnType<typeof args>) => cacheKey(searchQuery(resolve(input)), ctx, now);
    const baseline = key(args());
    for (const change of [
      { stayDays: 5 },
      { departurePeriod: "next_month" },
      { oneWay: true },
      { passengers: 2 },
    ])
      expect(key(args(change))).not.toBe(baseline);
    expect(
      searchQuery(resolve(args({ origin: "o".repeat(100), destination: "d".repeat(100) }))).length,
    ).toBeLessThanOrEqual(700);
  });
  it("dispatches exactly one hosted search with flexible criteria instead of asking for dates", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    const f = await repositoryFixture();
    try {
      await f.repo.db.setting.update({
        where: { id: "settings" },
        data: {
          data: json(settingsSchema.parse({ openaiKey: "fixture", webSearchEnabled: true })),
        },
      });
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              choices: [
                {
                  finish_reason: "tool_calls",
                  message: {
                    content: null,
                    tool_calls: [
                      {
                        id: "search",
                        type: "function",
                        function: { name: "search_web", arguments: JSON.stringify(args()) },
                      },
                    ],
                  },
                },
              ],
              usage: { prompt_tokens: 20, completion_tokens: 20 },
            }),
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              status: "completed",
              output: [
                {
                  type: "web_search_call",
                  status: "completed",
                  action: { sources: [{ type: "url", url: "https://example.org/flights" }] },
                },
                {
                  type: "message",
                  content: [
                    {
                      type: "output_text",
                      text: JSON.stringify({ offers: [] }),
                      annotations: [],
                    },
                  ],
                },
              ],
              usage: { input_tokens: 8500, output_tokens: 40, total_tokens: 8540 },
            }),
          ),
        );
      vi.stubGlobal("fetch", fetcher);
      const automation = new Automations(f.repo);
      const reply = await new Conversation(f.repo, automation).respond(
        "one",
        "Quero passagens baratas para Recife",
        AbortSignal.timeout(10000),
      );
      expect(reply.web?.sources).toHaveLength(1);
      expect(fetcher).toHaveBeenCalledTimes(2);
      const hosted = JSON.parse(fetcher.mock.calls[1][1].body);
      expect(hosted.input).toContain("2026-09-25 e 2026-10-24");
      expect(hosted.input).toContain("Ida e volta");
      expect(hosted.input).toContain("2 a 7 dias");
      expect(hosted.instructions).toContain(
        "Não use uma tarifa de só ida como preço de ida e volta",
      );
      expect(hosted.max_tool_calls).toBe(1);
      expect(hosted.text.format).toMatchObject({ type: "json_schema", strict: true });
      expect(hosted.include).toContain("web_search_call.action.sources");
      expect(await automation.addons.webSearch.status()).toMatchObject({ requests: 1 });
    } finally {
      await f.close();
    }
  });
});
