import type { Catalog } from "@rosie/types";
import { numericReading, selectResponseRule } from "@rosie/types";
import { DomainError, type TurnContext } from "@rosie/types/context";
import type { Readings } from "../readings/service";
import type { Intent } from "./intents";

export async function prepareIntent(
  intent: Intent,
  c: Catalog,
  ctx: TurnContext,
  readings: Readings,
  signal: AbortSignal,
  now = new Date(),
) {
  const numeric = intent.responseRules.some((r) => r.minValue !== null || r.maxValue !== null);
  try {
    const reading = await readings.read({ intent, catalog: c, context: ctx }, signal);
    const variables = {
      valor: reading?.value ?? "",
      condicao: reading?.condition ?? "",
      nome: reading?.source ?? ctx.assistant.name,
      ambiente: ctx.room.name,
      robo: ctx.assistant.name,
      cidade: ctx.home.city || "cidade não configurada",
      pessoa: ctx.resident?.name ?? "visitante",
    };
    if (numeric && numericReading(variables.valor) === undefined)
      throw new DomainError("O sensor não informou um valor numérico válido agora.");
    const rule = selectResponseRule(
      intent.responseRules,
      {
        timezone: ctx.home.timezone,
        residentId: ctx.resident?.id,
        modeId: ctx.mode?.id,
        value: variables.valor,
      },
      now,
    );
    return {
      intent: rule
        ? {
            ...intent,
            responses: rule.responses,
            instructions: [intent.instructions, rule.instructions].filter(Boolean).join("\n"),
            humor: rule.humor === "inherit" ? intent.humor : rule.humor,
          }
        : intent,
      variables,
      rule: rule?.name,
      error: undefined,
      source: reading?.source,
    };
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    return {
      intent,
      variables: undefined,
      rule: undefined,
      error: error.message,
      source: undefined,
    };
  }
}
