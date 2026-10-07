"use client";
import type { CompanionProfile, PersonalAssistant, PersonalProfileStatus } from "@rosie/types";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Modal } from "../../components/modal/Modal";
import { request } from "../../lib/api-client";
import { AssistantProfileFields } from "./AssistantProfileFields";

type Choices = { voices: string[]; defaultProfile: CompanionProfile };
export function PersonalAssistants() {
  const [status, setStatus] = useState<PersonalProfileStatus>();
  const [choices, setChoices] = useState<Choices>();
  const [editing, setEditing] = useState<PersonalAssistant>();
  const [deleting, setDeleting] = useState<PersonalAssistant>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    void Promise.all([
      request<PersonalProfileStatus>("/me/profile", { signal: abort.signal }),
      request<Choices>("/me/assistant-options", { signal: abort.signal }),
    ])
      .then(([profile, options]) => {
        setStatus(profile);
        setChoices(options);
      })
      .catch((cause) => {
        if (!abort.signal.aborted) setError(cause.message);
      });
    return () => abort.abort();
  }, []);
  async function save(
    assistants: PersonalAssistant[],
    defaultAssistantId: string | null,
    message: string,
  ) {
    if (!status) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const next = await request<PersonalProfileStatus>("/me/profile", {
        method: "PUT",
        body: JSON.stringify({
          revision: status.revision,
          profile: { ...status.profile, assistants, defaultAssistantId },
        }),
      });
      setStatus(next);
      setEditing(undefined);
      setDeleting(undefined);
      setNotice(message);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">SEU ESPAÇO</p>
          <h1>Meus assistentes</h1>
          <p>Nome, voz e personalidade para as suas conversas.</p>
        </div>
        <button
          type="button"
          className="primary"
          disabled={!choices || busy}
          onClick={() => {
            if (!choices) return;
            // New IDs are assigned by the server when the draft is saved.
            setEditing({ ...choices.defaultProfile, id: "" });
          }}
        >
          Criar assistente
        </button>
      </header>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!status ? (
        <p role="status">Carregando seus assistentes…</p>
      ) : (
        <>
          <section className="panel">
            <h2>Assistente padrão da sua conta</h2>
            <p>
              {status.profile.assistants.find((a) => a.id === status.profile.defaultAssistantId)
                ?.name ??
                choices?.defaultProfile.name ??
                "Jarvis"}
            </p>
            {status.profile.defaultAssistantId && (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void save(
                    status.profile.assistants,
                    null,
                    "O Jarvis da instalação será usado por padrão.",
                  )
                }
              >
                Usar Jarvis da instalação
              </button>
            )}
            <Link href="/studio">Conversar</Link>
          </section>
          {!status.profile.assistants.length && (
            <section className="panel">
              <h2>Seu primeiro assistente</h2>
              <p>Crie um assistente e escolha como ele conversa com você.</p>
            </section>
          )}
          {status.profile.assistants.map((assistant) => (
            <section className="panel" key={assistant.id}>
              <h2>{assistant.name}</h2>
              <p>
                {assistant.voice}{" "}
                {assistant.id === status.profile.defaultAssistantId ? "· Seu padrão" : ""}
              </p>
              <div className="form-actions">
                <button type="button" disabled={busy} onClick={() => setEditing(assistant)}>
                  Editar {assistant.name}
                </button>
                <button
                  type="button"
                  disabled={busy || assistant.id === status.profile.defaultAssistantId}
                  onClick={() =>
                    void save(
                      status.profile.assistants,
                      assistant.id,
                      "Assistente padrão atualizado.",
                    )
                  }
                >
                  Usar {assistant.name} por padrão
                </button>
                <button type="button" disabled={busy} onClick={() => setDeleting(assistant)}>
                  Excluir {assistant.name}
                </button>
              </div>
            </section>
          ))}
        </>
      )}
      {editing && choices && (
        <Modal
          title={editing.id ? "Editar assistente" : "Criar assistente"}
          onClose={() => {
            if (!busy) setEditing(undefined);
          }}
        >
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (!status) return;
              setBusy(true);
              setError("");
              try {
                const next = await request<PersonalProfileStatus>("/me/assistants", {
                  method: editing.id ? "PUT" : "POST",
                  body: JSON.stringify({ revision: status.revision, assistant: editing }),
                });
                setStatus(next);
                setEditing(undefined);
                setNotice("Assistente salvo.");
              } catch (cause) {
                setError((cause as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <fieldset disabled={busy}>
              <AssistantProfileFields
                value={editing}
                voices={choices.voices}
                onChange={(profile) => setEditing({ ...profile, id: editing.id })}
              />
            </fieldset>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <div className="form-actions">
              <button type="button" disabled={busy} onClick={() => setEditing(undefined)}>
                Cancelar
              </button>
              <button type="submit" className="primary" disabled={busy}>
                {busy ? "Salvando…" : "Salvar assistente"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {deleting && status && (
        <Modal title="Excluir assistente?" onClose={() => setDeleting(undefined)}>
          <p>{deleting.name} será removido da sua conta.</p>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void save(
                status.profile.assistants.filter((a) => a.id !== deleting.id),
                status.profile.defaultAssistantId === deleting.id
                  ? null
                  : status.profile.defaultAssistantId,
                "Assistente removido.",
              )
            }
          >
            Confirmar exclusão
          </button>
        </Modal>
      )}
    </>
  );
}
