import type { Account, PersonalProvider } from "@rosie/types";
import { expect, it, vi } from "vitest";
import { Accounts } from "../src/server/auth/accounts";
import { PersonalProviderClient, providers } from "../src/server/personal/providers";
import { PersonalIntegrations } from "../src/server/personal/service";
import { repositoryFixture } from "./fixture";

async function fixture() {
  const f = await repositoryFixture(),
    accounts = new Accounts(f.repo.db);
  const admin = await accounts.bootstrap({
    username: "admin",
    name: "Admin",
    password: "fixture-password",
    role: "admin",
    enabled: true,
  });
  const partner = await accounts.save(admin as Account, {
    username: "partner",
    name: "Partner",
    password: "fixture-password",
    role: "member",
    enabled: true,
  });
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    const data = url.includes("/token")
      ? {
          access_token: "fixture-access",
          refresh_token: "fixture-refresh",
          token_type: "Bearer",
          expires_in: 3600,
        }
      : url.includes("userinfo")
        ? { id: "google-subject", email: "owner@example.test", verified_email: true }
        : url.includes("/me?$select")
          ? { id: "microsoft-subject", mail: "owner@outlook.test", displayName: "Owner" }
          : url.includes("calendarList")
            ? { items: [{ id: "primary", summary: "Personal", accessRole: "owner" }] }
            : url.includes("/calendars?")
              ? { value: [{ id: "primary", name: "Personal", canEdit: true }] }
              : url.includes("messages?")
                ? { messages: [] }
                : { id: "created" };
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  const service = new PersonalIntegrations(
    f.repo,
    "https://jarvis.example.test",
    "fixture-encryption-key",
    new PersonalProviderClient(fetcher),
  );
  async function connect(owner: string, provider: PersonalProvider = "google") {
    await service.configure(admin.id, {
      provider,
      clientId: `${provider}-client`,
      clientSecret: "fixture-secret",
    });
    const authorization = new URL((await service.begin(owner, provider)).url);
    expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
    const callback = new URL(service.callback);
    callback.search = new URLSearchParams({
      state: authorization.searchParams.get("state") ?? "",
      code: "fixture-code",
    }).toString();
    const continuation = await service.callbackResult(callback);
    return { continuation, callback };
  }
  return { ...f, admin, partner, fetcher, service, connect };
}
it("connects both providers privately, encrypts credentials, rejects OAuth replay and foreign identity linking", async () => {
  const f = await fixture();
  try {
    const google = await f.connect(f.admin.id);
    await expect(f.service.finish(f.partner.id, google.continuation)).rejects.toThrow(
      "não pertence",
    );
    await f.service.finish(f.admin.id, google.continuation);
    await expect(f.service.finish(f.admin.id, google.continuation)).rejects.toThrow("expirou");
    await expect(f.service.callbackResult(google.callback)).rejects.toThrow("expirou");
    const microsoft = await f.connect(f.admin.id, "microsoft");
    await f.service.finish(f.admin.id, microsoft.continuation);
    const status = await f.service.status(f.admin.id, true);
    expect(status.connections.map((value) => value.provider).sort()).toEqual([
      "google",
      "microsoft",
    ]);
    expect((await f.service.status(f.partner.id)).connections).toEqual([]);
    expect(JSON.stringify(status)).not.toMatch(
      /fixture-access|fixture-refresh|fixture-secret|encrypted|subject/,
    );
    const stored = JSON.stringify(await f.repo.db.setting.findMany());
    expect(stored).not.toMatch(/fixture-access|fixture-refresh|fixture-secret/);
    const foreign = await f.connect(f.partner.id);
    await expect(f.service.finish(f.partner.id, foreign.continuation)).rejects.toThrow(
      "outro usuário",
    );
    await expect(f.service.read(f.partner.id, status.connections[0].id, "inbox")).rejects.toThrow(
      "não encontrada",
    );
    await expect(
      f.service.configure(f.partner.id, {
        provider: "google",
        clientId: "foreign",
        clientSecret: "secret",
      }),
    ).rejects.toThrow("administrativo");
    await f.service.configure(f.admin.id, { provider: "google", clientId: "google-client" });
    await expect(
      f.service.configure(f.admin.id, { provider: "google", clientId: "changed-client" }),
    ).rejects.toThrow("segredo");
    const changed = new URL(f.service.callback);
    changed.search = "state=incorrect&code=code";
    await expect(f.service.callbackResult(changed)).rejects.toThrow("expirou");
  } finally {
    await f.close();
  }
}, 15000);
it("requires explicit owner-bound confirmation, prevents retries and invalidates drafts on disconnect", async () => {
  const f = await fixture();
  try {
    await f.service.finish(f.admin.id, (await f.connect(f.admin.id)).continuation);
    const connection = (await f.service.status(f.admin.id)).connections[0];
    const draft = { to: ["recipient@example.test"], subject: "Olá 🌙", text: "Mensagem privada" };
    const proposal = await f.service.propose(f.admin.id, connection.id, "mail", draft);
    expect(
      f.fetcher.mock.calls.filter(([url]) => String(url).endsWith("/messages/send")),
    ).toHaveLength(0);
    await expect(f.service.confirm(f.partner.id, proposal.id)).rejects.toThrow("não pertence");
    expect(await f.service.confirm(f.admin.id, proposal.id)).toEqual({
      message: "Envio aceito pelo provedor.",
    });
    await expect(f.service.confirm(f.admin.id, proposal.id)).rejects.toThrow("expirou");
    const send = f.fetcher.mock.calls.find(([url]) => String(url).endsWith("/messages/send"));
    const raw = JSON.parse(String(send?.[1]?.body)).raw;
    expect(Buffer.from(raw, "base64url").toString()).toContain("To: recipient@example.test\r\n");
    await expect(
      f.service.propose(f.admin.id, connection.id, "mail", {
        ...draft,
        subject: "Subject\r\nBcc: injected@example.test",
      }),
    ).rejects.toThrow();
    const event = await f.service.propose(f.admin.id, connection.id, "calendar", {
      calendarId: "primary",
      title: "Reunião",
      start: "2026-10-10T12:00:00Z",
      end: "2026-10-10T13:00:00Z",
    });
    await f.service.confirm(f.admin.id, event.id);
    expect(f.fetcher.mock.calls.some(([url]) => String(url).endsWith("/primary/events"))).toBe(
      true,
    );
    const uncertain = await f.service.propose(f.admin.id, connection.id, "mail", draft);
    f.fetcher.mockRejectedValueOnce(new Error("network timeout"));
    await expect(f.service.confirm(f.admin.id, uncertain.id)).rejects.toThrow(
      "Confira a pasta Enviados",
    );
    await expect(f.service.confirm(f.admin.id, uncertain.id)).rejects.toThrow("expirou");
    const pending = await f.service.propose(f.admin.id, connection.id, "mail", draft);
    await f.service.disconnect(f.admin.id, connection.id);
    await expect(f.service.confirm(f.admin.id, pending.id)).rejects.toThrow("expirou");
    expect((await f.service.status(f.admin.id)).connections).toEqual([]);
    await f.service.finish(f.partner.id, (await f.connect(f.partner.id)).continuation);
    expect((await f.service.status(f.partner.id)).connections).toHaveLength(1);
  } finally {
    await f.close();
  }
}, 15000);
it("expires authorizations and proposals without exposing provider payloads", async () => {
  const f = await fixture();
  try {
    const { continuation } = await f.connect(f.admin.id);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 11 * 60000);
    await expect(f.service.finish(f.admin.id, continuation)).rejects.toThrow("expirou");
  } finally {
    vi.restoreAllMocks();
    await f.close();
  }
});
it("keeps API calls on official origins and ignores HTML and attachments", async () => {
  const fetcher = vi.fn<typeof fetch>(
    async () =>
      new Response(
        JSON.stringify({
          id: "mail",
          payload: {
            headers: [{ name: "Subject", value: "Hello" }],
            parts: [
              {
                mimeType: "text/html",
                body: { data: Buffer.from("<script>unsafe</script>").toString("base64url") },
              },
              {
                mimeType: "text/plain",
                filename: "attachment.txt",
                body: { data: Buffer.from("attachment").toString("base64url") },
              },
              {
                mimeType: "text/plain",
                body: { data: Buffer.from("Safe text").toString("base64url") },
              },
            ],
          },
        }),
        { headers: { "content-type": "application/json" } },
      ),
  );
  const client = new PersonalProviderClient(fetcher);
  expect((await client.message("google", "token", "https://evil.test/path")).text).toBe(
    "Safe text",
  );
  expect(new URL(String(fetcher.mock.calls[0][0])).origin).toBe(providers.google.api);
});

