import { z } from "zod";

export const webSourceSchema = z.object({
  title: z.string().min(1).max(300),
  url: z
    .string()
    .url()
    .max(2000)
    .refine((value) => {
      const url = new URL(value);
      return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password;
    }),
});
export const webReferencesSchema = z.object({
  sources: z.array(webSourceSchema).min(1).max(12),
  checkedAt: z.string().datetime(),
  cache: z.enum(["fresh", "hit", "shared"]).optional(),
  expiresAt: z.string().datetime().optional(),
});
export type WebReferences = z.infer<typeof webReferencesSchema>;
export type WebSearchPeriod = { from: string; to: string };
export type WebSearchStatus = {
  enabled: boolean;
  configured: boolean;
  budgetUsd: number;
  accountedUsd: number;
  reservedUsd: number;
  remainingUsd: number;
  requests: number;
  cacheHits: number;
  cacheEntries: number;
  cacheEnabled: boolean;
  month: string;
  timezone: string;
};

export const searchBudgetSchema = z
  .object({
    accountedMicros: z.number().int().nonnegative().safe(),
    requests: z.number().int().nonnegative().safe(),
    cacheHits: z.number().int().nonnegative().safe(),
    reservations: z.record(z.string(), z.number().int().nonnegative().safe()),
  })
  .refine(
    (value) =>
      Object.values(value.reservations).reduce((sum, amount) => sum + amount, 0) <=
      value.accountedMicros,
    "Reservations exceed accounted search spend",
  );
export type SearchBudget = z.infer<typeof searchBudgetSchema>;
