import { normalize, type Reply } from "@rosie/types";
import type { TurnContext } from "@rosie/types/context";

const questions = [
  /^(?:(?:voce )?(?:sabe|lembra|consegue (?:dizer|me dizer|identificar)) |(?:me )?(?:diga|diz|fale) )?quem (?:eu sou|sou eu)$/,
  /^(?:(?:voce )?(?:sabe|lembra|consegue (?:dizer|me dizer|identificar)) |(?:me )?(?:diga|diz|fale) )?quem (?:esta|ta) falando(?: (?:com voce|ai|aqui))?(?: agora)?$/,
  /^(?:voce )?(?:sabe|consegue (?:dizer|me dizer|identificar)) com quem (?:esta|ta) falando$/,
  /^(?:(?:voce )?(?:sabe|lembra) )?(?:qual (?:e )?)?(?:o )?meu nome$/,
  /^(?:voce )?(?:me (?:reconhece|identificou|reconheceu)|consegue me (?:reconhecer|identificar))(?: pela voz)?$/,
  /^(?:voce )?(?:(?:reconhece|reconheceu|identificou)|consegue (?:reconhecer|identificar)) (?:a )?minha voz$/,
];

export function speakerIdentityReply(
  text: string,
  ctx: TurnContext,
  residentId?: string | null,
): Reply | null {
  let value = normalize(text),
    previous = "";
  const edges = ["por favor", "rosy", "rozi", ctx.assistant.name, ...ctx.assistant.aliases]
    .map(normalize)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  while (value !== previous) {
    previous = value;
    for (const edge of edges) {
      if (value.startsWith(`${edge} `)) value = value.slice(edge.length + 1);
      if (value.endsWith(` ${edge}`)) value = value.slice(0, -edge.length - 1);
    }
    value = value.trim();
  }
  if (!questions.some((pattern) => pattern.test(value))) return null;
  if (!ctx.resident)
    return {
      text: "Ainda não identifiquei sua voz com segurança. Pode repetir?",
      expression: "curious",
    };
  return {
    text:
      residentId === undefined
        ? `O perfil selecionado nesta caixinha é o de ${ctx.resident.name}.`
        : `Reconheci sua voz, ${ctx.resident.name}!`,
    expression: "happy",
  };
}

export function speakerIdentityContext(ctx: TurnContext, residentId?: string | null) {
  const capability =
    "A caixinha usa um serviço local de reconhecimento de voz e o servidor informa o resultado aqui. Você recebe a transcrição e esse resultado, não o áudio bruto.";
  if (!ctx.resident)
    return `${capability} Nesta conversa não há uma pessoa identificada. Não deduza o nome de cadastros, histórico, exemplos ou de outra caixinha. Quando perguntarem quem está falando, diga que ainda não houve identificação suficiente; não diga que a Rosie não tem reconhecimento de voz.`;
  const source =
    residentId === undefined
      ? `Perfil selecionado manualmente nesta caixinha: ${ctx.resident.name}. Isso não comprova reconhecimento pela voz.`
      : `Pessoa reconhecida pelo serviço local de voz nesta conversa: ${ctx.resident.name}. Use esse nome ao responder quem está falando. Você pode reconhecer essa informação fornecida pelo servidor; não responda que não sabe quem é a pessoa ou que a Rosie não consegue identificar vozes.`;
  return `${capability} ${source} O resultado serve para personalizar a conversa, não para autenticar ou liberar acesso. Preferências dessa pessoa: ${ctx.resident.preferences}. Informações: ${ctx.resident.facts}.`;
}
