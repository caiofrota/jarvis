import { Field } from "../../../components/field/Field";
import { Tabs } from "../../../components/tabs/Tabs";
import { ResidentCalendar } from "./ResidentCalendar/ResidentCalendar";
import { ResidentVoice } from "./ResidentVoice/ResidentVoice";
import { type FormProps, homeOptions } from "./types";
export function ResidentFields({ value: v, set, options }: FormProps) {
  return (
    <Tabs
      label="Configurações do morador"
      items={[
        {
          id: "profile",
          label: "Perfil",
          content: (
            <>
              <Field
                label="Preferências"
                type="textarea"
                value={v.preferences}
                onChange={(x) => set("preferences", x)}
              />
              <Field
                label="Informações pessoais"
                type="textarea"
                value={v.facts}
                onChange={(x) => set("facts", x)}
              />
              <p className="hint">
                Usadas quando este morador estiver selecionado na caixinha ou reconhecido pela voz.
              </p>
            </>
          ),
        },
        {
          id: "voice",
          label: "Reconhecimento de voz",
          content:
            typeof v.id === "string" ? (
              <ResidentVoice
                residentId={v.id}
                endpoints={homeOptions(options, "endpoints", v.homeId)}
                enabled={Boolean(v.enabled)}
              />
            ) : (
              <p className="hint">Salve este morador e abra a edição para cadastrar sua voz.</p>
            ),
        },
        {
          id: "calendar",
          label: "Agenda",
          content:
            typeof v.id === "string" ? (
              <ResidentCalendar residentId={v.id} enabled={Boolean(v.enabled)} />
            ) : (
              <p className="hint">Salve este morador e abra a edição para vincular sua agenda.</p>
            ),
        },
      ]}
    />
  );
}
