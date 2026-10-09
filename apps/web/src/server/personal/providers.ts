import type { PersonalCalendar, PersonalEvent, PersonalMail, PersonalProvider } from "@rosie/types";
import { DomainError } from "@rosie/types/context";
import type { AuthorizationServer } from "oauth4webapi";

export const providers: Record<
  PersonalProvider,
  { server: AuthorizationServer; scopes: string; api: string }
> = {
  google: {
    server: {
      issuer: "https://accounts.google.com",
      authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
      token_endpoint: "https://oauth2.googleapis.com/token",
    },
    scopes:
      "https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly",
    api: "https://www.googleapis.com",
  },
  microsoft: {
    server: {
      issuer: "https://login.microsoftonline.com/common/v2.0",
      authorization_endpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
      token_endpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    },
    scopes: "User.Read offline_access Mail.Read Mail.Send Calendars.ReadWrite",
    api: "https://graph.microsoft.com",
  },
};

// Provider payloads stay inside this boundary; HTML and attachments are never rendered.
type Data = {
  id?: string;
  name?: string;
  email?: string;
  verified_email?: boolean;
  mail?: string;
  userPrincipalName?: string;
  displayName?: string;
  subject?: string;
  summary?: string;
  receivedDateTime?: string;
  accessRole?: string;
  canEdit?: boolean;
  primary?: boolean;
  selected?: boolean;
  isDefaultCalendar?: boolean;
  status?: string;
  transparency?: string;
  isAllDay?: boolean;
  isCancelled?: boolean;
  showAs?: string;
  responseStatus?: { response?: string };
  attendees?: { self?: boolean; email?: string; responseStatus?: string }[];
  organizer?: { email?: string; emailAddress?: { address?: string } };
  mimeType?: string;
  filename?: string;
  from?: { emailAddress?: { address?: string } };
  body?: { contentType?: string; content?: string; data?: string };
  headers?: { name?: string; value?: string }[];
  payload?: Data;
  parts?: Data[];
  messages?: Data[];
  value?: Data[];
  items?: Data[];
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
};
export class PersonalProviderClient {
  constructor(readonly fetcher: typeof fetch = fetch) {}
  async request(
    provider: PersonalProvider,
    token: string,
    path: string,
    method = "GET",
    input?: unknown,
  ): Promise<Data> {
    const response = await this.fetcher(new URL(path, providers[provider].api), {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(20000),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: 'outlook.body-content-type="text", outlook.timezone="UTC"',
      },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
    });
    if (!response.ok)
      throw new DomainError(
        response.status === 401
          ? "A conexão expirou. Conecte esta conta novamente."
          : "O provedor não concluiu a solicitação.",
      );
    if (response.status === 202 || response.status === 204) return {};
    const reader = response.body?.getReader();
    if (!reader) throw new DomainError("O provedor retornou uma resposta vazia.");
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 2 * 1024 * 1024)
          throw new DomainError("A resposta do provedor excedeu o limite.");
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }
  async identity(provider: PersonalProvider, token: string) {
    const data = await this.request(
      provider,
      token,
      provider === "google"
        ? "/oauth2/v2/userinfo"
        : "/v1.0/me?$select=id,displayName,mail,userPrincipalName",
    );
    if (provider === "google" && !data.verified_email)
      throw new DomainError("O e-mail do Google precisa estar verificado.");
    const subject = data.id,
      email = provider === "google" ? data.email : data.mail || data.userPrincipalName;
    if (typeof subject !== "string" || typeof email !== "string" || !email.includes("@"))
      throw new DomainError("Não foi possível identificar a conta autorizada.");
    return {
      subject,
      email: email.slice(0, 254),
      name: String(data.name || data.displayName || email).slice(0, 200),
    };
  }
  async inbox(provider: PersonalProvider, token: string): Promise<PersonalMail[]> {
    if (provider === "microsoft") {
      const data = await this.request(
        provider,
        token,
        "/v1.0/me/mailFolders/inbox/messages?$top=10&$select=id,subject,from,receivedDateTime&$orderby=receivedDateTime%20desc",
      );
      return (data.value ?? []).slice(0, 10).map((message: Data) => ({
        id: String(message.id),
        subject: String(message.subject ?? ""),
        from: String(message.from?.emailAddress?.address ?? ""),
        date: String(message.receivedDateTime ?? ""),
      }));
    }
    const data = await this.request(
      provider,
      token,
      "/gmail/v1/users/me/messages?labelIds=INBOX&maxResults=10",
    );
    const messages: PersonalMail[] = [];
    for (const message of (data.messages ?? []).slice(0, 10))
      messages.push(await this.message(provider, token, String(message.id), false));
    return messages;
  }
  async message(
    provider: PersonalProvider,
    token: string,
    id: string,
    full = true,
  ): Promise<PersonalMail> {
    if (provider === "microsoft") {
      const data = await this.request(
        provider,
        token,
        `/v1.0/me/messages/${encodeURIComponent(id)}?$select=id,subject,from,receivedDateTime,body`,
      );
      return {
        id: String(data.id),
        subject: String(data.subject ?? ""),
        from: String(data.from?.emailAddress?.address ?? ""),
        date: String(data.receivedDateTime ?? ""),
        text:
          data.body?.contentType?.toLowerCase() === "text"
            ? String(data.body.content ?? "").slice(0, 16000)
            : "Esta mensagem não contém uma versão em texto.",
      };
    }
    const data = await this.request(
      provider,
      token,
      `/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=${full ? "full" : "metadata"}`,
    );
    const header = (name: string) =>
      String(
        data.payload?.headers?.find((h) => String(h.name).toLowerCase() === name)?.value ?? "",
      );
    const parts: string[] = [];
    const visit = (part: Data, depth = 0) => {
      if (depth > 8 || parts.length >= 20) return;
      if (part.mimeType === "text/plain" && !part.filename && typeof part.body?.data === "string")
        parts.push(Buffer.from(part.body.data, "base64url").toString("utf8").slice(0, 16000));
      for (const child of (part.parts ?? []).slice(0, 20)) visit(child, depth + 1);
    };
    if (full && data.payload) visit(data.payload);
    return {
      id: String(data.id),
      subject: header("subject"),
      from: header("from"),
      date: header("date"),
      ...(full
        ? {
            text:
              parts.join("\n").slice(0, 16000) || "Esta mensagem não contém uma versão em texto.",
          }
        : {}),
    };
  }
  async calendars(provider: PersonalProvider, token: string): Promise<PersonalCalendar[]> {
    const data = await this.request(
      provider,
      token,
      provider === "google"
        ? "/calendar/v3/users/me/calendarList?maxResults=50"
        : "/v1.0/me/calendars?$top=50&$select=id,name,canEdit,isDefaultCalendar",
    );
    return (provider === "google" ? (data.items ?? []) : (data.value ?? []))
      .slice(0, 50)
      .map((calendar: Data) => ({
        id: String(calendar.id),
        name: String(calendar.summary || calendar.name || calendar.id),
        owned:
          provider === "google"
            ? calendar.accessRole === "owner"
            : calendar.isDefaultCalendar === true,
        primary:
          provider === "google" ? calendar.primary === true : calendar.isDefaultCalendar === true,
        ...(provider === "google" && typeof calendar.selected === "boolean"
          ? { selected: calendar.selected }
          : {}),
        writable:
          provider === "google"
            ? ["owner", "writer"].includes(calendar.accessRole ?? "")
            : calendar.canEdit === true,
      }));
  }
  async events(
    provider: PersonalProvider,
    token: string,
    calendarId: string,
    period?: { start: string; end: string },
    accountEmail?: string,
  ): Promise<PersonalEvent[]> {
    const start = period?.start ?? new Date().toISOString(),
      end = period?.end ?? new Date(Date.now() + 7 * 86400000).toISOString();
    const path =
      provider === "google"
        ? `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${new URLSearchParams({ timeMin: start, timeMax: end, singleEvents: "true", orderBy: "startTime", maxResults: "30" })}`
        : `/v1.0/me/calendars/${encodeURIComponent(calendarId)}/calendarView?${new URLSearchParams({ startDateTime: start, endDateTime: end, $top: "30", $select: "id,subject,start,end,isAllDay,isCancelled,showAs,responseStatus", $orderby: "start/dateTime" })}`;
    const data = await this.request(provider, token, path);
    const eventTime = (value: Data["start"]) => {
      const date = String(value?.dateTime || value?.date || "");
      // Graph returns UTC because request() explicitly asks for outlook.timezone="UTC".
      return provider === "microsoft" && value?.dateTime && !/(Z|[+-]\d{2}:\d{2})$/i.test(date)
        ? `${date}Z`
        : date;
    };
    const participation = (event: Data): PersonalEvent["participation"] => {
      if (!accountEmail) return "unknown";
      const address = accountEmail.toLowerCase();
      const organizer = event.organizer?.email || event.organizer?.emailAddress?.address;
      if (organizer?.toLowerCase() === address) return "organizer";
      const response =
        provider === "google"
          ? event.attendees?.find((attendee) => attendee.email?.toLowerCase() === address)
              ?.responseStatus
          : event.responseStatus?.response;
      return response === "accepted" || response === "tentative"
        ? response
        : response === "needsAction" || response === "notResponded"
          ? "unanswered"
          : "unknown";
    };
    return (provider === "google" ? (data.items ?? []) : (data.value ?? []))
      .slice(0, 30)
      .map((event: Data) => ({
        id: String(event.id),
        title: String(event.summary || event.subject || "Sem título"),
        start: eventTime(event.start),
        end: eventTime(event.end),
        allDay:
          provider === "google"
            ? Boolean(event.start?.date && !event.start?.dateTime)
            : event.isAllDay === true,
        cancelled: event.status === "cancelled" || event.isCancelled === true,
        declined:
          provider === "google"
            ? event.attendees?.some(
                (attendee) =>
                  attendee.email?.toLowerCase() === accountEmail?.toLowerCase() &&
                  Boolean(accountEmail) &&
                  attendee.responseStatus === "declined",
              ) === true
            : event.responseStatus?.response === "declined",
        busy:
          provider === "google"
            ? event.transparency !== "transparent"
            : !["free", "unknown"].includes(event.showAs ?? "unknown"),
        titleAvailable: Boolean((event.summary || event.subject || "").trim()),
        participation: participation(event),
      }));
  }
  async send(
    provider: PersonalProvider,
    token: string,
    draft: { to: string[]; subject: string; text: string },
  ) {
    if (provider === "microsoft") {
      await this.request(provider, token, "/v1.0/me/sendMail", "POST", {
        message: {
          subject: draft.subject,
          body: { contentType: "Text", content: draft.text },
          toRecipients: draft.to.map((address) => ({ emailAddress: { address } })),
        },
        saveToSentItems: true,
      });
      return;
    }
    const subject = Array.from(draft.subject)
      .reduce<string[]>((chunks, char) => {
        const last = chunks.length - 1;
        if (last < 0 || Buffer.byteLength(chunks[last] + char) > 42) chunks.push(char);
        else chunks[last] += char;
        return chunks;
      }, [])
      .map((chunk) => `=?UTF-8?B?${Buffer.from(chunk).toString("base64")}?=`)
      .join("\r\n ");
    const content =
      Buffer.from(draft.text)
        .toString("base64")
        .match(/.{1,76}/g)
        ?.join("\r\n") ?? "";
    const raw = Buffer.from(
      `To: ${draft.to.join(", ")}\r\nSubject: ${subject}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${content}`,
    ).toString("base64url");
    await this.request(provider, token, "/gmail/v1/users/me/messages/send", "POST", { raw });
  }
  async createEvent(
    provider: PersonalProvider,
    token: string,
    draft: { calendarId: string; title: string; start: string; end: string },
  ) {
    const path =
      provider === "google"
        ? `/calendar/v3/calendars/${encodeURIComponent(draft.calendarId)}/events`
        : `/v1.0/me/calendars/${encodeURIComponent(draft.calendarId)}/events`;
    await this.request(
      provider,
      token,
      path,
      "POST",
      provider === "google"
        ? { summary: draft.title, start: { dateTime: draft.start }, end: { dateTime: draft.end } }
        : {
            subject: draft.title,
            start: {
              dateTime: new Date(draft.start).toISOString().replace(/Z$/, ""),
              timeZone: "UTC",
            },
            end: { dateTime: new Date(draft.end).toISOString().replace(/Z$/, ""), timeZone: "UTC" },
          },
    );
  }
}
