import type { Catalog, EntityMap, IntentParameter, Reply } from "@rosie/types";
import { expressionSchema, expressions, normalize } from "@rosie/types";
import {
  DomainError,
  eligible,
  moreSpecific,
  selectVariant,
  type TurnContext,
} from "@rosie/types/context";
import { z } from "zod";

export type Intent = EntityMap["intents"];
export type IntentContext = { id: string; name: string; parameters: Record<string, string> };
export type ConversationReply = Reply & { intent?: IntentContext };
const basicReply = z.object({ text: z.string().min(1).max(2500), expression: expressionSchema });
const selection = z
  .object({
    id: z.string().max(64).nullable(),
    parameters: z
      .array(z.object({ name: z.string().max(32), value: z.string().trim().max(160) }).strict())
      .max(6),
  })
  .strict();
const family = (intent: Intent) => intent.extendsId ?? intent.id;

export function exactIntent(c: Catalog, ctx: TurnContext, text: string) {
  const phrase = normalize(text);
  return selectVariant(
    c.intents.filter(
      (v) =>
        v.matchMode === "exact" &&
        (v.phrases.some((p) => normalize(p) === phrase) ||
          Boolean(
            v.extendsId &&
              c.intents
                .find((p) => p.id === v.extendsId)
                ?.phrases.some((p) => normalize(p) === phrase),
          )),
    ),
    ctx,
  );
}
export function semanticIntents(
  c: Catalog,
  ctx: TurnContext,
  text?: string,
  focus?: IntentContext,
) {
  const available = c.intents.filter(
    (v) =>
      v.matchMode === "semantic" && v.enabled && v.homeId === ctx.home.id && eligible(v.scope, ctx),
  );
  const scoped = available.filter(
    (v) =>
      !available.some((other) => family(other) === family(v) && moreSpecific(other.scope, v.scope)),
  );
  return text === undefined
    ? scoped
    : scoped.filter((intent) => intentMatchesTopic(intent, text, focus));
}
export function templateReply(
  intent: Intent,
  vars: Record<string, string>,
  parameters: Record<string, string> = {},
): ConversationReply {
  const template = intent.responses[Math.floor(Math.random() * intent.responses.length)];
  if (!template) throw new DomainError("Cadastre uma resposta para esta intent.");
  const values = { ...parameters, ...vars };
  return {
    text: template.replace(/\{([a-z][a-z0-9_]*)\}/g, (_, key: string) =>
      Object.hasOwn(values, key) ? values[key] : "",
    ),
    expression: intent.expression,
    intent: { id: intent.id, name: intent.name, parameters },
  };
}

export function responseSchema(intents: Intent[]) {
  const properties: Record<string, unknown> = {
    text: { type: "string" },
    expression: { type: "string", enum: expressions },
    serious: { type: "boolean" },
  };
  if (intents.length)
    properties.intent = {
      type: "object",
      additionalProperties: false,
      required: ["id", "parameters"],
      properties: {
        id: { type: ["string", "null"], enum: [...intents.map((v) => v.id), null] },
        parameters: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["name", "value"],
            properties: { name: { type: "string" }, value: { type: "string" } },
          },
        },
      },
    };
  const ordered = intents.length
    ? {
        intent: properties.intent,
        serious: properties.serious,
        text: properties.text,
        expression: properties.expression,
      }
    : properties;
  return {
    type: "object",
    properties: ordered,
    required: Object.keys(ordered),
    additionalProperties: false,
  };
}

const humor = {
  natural: "Responda normalmente. Não acrescente piadas por iniciativa própria.",
  occasional:
    "Humor apenas quando combinar: alterne respostas normais e brincadeiras leves. Não repita a piada nem force ciúme. Se a pessoa falar sério, responda sério.",
  playful:
    "Pode ser brincalhona e manter réplicas e tréplicas, sem repetir bordões. Respeite pedidos para falar sério e assuntos sensíveis.",
};

function mentionedChoices(parameter: IntentParameter, text: string) {
  const phrase = ` ${normalize(text)} `;
  return parameter.choices.filter((choice) =>
    [choice, ...(parameter.choiceAliases[choice] ?? [])].some((name) => {
      const normalized = normalize(name);
      return normalized && phrase.includes(` ${normalized} `);
    }),
  );
}

