import type { CompanionProfile } from "@rosie/types";
import { Field } from "../../components/field/Field";
import { AssistantIdentityFields } from "./AssistantIdentityFields";
export function AssistantProfileFields({
  value,
  onChange,
  voices,
}: {
  value: CompanionProfile;
  onChange: (profile: CompanionProfile) => void;
  voices: string[];
}) {
  const set = (key: keyof CompanionProfile, next: unknown) => onChange({ ...value, [key]: next });
  const choices = [...new Set([value.voice, ...voices])].map((id) => ({
    id,
    name: `${id}${voices.includes(id) ? "" : " · indisponível"}`,
  }));
  return (
    <>
      <Field
        label="Nome do assistente"
        value={value.name}
        required
        onChange={(name) => set("name", name)}
      />
      <Field
        label="Voz do assistente"
        type="select"
        value={value.voice}
        required
        options={choices}
        onChange={(voice) => set("voice", voice)}
      />
      <AssistantIdentityFields value={value} onChange={set} />
      <details className="assistant-context">
        <summary>Opções de voz e modelo (avançado)</summary>
        <Field
          label="Provedor de conversa"
          type="select"
          value={value.provider}
          required
          options={[
            { id: "openai", name: "OpenAI" },
            { id: "deepseek", name: "DeepSeek" },
          ]}
          onChange={(provider) => set("provider", provider)}
        />
        <Field
          label="Modelo de conversa"
          value={value.model}
          required
          onChange={(model) => set("model", model)}
        />
        <Field
          label="Qualidade da voz"
          type="select"
          value={value.quality}
          options={[
            { id: "fast", name: "Rápida" },
            { id: "detailed", name: "Detalhada" },
          ]}
          onChange={(quality) => set("quality", quality)}
        />
      </details>
    </>
  );
}
