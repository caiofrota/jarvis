import { normalizeMoney } from "./money";

/** Text sent to speech engines must not contain visual formatting or citation tokens. */
export function spokenText(input: string): string {
  return normalizeMoney(input)
    .replace(
      /(?<![\d:])([01]?\d|2[0-3])\s*[hH:]\s*([0-5]\d)(?![\d:])/gu,
      (_match, hours: string, minutes: string) =>
        Number(minutes)
          ? `${Number(hours)} e ${Number(minutes)}`
          : `${Number(hours)} ${Number(hours) === 1 ? "hora" : "horas"}`,
    )
    .replace(/\uE200[^\uE201]*\uE201/gu, "")
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/gu, "$1")
    .replace(/https?:\/\/\S+/gu, "")
    .replace(/<[^>]*>/gu, "")
    .replace(/&deg;/giu, "°")
    .replace(/&nbsp;/giu, " ")
    .replace(/℃/gu, "°C")
    .replace(/℉/gu, "°F")
    .replace(/(^|\n)\s*(?:[-*•#>]+|\d+[.)])\s+/gu, "$1")
    .replace(/[*_`#|]/gu, "")
    .replace(/\p{Extended_Pictographic}|\uFE0F|\u200D/gu, "")
    .replace(/\u2212(?=\d)/gu, "-")
    .replace(/(\d)\s*[–—]\s*(?=-?\d)/gu, "$1 a ")
    .replace(/(-?\d+(?:[.,]\d+)?)\s*[°º]\s*C\b/giu, "$1 graus Celsius")
    .replace(/(-?\d+(?:[.,]\d+)?)\s*(?:[°º]\s*F\b|F[°º])/giu, "$1 graus Fahrenheit")
    .replace(/(-?\d+(?:[.,]\d+)?)\s*°(?!\w)/gu, "$1 graus")
    .replace(/(?<![\p{L}\p{N}])-([0-9])/gu, "menos $1")
    .replace(/(\d)\.(\d)(?=\d*\s+graus)/gu, "$1,$2")
    .replace(/(\d)\s*%/gu, "$1 por cento")
    .replace(/\s+([,.;!?])/gu, "$1")
    .replace(/\s+/gu, " ")
    .trim();
}