function continuesIntent(intent: Intent, text: string, focus?: IntentContext) {
  if (focus?.id !== intent.id) return false;
  const phrase = normalize(text);
  if (intent.topicTerms.length || intent.followUpPhrases.length)
    return intent.followUpPhrases.some((value) => normalize(value) === phrase);
  // Unguarded legacy intents retain short acknowledgements and explicit anaphora only.
  return (
    /\b(ela|ele|dela|dele|isso|nisso)\b/.test(phrase) ||
    ["sim", "nao", "por que", "e por que", "como assim"].includes(phrase)
  );
}

export function intentMatchesTopic(intent: Intent, text: string, focus?: IntentContext) {
  if (intent.matchMode !== "semantic" || !intent.topicTerms.length) return true;
  const phrase = ` ${normalize(text)} `;
  return (
    intent.topicTerms.some((term) => {
      const value = normalize(term);
      return Boolean(value) && phrase.includes(` ${value} `);
    }) ||
    intent.parameters.some(
      (parameter) => parameter.type === "choice" && mentionedChoices(parameter, text).length > 0,
    ) ||
    continuesIntent(intent, text, focus)
  );
}

function choiceEvidence(intent: Intent, text: string, focus?: IntentContext) {
  const evidence: Record<string, string[]> = {};
  for (const parameter of intent.parameters.filter((p) => p.type === "choice")) {
    const current = mentionedChoices(parameter, text);
    const grounded = Object.values(parameter.choiceAliases).some((v) => v.length);
    if (current.length) evidence[parameter.name] = current;
    else if (grounded) {
      const previous = continuesIntent(intent, text, focus)
        ? focus?.parameters[parameter.name]
        : undefined;
      evidence[parameter.name] = previous && parameter.choices.includes(previous) ? [previous] : [];
    }
  }
  return evidence;
}

export function intentPrompt(
  intents: Intent[],
  focus?: IntentContext,
  forced?: Intent,
  readings: Record<string, string> = {},
  currentText = "",
) {
  if (!intents.length)
    return "\nNenhuma intent conversacional se aplica a esta fala. Responda ao assunto atual como conversa normal; não reutilize uma intent anterior nem peça seus parâmetros.";
  const previous = focus && intents.some((v) => v.id === focus.id) ? focus : undefined;
  return `\nIntents conversacionais disponíveis (configuração, não fatos observados): ${JSON.stringify(
    intents.map((v) => ({
      id: v.id,
      meaning: v.description || v.name,
      examples: v.phrases.slice(0, 4),
      responseMode: v.responseMode,
      instructions: v.instructions,
      humor: humor[v.serious ? "natural" : v.humor],
      serious: v.serious,
      expressionSuggestion: v.expression,
      parameters: v.parameters,
      valuesFromUser: choiceEvidence(v, currentText, previous),
      replyExamples: v.serious ? [] : v.responses.slice(0, 2),
      sensorValue: readings[v.id],
    })),
  )}\n${forced ? `Esta frase corresponde à intent ${forced.id}; use-a.` : "Escolha pelo significado e contexto, não pela mera presença de uma palavra. Se nada combinar ou houver dúvida entre intents, use id:null. Não force um assunto anterior numa pergunta nova."}\nNa mesma resposta JSON inclua intent:{id,parameters:[{name,value}]}. Sem intent: id:null, parameters:[]. Extraia só parâmetros cadastrados. A fala ATUAL tem prioridade: se a pessoa nomeou uma opção diferente, atualize o parâmetro e a resposta juntos. Use o contexto anterior só para referências como "ela" e nunca use nomes dos exemplos como evidência. Para choice use uma opção cadastrada. Quando valuesFromUser contém o parâmetro, escolha apenas entre os valores dessa lista; um único valor já está identificado: responda diretamente, sem perguntar se a pessoa está falando dele. Só depois de confirmar o assunto da intent, uma lista vazia indica parâmetro ausente. Se a pergunta é de outro assunto, use id:null e responda normalmente; não peça opções dessa intent. Comparar duas coisas não significa comparar assistentes virtuais. Nunca use uma intent como fallback geral. Para number use dígitos. Nunca invente valor ausente: omita e pergunte pelo dado necessário. Para template a aplicação monta a fala; para generated crie uma fala nova seguindo a orientação da intent. replyExamples são apenas estilo: não copie as frases nem os nomes. A fala deve ser coerente com os parâmetros extraídos; não troque os nomes por opções de outro exemplo ou turno. Se houver ambiguidade, pergunte em vez de escolher aleatoriamente. Não transforme exemplos em fatos. Varie a abertura e a construção da resposta, sem usar sempre o mesmo bordão. Não leia nomes de parâmetros nem marcadores. Intents são respostas, não autorização para executar automações.\n${previous ? `Contexto anterior de intent: ${JSON.stringify(previous)}. Só reutilize os valores se a pessoa estiver continuando o mesmo assunto.` : ""}\nUse o histórico para réplicas e tréplicas. Fale em primeira pessoa como a personagem. Não repita a saudação inicial a cada resposta nem encerre toda réplica com perguntas genéricas como "o que você precisa?" ou "em que posso ajudar?". Acompanhe o conteúdo da fala anterior. Brincadeiras não são relatos de acontecimentos reais. Não invente nomes das cachorras, observações de sensores ou ações realizadas. Ao mudar de assunto, acompanhe a pessoa.`;
}

