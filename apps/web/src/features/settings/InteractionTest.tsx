"use client";
import { useState } from "react";
import { Field } from "../../components/field/Field";
import { type Options, request, type Status } from "../../lib/api-client";

const labels: Record<string, string> = {
  played: "Reprodução concluída pela caixinha.",
  answered: "Resposta recebida",
  timeout: "Tempo de resposta esgotado.",
  cancelled: "Interação cancelada.",
  disconnected: "Caixinha desconectada.",
  error: "Falha na voz ou na reprodução.",
  muted: "Caixinha silenciada.",
  quiet: "Dentro do horário silencioso.",
  disabled: "Avisos desativados nesta caixinha.",
  expired: "Pedido expirou.",
  busy: "Caixinha ocupada. Aguarde ou use Dormir na página inicial.",
  duplicate: "Pedido já recebido.",
};
export function InteractionTest({
  options,
  status,
  prefix,
}: {
  options: Options;
  status?: Status;
  prefix: string;
}) {
  const [endpoint, setEndpoint] = useState(""),
    [text, setText] = useState("Olá! Você quer que eu apague a luz?"),
    [type, setType] = useState("ask"),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState("");
  const box = options.endpoints?.find((v) => v.id === endpoint);
  const topic = box ? `${prefix}/${box.homeId}/${box.id}` : "";
  return (
    <fieldset>
      <legend>Testar fala ou pergunta</legend>
      <Field
        label="Caixinha para a interação"
        type="select"
        options={options.endpoints ?? []}
        value={endpoint}
        onChange={(v) => setEndpoint(String(v))}
      />
      <Field
        label="Tipo de interação"
        type="select"
        value={type}
        onChange={(v) => setType(String(v))}
        options={[
          { id: "announce", name: "Aviso — só falar" },
          { id: "ask", name: "Pergunta — ouvir sim ou não" },
        ]}
      />
      <Field
        label="Mensagem para falar"
        type="textarea"
        value={text}
        onChange={(v) => setText(String(v))}
      />
      <p className="hint">
        O teste de pergunta aguarda até 30 segundos depois da fala e mostra a resposta aqui. Ele não
        liga nem desliga dispositivos.
      </p>
      <button
        type="button"
        disabled={
          busy || !text.trim() || text.length > 1000 || !endpoint || !status?.robots[endpoint]
        }
        onClick={async () => {
          setBusy(true);
          setResult("Aguardando a caixinha…");
          try {
            const answer = await request<{ status: string; choice?: string }>(
              `/endpoints/${endpoint}/interact`,
              {
                method: "POST",
                body: JSON.stringify({
                  id: `panel-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
                  type,
                  text,
                  expiresAt: new Date(Date.now() + 120000).toISOString(),
                  busyPolicy: "reject",
                }),
              },
            );
            setResult(
              `${labels[answer.status] ?? answer.status}${answer.choice ? `: ${answer.choice === "yes" ? "Sim" : answer.choice === "no" ? "Não" : answer.choice}` : ""}`,
            );
          } catch (e) {
            setResult((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Interação em andamento…" : "Enviar para a caixinha"}
      </button>
      {result && <p role="status">{result}</p>}
      {topic && (
        <>
          <p>
            <a className="button" href={`/api/v1/home-assistant/package/${endpoint}`} download>
              Baixar scripts para o Home Assistant
            </a>
          </p>
          <p className="hint">
            Instale o arquivo como pacote no Home Assistant. Ele cria um script de aviso, um de
            pergunta e um sensor para receber a resposta.
          </p>
          <p>
            Enviar pedidos: <code>{topic}/request</code>
          </p>
          <p>
            Receber respostas: <code>{topic}/result</code>
          </p>
        </>
      )}
    </fieldset>
  );
}
