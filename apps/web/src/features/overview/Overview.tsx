"use client";
import type { WebReferences } from "@rosie/types";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Field } from "../../components/field/Field";
import { SourceLinks } from "../../components/source-links/SourceLinks";
import { expressionLabels, stateLabels } from "../../i18n/pt-BR";
import { type Options, request, type Status } from "../../lib/api-client";
export function Overview({
  status,
  refresh,
  readOnly = false,
}: {
  status?: Status;
  refresh: () => Promise<void>;
  readOnly?: boolean;
}) {
  const [options, setOptions] = useState<Options>({}),
    [endpoint, setEndpoint] = useState(""),
    [expression, setExpression] = useState("happy"),
    [text, setText] = useState(""),
    [reply, setReply] = useState(""),
    [web, setWeb] = useState<WebReferences>(),
    [recognized, setRecognized] = useState<
      { name: string; parameters: Record<string, string> } | undefined
    >(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    request<Options>("/options")
      .then((v) => {
        setOptions(v);
        setEndpoint(v.endpoints?.[0]?.id ?? "");
      })
      .catch((e) => setError(e.message));
  }, []);
  async function act(action: string) {
    setBusy(true);
    setError("");
    try {
      await request(`/endpoints/${endpoint}/${action}`, {
        method: "POST",
        body: action === "test-expression" ? JSON.stringify({ expression }) : undefined,
      });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const online = Object.keys(status?.robots ?? {}).length;
  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">JARVIS · CENTRAL DE OPERAÇÕES</p>
          <h1>Uma casa, muitas conversas.</h1>
          <p>Seus assistentes, cada um com seu jeito. Cada caixinha no seu ambiente.</p>
        </div>
        <Link className="button primary" href="/endpoints">
          {readOnly ? "Consultar caixinhas" : "Gerenciar caixinhas"}
        </Link>
      </header>
      <section className="command-hero" aria-label="Central de assistentes">
        <div>
          <p className="eyebrow">UMA PLATAFORMA, MUITAS PERSONALIDADES</p>
          <h2>Seu universo conectado.</h2>
          <p>
            Organize a casa, escolha seus assistentes e acompanhe cada dispositivo. Rosie e Jarvis
            podem ter vozes e personalidades próprias.
          </p>
          <div className="command-links">
            {!readOnly && (
              <Link className="button primary" href="/studio">
                Abrir conversa
              </Link>
            )}
            <Link className="button" href="/assistants">
              Seus assistentes
            </Link>
            <Link className="button" href="/devices">
              Dispositivos da casa
            </Link>
          </div>
        </div>
        <div className="command-orb" aria-hidden="true">
          <span>J·</span>
        </div>
      </section>
      <div className="overview-grid">
        <section className="panel">
          <h2>Agora na sua casa</h2>
          <dl className="connection-list">
            <div>
              <dt>Caixinhas conectadas</dt>
              <dd>
                <Link href="/endpoints">
                  {online} de {options.endpoints?.length ?? 0}
                </Link>
              </dd>
            </div>
            <div>
              <dt>Voz local</dt>
              <dd>
                <span className={`badge ${status?.speech.ready ? "good" : "warning"}`}>
                  {status?.speech.ready
                    ? status.speech.busy
                      ? "Preparando uma fala"
                      : "Disponível"
                    : "Indisponível"}
                </span>
              </dd>
            </div>
            <div>
              <dt>Automações MQTT</dt>
              <dd>
                <span className={`badge ${status?.mqtt ? "good" : "warning"}`}>
                  {status?.mqtt ? "Conectadas" : "Sem conexão"}
                </span>
              </dd>
            </div>
          </dl>
          {!readOnly && <Link href="/settings">Ver voz e conexões</Link>}
        </section>
        {!readOnly && (
          <section className="panel">
            <h2>Experimentar uma conversa</h2>
            <p>
              A frase usa o ambiente e o assistente desta caixinha, com histórico separado do
              microfone. Comandos de automação serão executados.
            </p>
            <Field
              label="Caixinha"
              disabled={busy}
              type="select"
              value={endpoint}
              onChange={(v) => {
                setEndpoint(String(v));
                setReply("");
                setWeb(undefined);
                setRecognized(undefined);
              }}
              options={options.endpoints ?? []}
            />
            <p className="hint">
              Morador reconhecido no microfone:{" "}
              {options.residents?.find((v) => v.id === status?.identifiedResidents?.[endpoint])
                ?.name ?? "ninguém nesta conversa"}
              .
            </p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError("");
                setReply("");
                setWeb(undefined);
                setRecognized(undefined);
                try {
                  const answer = await request<{
                    text: string;
                    web?: WebReferences;
                    intent?: { name: string; parameters: Record<string, string> };
                  }>("/conversation", {
                    method: "POST",
                    body: JSON.stringify({ endpointId: endpoint, text }),
                  });
                  setReply(answer.text);
                  setWeb(answer.web);
                  setRecognized(answer.intent);
                  await refresh();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Field
                label="Sua mensagem"
                value={text}
                onChange={(v) => setText(String(v))}
                required
              />
              <button type="submit" className="primary" disabled={busy || !endpoint}>
                {busy ? "Aguarde…" : "Enviar"}
              </button>
              <button
                type="button"
                disabled={busy || !endpoint}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await request("/conversation/reset", {
                      method: "POST",
                      body: JSON.stringify({ endpointId: endpoint }),
                    });
                    setReply("");
                    setWeb(undefined);
                    setText("");
                    setRecognized(undefined);
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Nova conversa
              </button>
            </form>
            {reply && (
              <p className="conversation-reply" role="status">
                {reply}
                <SourceLinks web={web} />
              </p>
            )}
            {recognized && (
              <div className="intent-result">
                <p>
                  Intent reconhecida: <strong>{recognized.name}</strong>
                </p>
                {Object.keys(recognized.parameters).length > 0 && (
                  <dl className="connection-list">
                    {Object.entries(recognized.parameters).map(([name, value]) => (
                      <div key={name}>
                        <dt>{name}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </section>
        )}
        {!readOnly && (
          <section className="panel">
            <h2>Rosto e voz</h2>
            {status?.voiceReferences?.[endpoint] && (
              <p>
                Última busca por voz desta caixinha. Os links ficam disponíveis por 30 minutos.
                <SourceLinks web={status.voiceReferences[endpoint]} />
              </p>
            )}
            <p>Teste a caixinha selecionada. O teste interrompe a conversa em andamento.</p>
            <p>
              Estado:{" "}
              <strong>{stateLabels[status?.robots[endpoint] ?? ""] ?? "Desconectada"}</strong>
            </p>
            <div className="button-row">
              <button
                type="button"
                disabled={busy || !status?.robots[endpoint]}
                onClick={() => void act("test-voice")}
              >
                Testar voz
              </button>
              <button
                type="button"
                disabled={busy || !status?.robots[endpoint]}
                onClick={() => void act("listen")}
              >
                Abrir escuta
              </button>
              <button
                type="button"
                disabled={busy || !status?.robots[endpoint]}
                onClick={() => void act("sleep")}
              >
                Dormir
              </button>
            </div>
            <Field
              label="Expressão"
              type="select"
              value={expression}
              onChange={(v) => setExpression(String(v))}
              options={Object.entries(expressionLabels).map(([id, name]) => ({ id, name }))}
            />
            <button
              type="button"
              disabled={busy || !status?.robots[endpoint]}
              onClick={() => void act("test-expression")}
            >
              Testar expressão
            </button>
          </section>
        )}
        <section className="panel">
          <h2>Um jeito para cada momento</h2>
          <p>
            <Link href="/personal">Assistentes</Link> guardam identidade e voz.{" "}
            <Link href="/endpoints">Caixinhas</Link> têm ambiente e ajustes próprios.
          </p>
          <p>
            Use <Link href="/residents">moradores</Link> para preferências pessoais e{" "}
            <Link href="/modes">modos</Link> para trabalho, descanso e outros momentos.
          </p>
          <p>
            Em <Link href="/intents">intents e humor</Link>, cadastre respostas prontas ou conversas
            por significado. Em <Link href="/routines">rotinas</Link>, reúna ações da casa.
          </p>
        </section>
      </div>
    </>
  );
}
