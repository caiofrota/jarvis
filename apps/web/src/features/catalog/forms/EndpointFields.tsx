import { announcementPolicy } from "@rosie/types";
import { Field } from "../../../components/field/Field";
import { AppearanceFields } from "./AppearanceFields";
import { type FormProps, homeOptions } from "./types";
export function EndpointFields({ value: v, set, options }: FormProps) {
  const policy = {
    ...announcementPolicy.parse({}),
    ...((v.announcements as Record<string, unknown>) ?? {}),
  };
  const notify = (key: string, next: unknown) => set("announcements", { ...policy, [key]: next });
  return (
    <>
      <fieldset>
        <legend>Quem responde aqui</legend>
        <Field
          label="Ambiente"
          type="select"
          value={v.roomId}
          onChange={(x) => set("roomId", x)}
          options={homeOptions(options, "rooms", v.homeId)}
          required
        />
        <Field
          label="Robô digital"
          type="select"
          value={v.assistantId}
          onChange={(x) => set("assistantId", x)}
          options={homeOptions(options, "assistants", v.homeId)}
          required
        />
        <Field
          label="Morador fixo (opcional)"
          type="select"
          nullable
          value={v.residentId}
          onChange={(x) => set("residentId", x)}
          options={homeOptions(options, "residents", v.homeId)}
          hint="Usar padrão permite reconhecer moradores com voz cadastrada. Selecionar alguém aqui fixa o perfil e tem prioridade sobre a voz."
        />
        <Field
          label="Modo"
          type="select"
          nullable
          value={v.modeId}
          onChange={(x) => set("modeId", x)}
          options={homeOptions(options, "modes", v.homeId)}
        />
      </fieldset>
      <fieldset>
        <legend>Áudio e escuta</legend>
        <Field
          label="Volume (%)"
          type="number"
          nullable
          min={0}
          max={100}
          value={v.volume}
          onChange={(x) => set("volume", x)}
        />
        <Field
          label="Reserva de áudio (ms)"
          type="number"
          nullable
          min={60}
          max={1800}
          value={v.prefillMs}
          onChange={(x) => set("prefillMs", x)}
        />
        <Field
          label="Tempo de escuta (s)"
          type="number"
          nullable
          min={5}
          max={120}
          value={v.listenSeconds}
          onChange={(x) => set("listenSeconds", x)}
        />
        <Field
          label="Tempo sonolenta (s)"
          type="number"
          nullable
          min={0}
          max={3600}
          value={v.drowsySeconds}
          onChange={(x) => set("drowsySeconds", x)}
        />
        <Field
          label="Microfone pausado"
          type="checkbox"
          value={v.muted}
          onChange={(x) => set("muted", x)}
        />
        <p className="hint">
          Campos em branco usam os valores da casa. O modo pode limitar o volume.
        </p>
      </fieldset>
      <fieldset>
        <legend>Avisos de automações</legend>
        <Field
          label="Permitir avisos e perguntas"
          type="checkbox"
          value={policy.enabled}
          onChange={(x) => notify("enabled", x)}
        />
        <Field
          label="Volume dos avisos (%)"
          type="number"
          nullable
          min={0}
          max={100}
          value={policy.volume}
          onChange={(x) => notify("volume", x)}
          hint="Em branco usa o volume da caixinha. O limite do modo continua valendo."
        />
        <Field
          label="Silenciar avisos por horário"
          type="checkbox"
          value={policy.quietEnabled}
          onChange={(x) => notify("quietEnabled", x)}
        />
        <Field
          label="Início do silêncio"
          type="time"
          value={policy.quietStart}
          onChange={(x) => notify("quietStart", x)}
          hint="HH:MM, no fuso da casa."
        />
        <Field
          label="Fim do silêncio"
          type="time"
          value={policy.quietEnd}
          onChange={(x) => notify("quietEnd", x)}
        />
      </fieldset>
      <AppearanceFields value={v} set={set} />
      <fieldset>
        <legend>Ativação</legend>
        <p>
          Chamada instalada: <strong>{String(v.wakeWord ?? "Acorda Rosie")}</strong>
        </p>
        <p className="hint">Trocar a palavra de ativação exige instalar um modelo na placa.</p>
        <Field
          label="Grupo de caixinhas que se ouvem"
          value={v.acousticGroup}
          onChange={(x) => set("acousticGroup", x)}
          hint="Use o mesmo grupo quando mais de uma caixinha escuta a mesma chamada. Deixe vazio para funcionamento independente."
        />
      </fieldset>
    </>
  );
}
