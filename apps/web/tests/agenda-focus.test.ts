import { expect, it } from "vitest";
import { type AgendaEvent, agendaFocus } from "../src/server/personal/agenda-focus";

const now = Date.parse("2026-10-09T12:00:00-03:00");
function event(id: string, fields: Partial<AgendaEvent> = {}): AgendaEvent {
  return {
    id,
    title: id,
    start: "2026-10-09T14:00:00-03:00",
    end: "2026-10-09T15:00:00-03:00",
    account: "owner@example.test",
    calendar: "Calendário",
    calendarId: "cal",
    busy: true,
    titleAvailable: true,
    ...fields,
  };
}
it("selects personal commitments rather than reciting ongoing public calendars and unnamed blocks", () => {
  const result = agendaFocus(
    [
      event("Public exhibition", {
        start: "2026-10-09T08:00:00-03:00",
        end: "2026-10-09T22:00:00-03:00",
      }),
      event("Global week", { start: "2026-10-04", end: "2026-10-11", allDay: true }),
      event("Untitled", { titleAvailable: false, calendarPrimary: true }),
      event("Lab sync", { participation: "accepted" }),
      event("Therapy", {
        calendarOwned: true,
        start: "2026-10-09T15:00:00-03:00",
        end: "2026-10-09T16:00:00-03:00",
      }),
      event("Book release", {
        calendarPrimary: true,
        start: "2026-10-09T19:00:00-03:00",
        end: "2026-10-09T20:00:00-03:00",
      }),
    ],
    now,
    "America/Fortaleza",
  );
  expect(result.focus.map((e) => e.id)).toEqual(["Lab sync", "Therapy", "Book release"]);
  expect(
    result.conflicts.some((c) => c.second.id === "Untitled" || c.first.id === "Untitled"),
  ).toBe(true);
});
it("keeps anonymous availability but excludes declined, cancelled, expired and transparent conflicts", () => {
  const result = agendaFocus(
    [
      event("Meeting", { participation: "organizer" }),
      event("Anonymous", { titleAvailable: false, calendarPrimary: true }),
      event("Not busy", { busy: false }),
      event("Declined", { declined: true }),
      event("Cancelled", { cancelled: true }),
      event("Past", { start: "2026-10-09T08:00:00-03:00", end: "2026-10-09T09:00:00-03:00" }),
    ],
    now,
    "America/Fortaleza",
  );
  expect(result.focus.map((e) => e.id)).toEqual(["Meeting", "Not busy"]);
  expect(result.conflicts).toHaveLength(1);
  expect(result.conflicts[0].second.id).toBe("Anonymous");
});
it("compares instants across timezones and applies exclusive all-day dates in the reference timezone", () => {
  const result = agendaFocus(
    [
      event("Elsewhere", { start: "2026-10-09T18:00:00+08:00", end: "2026-10-09T19:00:00+08:00" }),
      event("Today", { allDay: true, start: "2026-10-09", end: "2026-10-10", calendarOwned: true }),
    ],
    Date.parse("2026-10-10T00:30:00Z"),
    "America/Fortaleza",
  );
  expect(result.focus.map((e) => e.id)).toEqual(["Today"]);
});
