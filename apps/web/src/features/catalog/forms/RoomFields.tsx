import { useEffect, useState } from "react";
import { Field } from "../../../components/field/Field";
import { kindLabels } from "../../../i18n/pt-BR";
import { request } from "../../../lib/api-client";
import { type FormProps, homeOptions } from "./types";
export function RoomFields({ value: v, set, options }: FormProps) {
  const [areas, setAreas] = useState<{ id: string; name: string; homeId: string }[]>([]);
  const [areaError, setAreaError] = useState("");
  useEffect(() => {
    let current = true;
    void request<{ items: { id: string; name: string; homeId: string }[] }>("/home-assistant/areas")
      .then((result) => {
        if (current) setAreas(result.items);
      })
      .catch(() => {
        if (current) setAreaError("Conecte o Home Assistant para escolher uma área.");
      });
    return () => {
      current = false;
    };
  }, []);
  const defaults = (v.defaultDevices ?? {}) as Record<string, string>;
  return (
    <>
      <Field
        label="Outros nomes"
        type="lines"
        value={v.aliases}
        onChange={(x) => set("aliases", x)}
      />
      <Field
        label="Área no Home Assistant"
        type="select"
        nullable
        value={v.haAreaId ?? ""}
        options={[
          ...areas.filter((area) => area.homeId === v.homeId),
          ...(v.haAreaId && !areas.some((area) => area.id === v.haAreaId)
            ? [{ id: String(v.haAreaId), name: String(v.haAreaId) }]
            : []),
        ]}
        onChange={(x) => set("haAreaId", x ?? "")}
        hint={
          areaError ||
          "Sem vínculo explícito, uma área com o mesmo nome ou apelido é reconhecida automaticamente."
        }
      />
      <fieldset>
        <legend>Dispositivos padrão</legend>
        {Object.entries(kindLabels)
          .filter(([id]) => id !== "sensor")
          .map(([id, name]) => (
            <Field
              key={id}
              label={name}
              type="select"
              nullable
              value={defaults[id]}
              options={homeOptions(options, "devices", v.homeId).filter(
                (d) => d.roomId === v.id && d.kind === id,
              )}
              onChange={(x) => {
                const next = { ...defaults };
                if (x) next[id] = String(x);
                else delete next[id];
                set("defaultDevices", next);
              }}
            />
          ))}
        <p className="hint">Escolha o alvo de comandos como “liga a luz”.</p>
      </fieldset>
    </>
  );
}
