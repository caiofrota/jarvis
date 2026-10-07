import type { CalendarDraft, CalendarEvent, Settings } from "@rosie/types";
import type { Addon } from "./contract";
import type { HomeAssistantAddon } from "./home-assistant";

// The HA provider owns Google OAuth. Resident authorization stays in the domain.
export class CalendarAddon implements Addon {
  readonly id = "calendar";
  readonly capabilities = ["calendar"] as const;
  constructor(private ha: HomeAssistantAddon) {}
  async configure(_settings: Settings) {}
  close() {}
  available() {
    return this.ha.status().ready;
  }
  discover(homeId: string) {
    return this.ha.calendars(homeId);
  }
  list(
    homeId: string,
    entityId: string,
    start: string,
    end: string,
    signal: AbortSignal,
  ): Promise<CalendarEvent[]> {
    signal.throwIfAborted();
    return this.ha.calendarEvents(homeId, entityId, start, end);
  }
  async create(
    homeId: string,
    entityId: string,
    draft: CalendarDraft,
    signal: AbortSignal,
    validate: () => Promise<void>,
  ) {
    signal.throwIfAborted();
    await this.ha.createCalendarEvent(homeId, entityId, draft, signal, validate);
  }
}
