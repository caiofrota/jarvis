import { useEffect, useState } from "react";
import { Field } from "../../../../components/field/Field";
import { type Option, request } from "../../../../lib/api-client";

type VoiceStatus = {
  registered: boolean;
  enrolledAt: string | null;
  enrollment: null | {
    id: string;
    endpointId: string;
    phase: string;
    completed: number;
    total: number;
    prompt: string;
    message: string;
  };
};
export function ResidentVoice({
  residentId,
  endpoints,
  enabled,
}: {
  residentId: string;
  endpoints: Option[];
  enabled: boolean;
}) {
  const [status, setStatus] = useState<VoiceStatus>(),
    [endpoint, setEndpoint] = useState(endpoints.length === 1 ? endpoints[0].id : ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [deleting, setDeleting] = useState(false);
  const path = `/catalog/residents/${residentId}/voice`;
  const active = ["listening", "processing"].includes(status?.enrollment?.phase ?? "");
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const next = await request<VoiceStatus>(path);
        if (!disposed) {
          setStatus(next);
          setError("");
        }
      } catch (e) {
        if (!disposed) setError((e as Error).message);
      }
      if (!disposed) timer = setTimeout(load, 1500);
    };
    void load();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [path]);
  async function action(kind: "enroll" | "cancel" | "delete") {
    setBusy(true);
    setError("");
    try {
      setStatus(
        await request<VoiceStatus>(path + (kind === "delete" ? "" : `/${kind}`), {
          method: kind === "delete" ? "DELETE" : "POST",
          body: JSON.stringify({ endpointId: endpoint }),
        }),
      );
      setDeleting(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <fieldset>
      <legend>Reconhecer pela voz</legend>
      <p>
        A Rosie pode escolher este perfil pela voz durante a conversa. O cadastro usa três frases
        ditas no microfone da caixinha, em um lugar silencioso. Você tem três minutos para concluir.
      </p>
      <p className="hint">
        O áudio não é guardado. A referência da voz fica neste servidor e pode ser apagada aqui.
        Isso personaliza a conversa; não funciona como senha.
      </p>
      <p role="status">
        {status
          ? status.registered
            ? "Voz cadastrada."
            : "Voz ainda não cadastrada."
          : "Carregando cadastro…"}
      </p>
      <Field
        label="Caixinha para o cadastro"
        type="select"
        value={endpoint}
        onChange={(v) => setEndpoint(String(v))}
        options={endpoints}
        disabled={busy || active || !enabled}
        hint="Deixe a caixinha conectada, sem silenciar e aguardando a palavra de ativação. Durante o cadastro, fale as frases sem dizer a chamada."
      />
      <div className="form-actions">
        <button
          type="button"
          disabled={busy || active || !endpoint || !status || !enabled}
          onClick={() => void action("enroll")}
        >
          {status?.registered ? "Cadastrar novamente" : "Cadastrar voz"}
        </button>
        {active && (
          <button type="button" disabled={busy} onClick={() => void action("cancel")}>
            Cancelar cadastro
          </button>
        )}
        {status?.registered && !active && (
          <button type="button" disabled={busy} onClick={() => setDeleting(true)}>
            Apagar voz cadastrada
          </button>
        )}
      </div>
      {status?.enrollment && (
        <div aria-live="polite">
          <p>{status.enrollment.message}</p>
          {active && (
            <>
              <p>
                Amostras: {status.enrollment.completed} de {status.enrollment.total}.
              </p>
              {status.enrollment.phase === "listening" ? (
                <p>
                  <strong>Leia em voz alta: {status.enrollment.prompt}</strong>
                </p>
              ) : (
                <p>Conferindo a amostra. Aguarde a próxima frase.</p>
              )}
            </>
          )}
        </div>
      )}
      {deleting && (
        <div>
          <p>
            Apagar a referência da voz deste morador? Para reconhecer novamente, será necessário
            repetir o cadastro.
          </p>
          <div className="form-actions">
            <button type="button" disabled={busy} onClick={() => setDeleting(false)}>
              Manter voz
            </button>
            <button type="button" disabled={busy} onClick={() => void action("delete")}>
              Confirmar exclusão da voz
            </button>
          </div>
        </div>
      )}
      {!enabled && <p className="hint">Salve e ative o morador para iniciar um cadastro.</p>}
      <p className="hint">
        Sem morador fixo na caixinha, o reconhecimento é automático. Frases muito curtas podem não
        identificar a pessoa; em caso de dúvida, a Rosie não escolhe um perfil.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}
