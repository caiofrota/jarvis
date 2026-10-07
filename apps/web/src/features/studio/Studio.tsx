"use client";
import { useEffect, useRef, useState } from "react";
import EnergyRing from "../../../../../features/voice/orb/EnergyRing";
import { Field } from "../../components/field/Field";
import { type Options, request } from "../../lib/api-client";

type Message = { id: string; role: "user" | "assistant"; text: string };
export function Studio() {
  const [options, setOptions] = useState<Options>({});
  const [endpoint, setEndpoint] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);
  const epoch = useRef(0);
  const messageId = useRef(0);
  useEffect(() => {
    const abort = new AbortController();
    void request<Options>("/options", { signal: abort.signal })
      .then((value) => {
        setOptions(value);
        setEndpoint(value.endpoints?.[0]?.id ?? "");
      })
      .catch((cause) => {
        if (!abort.signal.aborted) setError(cause.message);
      });
    return () => {
      abort.abort();
      epoch.current++;
      pending.current?.abort();
    };
  }, []);
  const selected = options.endpoints?.find((value) => value.id === endpoint);
  const room = options.rooms?.find((value) => value.id === selected?.roomId);
  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (!text.trim() || busy || !endpoint) return;
    const version = ++epoch.current;
    const abort = new AbortController();
    pending.current = abort;
    const phrase = text.trim();
    setText("");
    setError("");
    setBusy(true);
    setMessages((current) =>
      [...current, { id: String(++messageId.current), role: "user" as const, text: phrase }].slice(
        -40,
      ),
    );
    try {
      const reply = await request<{ text: string }>("/conversation", {
        method: "POST",
        body: JSON.stringify({ endpointId: endpoint, text: phrase }),
        signal: abort.signal,
      });
      if (epoch.current === version)
        setMessages((current) =>
          [
            ...current,
            { id: String(++messageId.current), role: "assistant" as const, text: reply.text },
          ].slice(-40),
        );
    } catch (cause) {
      if (!abort.signal.aborted && epoch.current === version) setError((cause as Error).message);
    } finally {
      if (epoch.current === version) {
        setBusy(false);
        pending.current = null;
      }
    }
  }
  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">JARVIS STUDIO</p>
          <h1>Converse com seu universo.</h1>
          <p>Uma conversa com seus assistentes e as ferramentas da sua casa.</p>
        </div>
      </header>
      <div className="studio-grid">
        <section className="studio-stage panel" aria-label="Assistente central">
          <div className="studio-ring">
            <EnergyRing
              phase={busy ? "thinking" : "idle"}
              profile="eco"
              motion
              sample={() => ({ level: 0, bass: 0, mid: 0, high: 0 })}
            />
            <span>{busy ? "Pensando" : "Pronto para conversar"}</span>
          </div>
          <Field
            label="Contexto da conversa"
            type="select"
            value={endpoint}
            disabled={busy}
            options={options.endpoints ?? []}
            onChange={(value) => {
              epoch.current++;
              pending.current?.abort();
              setEndpoint(String(value));
              setMessages([]);
              setError("");
            }}
          />
          <p className="hint">
            {room?.name ??
              "Escolha um dispositivo cadastrado para definir o ambiente e o assistente."}
          </p>
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
                setMessages([]);
              } catch (cause) {
                setError((cause as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Nova conversa
          </button>
        </section>
        <section className="studio-conversation panel" aria-label="Conversa">
          <div className="studio-history" role="log" aria-live="polite" aria-relevant="additions">
            {!messages.length && (
              <div className="studio-empty">
                <p className="eyebrow">COMECE POR AQUI</p>
                <h2>O que vamos fazer hoje?</h2>
                <p>
                  Converse, consulte a casa ou peça uma ação. O assistente usa o ambiente e as
                  permissões do contexto escolhido.
                </p>
              </div>
            )}
            {messages.map((message) => (
              <article key={message.id} className={`studio-message ${message.role}`}>
                <span>{message.role === "user" ? "Você" : "Assistente"}</span>
                <p>{message.text}</p>
              </article>
            ))}
            {busy && <p role="status">Preparando resposta…</p>}
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <form className="studio-composer" onSubmit={(event) => void send(event)}>
            <Field
              label="Mensagem"
              value={text}
              disabled={busy}
              onChange={(value) => setText(String(value))}
              placeholder="Escreva para seu assistente…"
            />
            <button
              className="primary"
              type="submit"
              disabled={busy || !endpoint || !text.trim() || text.length > 4000}
            >
              Enviar
            </button>
          </form>
        </section>
      </div>
    </>
  );
}
