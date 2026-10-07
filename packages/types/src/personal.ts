import { z } from "zod";
import { companionProfileSchema } from "./companion";
export const personalAssistantSchema = companionProfileSchema.extend({ id: z.string().uuid() });
export const sharedAssistantSchema = companionProfileSchema.extend({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
});
export type SharedAssistant = z.infer<typeof sharedAssistantSchema>;
export const personalProfileSchema = z
  .object({
    email: z.union([z.email().max(254), z.literal("")]).default(""),
    assistants: z.array(personalAssistantSchema).max(20).default([]),
    defaultAssistantId: z.string().uuid().nullable().default(null),
    defaultSharedAssistantId: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,64}$/)
      .nullable()
      .default(null),
  })
  .strict()
  .superRefine((profile, context) => {
    if (profile.defaultAssistantId && profile.defaultSharedAssistantId)
      context.addIssue({
        code: "custom",
        path: ["defaultSharedAssistantId"],
        message: "Escolha somente um assistente padrão.",
      });
    if (
      new Set(profile.assistants.map((assistant) => assistant.id)).size !==
      profile.assistants.length
    )
      context.addIssue({
        code: "custom",
        path: ["assistants"],
        message: "Os identificadores dos assistentes devem ser únicos.",
      });
    if (
      profile.defaultAssistantId &&
      !profile.assistants.some((assistant) => assistant.id === profile.defaultAssistantId)
    )
      context.addIssue({
        code: "custom",
        path: ["defaultAssistantId"],
        message: "Escolha um dos seus assistentes como padrão.",
      });
  });
export type PersonalProfile = z.infer<typeof personalProfileSchema>;
export type PersonalAssistant = z.infer<typeof personalAssistantSchema>;
export const savePersonalProfileSchema = z
  .object({ profile: personalProfileSchema, revision: z.string().uuid().nullable() })
  .strict();
export type PersonalProfileStatus = { profile: PersonalProfile; revision: string | null };
