import { normalize } from "@rosie/types";

export type SearchPresentation = {
  flight?: boolean;
  weather: boolean;
  period: "now" | "today" | "requested";
  fahrenheit: boolean;
  detailed: boolean;
  dayparts?: ("morning" | "afternoon" | "night")[];
};

export function searchPresentation(text: string, query = text): SearchPresentation {
  const phrase = normalize(text);
  const dayparts: NonNullable<SearchPresentation["dayparts"]> = [];
  if (/\b(manha|cedo)\b/.test(phrase)) dayparts.push("morning");
  if (/\btarde\b/.test(phrase)) dayparts.push("afternoon");
  if (/\bnoite\b/.test(phrase)) dayparts.push("night");
  return {
    weather: /\b(clima|temperatura|meteorolog\w*|chuva|chover\w*|previsao do tempo|weather)\b/.test(
      normalize(`${text} ${query}`),
    ),
    period:
      /\b(amanha|ontem|semana|dias|mes|segunda|terca|quarta|quinta|sexta|sabado|domingo)\b/.test(
        phrase,
      ) || /\d{1,2}[/.-]\d{1,2}/.test(text)
        ? "requested"
        : /\bhoje\b/.test(phrase)
          ? "today"
          : "now",
    fahrenheit: /\bfahrenheit\b|[°º]\s*f\b/iu.test(text),
    detailed: /\b(detalhe|detalhes|detalhad[ao]|complet[ao]|dia a dia)\b/.test(phrase),
    ...(dayparts.length ? { dayparts } : {}),
  };
}

/** Only unambiguous questions about the configured city's present conditions. */
export function asksCurrentHomeWeather(text: string, city: string): boolean {
  let phrase = normalize(text)
    .replace(/^(?:por favor )/, "")
    .replace(/ por favor$/, "");
  const cityName = normalize(city.split(",")[0]);
  if (cityName && phrase.endsWith(` em ${cityName}`))
    phrase = phrase.slice(0, -cityName.length - 4);
  return /^(?:(?:como (?:esta|ta|anda)|qual(?: e)?) (?:o (?:clima|tempo)|a temperatura)|(?:esta|ta) (?:quente|frio|chovendo))(?: (?:agora|hoje|aqui|la fora|por aqui))*$/.test(
    phrase,
  );
}
