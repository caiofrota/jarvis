import { Field } from "../../../components/field/Field";
import { AssistantIdentityFields } from "../../assistants/AssistantIdentityFields";
import { ConversationModelField } from "../../assistants/ConversationModelField";
import { VoicePreview } from "../../voice-preview/VoicePreview";
import { voiceLabel, voiceProvider } from "../../voice-preview/voice-label";
import type { FormProps } from "./types";
export function AssistantFields({ value: v, set, voices, cloudHomeId, voiceNames }: FormProps) {
  const external = /^(openai|elevenlabs)-/.test(String(v.voice));
  const cloud = String(v.voice).startsWith("ha-cloud-");
  const available = voices.filter((id) => !id.startsWith("ha-cloud-") || v.homeId === cloudHomeId);
  const current = String(v.voice ?? "");
  const choices = current && !available.includes(current) ? [...available, current] : available;
  return (
    <>
      <fieldset>
        <legend>Identidade</legend>
        <AssistantIdentityFields value={v} onChange={set}>
          <Field
            label="Outros nomes"
            type="lines"
            value={v.aliases}
            onChange={(x) => set("aliases", x)}
            hint="Um por linha."
          />
        </AssistantIdentityFields>
      </fieldset>
      <fieldset>
        <legend>Voz e conversa</legend>
        <Field
          label="Voz"
          type="select"
          value={v.voice}
          onChange={(x) => set("voice", x)}
          options={choices.map((id) => ({
            id,
            name: voiceLabel(id, voiceNames) + (available.includes(id) ? "" : " · indisponível"),
          }))}
          required
          hint={`Provedor da voz: ${voiceProvider(current)}. ${
            external
              ? "Voz gerada por IA. Envia o texto da resposta à OpenAI ou ElevenLabs, com cobrança pela API. O reconhecimento continua local."
              : cloud
                ? "Gera a fala na nuvem usando sua assinatura do Home Assistant Cloud. Envia o texto da resposta e precisa de internet. O reconhecimento da sua fala continua local."
                : "Gera a fala neste servidor. Não usa um serviço de voz na nuvem."
          }`}
        />
        <p className="field-hint">
          Ouvir uma amostra não altera a voz do assistente. Salve para aplicar às caixinhas
          vinculadas a ele.
        </p>
        {typeof v.id === "string" && (
          <VoicePreview
            key={`${v.id}:${v.voice}`}
            assistantId={v.id}
            name={String(v.name)}
            voice={String(v.voice)}
          />
        )}
        <details className="assistant-context">
          <summary>Opções de voz e modelo (avançado)</summary>
          {!cloud && (
            <Field
              label="Qualidade da voz"
              type="select"
              value={v.quality}
              onChange={(x) => set("quality", x)}
              options={[
                { id: "fast", name: "Rápida" },
                { id: "detailed", name: "Detalhada" },
              ]}
            />
          )}
          <Field
            label="Provedor de conversa"
            type="select"
            value={v.provider}
            onChange={(x) => set("provider", x)}
            options={[
              { id: "openai", name: "OpenAI" },
              { id: "deepseek", name: "DeepSeek" },
            ]}
          />
          <ConversationModelField
            key={String(v.provider)}
            provider={String(v.provider)}
            model={String(v.model)}
            onChange={(model) => set("model", model)}
          />
          <Field
            label="Limite de tokens por resposta"
            type="number"
            min={64}
            max={1000}
            value={v.maxOutputTokens}
            onChange={(x) => set("maxOutputTokens", x)}
          />
          <Field
            label="Turnos de histórico"
            type="number"
            min={0}
            max={12}
            value={v.historyTurns}
            onChange={(x) => set("historyTurns", x)}
          />
        </details>
      </fieldset>
    </>
  );
}
