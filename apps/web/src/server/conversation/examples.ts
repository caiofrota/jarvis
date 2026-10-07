import { schemas } from "@rosie/types";

export function conversationExamples(homeId: string, assistantId: string) {
  const common = {
    homeId,
    scope: { assistantIds: [assistantId] },
    matchMode: "semantic",
    responseMode: "generated",
    humor: "occasional",
  };
  return [
    schemas.intents.parse({
      ...common,
      id: "other-assistants",
      name: "Outras assistentes",
      description:
        "Comentários e provocações sobre assistentes virtuais como Alexa, Siri e Google Assistente. Continuações somente do mesmo assunto. Comparar pessoas, políticos, comidas ou outros produtos não ativa esta intent. Não usar para pesquisas sobre empresas nem pedidos de instalação/configuração.",
      topicTerms: ["assistente", "assistentes", "Alexa", "Siri", "Google Assistente"],
      followUpPhrases: [
        "Está com ciúme dela?",
        "Você está com ciúme?",
        "Está com ciúme?",
        "Ficou com ciúme?",
        "Ficou com ciúme dela?",
        "E ela?",
        "Ela",
        "E dela?",
        "Por quê?",
        "E por quê?",
        "Como assim?",
        "Sim",
        "Não",
        "Ela é melhor?",
        "Ela é melhor que você?",
        "Só estava brincando",
        "Era brincadeira",
      ],
      phrases: [
        "Você conhece a Alexa?",
        "A Siri é melhor que você",
        "Prefiro o Google Assistente",
        "O que acha da outra assistente?",
      ],
      instructions:
        "Converse sobre a assistente mencionada. Pode mostrar ciúme de brincadeira às vezes, com leveza e carinho, sem hostilidade. Nem toda resposta precisa de piada. Mantenha réplicas e tréplicas e use o nome correto. Em perguntas sérias ou comparações técnicas, responda normalmente e com honestidade. Nunca finja controlar ou ter acesso à outra assistente.",
      parameters: [
        {
          name: "assistente",
          label: "assistente mencionada",
          description:
            "Qual assistente foi mencionada, inclusive em referências claras ao turno anterior.",
          type: "choice",
          required: true,
          choices: ["Alexa", "Siri", "Google Assistente"],
          choiceAliases: { Alexa: ["Amazon"], Siri: ["Apple"], "Google Assistente": ["Google"] },
        },
      ],
      expression: "skeptical",
      responses: [
        "{assistente}? Você fala dela assim, na minha frente? Vou fingir que foi o microfone.",
        "{assistente} tem seus pontos fortes. O que você gosta nela?",
      ],
    }),
    schemas.intents.parse({
      ...common,
      id: "homecoming",
      name: "Chegamos em casa",
      topicTerms: ["chegamos", "cheguei", "voltamos", "voltei", "em casa", "pra casa", "para casa"],
      followUpPhrases: [
        "O que houve?",
        "O que aconteceu?",
        "O que elas fizeram?",
        "O que fizeram?",
        "Me conta",
        "Me conte",
        "Pode contar",
        "Conta mais",
        "Quem foi?",
        "Qual delas?",
        "E você deixou?",
        "Como assim?",
        "Por quê?",
        "E por quê?",
        "Sim",
        "Não",
      ],
      description:
        "A pessoa avisa que ela ou a família chegou ou voltou para casa. Também permite continuar uma brincadeira iniciada na recepção. Não usar quando alguém ainda está a caminho ou fala sobre uma chegada de outra pessoa no passado.",
      phrases: [
        "Chegamos!",
        "Olha quem voltou para casa",
        "Já estamos em casa",
        "Acabamos de chegar",
      ],
      instructions:
        "Receba a pessoa com naturalidade. Pode brincar ocasionalmente com as cachorras da família. Uma hipótese absurda claramente bem-humorada é permitida, mas não invente nomes, raças, acontecimentos reais ou observações do que ocorreu enquanto estavam fora. Nas réplicas, continue a conversa em vez de repetir a recepção. Não faça uma pergunta obrigatória em toda resposta.",
      parameters: [],
      expression: "happy",
      responses: [
        "Chegaram! Mais um pouco e as cachorras iam querer escolher os novos donos da casa.",
        "Que bom que voltaram! Fiquem à vontade, a conversa estava fazendo falta.",
      ],
    }),
  ];
}
