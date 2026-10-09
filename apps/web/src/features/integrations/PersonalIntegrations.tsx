"use client";
import { isNativeCompanion } from "@jarvis/api-client";
import type {
  CalendarMode,
  IntegrationStatus,
  PersonalCalendar,
  PersonalConnection,
  PersonalEvent,
  PersonalMail,
  PersonalProposal,
  PersonalProvider,
} from "@rosie/types";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "../../components/modal/Modal";
import { request } from "../../lib/api-client";

const base = "/personal-integrations";
const providerName = (provider: PersonalProvider) =>
  provider === "google" ? "Google" : "Microsoft";
export function PersonalIntegrations({ userName, admin }: { userName: string; admin: boolean }) {
  const [status, setStatus] = useState<IntegrationStatus>(),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<PersonalConnection>(),
    [mail, setMail] = useState<PersonalMail[]>(),
    [message, setMessage] = useState<PersonalMail>(),
    [calendars, setCalendars] = useState<PersonalCalendar[]>(),
    [events, setEvents] = useState<PersonalEvent[]>();
  const [calendarId, setCalendarId] = useState(""),
    [compose, setCompose] = useState(false),
    [schedule, setSchedule] = useState(false),
    [proposal, setProposal] = useState<PersonalProposal>(),
    [disconnecting, setDisconnecting] = useState<PersonalConnection>();
  const [to, setTo] = useState(""),
    [subject, setSubject] = useState(""),
    [text, setText] = useState(""),
    [title, setTitle] = useState(""),
    [start, setStart] = useState(""),
    [end, setEnd] = useState("");
  const [nativeClient, setNativeClient] = useState(false);
  useEffect(() => setNativeClient(isNativeCompanion(navigator.userAgent)), []);
  const initialized = useRef(false);
  const reload = useCallback(async () => setStatus(await request<IntegrationStatus>(base)), []);
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const url = new URL(window.location.href),
      state = url.searchParams.get("oauth_state"),
      failed = url.searchParams.has("oauth_error");
    if (state || failed) {
      url.searchParams.delete("oauth_state");
      url.searchParams.delete("oauth_error");
      window.history.replaceState(null, "", url.pathname + url.search);
    }
    void (async () => {
      if (failed)
        setError("A conexão não foi concluída. Inicie novamente e confira as permissões.");
      try {
        if (state) {
          await request(`${base}/finish`, { method: "POST", body: JSON.stringify({ state }) });
          setNotice("Conta conectada ao seu perfil.");
        }
      } catch (cause) {
        setError((cause as Error).message);
      }
      await reload();
    })().catch((cause) => setError(cause.message));
  }, [reload]);
  async function action(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const connectionPath = (id: string) => `${base}/connections/${id}`;
  function select(connection: PersonalConnection) {
    setSelected(connection);
    setMail(undefined);
    setMessage(undefined);
    setCalendars(undefined);
    setEvents(undefined);
    setCalendarId("");
    setCompose(false);
    setSchedule(false);
    setProposal(undefined);
  }
  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">CONTAS PESSOAIS</p>
          <h1>Minhas contas</h1>
          <p>
            Conecte os seus e-mails e agendas. Cada pessoa usa seu próprio usuário do Jarvis e
            autoriza suas próprias contas.
          </p>
        </div>
      </header>
      <section className="panel account-guidance">
        <h2>Estas conexões pertencem a {userName}</h2>
        <p>
          Ao clicar em Conectar, escolha a sua conta no Google ou na Microsoft e autorize o acesso.
          Para conectar as contas de outra pessoa, ela precisa entrar no Jarvis com o próprio
          usuário.
        </p>
        {admin && (
          <Link className="button" href="/users">
            Gerenciar usuários
          </Link>
        )}
        <p>
          Nome e voz do assistente não alteram o dono destas conexões. Seus e-mails, agendas e
          histórico não são compartilhados ao escolher um assistente compartilhado.
        </p>
      </section>
      {nativeClient && (
        <section className="panel account-guidance">
          <p>
            Conecte Google e Microsoft no navegador do sistema. Entre com o mesmo usuário do Jarvis;
            depois volte ao companion.
          </p>
          <a className="button" href="/integrations" target="_blank" rel="noopener noreferrer">
            Abrir conexões no navegador
          </a>
        </section>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!status ? (
        <p role="status">Carregando integrações…</p>
      ) : (
        <>
          <div className="cards">
            {status.providers.map((provider) => (
              <section className="panel" key={provider.provider}>
                <h2>{providerName(provider.provider)}</h2>
                <p>
                  {provider.configured
                    ? "Conecte uma ou mais contas para acessar e-mail e calendário."
                    : "A conexão ainda não está disponível. Um administrador precisa configurar o aplicativo Jarvis para este provedor."}
                </p>
                <button
                  type="button"
                  className="primary"
                  disabled={busy || !provider.configured}
                  onClick={() =>
                    void action(async () => {
                      if (nativeClient) {
                        window.open("/integrations", "_blank", "noopener,noreferrer");
                        return;
                      }
                      const authorization = await request<{ url: string }>(`${base}/authorize`, {
                        method: "POST",
                        body: JSON.stringify({ provider: provider.provider }),
                      });
                      window.location.assign(authorization.url);
                    })
                  }
                >
                  Conectar {providerName(provider.provider)}
                </button>
                {!provider.configured && admin && (
                  <Link className="button" href="/provider-apps">
                    Configurar o aplicativo Jarvis
                  </Link>
                )}
              </section>
            ))}
          </div>
          {!status.connections.length && (
            <section className="panel">
              <h2>Nenhuma conta conectada</h2>
              <p>
                Você pode conectar Google e Microsoft. Cada pessoa autoriza suas próprias contas ao
                entrar no Jarvis.
              </p>
            </section>
          )}
          {status.connections.map((connection) => (
            <section className="panel" key={connection.id}>
              <h2>{connection.email}</h2>
              <p>
                {providerName(connection.provider)} · {connection.name}
              </p>
              <div className="form-actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      select(connection);
                      setMail(
                        await request<PersonalMail[]>(`${connectionPath(connection.id)}/inbox`),
                      );
                    })
                  }
                >
                  Abrir caixa de entrada de {connection.email}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      select(connection);
                      setCalendars(
                        await request<PersonalCalendar[]>(
                          `${connectionPath(connection.id)}/calendars`,
                        ),
                      );
                    })
                  }
                >
                  Abrir agendas de {connection.email}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    select(connection);
                    setCompose(true);
                  }}
                >
                  Escrever e-mail com {connection.email}
                </button>
                <button type="button" disabled={busy} onClick={() => setDisconnecting(connection)}>
                  Desconectar {connection.email}
                </button>
              </div>
            </section>
          ))}
          {selected && mail && (
            <section className="panel">
              <h2>Caixa de entrada · {selected.email}</h2>
              {!mail.length && <p>Nenhuma mensagem encontrada na caixa de entrada.</p>}
              {mail.map((item) => (
                <article key={item.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void action(async () =>
                        setMessage(
                          await request<PersonalMail>(
                            `${connectionPath(selected.id)}/message?id=${encodeURIComponent(item.id)}`,
                          ),
                        ),
                      )
                    }
                  >
                    {item.subject || "Sem assunto"}
                  </button>
                  <p>
                    {item.from} · {item.date}
                  </p>
                </article>
              ))}
            </section>
          )}
          {selected && message && (
            <section className="panel">
              <h2>{message.subject}</h2>
              <p>{message.from}</p>
              <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{message.text}</p>
            </section>
          )}
          {selected && calendars && (
            <section className="panel">
              <h2>Agendas · {selected.email}</h2>
              <p>
                Escolha o que seu assistente pode consultar. Agendas prioritárias vêm primeiro nos
                resumos. A preferência vale somente para esta conta e seu usuário.
              </p>
              <p>Após salvar, agendas novas ficam desabilitadas até você selecioná-las aqui.</p>
              {!calendars.length && <p>Nenhuma agenda disponível.</p>}
              {calendars.map((calendar) => (
                <article key={calendar.id}>
                  <h3>{calendar.name}</h3>
                  <label>
                    Consulta de {calendar.name}
                    <select
                      aria-label={`Consulta de ${calendar.name}`}
                      value={calendar.assistantMode ?? "normal"}
                      disabled={busy}
                      onChange={(event) =>
                        setCalendars((current) =>
                          current?.map((value) =>
                            value.id === calendar.id
                              ? { ...value, assistantMode: event.target.value as CalendarMode }
                              : value,
                          ),
                        )
                      }
                    >
                      <option value="priority">Prioritária</option>
                      <option value="normal">Normal</option>
                      <option value="excluded">Não consultar</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        setCalendarId(calendar.id);
                        setEvents(
                          await request<PersonalEvent[]>(
                            `${connectionPath(selected.id)}/events?id=${encodeURIComponent(calendar.id)}`,
                          ),
                        );
                      })
                    }
                  >
                    Ver próximos sete dias de {calendar.name}
                  </button>
                  {calendar.writable && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setCalendarId(calendar.id);
                        setSchedule(true);
                      }}
                    >
                      Criar compromisso em {calendar.name}
                    </button>
                  )}
                </article>
              ))}
              {calendars.length > 0 && (
                <button
                  type="button"
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      await request(`${connectionPath(selected.id)}/calendar-preferences`, {
                        method: "PUT",
                        body: JSON.stringify({
                          calendars: calendars.map((calendar) => ({
                            id: calendar.id,
                            mode: calendar.assistantMode ?? "normal",
                          })),
                        }),
                      });
                      setEvents(undefined);
                      setNotice(
                        "Preferências de agendas salvas. Seu assistente usará esta seleção nas próximas consultas.",
                      );
                    })
                  }
                >
                  Salvar preferências de agendas
                </button>
              )}
              {events && (
                <>
                  <h3>Próximos sete dias</h3>
                  {!events.length && <p>Nenhum compromisso encontrado nesta consulta.</p>}
                  {events.map((event) => (
                    <article key={event.id}>
                      <h4>{event.title}</h4>
                      <p>
                        {event.start} — {event.end}
                      </p>
                    </article>
                  ))}
                </>
              )}
            </section>
          )}
        </>
      )}
      {compose && selected && !proposal && (
        <Modal
          title="Escrever e-mail"
          onClose={() => {
            if (!busy) setCompose(false);
          }}
        >
          <p>Conta: {selected.email}</p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void action(async () => {
                setProposal(
                  await request<PersonalProposal>(`${connectionPath(selected.id)}/proposals`, {
                    method: "POST",
                    body: JSON.stringify({
                      kind: "mail",
                      draft: {
                        to: to
                          .split(",")
                          .map((value) => value.trim())
                          .filter(Boolean),
                        subject,
                        text,
                      },
                    }),
                  }),
                );
              });
            }}
          >
            <fieldset disabled={busy}>
              <label>
                Destinatários
                <input
                  required
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                  placeholder="Separe os endereços com vírgula"
                />
              </label>
              <label>
                Assunto
                <input
                  required
                  maxLength={200}
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                />
              </label>
              <label>
                Mensagem
                <textarea
                  required
                  maxLength={20000}
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  rows={8}
                />
              </label>
            </fieldset>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <button type="submit" className="primary" disabled={busy}>
              Revisar envio
            </button>
          </form>
        </Modal>
      )}
      {schedule && selected && !proposal && (
        <Modal
          title="Criar compromisso"
          onClose={() => {
            if (!busy) setSchedule(false);
          }}
        >
          <p>
            Conta: {selected.email} ·{" "}
            {calendars?.find((calendar) => calendar.id === calendarId)?.name}
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void action(async () =>
                setProposal(
                  await request<PersonalProposal>(`${connectionPath(selected.id)}/proposals`, {
                    method: "POST",
                    body: JSON.stringify({
                      kind: "calendar",
                      draft: {
                        calendarId,
                        title,
                        start: new Date(start).toISOString(),
                        end: new Date(end).toISOString(),
                      },
                    }),
                  }),
                ),
              );
            }}
          >
            <fieldset disabled={busy}>
              <label>
                Título
                <input
                  required
                  maxLength={200}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </label>
              <label>
                Início
                <input
                  required
                  type="datetime-local"
                  value={start}
                  onChange={(event) => setStart(event.target.value)}
                />
              </label>
              <label>
                Fim
                <input
                  required
                  type="datetime-local"
                  value={end}
                  onChange={(event) => setEnd(event.target.value)}
                />
              </label>
              <p>Os horários seguem o fuso deste dispositivo.</p>
            </fieldset>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <button type="submit" className="primary" disabled={busy}>
              Revisar compromisso
            </button>
          </form>
        </Modal>
      )}
      {proposal && (
        <Modal
          title={
            proposal.kind === "mail"
              ? "Confirmar envio de e-mail"
              : "Confirmar criação de compromisso"
          }
          onClose={() => {
            if (!busy) setProposal(undefined);
          }}
        >
          <p>Conta: {proposal.account}</p>
          {"to" in proposal.draft ? (
            <>
              <p>Para: {proposal.draft.to.join(", ")}</p>
              <h3>{proposal.draft.subject}</h3>
              <p style={{ whiteSpace: "pre-wrap" }}>{proposal.draft.text}</p>
            </>
          ) : (
            <>
              <h3>{proposal.draft.title}</h3>
              <p>
                {
                  calendars?.find(
                    (calendar) =>
                      calendar.id ===
                      ("calendarId" in proposal.draft ? proposal.draft.calendarId : ""),
                  )?.name
                }
              </p>
              <p>
                {proposal.draft.start} — {proposal.draft.end}
              </p>
            </>
          )}
          <p>A confirmação expira em cinco minutos.</p>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button type="button" disabled={busy} onClick={() => setProposal(undefined)}>
            Voltar
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                const pending = proposal;
                setProposal(undefined);
                setCompose(false);
                setSchedule(false);
                const result = await request<{ message: string }>(`${base}/confirm`, {
                  method: "POST",
                  body: JSON.stringify({ id: pending.id }),
                });
                setNotice(result.message);
                setTo("");
                setSubject("");
                setText("");
                setTitle("");
              })
            }
          >
            {proposal.kind === "mail" ? "Confirmar e enviar" : "Confirmar e criar"}
          </button>
        </Modal>
      )}
      {disconnecting && (
        <Modal
          title="Desconectar conta?"
          onClose={() => {
            if (!busy) setDisconnecting(undefined);
          }}
        >
          <p>
            O Jarvis apagará o acesso a {disconnecting.email}. Para remover também o consentimento,
            use as configurações de aplicativos da sua conta no provedor.
          </p>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                await request(connectionPath(disconnecting.id), { method: "DELETE" });
                if (selected?.id === disconnecting.id) setSelected(undefined);
                setDisconnecting(undefined);
                await reload();
                setNotice("Conta desconectada do Jarvis.");
              })
            }
          >
            Confirmar desconexão
          </button>
        </Modal>
      )}
    </>
  );
}