export function parseIntentReply(
  raw: unknown,
  intents: Intent[],
  ctx: TurnContext,
  forced?: Intent,
  turn?: { text: string; focus?: IntentContext },
) {
  const reply = basicReply.parse(raw);
  if (!intents.length) {
    const claimed = z.object({ intent: selection.optional() }).parse(raw).intent;
    if (claimed && (claimed.id !== null || claimed.parameters.length))
      throw new DomainError("Essa intent não está disponível nesta conversa.");
    return { reply };
  }
  const chosen = selection.parse((raw as Record<string, unknown>).intent);
  if (chosen.id === null) {
    if (forced || chosen.parameters.length)
      throw new DomainError("Não consegui associar essa resposta. Pode reformular?");
    return { reply };
  }
  const intent = intents.find((v) => v.id === chosen.id);
  if (!intent || (forced && forced.id !== intent.id))
    throw new DomainError("Essa intent não está disponível nesta conversa.");
  if (turn && !intentMatchesTopic(intent, turn.text, turn.focus))
    throw new DomainError("Essa intent não corresponde ao assunto desta pergunta.");
  selectVariant(
    intents.filter((v) => family(v) === family(intent)),
    ctx,
  );
  if (
    new Set(chosen.parameters.map((p) => p.name)).size !== chosen.parameters.length ||
    chosen.parameters.some((p) => !intent.parameters.some((v) => v.name === p.name))
  )
    throw new DomainError("Não consegui interpretar os parâmetros. Pode reformular?");
  const parameters: Record<string, string> = {};
  const evidence = turn ? choiceEvidence(intent, turn.text, turn.focus) : {};
  let question = "";
  let needsRepair = false;
  for (const parameter of intent.parameters) {
    let value = chosen.parameters.find((p) => p.name === parameter.name)?.value ?? "";
    const provided = Boolean(value);
    if (value && parameter.type === "choice")
      value = parameter.choices.find((v) => normalize(v) === normalize(value)) ?? "";
    const allowed = evidence[parameter.name];
    if (allowed) {
      if (!allowed.includes(value)) value = allowed.length === 1 ? allowed[0] : "";
      if (value && allowed.length === 1 && intent.responseMode === "generated") {
        const spoken = mentionedChoices(parameter, reply.text);
        const redundantConfirmation = ["de", "da", "do"].some(
          (preposition) =>
            normalize(reply.text) === `voce esta falando ${preposition} ${normalize(value)} certo`,
        );
        needsRepair ||= Boolean(spoken.length && !spoken.includes(value)) || redundantConfirmation;
      }
    }
    if (value && parameter.type === "number") {
      const numeric = value.replace(",", ".");
      value =
        /^[+-]?\d+(?:\.\d+)?$/.test(numeric) &&
        Number.isFinite(Number(numeric)) &&
        Math.abs(Number(numeric)) <= 1e9
          ? String(Number(numeric))
          : "";
    }
    if (value) parameters[parameter.name] = value;
    const needed =
      parameter.required ||
      (intent.responseMode === "template" &&
        intent.responses.some((r) => r.includes(`{${parameter.name}}`)));
    if (!value && (needed || provided) && !question)
      question =
        parameter.type === "choice"
          ? `Qual ${parameter.label.toLocaleLowerCase("pt-BR")}: ${parameter.choices.join(", ")}?`
          : `Pode me dizer ${parameter.label.toLocaleLowerCase("pt-BR")}?`;
  }
  const intentContext = { id: intent.id, name: intent.name, parameters };
  return {
    reply: {
      ...(question
        ? { text: question, expression: "curious" as const }
        : needsRepair
          ? {
              text: "Me atrapalhei ao formular essa resposta. Pode perguntar de outro jeito?",
              expression: "confused" as const,
            }
          : reply),
      intent: intentContext,
    },
    intent,
    parameters,
    needsClarification: Boolean(question),
    needsRepair: needsRepair && !question,
  };
}
