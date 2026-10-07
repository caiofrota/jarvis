import { expressionSchema, normalize } from "@rosie/types";
import type { TurnContext } from "@rosie/types/context";
import { z } from "zod";

const choice = z
  .object({
    value: z.string().regex(/^[a-z0-9_-]{1,40}$/),
    label: z.string().min(1).max(80),
    aliases: z.array(z.string().min(1).max(100)).max(20).default([]),
  })
  .strict();
export const interactionSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
    type: z.enum(["announce", "ask"]),
    text: z.string().trim().min(1).max(1000),
    expression: expressionSchema.default("neutral"),
    expiresAt: z.iso.datetime({ offset: true }),
    timeoutSeconds: z.number().int().min(5).max(120).default(30),
    busyPolicy: z.enum(["queue", "reject"]).default("queue"),
    choices: z
      .array(choice)
      .min(2)
      .max(6)
      .default([
        {
          value: "yes",
          label: "Sim",
          aliases: [
            "sim",
            "pode",
            "pode sim",
            "pode desligar",
            "pode ligar",
            "quero",
            "pode fazer",
            "claro",
          ],
        },
        {
          value: "no",
          label: "Não",
          aliases: ["não", "não quero", "não precisa", "deixa", "agora não"],
        },
      ]),
  })
  .strict()
  .superRefine((v, c) => {
    const values = v.choices.map((x) => x.value);
    if (new Set(values).size !== values.length)
      c.addIssue({
        code: "custom",
        message: "As opções precisam de identificadores diferentes.",
        path: ["choices"],
      });
    const phrases = v.choices.flatMap((x) =>
      [x.label, ...x.aliases]
        .map(normalize)
        .filter(Boolean)
        .map((p) => ({ p, value: x.value })),
    );
    if (phrases.some((a) => phrases.some((b) => a.p === b.p && a.value !== b.value)))
      c.addIssue({
        code: "custom",
        message: "Uma frase não pode indicar duas opções diferentes.",
        path: ["choices"],
      });
  });
export type InteractionRequest = z.infer<typeof interactionSchema>;
export type InteractionOutcome = {
  status:
    | "played"
    | "answered"
    | "timeout"
    | "cancelled"
    | "disconnected"
    | "error"
    | "muted"
    | "quiet"
    | "disabled"
    | "expired"
    | "busy"
    | "duplicate"
    | "invalid";
  choice?: string;
};
export function interactionChoice(text: string, request: InteractionRequest) {
  const clean = normalize(text).replace(/^(?:por favor )|(?: por favor| obrigado| obrigada)$/g, "");
  return request.choices.find((v) => [v.label, ...v.aliases].some((a) => normalize(a) === clean))
    ?.value;
}
export function interactionRestriction(
  ctx: TurnContext,
  now = new Date(),
): InteractionOutcome | undefined {
  const policy = ctx.endpoint.announcements;
  if (!policy.enabled) return { status: "disabled" };
  if (ctx.endpoint.muted || ctx.audio.volume === 0 || policy.volume === 0)
    return { status: "muted" };
  if (policy.quietEnabled) {
    const time = new Intl.DateTimeFormat("en-GB", {
      timeZone: ctx.home.timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(now);
    const quiet =
      policy.quietStart === policy.quietEnd ||
      (policy.quietStart < policy.quietEnd
        ? time >= policy.quietStart && time < policy.quietEnd
        : time >= policy.quietStart || time < policy.quietEnd);
    if (quiet) return { status: "quiet" };
  }
}