it("coalesces refreshes and cannot restore a connection removed during refresh", async () => {
  const f = await fixture();
  try {
    await f.service.finish(f.admin.id, (await f.connect(f.admin.id)).continuation);
    const connection = (await f.service.status(f.admin.id)).connections[0];
    const clock = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(clock + 3600000);
    let release: (response: Response) => void = () => {};
    const response = new Promise<Response>((resolve) => {
      release = resolve;
    });
    f.fetcher.mockImplementationOnce(async () => response);
    const first = f.service.read(f.admin.id, connection.id, "inbox");
    const firstResult = first.catch((error) => error);
    await vi.waitFor(() =>
      expect(
        f.fetcher.mock.calls.some(([, options]) =>
          String(options?.body).includes("grant_type=refresh_token"),
        ),
      ).toBe(true),
    );
    const secondResult = f.service.read(f.admin.id, connection.id, "inbox").catch((error) => error);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(
      f.fetcher.mock.calls.filter(([, options]) =>
        String(options?.body).includes("grant_type=refresh_token"),
      ),
    ).toHaveLength(1);
    await f.service.disconnect(f.admin.id, connection.id);
    release(
      new Response(
        JSON.stringify({
          access_token: "refreshed-access",
          token_type: "Bearer",
          expires_in: 3600,
        }),
        { headers: { "content-type": "application/json" } },
      ),
    );
    expect(String(await firstResult)).toContain("conexão mudou");
    expect(String(await secondResult)).toContain("conexão mudou");
    expect((await f.service.status(f.admin.id)).connections).toEqual([]);
  } finally {
    vi.restoreAllMocks();
    await f.close();
  }
}, 15000);

