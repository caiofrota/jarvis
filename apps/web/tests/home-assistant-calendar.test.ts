import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { settingsSchema } from "@rosie/types";
import { expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { HomeAssistantAddon } from "../src/server/addons/home-assistant";

it("uses registered Google calendars, bounded event reads and a single confirmed creation", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("port");
  const calls: Record<string, unknown>[] = [];
  let broken = false;
  server.on("connection", (ws) => {
    ws.send(JSON.stringify({ type: "auth_required" }));
    ws.on("message", (data) => {
      const message = JSON.parse(data.toString());
      calls.push(message);
      if (message.type === "auth") {
        ws.send(JSON.stringify({ type: "auth_ok" }));
        return;
      }
      if (message.service === "create_event" && broken) {
        ws.terminate();
        return;
      }
      const registry = [
        { entity_id: "calendar.caio", platform: "google" },
        { entity_id: "calendar.local", platform: "local_calendar" },
      ];
      const state = {
        entity_id: "calendar.caio",
        state: "off",
        attributes: { friendly_name: "Agenda Caio", supported_features: 1 },
        last_updated: new Date().toISOString(),
      };
      const values: Record<string, unknown> = {
        get_states: [state, { ...state, entity_id: "calendar.local" }],
        "config/entity_registry/list": registry,
      };
      const result =
        message.service === "get_events"
          ? {
              response: {
                "calendar.caio": {
                  events: [
                    {
                      summary: "Dentista",
                      start: "2026-09-26T09:00:00-03:00",
                      end: "2026-09-26T10:00:00-03:00",
                    },
                    { summary: "Feriado", start: "2026-09-26", end: "2026-09-27" },
                  ],
                },
              },
            }
          : (values[message.type] ?? null);
      ws.send(JSON.stringify({ type: "result", id: message.id, success: true, result }));
    });
  });
  const addon = new HomeAssistantAddon(),
    signal = new AbortController().signal;
  const draft = {
    title: "Dentista",
    start: "2026-09-26T12:00:00Z",
    end: "2026-09-26T13:00:00Z",
    allDay: false,
  };
  try {
    await addon.configure(
      settingsSchema.parse({
        homeAssistantEnabled: true,
        homeAssistantHomeId: "home",
        homeAssistantUrl: `http://127.0.0.1:${address.port}`,
        homeAssistantToken: "fixture",
      }),
    );
    for (let i = 0; i < 100 && !addon.status().ready; i++) await delay(10);
    expect(await addon.calendars("home")).toEqual([
      { id: "calendar.caio", name: "Agenda Caio", available: true, canCreate: true },
    ]);
    await expect(addon.calendars("other")).rejects.toThrow(/outra casa/);
    const events = await addon.calendarEvents("home", "calendar.caio", draft.start, draft.end);
    expect(events.map((v) => v.allDay)).toEqual([false, true]);
    expect(calls.find((v) => v.service === "get_events")).toMatchObject({
      return_response: true,
      target: { entity_id: "calendar.caio" },
    });
    await expect(
      addon.createCalendarEvent("home", "calendar.local", draft, signal, async () => {}),
    ).rejects.toThrow(/indisponível/);
    const abort = new AbortController();
    await expect(
      addon.createCalendarEvent("home", "calendar.caio", draft, abort.signal, async () => {
        abort.abort();
      }),
    ).rejects.toThrow();
    expect(calls.filter((v) => v.service === "create_event")).toHaveLength(0);
    await addon.createCalendarEvent("home", "calendar.caio", draft, signal, async () => {});
    expect(calls.filter((v) => v.service === "create_event")).toEqual([
      expect.objectContaining({
        target: { entity_id: "calendar.caio" },
        service_data: {
          summary: "Dentista",
          start_date_time: draft.start,
          end_date_time: draft.end,
        },
      }),
    ]);
    broken = true;
    await expect(
      addon.createCalendarEvent("home", "calendar.caio", draft, signal, async () => {}),
    ).rejects.toThrow(/Não vou repeti/);
    expect(calls.filter((v) => v.service === "create_event")).toHaveLength(2);
  } finally {
    addon.close();
    for (const ws of server.clients) ws.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
