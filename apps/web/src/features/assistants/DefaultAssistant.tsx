"use client";
import type { CompanionProfile } from "@rosie/types";
import { useEffect, useState } from "react";
import { request } from "../../lib/api-client";
import { AssistantProfileFields } from "./AssistantProfileFields";

type Status = { profile: CompanionProfile; revision: string };
export function DefaultAssistant() {
  const [status, setStatus] = useState<Status>();
  const [voices, setVoices] = useState<string[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    void Promise.all([
      request<Status>("/assistant-default", { signal: abort.signal }),
      request<{ voices: string[] }>("/me/assistant-options", { signal: abort.signal }),
    ])
      .then(([value, options]) => {
        setStatus(value);
        setVoices(options.voices);
      })
      .catch((cause) => {
        if (!abort.signal.aborted) setError(cause.message);
      });
    return () => abort.abort();
  }, []);
  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">PADRÃO DA INSTALAÇÃO</p>
          <h1>Jarvis padrão</h1>
          <p>Usado pelas contas que ainda não escolheram um assistente pessoal.</p>
        </div>
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!status ? (
        <p role="status">Carregando Jarvis…</p>
      ) : (
        <section className="panel">
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              setError("");
              setNotice("");
              try {
                setStatus(
                  await request<Status>("/assistant-default", {
                    method: "PUT",
                    body: JSON.stringify(status),
                  }),
                );
                setNotice("Jarvis padrão atualizado.");
              } catch (cause) {
                setError((cause as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <fieldset disabled={busy}>
              <AssistantProfileFields
                value={status.profile}
                voices={voices}
                onChange={(profile) => setStatus({ ...status, profile })}
              />
            </fieldset>
            <button className="primary" type="submit" disabled={busy}>
              {busy ? "Salvando…" : "Salvar Jarvis padrão"}
            </button>
          </form>
        </section>
      )}
    </>
  );
}
