import { json } from "@rosie/db";
import { settingsSchema } from "@rosie/types";
import { context } from "@rosie/types/context";
import { afterEach, expect, it, vi } from "vitest";
import type { CalendarAddon } from "../src/server/addons/calendar";
import { Automations } from "../src/server/automation/service";
import { CalendarConversation } from "../src/server/calendar/conversation";
import { addDays, localDate, zonedTime } from "../src/server/calendar/dates";
import { ResidentCalendars } from "../src/server/calendar/service";
import { CatalogService, queryFrom } from "../src/server/catalog/service";
import { Conversation } from "../src/server/conversation/service";
import { repositoryFixture } from "./fixture";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
async function fixture() {
  const f = await repositoryFixture(),
    catalog = new CatalogService(f.repo);
  await catalog.save("residents", { name: "Caio", homeId: "home" });
  await catalog.save("residents", { name: "Luana", homeId: "home" });
  await f.repo.db.setting.update({
    where: { id: "settings" },
    data: {
      data: json(
        settingsSchema.parse({
          homeAssistantEnabled: true,
          homeAssistantHomeId: "home",
          homeAssistantUrl: "http://127.0.0.1:8123",
          homeAssistantToken: "fixture-token",
          openaiKey: "fixture-key",
        }),
      ),
    },
  });
  const provider = {
    available: vi.fn(() => true),
    discover: vi.fn(async (_home: string) => [
      { id: "calendar.caio", name: "Caio", canCreate: true, available: true },
      { id: "calendar.readonly", name: "Feriados", canCreate: false, available: true },
    ]),
    list: vi.fn(
      async (
        _home: string,
        _entity: string,
        _start: string,
        _end: string,
        _signal: AbortSignal,
      ) => [
        {
          title: "Consulta particular",
          start: "2026-09-26T09:00:00-03:00",
          end: "2026-09-26T10:00:00-03:00",
          allDay: false,
        },
      ],
    ),
    create: vi.fn(
      async (_home, _entity, _draft, signal: AbortSignal, validate: () => Promise<void>) => {
        await validate();
        signal.throwIfAborted();
      },
    ),
  };
  const calendars = new ResidentCalendars(f.repo, () => provider as unknown as CalendarAddon);
  const binding = {
    provider: "home-assistant",
    entityId: "calendar.caio",
    enabled: true,
    allowCreate: true,
  };
  await calendars.save("caio", binding, null);
  const c = await f.repo.catalog(),
    ctx = context(c, "one", "caio"),
    signal = new AbortController().signal;
  const conversation = new CalendarConversation(calendars);
  const tomorrow = addDays(localDate(new Date(), ctx.home.timezone), 1);
  const args = {
    action: "create",
    fromDate: tomorrow,
    toDate: null,
    title: "Dentista",
    startTime: "09:00",
    endTime: null,
    allDay: false,
  };
  return { ...f, catalog, provider, calendars, binding, ctx, signal, conversation, args, c };
}
it("keeps a resident calendar private and prevents cross-home, unknown or disabled access", async () => {
  const f = await fixture();
  try {
    expect((await f.calendars.status("caio")).binding?.entityId).toBe("calendar.caio");
    expect((await f.calendars.status("luana")).binding).toBeNull();
    await expect(f.calendars.access(context(f.c, "one", null))).rejects.toThrow(/identificar/);
    await expect(f.calendars.access(context(f.c, "one", "luana"))).rejects.toThrow(
      /não está habilitada/,
    );
    await expect(
      f.calendars.access({ ...f.ctx, home: { ...f.ctx.home, id: "foreign" } }),
    ).rejects.toThrow();
    expect(f.provider.list).not.toHaveBeenCalled();
    await expect(
      f.calendars.save("luana", { ...f.binding, entityId: "light.office" }, null),
    ).rejects.toThrow();
    await expect(
      f.calendars.save("luana", { ...f.binding, entityId: "calendar.readonly" }, null),
    ).rejects.toThrow(/apenas consulta/);
    const stored = await f.repo.db.entry.findUniqueOrThrow({
      where: { collection_id: { collection: "residents", id: "caio" } },
    });
    await f.catalog.remove("residents", "caio", stored.revision);
    expect(await f.repo.db.setting.findUnique({ where: { id: "calendar:caio" } })).toBeNull();
    expect(
      JSON.stringify((await f.catalog.list("residents", queryFrom(new URLSearchParams()))).items),
    ).not.toContain("fixture-token");
  } finally {
    await f.close();
  }
});
it("creates only after one matching confirmation and does not reuse consent", async () => {
  const f = await fixture();
  try {
    const reply = await f.conversation.run("one", f.args, f.ctx, f.signal);
    expect(reply).toContain("agenda de Caio");
    expect(reply).toContain("09:00 às 10:00");
    expect(f.provider.create).not.toHaveBeenCalled();
    expect(
      await f.conversation.answer("two", "sim", context(f.c, "two", "caio"), f.signal),
    ).toBeNull();
    expect(await f.conversation.answer("one", "pode salvar", f.ctx, f.signal)).toContain("criado");
    expect(f.provider.create).toHaveBeenCalledTimes(1);
    expect(f.provider.create.mock.calls[0][1]).toBe("calendar.caio");
    expect(await f.conversation.answer("one", "sim", f.ctx, f.signal)).toContain("Não há");
    expect(await f.conversation.answer("one", "não", f.ctx, f.signal)).toBe(
      "Não há um pedido de agenda aguardando confirmação.",
    );
    expect(f.provider.create).toHaveBeenCalledTimes(1);
    const events = await f.repo.db.event.findMany();
    expect(JSON.stringify(events)).not.toContain("Dentista");
  } finally {
    await f.close();
  }
});
it.each(["refusal", "reset", "other-request", "expiry", "speaker", "binding", "home", "uncertain"])(
  "invalidates calendar confirmation after %s",
  async (reason) => {
    const f = await fixture();
    try {
      await f.conversation.run("one", f.args, f.ctx, f.signal);
      let ctx = f.ctx;
      if (reason === "refusal") await f.conversation.answer("one", "não", ctx, f.signal);
      if (reason === "reset") f.conversation.reset("one");
      if (reason === "other-request")
        await f.conversation.answer("one", "acenda a luz", ctx, f.signal);
      if (reason === "expiry") {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(Date.now() + 61000);
      }
      if (reason === "speaker") ctx = context(f.c, "one", "luana");
      if (reason === "home") ctx = { ...ctx, home: { ...ctx.home, id: "foreign" } };
      if (reason === "binding") {
        const current = await f.calendars.status("caio");
        await f.calendars.save("caio", { ...f.binding, allowCreate: false }, current.revision);
      }
      if (reason === "uncertain")
        f.provider.create.mockRejectedValueOnce(new Error("unknown delivery"));
      try {
        await f.conversation.answer("one", "sim", ctx, f.signal);
      } catch {
        /* Delivery ambiguity remains terminal. */
      }
      await f.conversation.answer("one", "sim", ctx, f.signal);
      expect(f.provider.create).toHaveBeenCalledTimes(reason === "uncertain" ? 1 : 0);
    } finally {
      await f.close();
    }
  },
);
it("checks calendar changes again immediately before dispatch and permits disabling while offline", async () => {
  const f = await fixture();
  try {
    await f.conversation.run("one", f.args, f.ctx, f.signal);
    let dispatched = false;
    f.provider.create.mockImplementationOnce(async (_h, _e, _d, signal, validate) => {
      const current = await f.calendars.status("caio");
      await f.calendars.save("caio", { ...f.binding, allowCreate: false }, current.revision);
      await validate();
      signal.throwIfAborted();
      dispatched = true;
    });
    await expect(f.conversation.answer("one", "sim", f.ctx, f.signal)).rejects.toThrow(/mudou/);
    expect(dispatched).toBe(false);
    const status = await f.calendars.status("caio");
    f.provider.available.mockReturnValue(false);
    f.provider.discover.mockRejectedValue(new Error("offline"));
    expect(
      (await f.calendars.save("caio", { ...f.binding, enabled: false }, status.revision)).binding
        ?.enabled,
    ).toBe(false);
    await expect(f.calendars.save("caio", f.binding, status.revision)).rejects.toThrow(/alterada/);
  } finally {
    await f.close();
  }
});
it("handles local queries without an LLM and does not include private calendar data in model history", async () => {
  const f = await fixture(),
    automations = new Automations(f.repo);
  try {
    vi.spyOn(automations.addons.calendar, "available").mockReturnValue(true);
    vi.spyOn(automations.addons.calendar, "list").mockImplementation(f.provider.list);
    const conversation = new Conversation(f.repo, automations);
    const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  text: "Olá!",
                  expression: "happy",
                  serious: false,
                  intentId: null,
                  parameters: {},
                }),
              },
            },
          ],
          usage: {},
        }),
      ),
    );
    const reply = await conversation.respond("one", "qual é minha agenda hoje?", f.signal, "caio");
    expect(reply.text).toContain("Consulta particular");
    expect(request).not.toHaveBeenCalled();
    await conversation.respond("one", "vamos conversar", f.signal, "caio");
    expect(JSON.stringify(request.mock.calls)).not.toContain("Consulta particular");
    expect(f.provider.list.mock.calls[0][1]).toBe("calendar.caio");
  } finally {
    automations.close();
    await f.close();
  }
});
it("requires date and time clarity and bounds calendar ranges", async () => {
  const f = await fixture();
  try {
    await expect(
      f.conversation.run("one", { ...f.args, startTime: null }, f.ctx, f.signal),
    ).rejects.toThrow(/horas/);
    await expect(
      f.conversation.run("one", { ...f.args, fromDate: "2026-02-30" }, f.ctx, f.signal),
    ).rejects.toThrow();
    await expect(
      f.conversation.run(
        "one",
        { ...f.args, action: "list", toDate: addDays(f.args.fromDate, 35) },
        f.ctx,
        f.signal,
      ),
    ).rejects.toThrow(/31 dias/);
    await f.conversation.run("one", { ...f.args, allDay: true, startTime: null }, f.ctx, f.signal);
    await f.conversation.answer("one", "sim", f.ctx, f.signal);
    expect(f.provider.create.mock.calls[0][2]).toMatchObject({
      start: f.args.fromDate,
      end: addDays(f.args.fromDate, 1),
      allDay: true,
    });
  } finally {
    await f.close();
  }
});
it.each([false, true])(
  "routes an extracted calendar proposal through confirmation and rejects mixed tools (mixed=%s)",
  async (mixed) => {
    const f = await fixture(),
      automations = new Automations(f.repo);
    try {
      vi.spyOn(automations.addons.calendar, "available").mockReturnValue(true);
      vi.spyOn(automations.addons.calendar, "create").mockImplementation(f.provider.create);
      const control = vi.spyOn(automations, "executePlan");
      const conversation = new Conversation(f.repo, automations);
      const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: "tool_calls",
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: "calendar-proposal",
                      type: "function",
                      function: { name: "resident_calendar", arguments: JSON.stringify(f.args) },
                    },
                    ...(mixed
                      ? [
                          {
                            id: "home-call",
                            type: "function",
                            function: { name: "control_home", arguments: "{}" },
                          },
                        ]
                      : []),
                  ],
                },
              },
            ],
            usage: {},
          }),
        ),
      );
      const reply = await conversation.respond(
        "one",
        "Crie um compromisso chamado dentista amanhã às nove",
        f.signal,
        "caio",
      );
      expect(reply.text).toContain(mixed ? "separadamente" : "Posso criar Dentista");
      expect(f.provider.create).not.toHaveBeenCalled();
      expect(control).not.toHaveBeenCalled();
      if (!mixed) {
        const result = await conversation.respond("one", "sim", f.signal, "caio");
        expect(result.text).toContain("criado");
        expect(f.provider.create).toHaveBeenCalledTimes(1);
        expect(request).toHaveBeenCalledTimes(1);
      }
    } finally {
      automations.close();
      await f.close();
    }
  },
);
it("resolves the home timezone and rejects invalid or ambiguous DST times", () => {
  expect(zonedTime("2026-09-26", "09:00", "America/Fortaleza")).toBe("2026-09-26T12:00:00.000Z");
  expect(localDate(new Date("2026-09-26T01:00:00Z"), "America/Fortaleza")).toBe("2026-09-25");
  expect(() => zonedTime("2026-03-08", "02:30", "America/New_York")).toThrow(/inexistente/);
  expect(() => zonedTime("2026-11-01", "01:30", "America/New_York")).toThrow(/ambíguo/);
});
