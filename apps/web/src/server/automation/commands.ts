import { normalize } from "@rosie/types";
import { DomainError } from "@rosie/types/context";
import { z } from "zod";
import { maskTemperatureCommands } from "./temperature";

export const commandSchema = z
  .object({
    target: z.string().min(1).max(100),
    action: z.string().min(1).max(40),
    room: z.string().max(100).nullable(),
    routine: z.boolean(),
    delaySeconds: z.number().int().min(0).max(3600),
    temperature: z.number().finite().min(-100).max(100).nullable().optional(),
  })
  .strict();
export const planSchema = z.object({ steps: z.array(commandSchema).min(1).max(8) }).strict();
export type Command = z.infer<typeof commandSchema>;

const numbers: Record<string, number> = {
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
  onze: 11,
  doze: 12,
  treze: 13,
  quatorze: 14,
  catorze: 14,
  quinze: 15,
  dezesseis: 16,
  dezessete: 17,
  dezoito: 18,
  dezenove: 19,
  vinte: 20,
  trinta: 30,
  quarenta: 40,
  cinquenta: 50,
  sessenta: 60,
  setenta: 70,
  oitenta: 80,
  noventa: 90,
  cem: 100,
};
const numberWord = `(?:${Object.keys(numbers).join("|")})`;
const amount = `(?:\\d+|${numberWord}(?: e ${numberWord})?)`;
const duration = new RegExp(`\\b(${amount}) (segundos?|minutos?|horas?)\\b`, "g");
const timingWords =
  /\b(depois|apos|daqui|durante|segundos?|minutos?|horas?|amanha|hoje|quando|ate|as \d+|em \d+)\b/;
const actionWords =
  /\b(liga|ligue|ligar|ligado|acende|acenda|acender|acesa|apaga|apague|apagar|desliga|desligue|desligar|ativa|ative|ativar)\b/;

export function commandTiming(text: string) {
  const phrase = maskTemperatureCommands(text),
    durations = [...phrase.matchAll(duration)].map(
      (match) =>
        (Number(match[1]) ||
          match[1].split(" e ").reduce((sum, word) => sum + (numbers[word] ?? 0), 0)) *
        (match[2].startsWith("hora") ? 3600 : match[2].startsWith("minuto") ? 60 : 1),
    ),
    temporal = timingWords.test(phrase);
  return { temporal, durations, automation: actionWords.test(phrase) };
}
export function timingClarification(text: string) {
  const { temporal, durations, automation } = commandTiming(text);
  if (!temporal || !automation) return null;
  if (!durations.length)
    return "Qual é o intervalo, em segundos ou minutos? Ainda não enviei nenhum comando.";
  if (durations.some((n) => n < 1) || durations.reduce((a, b) => a + b, 0) > 3600)
    return "Use intervalos positivos que somem até uma hora. Ainda não enviei nenhum comando.";
  // Reject formats whose timing cannot be preserved instead of silently simplifying them.
  const rest = maskTemperatureCommands(text).replace(duration, "TEMPO");
  if (
    /\b(amanha|hoje|quando|ate|meio|meia|menos|cento|duzentos|trezentos|mil|as \d|ou)\b|\d/.test(
      rest,
    ) ||
    /-\d/.test(normalize(text))
  )
    return "Diga um intervalo exato, por exemplo: acenda a luz e apague depois de cinco segundos. Ainda não enviei nenhum comando.";
  return null;
}
export function validatePlanTiming(text: string, steps: Command[]) {
  const clarification = timingClarification(text);
  if (clarification) throw new DomainError(clarification);
  const requested = commandTiming(text),
    planned = steps.map((step) => step.delaySeconds).filter((seconds) => seconds > 0);
  if (
    JSON.stringify(requested.durations) !== JSON.stringify(planned) ||
    (requested.temporal && !planned.length)
  )
    throw new DomainError(
      "Não consegui preservar os intervalos do pedido. Nenhum comando foi enviado; diga o tempo e a ação de cada etapa.",
    );
}
export function timerCancellation(text: string) {
  return /^(?:por favor )?(?:cancela|cancele|cancelar|remove|remova) (?:o |os |todos os |meus )?(?:temporizador|temporizadores|agendamento|agendamentos)(?: por favor)?$/.test(
    normalize(text),
  );
}
