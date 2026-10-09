import { z } from "zod";

export const companionProfileSchema = z.object({
  name: z.string().trim().min(1).max(100).default("Jarvis"),
  worldview: z.string().trim().max(1500).default(""),
  facts: z.string().max(3000).default(""),
  personality: z
    .string()
    .max(3000)
    .default(
      "Você é um companion pessoal, prestativo e direto. Converse naturalmente e nunca invente ações executadas.",
    ),
  provider: z.enum(["openai", "deepseek"]).default("openai"),
  model: z.string().trim().min(1).max(100).default("gpt-4o-mini"),
  voice: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,100}$/)
    .default("kokoro-pf_dora"),
  quality: z.enum(["fast", "detailed"]).default("fast"),
  maxOutputTokens: z.number().int().min(64).max(1000).default(500),
  historyTurns: z.number().int().min(0).max(12).default(6),
});
export type CompanionProfile = z.infer<typeof companionProfileSchema>;
export const companionSelectionSchema = z.object({
  sessionId: z.string().uuid(),
  assistantId: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{1,64}$/)
    .nullable()
    .default(null),
  areaId: z.string().max(200).nullable().default(null),
});
export type CompanionSelection = z.infer<typeof companionSelectionSchema>;
export const companionComputerSchema = z
  .object({
    clientId: z.string().uuid(),
    targets: z
      .array(
        z
          .object({
            id: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
            label: z
              .string()
              .trim()
              .min(1)
              .max(200)
              .regex(/^[^\p{Cc}]+$/u),
            kind: z.enum(["app", "folder"]),
          })
          .strict(),
      )
      .max(600),
  })
  .strict()
  .refine(
    (value) => new Set(value.targets.map((target) => target.id)).size === value.targets.length,
    "O catálogo tem identificadores repetidos.",
  );
export type CompanionComputerCatalog = z.infer<typeof companionComputerSchema>;
export const companionComputerResultSchema = companionSelectionSchema
  .extend({
    requestId: z.string().uuid(),
    clientId: z.string().uuid(),
    status: z.enum(["sent", "cancelled", "failed"]),
  })
  .strict();
export const companionMessageSchema = companionSelectionSchema.extend({
  text: z.string().trim().min(1).max(4000),
  computer: companionComputerSchema.optional(),
});
export type CompanionMessageInput = z.infer<typeof companionMessageSchema>;
export const companionAudioSchema = companionSelectionSchema.extend({
  computer: companionComputerSchema.optional(),
  audio: z
    .string()
    .min(1)
    .max(900000)
    .regex(/^[A-Za-z0-9+/]*={0,2}$/),
});
export const companionSpeechSchema = companionSelectionSchema.extend({
  text: z.string().trim().min(1).max(4000),
  voice: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,100}$/)
    .optional(),
});

export const companionComputerOfferSchema = z
  .object({
    requestId: z.string().uuid(),
    clientId: z.string().uuid(),
    id: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
    label: z.string().min(1).max(200),
    newInstance: z.boolean(),
    expires: z.number().finite(),
  })
  .strict();
export type CompanionComputerOffer = z.infer<typeof companionComputerOfferSchema>;
