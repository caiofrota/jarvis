import type { SearchPresentation } from "../conversation/weather-request";
import { spokenText } from "../voice/text";

export const defaultPresentation: SearchPresentation = {
  weather: false,
  period: "now",
  fahrenheit: false,
  detailed: false,
};

export function searchAnswerInstructions(p: SearchPresentation): string {
  const flight = p.flight
    ? " Para passagens: priorize opções econômicas dentro dos critérios, sem prometer a menor tarifa de todas as datas. Informe brevemente os critérios assumidos (ida/volta, janela de saída e duração), a origem e o preço por pessoa. Diga as datas da oferta e se o preço inclui ida e volta. Se a fonte não confirmar essas datas ou os dois trechos, apresente apenas como referência da rota, nunca como oferta confirmada para o pedido. Não use uma tarifa de só ida como preço de ida e volta. Se a consulta tiver um passageiro, use um adulto. Total do grupo só se publicado; não multiplique uma tarifa individual presumindo lugares para todos. Preserve aeroportos explícitos. Se a origem for uma cidade sem aeroporto comercial, procure o aeroporto comercial mais próximo nessa mesma busca e informe qual foi usado; não invente código ou proximidade."
    : "";
  const parts = p.dayparts
    ?.map((part) => ({ morning: "manhã", afternoon: "tarde", night: "noite" })[part])
    .join(" e ");
  const scope =
    p.period === "now"
      ? "Somente as condições atuais; não acrescente previsão diária ou semanal."
      : p.period === "today"
        ? "Somente hoje; não acrescente os próximos dias."
        : "Respeite exatamente o período pedido. Resuma a tendência; não leia um boletim dia a dia, salvo pedido explícito.";
  return `A resposta será falada por um robô de mesa. Use ${p.detailed ? "até 100 palavras e cinco" : p.weather ? "até 45 palavras e duas" : "até 65 palavras e três"} frases curtas. Vá direto à informação; sem introdução, relatório, tabela, lista, emojis, símbolos, cartão meteorológico ou pergunta genérica no final. Escreva unidades por extenso e use português brasileiro coloquial. Preserve ressalvas essenciais junto dos fatos, preços ou orientações.${flight} ${p.weather ? `Para o clima: ${scope} ${parts ? `O usuário pediu especificamente ${parts}. Busque essa parte do dia; se só encontrar dados diários, avise logo no início que não encontrou esse horário. Não atribua uma mínima, máxima ou probabilidade diária a esse horário.` : ""} Use somente graus ${p.fahrenheit ? "Fahrenheit" : "Celsius; converta Fahrenheit quando necessário"}, sem duplicar unidades. Prefira 'algumas nuvens' a 'nuvens espaçadas' e 'chance de chuva' a 'probabilidade de precipitação'. Diga 'hoje' ou 'amanhã' quando apropriado, sem ler a data completa. Temperatura e condição do céu bastam; acrescente chance de chuva, vento ou outros detalhes só se pedidos ou relevantes à pergunta. Não transforme previsão em observação atual.` : ""}`;
}

/** Bound spoken search output locally; never spend another model call to shorten it. */
export function formatSearchAnswer(raw: string, p = defaultPresentation): string {
  let text = raw
    .replace(/℃/gu, "°C")
    .replace(/℉/gu, "°F")
    .replace(/−(?=\d)/gu, "-");
  if (p.weather) {
    if (p.period !== "requested") {
      // Discard an unsolicited forecast widget, preserving any current-condition preamble.
      text = text.split(
        /(?:daily forecast|previs[aã]o di[aá]ria|previs[aã]o (?:para os pr[oó]ximos dias|semanal))\s*:/iu,
      )[0];
    }
    if (!p.fahrenheit) {
      // Prefer the explicitly supplied Celsius value over recomputing a dual-unit result.
      text = text.replace(
        /-?\d+(?:[.,]\d+)?\s*(?:[°º]\s*F|graus Fahrenheit)\s*\(\s*(-?\d+(?:[.,]\d+)?\s*(?:[°º]\s*C|graus Celsius))\s*\)/giu,
        "$1",
      );
      text = text.replace(
        /(-?\d+(?:[.,]\d+)?\s*(?:[°º]\s*C|graus Celsius))\s*\(\s*-?\d+(?:[.,]\d+)?\s*(?:[°º]\s*F|graus Fahrenheit)\s*\)/giu,
        "$1",
      );
      text = text.replace(
        /(-?\d+(?:[.,]\d+)?)\s*(?:[°º]\s*F\b|F[°º]|graus Fahrenheit)/giu,
        (_, value: string) =>
          `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(((Number(value.replace(",", ".")) - 32) * 5) / 9)} graus Celsius`,
      );
    } else {
      text = text
        .replace(
          /-?\d+(?:[.,]\d+)?\s*(?:[°º]\s*C|graus Celsius)\s*\(\s*(-?\d+(?:[.,]\d+)?\s*(?:[°º]\s*F|graus Fahrenheit))\s*\)/giu,
          "$1",
        )
        .replace(
          /(-?\d+(?:[.,]\d+)?\s*(?:[°º]\s*F|graus Fahrenheit))\s*\(\s*-?\d+(?:[.,]\d+)?\s*(?:[°º]\s*C|graus Celsius)\s*\)/giu,
          "$1",
        );
    }
    text = text.replace(
      /nuvens (?:espa[cç]adas|esparsas|dispersas)|scattered clouds/giu,
      "algumas nuvens",
    );
  }
  text = spokenText(text);
  const words = p.detailed ? 100 : p.weather ? 55 : 80;
  const sentences = p.detailed ? 5 : p.weather ? 3 : 4;
  const selected: string[] = [];
  let count = 0;
  for (const { segment } of new Intl.Segmenter("pt-BR", { granularity: "sentence" }).segment(
    text,
  )) {
    const size = segment.trim().split(/\s+/u).length;
    if (count + size > words || selected.length >= sentences) break;
    selected.push(segment.trim());
    count += size;
  }
  return (
    selected.join(" ") ||
    "Encontrei fontes, mas não consegui obter um resumo adequado para falar. Você pode consultá-las no painel."
  );
}