it("summarizes multiple owned calendars for an explicit local-day interval and reports unavailable calendars", async () => {
  const f = await fixture();
  try {
    const google = await f.connect(f.admin.id);
    await f.service.finish(f.admin.id, google.continuation);
    f.fetcher.mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("calendarList"))
        return Response.json({
          items: [
            { id: "work", summary: "Pesquisa" },
            { id: "family", summary: "Família" },
            { id: "offline", summary: "Sem acesso" },
          ],
        });
      expect(url.searchParams.get("timeMin")).toBe("2026-10-09T00:00:00-03:00");
      expect(url.searchParams.get("timeMax")).toBe("2026-10-10T00:00:00-03:00");
      if (url.pathname.includes("/offline/")) return new Response("", { status: 403 });
      return Response.json({
        items: [
          {
            id: url.pathname,
            summary: url.pathname.includes("/work/") ? "Revisão matinal" : "Aniversário",
            start: url.pathname.includes("/work/")
              ? { dateTime: "2026-10-09T08:00:00-03:00" }
              : { date: "2026-10-09" },
            end: { dateTime: "2026-10-09T09:00:00-03:00" },
          },
        ],
      });
    });
    const result = await f.service.agenda(
      f.admin.id,
      "2026-10-09T00:00:00-03:00",
      "2026-10-10T00:00:00-03:00",
    );
    expect(result.events.map((event) => event.calendar)).toEqual(["Família", "Pesquisa"]);
    expect(result.events.every((event) => event.account === "owner@example.test")).toBe(true);
    expect(result.incomplete).toBe(true);
    expect(result.unavailable).toEqual([{ account: "owner@example.test", calendar: "Sem acesso" }]);
    const calls = f.fetcher.mock.calls.length;
    await expect(
      f.service.agenda(f.partner.id, "2026-10-09T00:00:00-03:00", "2026-10-10T00:00:00-03:00", [
        (await f.service.status(f.admin.id)).connections[0].id,
      ]),
    ).rejects.toThrow("indisponível");
    expect(f.fetcher.mock.calls).toHaveLength(calls);
    await expect(
      f.service.agenda(f.admin.id, "2026-10-09T00:00:00-03:00", "2026-12-10T00:00:00-03:00"),
    ).rejects.toThrow("31 dias");
  } finally {
    await f.close();
  }
});

it("bounds aggregate calendar queries and reports incomplete coverage instead of claiming an empty agenda", async () => {
  const f = await fixture();
  try {
    const link = await f.connect(f.admin.id);
    await f.service.finish(f.admin.id, link.continuation);
    f.fetcher.mockImplementation(async (input) =>
      Response.json(
        String(input).includes("calendarList")
          ? {
              items: Array.from({ length: 31 }, (_, id) => ({
                id: String(id),
                summary: `Agenda ${id}`,
              })),
            }
          : { items: [] },
      ),
    );
    const result = await f.service.agenda(
      f.admin.id,
      "2026-10-09T00:00:00-03:00",
      "2026-10-10T00:00:00-03:00",
    );
    expect(result).toMatchObject({ calendarsQueried: 30, incomplete: true, events: [] });
    expect(
      f.fetcher.mock.calls.filter(([input]) => String(input).includes("/events?")),
    ).toHaveLength(30);
  } finally {
    await f.close();
  }
});

it("queries Microsoft calendar views for the requested interval and labels provider UTC timestamps", async () => {
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    expect(url.searchParams.get("startDateTime")).toBe("2026-10-09T00:00:00-03:00");
    expect(url.searchParams.get("endDateTime")).toBe("2026-10-10T00:00:00-03:00");
    return Response.json({
      value: [
        {
          id: "review",
          subject: "Revisão",
          start: { dateTime: "2026-10-09T11:00:00.0000000" },
          end: { dateTime: "2026-10-09T12:00:00.0000000" },
        },
      ],
    });
  });
  const events = await new PersonalProviderClient(fetcher).events(
    "microsoft",
    "fixture-access",
    "work",
    { start: "2026-10-09T00:00:00-03:00", end: "2026-10-10T00:00:00-03:00" },
  );
  expect(events[0].start).toBe("2026-10-09T11:00:00.0000000Z");
});
