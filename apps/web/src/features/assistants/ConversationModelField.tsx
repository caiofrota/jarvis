"use client";
import { useEffect, useRef, useState } from "react";
import { Field } from "../../components/field/Field";
import { request } from "../../lib/api-client";

export function ConversationModelField({
  provider,
  model,
  onChange,
}: {
  provider: string;
  model: string;
  onChange: (model: unknown) => void;
}) {
  const [models, setModels] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [queried, setQueried] = useState(false);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  return (
    <>
      <Field label="Modelo de conversa" value={model} required onChange={onChange} />
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          const selected = provider;
          const controller = new AbortController();
          abort.current = controller;
          setBusy(true);
          setError("");
          try {
            const result = await request<{ models: string[] }>(
              `/me/conversation-models?provider=${encodeURIComponent(selected)}`,
              { signal: controller.signal },
            );
            setModels(result.models);
            setQueried(true);
          } catch (cause) {
            if (!controller.signal.aborted) setError((cause as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Consultando modelos…" : "Consultar modelos disponíveis"}
      </button>
      {!!models.length && (
        <Field
          label="Modelos disponíveis na API"
          type="select"
          value={models.includes(model) ? model : ""}
          options={models.map((id) => ({ id, name: id }))}
          onChange={onChange}
          hint="Escolher aqui preenche o modelo de conversa. A voz é configurada separadamente."
        />
      )}
      {queried && !models.length && !error && (
        <p role="status">
          Nenhum modelo de conversa disponível na lista. Você pode informar o identificador
          manualmente.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </>
  );
}
