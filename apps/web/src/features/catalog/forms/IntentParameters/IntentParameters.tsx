import { faTrash } from "@fortawesome/free-solid-svg-icons";
import type { IntentParameter } from "@rosie/types";
import { useRef, useState } from "react";
import { Field } from "../../../../components/field/Field";
import { IconButton } from "../../../../components/icon-button/IconButton";

export function IntentParameters({
  value,
  onChange,
}: {
  value: IntentParameter[];
  onChange: (value: IntentParameter[]) => void;
}) {
  const nextKey = useRef(value.length);
  const [keys, setKeys] = useState(() => value.map((_, index) => index));
  const change = (index: number, patch: Partial<IntentParameter>) =>
    onChange(value.map((v, i) => (i === index ? { ...v, ...patch } : v)));
  return (
    <fieldset>
      <legend>Parâmetros da fala</legend>
      <p>
        Extraia até seis informações, como a assistente mencionada ou uma quantidade. Se faltar um
        dado obrigatório, a Rosie pergunta antes de continuar.
      </p>
      {value.map((parameter, index) => (
        <section className="routine-step" key={keys[index]} aria-label={`Parâmetro ${index + 1}`}>
          <div className="step-heading">
            <strong>Parâmetro {index + 1}</strong>
            <IconButton
              icon={faTrash}
              tone="danger"
              label={`Remover parâmetro ${index + 1}`}
              onClick={() => {
                onChange(value.filter((_, i) => i !== index));
                setKeys(keys.filter((_, i) => i !== index));
              }}
            />
          </div>
          <div className="form-grid">
            <Field
              label="Nome do parâmetro"
              value={parameter.name}
              onChange={(v) => change(index, { name: String(v) })}
              hint="Exemplo: assistente. Use {assistente} em uma resposta pronta."
              required
            />
            <Field
              label="Nome na pergunta"
              value={parameter.label}
              onChange={(v) => change(index, { label: String(v) })}
              hint="Exemplo: assistente mencionada."
              required
            />
            <Field
              label="Tipo do parâmetro"
              type="select"
              value={parameter.type}
              onChange={(v) =>
                change(index, {
                  type: v as IntentParameter["type"],
                  choices: [],
                  choiceAliases: {},
                })
              }
              options={[
                { id: "text", name: "Texto" },
                { id: "number", name: "Número" },
                { id: "choice", name: "Lista de opções" },
              ]}
            />
          </div>
          <Field
            label="O que extrair"
            value={parameter.description}
            onChange={(v) => change(index, { description: String(v) })}
            hint="Explique qual informação deve ser reconhecida na fala."
          />
          {parameter.type === "choice" && (
            <>
              <Field
                label="Opções permitidas"
                type="lines"
                value={parameter.choices}
                onChange={(v) => {
                  const choices = v as string[];
                  change(index, {
                    choices,
                    choiceAliases: Object.fromEntries(
                      Object.entries(parameter.choiceAliases ?? {}).filter(([key]) =>
                        choices.includes(key),
                      ),
                    ),
                  });
                }}
                hint="Uma por linha. Exemplo: Alexa, Siri e Google Assistente em linhas separadas."
                required
              />
              {[...new Set(parameter.choices.filter(Boolean))].map((choice) => (
                <Field
                  key={choice}
                  label={`Outras formas de dizer ${choice}`}
                  type="lines"
                  value={parameter.choiceAliases?.[choice] ?? []}
                  onChange={(v) =>
                    change(index, {
                      choiceAliases: { ...parameter.choiceAliases, [choice]: v as string[] },
                    })
                  }
                  hint="Opcional, uma por linha. Exemplo: Amazon para Alexa. Quando configuradas, a identificação usa nomes e sinônimos cadastrados ou o contexto anterior; se faltar, pergunta."
                />
              ))}
            </>
          )}
          <Field
            label="Obrigatório"
            type="checkbox"
            value={parameter.required}
            onChange={(v) => change(index, { required: Boolean(v) })}
          />
        </section>
      ))}
      <button
        type="button"
        disabled={value.length >= 6}
        onClick={() => {
          setKeys([...keys, nextKey.current++]);
          onChange([
            ...value,
            {
              name: "",
              label: "",
              description: "",
              type: "text",
              required: false,
              choices: [],
              choiceAliases: {},
            },
          ]);
        }}
      >
        Adicionar parâmetro
      </button>
    </fieldset>
  );
}
