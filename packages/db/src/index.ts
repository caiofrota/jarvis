import { randomUUID } from "node:crypto";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import {
  type Catalog,
  type Collection,
  collections,
  type Entity,
  emptyCatalog,
  type SearchBudget,
  type Settings,
  schemas,
  searchBudgetSchema,
  settingsSchema,
} from "@rosie/types";
import { type Prisma, PrismaClient } from "../generated/client";

export { PrismaClient };
export function createDatabase(url: string) {
  return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });
}
export function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
export class Repository {
  catalogProjection?: (catalog: Catalog) => Promise<Catalog>;
  private usageQueue: Promise<unknown> = Promise.resolve();
  constructor(readonly db: PrismaClient) {}
  async catalog({ project = true }: { project?: boolean } = {}): Promise<Catalog> {
    const c = emptyCatalog();
    for (const entry of await this.db.entry.findMany()) {
      if (collections.includes(entry.collection as Collection))
        (c[entry.collection as Collection] as Entity[]).push(
          schemas[entry.collection as Collection].parse(entry.data),
        );
    }
    return project && this.catalogProjection ? this.catalogProjection(c) : c;
  }
  async settings(): Promise<Settings> {
    return settingsSchema.parse(
      (await this.db.setting.findUnique({ where: { id: "settings" } }))?.data ?? {},
    );
  }
  async ready() {
    return Boolean(await this.db.setting.findUnique({ where: { id: "schema-version" } }));
  }
  private serializeUsage<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.usageQueue.then(operation);
    this.usageQueue = task.catch(() => undefined);
    return task;
  }
  private async saveSearchBudget(month: string, value: SearchBudget) {
    const id = `budget:web-search:${month}`,
      data = json(searchBudgetSchema.parse(value));
    await this.db.setting.upsert({ where: { id }, create: { id, data }, update: { data } });
  }
  private async readSearchBudget(
    month: string,
    reserve: number,
    legacyCost: (detail: unknown) => number | undefined,
  ): Promise<SearchBudget> {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Invalid budget period");
    const row = await this.db.setting.findUnique({ where: { id: `budget:web-search:${month}` } });
    if (row) return searchBudgetSchema.parse(row.data);
    // Import the earlier daily counter and still-retained usage evidence once, without resetting spend.
    const legacy = (await this.db.setting.findUnique({ where: { id: "usage:web-search" } }))?.data;
    let oldCount = 0;
    if (legacy) {
      if (
        typeof legacy !== "object" ||
        Array.isArray(legacy) ||
        typeof legacy.day !== "string" ||
        typeof legacy.used !== "number" ||
        !Number.isSafeInteger(legacy.used) ||
        legacy.used < 0
      )
        throw new Error("Invalid legacy search counter");
      if (legacy.day.startsWith(month)) oldCount = legacy.used;
    }
    const [year, number] = month.split("-").map(Number);
    const events = await this.db.event.findMany({
      where: {
        kind: { in: ["web_search_usage", "web_search_failed"] },
        time: {
          gte: new Date(`${month}-01T03:00:00Z`),
          lt: new Date(Date.UTC(year, number, 1, 3)),
        },
      },
    });
    const value: SearchBudget = {
      accountedMicros:
        events.reduce((sum, event) => sum + (legacyCost(event.detail) ?? reserve), 0) +
        Math.max(0, oldCount - events.length) * reserve,
      requests: Math.max(events.length, oldCount),
      cacheHits: 0,
      reservations: {},
    };
    await this.saveSearchBudget(month, value);
    return value;
  }
  monthlySearchBudget(
    month: string,
    reserve: number,
    legacyCost: (detail: unknown) => number | undefined,
  ) {
    return this.serializeUsage(() => this.readSearchBudget(month, reserve, legacyCost));
  }
  reserveSearchBudget(
    month: string,
    limit: number,
    amount: number,
    legacyCost: (detail: unknown) => number | undefined,
  ) {
    return this.serializeUsage(async () => {
      if (!Number.isSafeInteger(limit) || limit < 0 || !Number.isSafeInteger(amount) || amount <= 0)
        throw new Error("Invalid search budget reservation");
      const value = await this.readSearchBudget(month, amount, legacyCost);
      if (value.accountedMicros + amount > limit) return undefined;
      const id = randomUUID();
      value.accountedMicros += amount;
      value.requests++;
      value.reservations[id] = amount;
      await this.saveSearchBudget(month, value);
      return { month, id };
    });
  }
  settleSearchBudget(ticket: { month: string; id: string }, actualMicros: number) {
    return this.serializeUsage(async () => {
      if (!Number.isSafeInteger(actualMicros) || actualMicros < 0)
        throw new Error("Invalid search cost");
      const row = await this.db.setting.findUniqueOrThrow({
        where: { id: `budget:web-search:${ticket.month}` },
      });
      const value = searchBudgetSchema.parse(row.data),
        reserved = value.reservations[ticket.id];
      if (reserved === undefined) return; // A settled ticket is never refunded twice.
      value.accountedMicros += actualMicros - reserved;
      delete value.reservations[ticket.id];
      await this.saveSearchBudget(ticket.month, value);
    });
  }
  recordSearchCacheHit(
    month: string,
    reserve: number,
    legacyCost: (detail: unknown) => number | undefined,
  ) {
    return this.serializeUsage(async () => {
      const value = await this.readSearchBudget(month, reserve, legacyCost);
      value.cacheHits++;
      await this.saveSearchBudget(month, value);
    });
  }
  async event(kind: string, detail: Record<string, unknown>) {
    const row = await this.db.event.create({ data: { kind, detail: json(detail) } });
    if (row.id % 20 === 0) await this.db.event.deleteMany({ where: { id: { lt: row.id - 1000 } } });
  }
}
