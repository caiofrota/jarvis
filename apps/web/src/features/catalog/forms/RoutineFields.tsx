import { faTrash } from "@fortawesome/free-solid-svg-icons";
import { useRef, useState } from "react";
import { Field } from "../../../components/field/Field";
import { IconButton } from "../../../components/icon-button/IconButton";
import { kindLabels } from "../../../i18n/pt-BR";
import { ScopeFields } from "./ScopeFields";
import { type FormProps, homeOptions } from "./types";

type Step = { deviceId: string | null; kind: string | null; roomId: string | null; action: string };
export function RoutineFields(props: FormProps) {
  const { value: v, set, options } = props,
    steps = (v.steps ?? []) as Step[];
  const nextKey = useRef(steps.length);
  const [keys, setKeys] = useState(() => steps.map((_, index) => index));
  const change = (index: number, patch: Partial<Step>) =>
    set(
      "steps",
      steps.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    );
  return (
    <>
      <Field
        label="Outras frases"
        type="lines"
        value={v.aliases}
        onChange={(x) => set("aliases", x)}
        hint="Uma por linha."
      />
      <Field
        label="Variação de"
        type="select"
        nullable
        value={v.extendsId}
        onChange={(x) => set("extendsId", x)}
        options={homeOptions(options, "routines", v.homeId).filter((x) => x.id !== v.id)}
      />
      <ScopeFields {...props} />
      <fieldset>
        <legend>Ações</legend>
        {steps.map((step, index) => (
          <div className="routine-step" key={keys[index]}>
            <div className="step-heading">
              <strong>Etapa {index + 1}</strong>
              <IconButton
                icon={faTrash}
                tone="danger"
                label={`Remover etapa ${index + 1}`}
                onClick={() => {
                  set(
                    "steps",
                    steps.filter((_, i) => i !== index),
                  );
                  setKeys(keys.filter((_, i) => i !== index));
                }}
              />
            </div>
            <Field
              label="Destino"
              type="select"
              value={step.kind === null ? "fixed" : "context"}
              onChange={(x) =>
                change(
                  index,
                  x === "fixed" ? { deviceId: "", kind: null } : { deviceId: null, kind: "light" },
                )
              }
              options={[
                { id: "fixed", name: "Dispositivo específico" },
                { id: "context", name: "Dispositivo padrão do ambiente" },
              ]}
            />
            {step.kind === null ? (
              <Field
                label="Dispositivo"
                type="select"
                value={step.deviceId}
                onChange={(x) => change(index, { deviceId: String(x) })}
                options={homeOptions(options, "devices", v.homeId)}
                required
              />
            ) : (
              <>
                <Field
                  label="Tipo de dispositivo"
                  type="select"
                  value={step.kind}
                  onChange={(x) => change(index, { kind: String(x) })}
                  options={Object.entries(kindLabels)
                    .filter(([id]) => id !== "sensor")
                    .map(([id, name]) => ({ id, name }))}
                />
                <Field
                  label="Ambiente da ação"
                  type="select"
                  nullable
                  value={step.roomId}
                  onChange={(x) => change(index, { roomId: x as string | null })}
                  options={homeOptions(options, "rooms", v.homeId)}
                  hint="Usar padrão segue o ambiente solicitado ou o da caixinha."
                />
              </>
            )}
            <Field
              label="Ação"
              value={step.action}
              onChange={(x) => change(index, { action: String(x) })}
              required
            />
          </div>
        ))}
        <button
          type="button"
          onClick={() => {
            setKeys([...keys, nextKey.current++]);
            set("steps", [
              ...steps,
              { deviceId: null, kind: "light", roomId: null, action: "off" },
            ]);
          }}
        >
          Adicionar etapa
        </button>
        <Field
          label="Permitir ações em outros ambientes"
          type="checkbox"
          value={v.crossRoom}
          onChange={(x) => set("crossRoom", x)}
        />
      </fieldset>
    </>
  );
}
