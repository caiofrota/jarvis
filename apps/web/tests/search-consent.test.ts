import { settingsSchema } from "@rosie/types";
import { context } from "@rosie/types/context";
import { afterEach, expect, it, vi } from "vitest";
import { explicitlyRequestsSearch, SearchConsent } from "../src/server/conversation/search-consent";
import { catalogFixture } from "./fixture";

afterEach(() => vi.useRealTimers());
it.each([
  "pesquise passagens para o Rio",
  "procure eventos na cidade",
  "Rosie, pode pesquisar isso na internet?",
  "quero passagens baratas para Recife",
  "veja na internet o preço",
])("allows a direct search request: %s", (text) =>
  expect(explicitlyRequestsSearch(text, ["Rosie"])).toBe(true),
);
it.each([
  "quais eventos tem na cidade?",
  "tô com frio",
  "estou pensando em viajar",
  "não pesquise passagens",
  "se eu pedir para pesquisar",
  "será que vai chover?",
])("requires confirmation for a model-initiated search: %s", (text) =>
  expect(explicitlyRequestsSearch(text)).toBe(false),
);
const c = catalogFixture(),
  one = context(c, "one"),
  two = context(c, "two"),
  cfg = settingsSchema.parse({ webSearchEnabled: true, openaiKey: "fixture-key" });
const request = {
  args: { query: "Eventos em Fortaleza", flight: null },
  text: "O que tem para fazer na cidade?",
};
it("pins the original request, accepts one affirmative and does not share endpoint or preview consent", () => {
  const consent = new SearchConsent();
  expect(consent.offer("one", request, one, cfg)).toContain("Eventos em Fortaleza");
  expect(consent.answer("two", "sim", two, cfg)).toBeNull();
  expect(new SearchConsent().answer("one", "sim", one, cfg)).toBeNull();
  expect(consent.answer("one", "sim, Rosie", one, cfg)).toEqual(request);
  expect(consent.answer("one", "sim", one, cfg)).toContain("não tem mais");
});
it("invalidates consent after refusal, another request, reset, timeout or changed context/configuration", () => {
  const consent = new SearchConsent();
  consent.offer("one", request, one, cfg);
  expect(consent.answer("one", "não, obrigada", one, cfg)).toContain("não vou pesquisar");
  expect(consent.answer("one", "sim", one, cfg)).toContain("não tem mais");
  consent.offer("one", request, one, cfg);
  expect(consent.answer("one", "bom dia", one, cfg)).toBeNull();
  expect(consent.answer("one", "sim", one, cfg)).toBeNull();
  consent.offer("one", request, one, cfg);
  consent.reset("one");
  expect(consent.answer("one", "sim", one, cfg)).toBeNull();
  vi.useFakeTimers({ toFake: ["Date"] });
  consent.offer("one", request, one, cfg);
  vi.setSystemTime(Date.now() + 61000);
  expect(consent.answer("one", "sim", one, cfg)).toContain("não tem mais");
  consent.offer("one", request, one, cfg);
  expect(consent.answer("one", "sim", two, cfg)).toContain("não tem mais");
  consent.offer("one", request, one, cfg);
  expect(consent.answer("one", "sim", one, { ...cfg, webSearchEnabled: false })).toContain(
    "não tem mais",
  );
});
