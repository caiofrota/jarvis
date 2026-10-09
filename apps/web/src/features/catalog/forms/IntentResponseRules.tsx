import { faArrowDown, faArrowUp, faTrash } from "@fortawesome/free-solid-svg-icons";
import { type ResponseRule, responseRuleSchema } from "@rosie/types";
import { useRef, useState } from "react";
import { Field } from "../../../components/field/Field";
import { IconButton } from "../../../components/icon-button/IconButton";
import { intentHumorLabels } from "../../../i18n/pt-BR";
import { type FormProps, homeOptions } from "./types";

export function IntentResponseRules({ value: v, set, options }: FormProps) {
  const value = (v.responseRules ?? []) as ResponseRule[];
  const next = useRef(value.length);
  const [keys, setKeys] = useState(() => value.map((_, i) => i));
  const generated = v.responseMode === "generated";
  const change = (index: number, patch: Partial<ResponseRule>) =>
    set(
      "responseRules",
      value.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)),
    );
  const move = (index: number, delta: number) => {
    const rules = [...value],
      ids = [...keys];
    [rules[index], rules[index + delta]] = [rules[index + delta], rules[index]];
    [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
    set("responseRules", rules);
    setKeys(ids);
  };
  return (
    <fieldset>
      <legend>Respostas por contexto</legend>
      <p>
        A primeira regra que atender a todas as condições será usada. Sem correspondência, vale a
        resposta padrão acima. Deixe limites e grupos vazios para não restringir aquele critério.
      </p>
      {value.map((rule, index) => (
        <section className="routine-step" key={keys[index]} aria-label={`Regra ${index + 1}`}>
          <div className="step-heading">
            <strong>Regra {index + 1}</strong>
            <div className="row-actions">
              {index > 0 && (
                <IconButton
                  icon={faArrowUp}
                  label={`Subir regra ${index + 1}`}
                  onClick={() => move(index, -1)}
                />
              )}
              {index < value.length - 1 && (
                <IconButton
                  icon={faArrowDown}
                  label={`Descer regra ${index + 1}`}
                  onClick={() => move(index, 1)}
                />
              )}
              <IconButton
                icon={faTrash}
                tone="danger"
                label={`Remover regra ${index + 1}`}
                onClick={() => {
                  set(
                    "responseRules",
                    value.filter((_, i) => i !== index),
                  );
                  setKeys(keys.filter((_, i) => i !== index));
                }}
              />
            </div>
          </div>
          <Field
            label="Nome da regra"
            value={rule.name}
            onChange={(x) => change(index, { name: String(x) })}
            hint="Exemplo: Calor à tarde."
            required
          />
          <div className="form-grid">
            <Field
              label="Valor a partir de"
              placeholder="Sem limite mínimo"
              type="number"
              step="any"
              nullable
              value={rule.minValue}
              onChange={(x) => change(index, { minValue: x as number | null })}
              hint="No clima da cidade, use °C; em sensores, a unidade da leitura."
            />
            <Field
              label="Valor abaixo de"
              placeholder="Sem limite máximo"
              hint="Este limite não entra na faixa. Exemplo: abaixo de 30 não inclui 30."
              type="number"
              step="any"
              nullable
              value={rule.maxValue}
              onChange={(x) => change(index, { maxValue: x as number | null })}
            />
            <Field
              label="A partir das"
              type="time"
              value={rule.startTime}
              onChange={(x) => change(index, { startTime: x ? String(x) : null })}
              hint="Fuso da casa. Pode atravessar a meia-noite."
            />
            <Field
              label="Antes das"
              type="time"
              value={rule.endTime}
              onChange={(x) => change(index, { endTime: x ? String(x) : null })}
            />
          </div>
          {(
            [
              ["residentIds", "residents", "Moradores desta regra"],
              ["modeIds", "modes", "Modos desta regra"],
            ] as const
          ).map(([key, kind, label]) => (
            <fieldset className="association-group" key={key}>
              <legend>{label}</legend>
              {homeOptions(options, kind, v.homeId).map((item) => (
                <label className="choice" key={item.id}>
                  <input
                    type="checkbox"
                    checked={rule[key].includes(item.id)}
                    onChange={(e) =>
                      change(index, {
                        [key]: e.target.checked
                          ? [...rule[key], item.id]
                          : rule[key].filter((id) => id !== item.id),
                      })
                    }
                  />
                  {item.name}
                </label>
              ))}
              {!homeOptions(options, kind, v.homeId).length && (
                <small>Nenhum cadastro neste grupo. Vale para todos.</small>
              )}
            </fieldset>
          ))}
          {generated && (
            <>
              <Field
                label="Orientação desta regra"
                type="textarea"
                value={rule.instructions}
                onChange={(x) => change(index, { instructions: String(x) })}
                hint="Complementa a orientação geral. Não precisa repetir os limites numéricos."
              />
              {!v.serious && (
                <Field
                  label="Estilo nesta regra"
                  type="select"
                  value={rule.humor}
                  onChange={(x) => change(index, { humor: x as ResponseRule["humor"] })}
                  options={[
                    { id: "inherit", name: "Usar humor da intent" },
                    ...Object.entries(intentHumorLabels).map(([id, name]) => ({ id, name })),
                  ]}
                />
              )}
            </>
          )}
          <Field
            label={generated ? "Exemplos desta regra" : "Respostas desta regra"}
            type="lines"
            value={rule.responses}
            onChange={(x) => change(index, { responses: x as string[] })}
            required={!generated}
            hint={
              generated
                ? "Referências para criar novas frases; não são aprendidas ou salvas automaticamente."
                : "Uma por linha. Pode usar os mesmos marcadores da resposta padrão."
            }
          />
        </section>
      ))}
      <button
        type="button"
        disabled={value.length >= 8}
        onClick={() => {
          setKeys([...keys, next.current++]);
          set("responseRules", [
            ...value,
            {
              ...responseRuleSchema.parse({
                name: "Novo contexto",
                startTime: "06:00",
                endTime: "12:00",
              }),
              name: "",
            },
          ]);
        }}
      >
        Adicionar regra de resposta
      </button>
      <p className="hint">
        Até oito regras. Moradores e modos são os selecionados na caixinha; não há identificação
        automática da voz.
      </p>
    </fieldset>
  );
}
