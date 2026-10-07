import type { WeatherLocation } from "@rosie/types";
import { useState } from "react";
import { Field } from "../../../components/field/Field";
import { request } from "../../../lib/api-client";

export function WeatherLocationField({
  city,
  value,
  onChange,
}: {
  city: string;
  value: WeatherLocation | null;
  onChange: (value: WeatherLocation | null) => void;
}) {
  const [query, setQuery] = useState(city.split(",")[0]);
  const [items, setItems] = useState<WeatherLocation[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  return (
    <fieldset>
      <legend>Local do clima</legend>
      <p>
        {value
          ? `Local selecionado: ${value.name}`
          : "Selecione a cidade para consultar o clima nas intents."}
      </p>
      <Field
        label="Buscar cidade para o clima"
        value={query}
        onChange={(v) => setQuery(String(v))}
        hint="Digite só o nome; escolha o estado e país nos resultados."
      />
      <button
        type="button"
        disabled={busy || query.trim().length < 2}
        onClick={async () => {
          setBusy(true);
          setMessage("");
          setItems([]);
          try {
            const result = await request<{ items: WeatherLocation[] }>(
              `/weather/locations?q=${encodeURIComponent(query)}`,
            );
            setItems(result.items);
            if (!result.items.length) setMessage("Nenhuma cidade encontrada. Tente outro nome.");
          } catch (e) {
            setMessage((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Buscando…" : "Buscar cidade"}
      </button>
      {message && <p role="status">{message}</p>}
      {!!items.length && (
        <Field
          label="Cidade encontrada"
          type="select"
          value=""
          onChange={(x) => {
            if (x === "") return;
            const selected = items[Number(x)];
            if (selected) {
              onChange(selected);
              setItems([]);
            }
          }}
          options={items.map((item, index) => ({ id: String(index), name: item.name }))}
        />
      )}
      {value && (
        <button type="button" onClick={() => onChange(null)}>
          Remover local do clima
        </button>
      )}
      <small>
        Condições estimadas para a cidade por{" "}
        <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">
          Open-Meteo
        </a>
        ; não é uma medição dentro da casa.
      </small>
    </fieldset>
  );
}
