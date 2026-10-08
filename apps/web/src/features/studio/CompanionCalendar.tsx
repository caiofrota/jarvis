"use client";
import type { IntegrationStatus, PersonalCalendar, PersonalEvent } from "@rosie/types";
import { useEffect, useState } from "react";
import { request } from "../../lib/api-client";
export function CompanionCalendar() {
  const [connections, setConnections] = useState<IntegrationStatus["connections"]>([]);
  const [connection, setConnection] = useState("");
  const [calendars, setCalendars] = useState<PersonalCalendar[]>([]);
  const [calendar, setCalendar] = useState("");
  const [events, setEvents] = useState<PersonalEvent[]>([]);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(true);
  useEffect(() => {
    const abort = new AbortController();
    setBusy(true);
    setError("");
    const path = connection
      ? `/personal-integrations/connections/${connection}/${calendar ? `events?id=${encodeURIComponent(calendar)}` : "calendars"}`
      : "/personal-integrations";
    void request<IntegrationStatus | PersonalCalendar[] | PersonalEvent[]>(path, {
      signal: abort.signal,
    })
      .then((data) => {
        if (!connection) setConnections((data as IntegrationStatus).connections);
        else if (!calendar) setCalendars(data as PersonalCalendar[]);
        else setEvents(data as PersonalEvent[]);
      })
      .catch((cause) => {
        if (!abort.signal.aborted) setError(cause.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setBusy(false);
      });
    return () => abort.abort();
  }, [connection, calendar]);
  const today = new Date();
  return (
    <div className="panel-body companion-calendar">
      <div className="calendar-date">
        <span className="date-big">{today.getDate()}</span>
        <div className="date-meta">
          <strong>{today.toLocaleDateString("pt-BR", { weekday: "long" })}</strong>
          {today.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}
        </div>
      </div>
      {error && (
        <p className="feature-error" role="alert">
          {error}
        </p>
      )}
      {busy && <p role="status">Carregando agenda…</p>}
      {!connections.length && !busy && (
        <p className="empty">
          Conecte seu calendário em{" "}
          <a href="/integrations" target="_blank" rel="noreferrer">
            Minhas contas
          </a>
          .
        </p>
      )}
      {connections.length > 0 && (
        <label>
          Conta
          <select
            value={connection}
            onChange={(event) => {
              setConnection(event.target.value);
              setCalendar("");
              setCalendars([]);
              setEvents([]);
            }}
          >
            <option value="">Selecione sua conta</option>
            {connections.map((value) => (
              <option key={value.id} value={value.id}>
                {value.email}
              </option>
            ))}
          </select>
        </label>
      )}
      {calendars.length > 0 && (
        <label>
          Calendário
          <select
            value={calendar}
            onChange={(event) => {
              setCalendar(event.target.value);
              setEvents([]);
            }}
          >
            <option value="">Selecione seu calendário</option>
            {calendars.map((value) => (
              <option key={value.id} value={value.id}>
                {value.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {calendar && !busy && !events.length && !error && (
        <p className="empty">Nenhum evento neste período.</p>
      )}
      {events.map((event) => (
        <div className="event" key={event.id}>
          <time>
            {new Date(event.start).toLocaleString("pt-BR", {
              day: "2-digit",
              month: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </time>
          <div>
            <strong>{event.title}</strong>
          </div>
        </div>
      ))}
    </div>
  );
}
