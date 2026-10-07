import { normalize } from "@rosie/types";
import { DomainError } from "@rosie/types/context";

const units: Record<string, number> = {
  zero: 0,
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
  onze: 11,
  doze: 12,
  treze: 13,
  quatorze: 14,
  catorze: 14,
  quinze: 15,
  dezesseis: 16,
  dezessete: 17,
  dezoito: 18,
  dezenove: 19,
  vinte: 20,
  trinta: 30,
  quarenta: 40,
  cinquenta: 50,
  sessenta: 60,
  setenta: 70,
  oitenta: 80,
  noventa: 90,
  cem: 100,
};
const amount = `(?:-?\\d+(?:decimal\\d+)?|(?:${Object.keys(units).join("|")})(?: e (?:um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove))?)`;
const verb =
  "(?:coloca|coloque|colocar|bota|bote|botar|poe|ponha|por|ajusta|ajuste|ajustar|muda|mude|mudar|deixa|deixe|deixar|define|defina|definir)";
const clause = `${verb} (?:a temperatura (?:do|da) |(?:o |a )?)(.+?) (?:no|nos|em|para|pra|a|aos) (${amount})(?: (?:graus(?: (?:celsius|fahrenheit|c|f))?|celsius|fahrenheit|c|f))?`;
function phrase(text: string) {
  return normalize(text.replace(/(\d)[.,](\d)/g, "$1decimal$2"));
}
function value(text: string) {
  return /^-?\d/.test(text)
    ? Number(text.replace("decimal", "."))
    : text.split(" e ").reduce((sum, word) => sum + units[word], 0);
}

export function localTemperatureCommand(text: string) {
  const normalized = phrase(text);
  // Never collapse multiple instructions or a requested wait into an immediate adjustment.
  if (
    /\be (?!(?:um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove)\b)/.test(normalized) ||
    /\b(depois|apos|daqui|segundos?|minutos?|horas?|amanha|hoje|quando|se|nao)\b|\be (?:liga|ligue|apaga|apague|desliga|desligue|acende|acenda|coloca|coloque|ajusta|ajuste|muda|mude|deixa|deixe)\b/.test(
      normalized,
    )
  )
    return null;
  const m = normalized.match(
    new RegExp(
      `^(?:por favor )?(?:(?:voce )?pode )?${clause}(?: (?:da|do|na|no|em) (.+?))?(?: por favor)?$`,
    ),
  );
  if (!m) return null;
  if (/\b(fahrenheit|f)\b/.test(normalized))
    throw new DomainError("Informe a temperatura em graus Celsius para ajustar o ar.");
  const room = m[1].match(/^(.+?) (?:da|do|na|no|em) (.+)$/);
  if (room && m[3]) return null;
  return {
    target: room?.[1] ?? m[1],
    room: room?.[2] ?? m[3] ?? null,
    action: "set_temperature",
    temperature: value(m[2]),
    routine: false,
    delaySeconds: 0,
  };
}

/** Keep temperature values out of relative-time parsing in compound commands. */
export function maskTemperatureCommands(text: string) {
  return phrase(text)
    .replace(new RegExp(`\\b${clause}(?=$| )`, "g"), "ajuste de temperatura")
    .replace(
      new RegExp(`\\b(?:em|no|nos|para|pra) ${amount} (?:graus(?: celsius)?|celsius)\\b`, "g"),
      "temperatura",
    );
}

export function validateTemperatureValues(
  text: string,
  steps: { action: string; temperature?: number | null }[],
) {
  const requested = [...phrase(text).matchAll(new RegExp(`\\b${clause}(?=$| )`, "g"))].map((m) =>
    value(m[2]),
  );
  const planned = steps.filter((s) => s.action === "set_temperature").map((s) => s.temperature);
  if (
    requested.length &&
    steps.some((s) => s.action !== "set_temperature") &&
    !/\b(liga|ligue|ligar|acende|acenda|acender|desliga|desligue|desligar|apaga|apague|apagar|ativa|ative|ativar)\b/.test(
      phrase(text),
    )
  )
    throw new DomainError(
      "Um ajuste de temperatura não autoriza ligar ou desligar aparelhos. Nenhum comando foi enviado.",
    );
  if (requested.length && JSON.stringify(requested) !== JSON.stringify(planned))
    throw new DomainError(
      "Não consegui preservar as temperaturas do pedido. Nenhum comando foi enviado.",
    );
  if (planned.length && /\b(fahrenheit|f)\b/.test(phrase(text)))
    throw new DomainError("Informe a temperatura em graus Celsius para ajustar o ar.");
}
