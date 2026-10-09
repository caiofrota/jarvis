import type { PersonalEvent } from "@rosie/types";

export type AgendaEvent = PersonalEvent & {
  account: string;
  calendar: string;
  calendarId: string;
  calendarPrimary?: boolean;
  calendarSelected?: boolean;
  calendarOwned?: boolean;
};

/** Schedule-based hints, never a guess about the meaning or importance of an event title. */
export function agendaFocus(events: AgendaEvent[], now: number, timezone: string) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
  const active = events.filter(
    (event) =>
      !event.cancelled &&
      !event.declined &&
      (event.allDay
        ? event.end.slice(0, 10) > today
        : Number.isFinite(Date.parse(event.start)) && Date.parse(event.end) > now),
  );
  const personal = (event: AgendaEvent) =>
    event.participation === "organizer" || event.participation === "accepted"
      ? 0
      : event.calendarPrimary || event.calendarOwned
        ? 1
        : event.calendarSelected === true
          ? 2
          : 3;
  const rank = (event: AgendaEvent) => (event.allDay ? 2 : event.busy === false ? 1 : 0);
  const sorted = active
    .filter((event) => event.titleAvailable !== false)
    .sort(
      (a, b) =>
        personal(a) - personal(b) || rank(a) - rank(b) || Date.parse(a.start) - Date.parse(b.start),
    );
  const focus = sorted.slice(0, 3);
  const busy = active.filter(
    (event) => !event.allDay && event.busy !== false && personal(event) <= 1,
  );
  const conflicts: { first: AgendaEvent; second: AgendaEvent }[] = [];
  for (let i = 0; i < busy.length && conflicts.length < 10; i++)
    for (let j = i + 1; j < busy.length && conflicts.length < 10; j++) {
      const a = busy[i],
        b = busy[j];
      if (a.id === b.id && a.start === b.start && a.end === b.end) continue;
      if (
        Date.parse(a.start) < Date.parse(b.end) &&
        Date.parse(b.start) < Date.parse(a.end) &&
        (focus.includes(a) || focus.includes(b))
      )
        conflicts.push({
          first: { ...a, title: a.titleAvailable === false ? "" : a.title },
          second: { ...b, title: b.titleAvailable === false ? "" : b.title },
        });
    }
  return { asOf: new Date(now).toISOString(), timezone, focus, conflicts };
}
