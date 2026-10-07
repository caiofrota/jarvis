import { useState } from "react";
import { Field } from "../../../components/field/Field";
import { kindLabels } from "../../../i18n/pt-BR";
import { type FormProps, homeOptions } from "./types";
export function DeviceFields({ value: v, set, options }: FormProps) {
  const actions = (v.actions ?? {}) as Record<string, string>;
  const [sceneText, setSceneText] = useState(
    Object.entries((v.haTemperatureScenes ?? {}) as Record<string, string>)
      .map(([temperature, scene]) => `${temperature}=${scene}`)
      .join("\n"),
  );
  const [actionText, setActionText] = useState(
    Object.entries(actions)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n"),
  );
  return (
    <>
      <Field
        label="Ambiente"
        type="select"
        value={v.roomId}
        onChange={(x) => set("roomId", x)}
        options={homeOptions(options, "rooms", v.homeId)}
        required
      />
      <Field
        label="Tipo"
        type="select"
        value={v.kind}
        onChange={(x) => {
          set("kind", x);
          if (x !== "climate") {
            set("haTemperatureScenes", {});
            setSceneText("");
            const next = { ...actions };
            delete next.set_temperature;
            set("actions", next);
          }
        }}
        options={Object.entries(kindLabels).map(([id, name]) => ({ id, name }))}
        hint="Escolha o que ele controla. Se o interruptor acende uma luz, selecione Luz."
      />
      <Field
        label="Outros nomes"
        type="lines"
        value={v.aliases}
        onChange={(x) => set("aliases", x)}
        hint="Um por linha."
      />
      <Field
        label="Conexão"
        type="select"
        value={v.connection ?? "mqtt"}
        onChange={(x) => {
          set("connection", x);
          if (x !== "home-assistant") {
            set("haTemperatureScenes", {});
            setSceneText("");
          }
          set(
            "actions",
            x === "home-assistant" ? { on: "turn_on", off: "turn_off" } : { on: "ON", off: "OFF" },
          );
        }}
        options={[
          { id: "mqtt", name: "MQTT" },
          { id: "home-assistant", name: "Home Assistant" },
        ]}
      />
      {v.connection === "home-assistant" ? (
        <fieldset>
          <legend>Home Assistant</legend>
          {v.kind === "climate" && (
            <>
              <Field
                label="Permitir ajuste de temperatura"
                type="checkbox"
                value={actions.set_temperature === "set_temperature"}
                onChange={(enabled) => {
                  const next = { ...actions };
                  if (enabled) next.set_temperature = "set_temperature";
                  else delete next.set_temperature;
                  set("actions", next);
                }}
                hint="Autoriza pedidos como ‘coloca o ar no 20’. Valida a temperatura pelos limites da entidade ou pelas cenas cadastradas abaixo."
              />
              <Field
                label="Cenas para temperatura (opcional)"
                type="textarea"
                value={sceneText}
                onChange={(value) => {
                  const text = String(value);
                  setSceneText(text);
                  set(
                    "haTemperatureScenes",
                    Object.fromEntries(
                      text
                        .split("\n")
                        .filter((line) => line.trim())
                        .map((line) => {
                          const at = line.indexOf("=");
                          return at < 0
                            ? [line.trim(), ""]
                            : [line.slice(0, at).trim(), line.slice(at + 1).trim()];
                        }),
                    ),
                  );
                }}
                hint="Para controle infravermelho por cenas, informe uma por linha: 20=scene.ar_20. Cada pedido aciona a cena com todas as configurações que ela contém. Vazio usa o ajuste normal da entidade. O último comando enviado não confirma a temperatura física do aparelho."
              />
            </>
          )}
          <Field
            label="Entidade no Home Assistant"
            value={v.haEntityId ?? ""}
            onChange={(x) => set("haEntityId", x)}
            hint="Exemplo: light.escritorio. Prefira importar pela aba Home Assistant em Voz e conexões."
            required
          />
          <Field
            label="Atributo da leitura"
            value={v.statePath}
            onChange={(x) => set("statePath", x)}
            hint="Vazio usa o estado principal. Para um atributo, use seu nome exato."
          />
        </fieldset>
      ) : (
        <fieldset>
          <legend>Conexão MQTT</legend>
          {v.kind !== "sensor" && (
            <>
              <Field
                label="Tópico de comando"
                value={v.commandTopic}
                onChange={(x) => set("commandTopic", x)}
                required
              />
              <Field
                label="Ações e mensagens"
                type="textarea"
                value={actionText}
                onChange={(x) => {
                  const text = String(x);
                  setActionText(text);
                  set(
                    "actions",
                    Object.fromEntries(
                      text
                        .split("\n")
                        .filter((line) => line.includes("="))
                        .map((line) => {
                          const at = line.indexOf("=");
                          return [line.slice(0, at).trim(), line.slice(at + 1)];
                        }),
                    ),
                  );
                }}
                hint="Uma ação por linha, por exemplo: on=ON e off=OFF."
              />
            </>
          )}
          <Field
            label="Tópico de estado"
            value={v.stateTopic}
            onChange={(x) => set("stateTopic", x)}
          />
          <Field
            label="Campo da leitura"
            value={v.statePath}
            onChange={(x) => set("statePath", x)}
            hint="Para uma mensagem JSON, informe o campo, como temperature. Deixe vazio para usar o valor inteiro."
          />
        </fieldset>
      )}
    </>
  );
}
