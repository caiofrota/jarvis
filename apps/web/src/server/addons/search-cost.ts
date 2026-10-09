import { z } from "zod";

// USD micros, standard GPT-4.1-mini rates checked 2026-09-23. Cached-token discounts are ignored.
export const SEARCH_RESERVATION_MICROS = 65_000;
export const searchUsageSchema = z.object({
  input_tokens: z.number().int().nonnegative().max(128000),
  output_tokens: z.number().int().nonnegative().max(1000),
  total_tokens: z.number().int().nonnegative().optional(),
});
export function searchCostMicros(usage: unknown): number | undefined {
  const parsed = searchUsageSchema.safeParse(usage);
  if (!parsed.success) return undefined;
  // The tool's 8k search-content block is included in reported input usage.
  return (
    10_000 +
    Math.ceil(Math.max(8000, parsed.data.input_tokens) * 0.4) +
    Math.ceil(parsed.data.output_tokens * 1.6)
  );
}
export function legacySearchCost(detail: unknown): number | undefined {
  return searchCostMicros(z.object({ usage: z.unknown() }).safeParse(detail).data?.usage);
}
