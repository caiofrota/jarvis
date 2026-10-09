import type { CalendarBinding, ResidentCalendarStatus } from "@rosie/types";
import { useEffect, useState } from "react";
import { Field } from "../../../../components/field/Field";
import { request } from "../../../../lib/api-client";

const empty: CalendarBinding = {
  provider: "home-assistant",
  entityId: "",
  enabled: false,
  allowCreate: false,
};
export function ResidentCalendar({
  residentId,
  enabled,
}: {
  residentId: string;
  enabled: boolean;
}) {
  const [status, setStatus] = useState<ResidentCalendarStatus>(),
    [draft, setDraft] = useState(empty),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [removing, setRemoving] = useState(false);
  const path = `/catalog/residents/${residentId}/calendar`;
  useEffect(() => {
    let disposed = false;
    if (!enabled) return;
    void request<ResidentCalendarStatus>(path)
      .then((value) => {
        if (!disposed) {
          setStatus(value);
          setDraft(value.binding ?? empty);
        }
      })
      .catch((e: Error) => {
        if (!disposed) setError(e.message);
      });
    return () => {
      disposed = true;
    };
  }, [path, enabled]);
  async function action(kind: "refresh" | "save" | "remove") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const value = await request<ResidentCalendarStatus>(
        path,
        kind === "refresh"
          ? undefined
          : {
              method: kind === "save" ? "PUT" : "DELETE",
              body: JSON.stringify({
                revision: status?.revision ?? null,
                ...(kind === "save" ? { binding: draft } : {}),
              }),
            },
      );
      setStatus(value);
      if (kind !== "refresh") setDraft(value.binding ?? empty);
      setRemoving(false);
      setNotice(
        kind === "save"
          ? "Configuração da agenda salva."
          : kind === "remove"
            ? "Vínculo removido. Os eventos do Google foram mantidos."
            : "Lista de agendas atualizada. Sua seleção não foi alterada.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const selected = status?.options.find((v) => v.id === draft.entityId);
  const options =
    status?.options.map((v) => ({
      id: v.id,
      name: `${v.name}${v.available ? "" : " — indisponível"}${v.canCreate ? "" : " — somente leitura"}`,
    })) ?? [];
  if (draft.entityId && !selected)
    options.unshift({ id: draft.entityId, name: "Agenda vinculada — indisponível no momento" });
  return (
    <fieldset>
      <legend>Google Agenda</legend>
      <p>
        Conecte a conta Google no Home Assistant e escolha aqui a agenda deste morador. Você pode
        consultar compromissos e criar eventos por voz, sempre confirmando antes de salvar.
      </p>
      <p className="hint">
        A escolha usa o perfil fixo da caixinha ou o reconhecimento de voz. Como a caixinha é
        compartilhada, essa identificação não funciona como senha.
      </p>
      {!enabled ? (
        <p>Salve e ative este morador para vincular uma agenda.</p>
      ) : (
        <>
          <p role="status">{status?.message ?? "Carregando agendas…"}</p>
          <div className="form-actions">
            {status?.setupUrl && (
              <a href={status.setupUrl} target="_blank" rel="noreferrer">
                Abrir integrações no Home Assistant
              </a>
            )}
            <a
              href="https://www.home-assistant.io/integrations/google/"
              target="_blank"
              rel="noreferrer"
            >
              Como conectar a conta Google
            </a>
            <button type="button" disabled={busy} onClick={() => void action("refresh")}>
              Atualizar agendas
            </button>
          </div>
          <Field
            label="Agenda deste morador"
            type="select"
            value={draft.entityId}
            disabled={busy || !status}
            options={options}
            onChange={(v) => setDraft({ ...draft, entityId: String(v), allowCreate: false })}
          />
          <Field
            label="Habilitar consultas por voz"
            type="checkbox"
            value={draft.enabled}
            disabled={busy || !draft.entityId}
            onChange={(v) => setDraft({ ...draft, enabled: Boolean(v) })}
          />
          <Field
            label="Permitir criar eventos com confirmação"
            type="checkbox"
            value={draft.allowCreate}
            disabled={busy || !selected?.canCreate}
            onChange={(v) => setDraft({ ...draft, allowCreate: Boolean(v) })}
            hint="A Rosie repete agenda, título, data e horário antes de salvar. Sem horário final, propõe uma hora de duração. Não altera nem exclui eventos."
          />
          <div className="form-actions">
            <button
              type="button"
              disabled={busy || !status || !draft.entityId}
              onClick={() => void action("save")}
            >
              {busy ? "Aguarde…" : "Salvar agenda"}
            </button>
            {status?.binding && (
              <button type="button" disabled={busy} onClick={() => setRemoving(true)}>
                Desvincular agenda
              </button>
            )}
          </div>
          {removing && (
            <div>
              <p>Desvincular esta agenda do morador? Os eventos do Google serão mantidos.</p>
              <div className="form-actions">
                <button type="button" disabled={busy} onClick={() => setRemoving(false)}>
                  Manter vínculo
                </button>
                <button type="button" disabled={busy} onClick={() => void action("remove")}>
                  Confirmar desvinculação
                </button>
              </div>
            </div>
          )}
          <p className="hint">
            Depois de salvar, teste: “Qual é minha agenda hoje?” ou “Crie um compromisso chamado
            dentista amanhã às nove”. Para criar, responda à confirmação da Rosie.
          </p>
        </>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}
