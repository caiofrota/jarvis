import { z } from "zod";
export const personalProviderSchema = z.enum(["google", "microsoft"]);
export type PersonalProvider = z.infer<typeof personalProviderSchema>;
export const integrationApplicationSchema = z
  .object({
    provider: personalProviderSchema,
    clientId: z.string().trim().min(1).max(512),
    clientSecret: z.string().min(1).max(4096).optional(),
  })
  .strict();
export type IntegrationApplication = z.infer<typeof integrationApplicationSchema>;
export type PersonalConnection = {
  id: string;
  provider: PersonalProvider;
  email: string;
  name: string;
  permissions: string[];
  reconnect: boolean;
};
export type IntegrationStatus = {
  callback: string;
  providers: { provider: PersonalProvider; configured: boolean; clientId?: string }[];
  connections: PersonalConnection[];
};
export const mailDraftSchema = z
  .object({
    to: z.array(z.email().max(254)).min(1).max(10),
    subject: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .refine((value) => !/[\r\n]/.test(value)),
    text: z.string().min(1).max(20000),
  })
  .strict();
export const calendarDraftSchema = z
  .object({
    calendarId: z.string().min(1).max(512),
    title: z.string().trim().min(1).max(200),
    start: z.iso.datetime({ offset: true }),
    end: z.iso.datetime({ offset: true }),
  })
  .strict()
  .refine(
    (value) =>
      Date.parse(value.end) > Date.parse(value.start) &&
      Date.parse(value.end) - Date.parse(value.start) <= 31 * 86400000,
    { message: "Confira o início e o fim do compromisso." },
  );
export type PersonalMail = {
  id: string;
  subject: string;
  from: string;
  date: string;
  text?: string;
};
export type PersonalCalendar = { id: string; name: string; writable: boolean };
export type PersonalEvent = { id: string; title: string; start: string; end: string };
export type PersonalProposal = {
  id: string;
  connectionId: string;
  account: string;
  kind: "mail" | "calendar";
  draft: z.infer<typeof mailDraftSchema> | z.infer<typeof calendarDraftSchema>;
};
