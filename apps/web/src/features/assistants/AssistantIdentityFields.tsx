import { Field } from "../../components/field/Field";

export function AssistantIdentityFields({
  value,
  onChange,
  children,
}: {
  value: { personality?: unknown; worldview?: unknown; facts?: unknown };
  onChange: (key: "personality" | "worldview" | "facts", value: unknown) => void;
  children?: React.ReactNode;
}) {
  return (
    <>
      <Field
        label="Personalidade"
        type="textarea"
        value={value.personality}
        onChange={(next) => onChange("personality", next)}
        hint="Como o assistente conversa: tom, humor e jeito de responder."
      />
      <details className="assistant-context">
        <summary>
          Contexto adicional (opcional){value.worldview || value.facts ? " · configurado" : ""}
        </summary>
        <p>Preencha apenas se quiser informações ou opiniões específicas para esta personagem.</p>
        <Field
          label="Informações do assistente"
          type="textarea"
          value={value.facts}
          onChange={(next) => onChange("facts", next)}
          hint="Dados sobre a personagem que ela deve lembrar. Não cadastre senhas ou credenciais."
        />
        <Field
          label="Visão de mundo e posicionamento"
          type="textarea"
          value={value.worldview}
          onChange={(next) => onChange("worldview", next)}
          hint="Valores e perspectivas usados quando você pedir uma opinião. Não substituem fatos nem as regras de controle dos dispositivos."
        />
        {children}
      </details>
    </>
  );
}
