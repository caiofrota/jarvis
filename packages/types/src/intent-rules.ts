import { z } from "zod";

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm.");
const ids = z
  .array(z.string().regex(/^[a-z0-9_-]{1,64}$/))
  .max(100)
  .default([]);
export const responseRuleSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    minValue: z.number().min(-1e9).max(1e9).nullable().default(null),
    maxValue: z.number().min(-1e9).max(1e9).nullable().default(null),
    startTime: time.nullable().default(null),
    endTime: time.nullable().default(null),
    residentIds: ids,
    modeIds: ids,
    responses: z.array(z.string().trim().min(1).max(1000)).max(10).default([]),
    instructions: z.string().trim().max(1000).default(""),
    humor: z.enum(["inherit", "natural", "occasional", "playful"]).default("inherit"),
  })
  .superRefine((v, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });
    if (v.minValue !== null && v.maxValue !== null && v.minValue >= v.maxValue)
      issue("maxValue", "O limite final precisa ser maior que o inicial.");
    if (Boolean(v.startTime) !== Boolean(v.endTime) || (v.startTime && v.startTime === v.endTime))
      issue("endTime", "Informe início e fim diferentes para o horário.");
    if (
      v.minValue === null &&
      v.maxValue === null &&
      !v.startTime &&
      !v.residentIds.length &&
      !v.modeIds.length
    )
      issue("name", "Escolha ao menos uma condição; use a resposta padrão para os demais casos.");
  });
export type ResponseRule = z.infer<typeof responseRuleSchema>;

export function numericReading(value: string | undefined): number | undefined {
  const text = value?.trim().replace(",", ".");
  if (!text || !/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(text)) return undefined;
  const number = Number(text);
  return Number.isFinite(number) && Math.abs(number) <= 1e9 ? number : undefined;
}

export function selectResponseRule(
  rules: ResponseRule[],
  context: { timezone: string; residentId?: string; modeId?: string; value?: string },
  now = new Date(),
) {
  const timeOfDay = new Intl.DateTimeFormat("en-GB", {
    timeZone: context.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
  const value = numericReading(context.value);
  return rules.find((rule) => {
    if (rule.residentIds.length && !rule.residentIds.includes(context.residentId ?? ""))
      return false;
    if (rule.modeIds.length && !rule.modeIds.includes(context.modeId ?? "")) return false;
    if (rule.minValue !== null && (value === undefined || value < rule.minValue)) return false;
    if (rule.maxValue !== null && (value === undefined || value >= rule.maxValue)) return false;
    if (rule.startTime && rule.endTime) {
      const within =
        rule.startTime < rule.endTime
          ? timeOfDay >= rule.startTime && timeOfDay < rule.endTime
          : timeOfDay >= rule.startTime || timeOfDay < rule.endTime;
      if (!within) return false;
    }
    return true;
  });
}
