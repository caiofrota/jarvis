import { Repository } from "@rosie/db";
import { describe, expect, it } from "vitest";
import {
  legacySearchCost,
  SEARCH_RESERVATION_MICROS,
  searchCostMicros,
} from "../src/server/addons/search-cost";
import { repositoryFixture } from "./fixture";

describe("monthly search ledger", () => {
  it("prices tool plus search tokens conservatively, refusing unknown usage", () => {
    expect(searchCostMicros({ input_tokens: 8500, output_tokens: 80 })).toBe(13528);
    expect(searchCostMicros({ input_tokens: 0, output_tokens: 0 })).toBe(13200);
    expect(searchCostMicros({ input_tokens: 128000, output_tokens: 1000 })).toBeLessThan(
      SEARCH_RESERVATION_MICROS,
    );
    for (const invalid of [
      undefined,
      {},
      { input_tokens: -1, output_tokens: 0 },
      { input_tokens: 128001, output_tokens: 1 },
    ])
      expect(searchCostMicros(invalid)).toBeUndefined();
  });
  it("imports existing spend once and conservatively accounts for attempts without evidence", async () => {
    const f = await repositoryFixture();
    try {
      await f.repo.db.setting.create({
        data: { id: "usage:web-search", data: { day: "2026-09-23", used: 3 } },
      });
      await f.repo.db.event.create({
        data: {
          kind: "web_search_usage",
          time: new Date("2026-09-23T17:00:00Z"),
          detail: { usage: { input_tokens: 8500, output_tokens: 80 } },
        },
      });
      const first = await f.repo.monthlySearchBudget(
        "2026-09",
        SEARCH_RESERVATION_MICROS,
        legacySearchCost,
      );
      expect(first).toMatchObject({ requests: 3, accountedMicros: 143528 });
      await f.repo.db.event.deleteMany();
      expect(
        await new Repository(f.repo.db).monthlySearchBudget(
          "2026-09",
          SEARCH_RESERVATION_MICROS,
          legacySearchCost,
        ),
      ).toEqual(first);
      expect(
        await f.repo.monthlySearchBudget("2026-10", SEARCH_RESERVATION_MICROS, legacySearchCost),
      ).toMatchObject({ requests: 0, accountedMicros: 0 });
    } finally {
      await f.close();
    }
  });
  it("settles only the original month, only once, with reservations durable after restart", async () => {
    const f = await repositoryFixture();
    try {
      const ticket = await f.repo.reserveSearchBudget(
        "2026-09",
        5_000_000,
        SEARCH_RESERVATION_MICROS,
        legacySearchCost,
      );
      if (!ticket) throw new Error("Expected reservation");
      const restarted = new Repository(f.repo.db);
      expect(
        await restarted.monthlySearchBudget("2026-09", SEARCH_RESERVATION_MICROS, legacySearchCost),
      ).toMatchObject({ accountedMicros: 65000, requests: 1 });
      await restarted.settleSearchBudget(ticket, 13528);
      await restarted.settleSearchBudget(ticket, 0);
      expect(
        await restarted.monthlySearchBudget("2026-09", SEARCH_RESERVATION_MICROS, legacySearchCost),
      ).toMatchObject({ accountedMicros: 13528, requests: 1, reservations: {} });
      expect(
        await restarted.monthlySearchBudget("2026-10", SEARCH_RESERVATION_MICROS, legacySearchCost),
      ).toMatchObject({ accountedMicros: 0, requests: 0 });
    } finally {
      await f.close();
    }
  });
});
