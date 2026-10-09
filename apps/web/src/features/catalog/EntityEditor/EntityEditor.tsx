"use client";
import { type Collection, defaultPersonality } from "@rosie/types";
import { useState } from "react";
import { Field } from "../../../components/field/Field";
import { Modal } from "../../../components/modal/Modal";
import { type Options, type RecordRow, request } from "../../../lib/api-client";
import { AssistantFields } from "../forms/AssistantFields";
import { DeviceFields } from "../forms/DeviceFields";
import { EndpointFields } from "../forms/EndpointFields";
import { HomeFields } from "../forms/HomeFields";
import { IntentFields } from "../forms/IntentFields";
import { ModeFields } from "../forms/ModeFields";
import { ResidentFields } from "../forms/ResidentFields";
import { RoomFields } from "../forms/RoomFields";
import { RoutineFields } from "../forms/RoutineFields";

const forms = {
  homes: HomeFields,
  rooms: RoomFields,
  assistants: AssistantFields,
  endpoints: EndpointFields,
  devices: DeviceFields,
  intents: IntentFields,
  routines: RoutineFields,
  residents: ResidentFields,
  modes: ModeFields,
};
function initial(options: Options) {
  return {
    name: "",
    enabled: true,
    homeId: options.homes?.length === 1 ? options.homes[0].id : "",
    aliases: [],
    defaults: { volume: 70, prefillMs: 600, listenSeconds: 30, drowsySeconds: 60 },
    timezone: "America/Fortaleza",
    scope: { assistantIds: [], roomIds: [], residentIds: [], modeIds: [] },
    personality: defaultPersonality,
    voice: "kokoro-pf_dora",
    quality: "fast",
    provider: "openai",
    model: "gpt-4o-mini",
    maxOutputTokens: 300,
    historyTurns: 4,
    kind: "light",
    actions: { on: "ON", off: "OFF" },
    expression: "neutral",
    phrases: [],
    responses: [],
    matchMode: "exact",
    responseMode: "template",
    description: "",
    topicTerms: [],
    followUpPhrases: [],
    instructions: "",
    humor: "occasional",
    parameters: [],
    responseRules: [],
    dataSource: "sensor",
    serious: false,
    steps: [{ deviceId: null, kind: "light", roomId: null, action: "off" }],
  };
}
export function EntityEditor({
  collection,
  row,
  options,
  voices,
  cloudHomeId,
  voiceNames,
  onClose,
  onSaved,
}: {
  collection: Collection;
  row?: RecordRow;
  options: Options;
  voices: string[];
  cloudHomeId?: string;
  voiceNames?: Record<string, string>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [value, setValue] = useState<Record<string, unknown>>(row ? { ...row } : initial(options)),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const set = (key: string, value: unknown) =>
      setValue((previous) => ({ ...previous, [key]: value })),
    Fields = forms[collection];
  async function save(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const input = { ...value };
      for (const key of ["aliases", "phrases", "responses", "topicTerms", "followUpPhrases"])
        if (Array.isArray(input[key]))
          input[key] = (input[key] as string[]).map((v) => v.trim()).filter(Boolean);
      if (Array.isArray(input.parameters))
        input.parameters = input.parameters.map((p) => ({
          ...p,
          choices: (p.choices ?? []).map((v: string) => v.trim()).filter(Boolean),
          choiceAliases: Object.fromEntries(
            Object.entries(p.choiceAliases ?? {}).map(([choice, values]) => [
              choice,
              (values as string[]).map((v) => v.trim()).filter(Boolean),
            ]),
          ),
        }));
      if (Array.isArray(input.responseRules))
        input.responseRules = input.responseRules.map((rule) => ({
          ...rule,
          responses: (rule.responses ?? []).map((v: string) => v.trim()).filter(Boolean),
        }));
      await request(`/catalog/${collection}${row ? `/${row.id}` : ""}`, {
        method: row ? "PUT" : "POST",
        body: JSON.stringify(input),
      });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={row ? `Editar ${row.name}` : "Novo cadastro"} onClose={onClose}>
      <form onSubmit={save}>
        <div className="form-grid">
          <Field label="Nome" value={value.name} onChange={(x) => set("name", x)} required />
          {collection !== "homes" && (
            <Field
              label="Casa"
              type="select"
              value={value.homeId}
              onChange={(x) => set("homeId", x)}
              options={options.homes ?? []}
              required
            />
          )}
          <Field
            label="Ativo"
            type="checkbox"
            value={value.enabled}
            onChange={(x) => set("enabled", x)}
          />
        </div>
        <Fields
          value={value}
          set={set}
          options={options}
          voices={voices}
          cloudHomeId={cloudHomeId}
          voiceNames={voiceNames}
        />
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <footer className="form-actions">
          <button type="button" onClick={onClose}>
            Cancelar
          </button>
          <button className="primary" type="submit" disabled={busy}>
            {busy ? "Salvando…" : "Salvar"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
