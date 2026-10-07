import type { WeatherLocation } from "@rosie/types";
import { Field } from "../../../components/field/Field";
import type { FormProps } from "./types";
import { WeatherLocationField } from "./WeatherLocationField";
export function HomeFields({ value: v, set }: FormProps) {
  const defaults = (v.defaults ?? {}) as Record<string, unknown>;
  return (
    <>
      <Field
        label="Cidade"
        value={v.city}
        onChange={(x) => set("city", x)}
        hint="Inclua estado e país se houver cidades com o mesmo nome."
      />
      <Field
        label="Fuso horário"
        value={v.timezone}
        onChange={(x) => set("timezone", x)}
        required
      />
      <WeatherLocationField
        city={String(v.city ?? "")}
        value={(v.weatherLocation ?? null) as WeatherLocation | null}
        onChange={(x) => set("weatherLocation", x)}
      />
      <Field
        label="Informações compartilhadas da casa"
        type="textarea"
        value={v.facts}
        onChange={(x) => set("facts", x)}
      />
      <fieldset>
        <legend>Padrões das caixinhas</legend>
        {[
          { key: "volume", label: "Volume (%)", min: 0, max: 100 },
          { key: "prefillMs", label: "Reserva de áudio (ms)", min: 60, max: 1800 },
          { key: "listenSeconds", label: "Tempo de escuta (s)", min: 5, max: 120 },
          { key: "drowsySeconds", label: "Tempo sonolenta (s)", min: 0, max: 3600 },
        ].map((f) => (
          <Field
            key={f.key}
            label={f.label}
            type="number"
            value={defaults[f.key]}
            min={f.min}
            max={f.max}
            onChange={(x) => set("defaults", { ...defaults, [f.key]: x })}
          />
        ))}
      </fieldset>
    </>
  );
}
