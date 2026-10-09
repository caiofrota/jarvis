import { z } from "zod";

export const calendarBindingSchema = z.object({
  provider: z.literal("home-assistant").default("home-assistant"),
  entityId: z.string().regex(/^calendar\.[a-z0-9_]{1,150}$/),
  enabled: z.boolean(),
  allowCreate: z.boolean(),
});
export type CalendarBinding = z.infer<typeof calendarBindingSchema>;
export type CalendarOption = { id: string; name: string; canCreate: boolean; available: boolean };
export type ResidentCalendarStatus = {
  binding: CalendarBinding | null;
  revision: string | null;
  connected: boolean;
  options: CalendarOption[];
  setupUrl: string | null;
  message: string;
};
export type CalendarEvent = { title: string; start: string; end: string; allDay: boolean };
export type CalendarDraft = { title: string; start: string; end: string; allDay: boolean };
