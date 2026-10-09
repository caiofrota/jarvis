import type { IntentParameter } from "@rosie/types";
import { Field } from "../../../components/field/Field";
import {
  expressionLabels,
  intentHumorLabels,
  intentMatchLabels,
  intentResponseLabels,
} from "../../../i18n/pt-BR";
import { IntentParameters } from "./IntentParameters/IntentParameters";
import { IntentResponseRules } from "./IntentResponseRules";
import { ScopeFields } from "./ScopeFields";
import { type FormProps, homeOptions } from "./types";
export function IntentFields(props: FormProps) {
  const { value: v, set, options } = props;
  const semantic = v.matchMode === "semantic",
    generated = v.responseMode === "generated";
  return (
    <>
      <div className="form-grid">
        <Field
          label="Reconhecimento"
          type="select"
          value={v.matchMode ?? "exact"}
          onChange={(x) => {
            set("matchMode", x);
            if (x === "exact") set("parameters", []);
          }}
          options={Object.entries(intentMatchLabels).map(([id, name]) => ({ id, name }))}
          hint="Por significado reconhece variações usando o modelo de conversa configurado."
        />
        <Field
          label="Tipo de resposta"
          type="select"
          value={v.responseMode ?? "template"}
          onChange={(x) => set("responseMode", x)}
          options={Object.entries(intentResponseLabels).map(([id, name]) => ({ id, name }))}
        />
      </div>
      <Field
        label="Frases que você diz"
        type="lines"
        value={v.phrases}
        onChange={(x) => set("phrases", x)}
        hint={
          semantic
            ? "Exemplos, um por linha. Outras frases com o mesmo significado também podem ativar esta intent."
            : "Uma frase por linha. Ignora acentos, pontuação e maiúsculas; não interpreta sinônimos."
        }
        required
      />
      {semantic && (
        <>
          <Field
            label="Quando usar esta intent"
            type="textarea"
            value={v.description}
            onChange={(x) => set("description", x)}
            hint="Descreva o assunto e o que não deve ativá-la. Exemplo: comentários sobre outras assistentes; não confundir com uma pesquisa sobre a empresa Google."
            required
          />
          <details>
            <summary>Proteção contra assuntos diferentes</summary>
            <Field
              label="Referências ao assunto"
              type="lines"
              value={v.topicTerms ?? []}
              onChange={(x) => set("topicTerms", x)}
              hint="Opcional, uma palavra ou expressão por linha. Exige uma dessas referências na fala antes de considerar esta intent; opções e apelidos dos parâmetros também contam. Exemplo: assistente, Alexa, Siri. Vazio deixa a seleção apenas por significado."
            />
            <Field
              label="Frases de continuação"
              type="lines"
              value={v.followUpPhrases ?? []}
              onChange={(x) => set("followUpPhrases", x)}
              hint="Uma frase completa por linha, como ‘está com ciúme dela?’. Permite continuar sem repetir o assunto somente enquanto esta intent está ativa. Ignora acentos, maiúsculas e pontuação. Uma nova pergunta sem referência segue como conversa normal."
            />
          </details>
        </>
      )}
      {generated && (
        <>
          <Field
            label="Como responder"
            type="textarea"
            value={v.instructions}
            onChange={(x) => set("instructions", x)}
            hint="Oriente o assunto e o jeito da resposta. A conversa recente ajuda a continuar a brincadeira."
            required
          />
          {!v.serious && (
            <Field
              label="Estilo da conversa"
              type="select"
              value={v.humor ?? "occasional"}
              onChange={(x) => set("humor", x)}
              options={Object.entries(intentHumorLabels).map(([id, name]) => ({ id, name }))}
              hint="Define o jeito de falar: normal, brincadeiras ocasionais ou mais brincalhão. Não controla a carinha no OLED."
            />
          )}
        </>
      )}
      <Field
        label="Sempre responder com seriedade"
        type="checkbox"
        value={v.serious ?? false}
        onChange={(x) => set("serious", x)}
        hint="Nas respostas geradas, tem prioridade sobre humor e exemplos. Em respostas prontas, cadastre frases sérias. Assuntos sensíveis e pedidos para falar sério também recebem orientação de seriedade."
      />
      <Field
        label={generated ? "Exemplos de resposta (opcional)" : "Respostas possíveis"}
        type="lines"
        value={v.responses}
        onChange={(x) => set("responses", x)}
        hint={
          generated
            ? "Referências de estilo, não falas fixas. Use {assistente} ou outro parâmetro no lugar de nomes que mudam; deixe vazio para criar livremente."
            : "Uma resposta por linha. Use {valor}, {nome}, {ambiente}, {robo}, {cidade}, {pessoa} ou um parâmetro cadastrado. Parâmetros usados na resposta precisam de um valor."
        }
        required={!generated}
      />
      {semantic && (
        <IntentParameters
          value={(v.parameters ?? []) as IntentParameter[]}
          onChange={(x) => set("parameters", x)}
        />
      )}
      <Field
        label="Expressão no rosto"
        type="select"
        value={v.expression}
        onChange={(x) => set("expression", x)}
        options={Object.entries(expressionLabels).map(([id, name]) => ({ id, name }))}
        hint={
          generated
            ? "Sugestão para a carinha do OLED. Nas respostas geradas, ela pode mudar para acompanhar o conteúdo; não define o humor da fala."
            : "Carinha exibida no OLED enquanto fala esta resposta pronta."
        }
      />
      <Field
        label="Fonte de dados"
        type="select"
        value={v.dataSource ?? "sensor"}
        onChange={(x) => {
          set("dataSource", x);
          if (x === "weather") set("deviceId", null);
        }}
        options={[
          { id: "sensor", name: "Sensor MQTT (opcional)" },
          { id: "weather", name: "Clima da cidade · Open-Meteo" },
        ]}
      />
      {v.dataSource === "weather" ? (
        <p className="hint">
          Usa o local do clima selecionado em Casas. {"{valor}"} é a temperatura em °C;{" "}
          {"{condicao}"} descreve o céu. A consulta é pela internet, com cache de 10 minutos.
        </p>
      ) : (
        <>
          <Field
            label="Sensor que fornece o valor"
            type="select"
            nullable
            value={v.deviceId}
            onChange={(x) => set("deviceId", x)}
            options={homeOptions(options, "devices", v.homeId)}
            hint="Opcional. Escolha um sensor cadastrado em Dispositivos para preencher {valor}, por exemplo, a temperatura externa. Frases sem dados não precisam de sensor."
          />
          {!!v.deviceId && (
            <Field
              label="Validade da leitura MQTT (s)"
              type="number"
              min={30}
              max={86400}
              value={v.sensorMaxAgeSeconds ?? 900}
              onChange={(x) => set("sensorMaxAgeSeconds", x)}
              hint="Conta desde o recebimento. Publique periodicamente para manter a leitura recente."
            />
          )}
        </>
      )}
      <IntentResponseRules {...props} />
      <details>
        <summary>Avançado: versão de outra intent</summary>
        <Field
          label="Intent original (opcional)"
          type="select"
          nullable
          value={v.extendsId}
          onChange={(x) => set("extendsId", x)}
          options={homeOptions(options, "intents", v.homeId).filter((x) => x.id !== v.id)}
          hint="Use só para criar uma versão mais específica de outra intent, com as mesmas frases, para um morador, ambiente ou modo. Para mudar respostas conforme temperatura ou horário, prefira as regras acima."
        />
      </details>
      <ScopeFields {...props} />
      {(semantic || generated) && (
        <p>
          Esta opção usa o provedor de conversa e consome tokens. Frase exata com resposta pronta
          continua funcionando sem essa chamada. O histórico é separado por caixinha e termina
          quando a conversa é encerrada.
        </p>
      )}
    </>
  );
}
