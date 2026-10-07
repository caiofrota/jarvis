import { describe, expect, it } from "vitest";
import { flightAnswer } from "../src/server/addons/flight-answer";
import { formatSearchAnswer } from "../src/server/addons/search-answer";
import { resolveFlightDefaults, searchArguments } from "../src/server/conversation/web-search";
import { spokenMoney } from "../src/server/voice/money";
import { spokenText } from "../src/server/voice/text";

const f = resolveFlightDefaults(
  searchArguments.parse({
    query: "Passagens para o Rio",
    flight: {
      origin: null,
      destination: "Rio de Janeiro",
      originCountry: "BR",
      destinationCountry: "BR",
      departureDate: null,
      returnDate: null,
      oneWay: null,
      passengers: null,
    },
  }),
  "Fortaleza",
  "America/Fortaleza",
  new Date("2026-09-24T12:00:00Z"),
).flight;
if (!f) throw new Error("Missing fixture flight");
const url = "https://example.org/ofertas";
const offer = {
  departure: "2026-10-02",
  return: "2026-10-05",
  amount: 1234.56,
  currency: "BRL",
  roundTrip: true,
  perPerson: true,
  airline: "LATAM",
  sourceUrl: url,
};
const answer = (changes = {}, criteria = f) =>
  flightAnswer(JSON.stringify({ offers: [{ ...offer, ...changes }] }), criteria, new Set([url]));

describe("grounded flight offers", () => {
  it("speaks the price and dates from one eligible published offer", () => {
    const result = answer();
    expect(result).toMatchObject({ accepted: 1, rejected: 0 });
    expect(result.text).toContain(
      "mil duzentos e trinta e quatro reais e cinquenta e seis centavos por pessoa, ida e volta",
    );
    expect(result.text).toContain("Ida em 2 de outubro e volta em 5 de outubro");
  });
  it.each([
    { return: "2026-10-16" }, // Reported 14-day domestic trip.
    { departure: "2026-10-31", return: "2026-11-04" },
    { roundTrip: false },
    { roundTrip: null },
    { return: null },
    { sourceUrl: "https://invented.example/offer" },
    { perPerson: false },
    { amount: null },
  ])("rejects unsuitable or ungrounded offers: %j", (change) => {
    const result = answer(change);
    expect(result).toMatchObject({ accepted: 0, rejected: 1 });
    expect(result.text).toContain("não encontrei preço com datas confirmadas");
    expect(result.text).toContain("2 a 7 dias");
    expect(result.text).not.toContain("mil duzentos");
  });
  it("honors an explicit longer stay and one-way travel", () => {
    expect(answer({ sourceUrl: `${url}?utm_source=openai` }).accepted).toBe(1);
    expect(answer({ sourceUrl: `${url}?departure=2026-12-01` }).accepted).toBe(0);
    expect(
      answer({ return: "2026-10-16" }, { ...f, stayDays: 14, stayWindow: null }).accepted,
    ).toBe(1);
    expect(answer({ return: null, roundTrip: false }, { ...f, oneWay: true }).accepted).toBe(1);
    expect(answer({}, { ...f, departureDate: "2026-10-03", departureWindow: null }).accepted).toBe(
      0,
    );
  });
  it("derives regional stays from countries, overriding a mistaken category", () => {
    for (const [country, scope, min, max] of [
      ["BR", "domestic", 2, 7],
      ["AR", "south_america", 4, 7],
      ["PT", "international", 7, 20],
    ] as const) {
      const criteria = resolveFlightDefaults(
        {
          query: "Passagens",
          flight: {
            ...f,
            destinationCountry: country,
            tripScope: "international",
            stayWindow: null,
          },
        },
        "Fortaleza",
      ).flight;
      expect(criteria).toMatchObject({ tripScope: scope, stayWindow: { min, max } });
    }
  });
});

describe("prices spoken without symbols or fragmented numbers", () => {
  it.each([
    ["R$ 1.234,56", "mil duzentos e trinta e quatro reais e cinquenta e seis centavos"],
    ["R$1.200", "mil e duzentos reais"],
    ["US$ 1,250.50", "mil duzentos e cinquenta dólares americanos e cinquenta centavos"],
    ["R$ 1,01", "um real e um centavo"],
    ["€ 383", "trezentos e oitenta e três euros"],
  ])("normalizes %s before both speech and search sentence limits", (input, expected) => {
    expect(spokenText(input)).toBe(expected);
    expect(formatSearchAnswer(`O preço é ${input}. Consulte o site.`)).toBe(
      `O preço é ${expected}. Consulte o site.`,
    );
  });
  it("handles zero, exact hundreds and millions without changing other numbers", () => {
    expect(spokenMoney(0, "BRL")).toBe("zero reais");
    expect(spokenMoney(100, "BRL")).toBe("cem reais");
    expect(spokenMoney(1_000_000, "BRL")).toBe("um milhão de reais");
    expect(spokenText("O voo 1234 sai em 2 de outubro.")).toBe("O voo 1234 sai em 2 de outubro.");
  });
});
