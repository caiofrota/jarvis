import type { Reply } from "@rosie/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cacheKey,
  cachePolicy,
  SEARCH_CACHE_MAX,
  SearchCache,
} from "../src/server/addons/search-cache";
import { wantsFreshSearch } from "../src/server/conversation/web-search";

const ctx = { endpointId: "one", homeId: "home", city: "Fortaleza", timezone: "America/Fortaleza" };
const signal = () => new AbortController().signal;
const reply = (): Reply => ({
  text: "Resposta com fontes",
  expression: "neutral",
  web: {
    checkedAt: new Date().toISOString(),
    sources: [{ title: "Agenda", url: "https://example.org/agenda" }],
  },
});
afterEach(() => vi.useRealTimers());

describe("bounded private search cache", () => {
  it("uses short lifetimes for volatile facts and preserves all search constraints", () => {
    expect(cachePolicy("Passagens Fortaleza Recife").ttlMs).toBe(120000);
    expect(cachePolicy("notícias da cidade").ttlMs).toBe(300000);
    expect(cachePolicy("eventos Fortaleza").ttlMs).toBe(3600000);
    expect(cachePolicy("endereço museu").ttlMs).toBe(21600000);
    expect(cachePolicy("placar ao vivo").ttlMs).toBe(30000);
    const date = new Date("2026-09-23T12:00:00Z"),
      key = cacheKey("Vôos  Recife?", ctx, date);
    expect(cacheKey("voos recife", { ...ctx, endpointId: "two" }, date)).toBe(key);
    for (const changed of [
      { ...ctx, homeId: "other" },
      { ...ctx, city: "Recife" },
      { ...ctx, period: { from: "2026-10-01", to: "2026-10-02" } },
    ])
      expect(cacheKey("voos recife", changed, date)).not.toBe(key);
    expect(cacheKey("voos recife", ctx, new Date("2026-09-24T12:00:00Z"))).not.toBe(key);
    expect(cacheKey("voos sem escala", ctx, date)).not.toBe(cacheKey("voos com escala", ctx, date));
    expect(cacheKey("voos ida 10/11 volta 11/11", ctx, date)).not.toBe(
      cacheKey("voos ida 11/11 volta 10/11", ctx, date),
    );
    expect(wantsFreshSearch("Pesquise de novo por favor")).toBe(true);
    expect(wantsFreshSearch("Atualize as notícias")).toBe(true);
    expect(wantsFreshSearch("Quais os eventos da cidade?")).toBe(false);
  });
  it("expires entries, preserves original evidence, bypasses on refresh and bounds memory", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const cache = new SearchCache(),
      task = vi.fn(async () => reply());
    const original = await cache.getOrSearch("key", 120000, true, false, signal(), task);
    vi.setSystemTime(Date.now() + 119999);
    expect((await cache.getOrSearch("key", 120000, true, false, signal(), task)).web).toEqual({
      ...original.web,
      cache: "hit",
    });
    expect(task).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 1);
    await cache.getOrSearch("key", 120000, true, false, signal(), task);
    expect(task).toHaveBeenCalledTimes(2);
    await cache.getOrSearch("key", 120000, true, true, signal(), task);
    expect(task).toHaveBeenCalledTimes(3);
    for (let i = 0; i <= SEARCH_CACHE_MAX; i++)
      await cache.getOrSearch(String(i), 120000, true, false, signal(), task);
    expect(cache.size).toBe(SEARCH_CACHE_MAX);
    const calls = task.mock.calls.length;
    await cache.getOrSearch("key", 120000, true, false, signal(), task);
    expect(task).toHaveBeenCalledTimes(calls + 1);
    cache.clear();
    expect(cache.size).toBe(0);
  });
  it("shares one in-flight request and one caller's cancellation does not cancel another", async () => {
    const cache = new SearchCache(),
      abort = new AbortController();
    let release!: (value: Reply) => void, upstream!: AbortSignal;
    const task = vi.fn((s: AbortSignal) => {
      upstream = s;
      return new Promise<Reply>((resolve) => {
        release = resolve;
      });
    });
    const first = cache.getOrSearch("key", 10000, true, false, abort.signal, task);
    const rejected = expect(first).rejects.toThrow();
    const second = cache.getOrSearch("key", 10000, true, false, signal(), task);
    await Promise.resolve();
    abort.abort();
    await rejected;
    expect(upstream.aborted).toBe(false);
    release(reply());
    expect((await second).web?.cache).toBe("shared");
    expect(task).toHaveBeenCalledTimes(1);
    expect(cache.size).toBe(1);
  });
  it("never caches cancelled or failed work and disabling cache preserves no answers", async () => {
    const cache = new SearchCache(),
      abort = new AbortController();
    let release!: (value: Reply) => void, upstream!: AbortSignal;
    const pending = cache.getOrSearch("key", 10000, true, false, abort.signal, (s) => {
      upstream = s;
      return new Promise<Reply>((resolve) => {
        release = resolve;
      });
    });
    const rejected = expect(pending).rejects.toThrow();
    await Promise.resolve();
    abort.abort();
    await rejected;
    expect(upstream.aborted).toBe(true);
    release(reply());
    await new Promise((resolve) => setImmediate(resolve));
    expect(cache.size).toBe(0);
    const failed = vi.fn(async () => {
      throw new Error("Failed lookup");
    });
    await expect(cache.getOrSearch("key", 10000, true, false, signal(), failed)).rejects.toThrow(
      "Failed lookup",
    );
    await expect(cache.getOrSearch("key", 10000, true, false, signal(), failed)).rejects.toThrow(
      "Failed lookup",
    );
    expect(failed).toHaveBeenCalledTimes(2);
    const task = vi.fn(async () => reply());
    await cache.getOrSearch("key", 10000, false, false, signal(), task);
    await cache.getOrSearch("key", 10000, false, false, signal(), task);
    expect(task).toHaveBeenCalledTimes(2);
    expect(cache.size).toBe(0);
  });
});
