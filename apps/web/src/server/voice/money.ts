const units = [
  "zero",
  "um",
  "dois",
  "três",
  "quatro",
  "cinco",
  "seis",
  "sete",
  "oito",
  "nove",
  "dez",
  "onze",
  "doze",
  "treze",
  "catorze",
  "quinze",
  "dezesseis",
  "dezessete",
  "dezoito",
  "dezenove",
];
const tens = [
  "",
  "",
  "vinte",
  "trinta",
  "quarenta",
  "cinquenta",
  "sessenta",
  "setenta",
  "oitenta",
  "noventa",
];
const hundreds = [
  "",
  "cento",
  "duzentos",
  "trezentos",
  "quatrocentos",
  "quinhentos",
  "seiscentos",
  "setecentos",
  "oitocentos",
  "novecentos",
];
function integer(n: number): string {
  if (n < 20) return units[n];
  if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ` e ${integer(n % 10)}` : "");
  if (n === 100) return "cem";
  if (n < 1000) return hundreds[Math.floor(n / 100)] + (n % 100 ? ` e ${integer(n % 100)}` : "");
  const divisor = n < 1_000_000 ? 1000 : 1_000_000;
  const groups = Math.floor(n / divisor),
    rest = n % divisor;
  const head =
    divisor === 1000
      ? groups === 1
        ? "mil"
        : `${integer(groups)} mil`
      : `${integer(groups)} ${groups === 1 ? "milhão" : "milhões"}`;
  return head + (rest ? `${rest < 100 || rest % 100 === 0 ? " e " : " "}${integer(rest)}` : "");
}

/** Spell amounts before sentence segmentation/TTS so R$, thousands and decimals stay intact. */
export function spokenMoney(amount: number, currency: string): string {
  const value = Math.round(amount * 100);
  if (!Number.isSafeInteger(value) || value < 0 || value >= 100_000_000_000)
    throw new Error("Invalid spoken money amount");
  const whole = Math.floor(value / 100),
    cents = value % 100;
  const names: Record<string, [string, string]> = {
    BRL: ["real", "reais"],
    USD: ["dólar americano", "dólares americanos"],
    EUR: ["euro", "euros"],
  };
  const name = names[currency];
  const main = name
    ? `${integer(whole)}${whole && whole % 1_000_000 === 0 ? " de" : ""} ${name[whole === 1 ? 0 : 1]}`
    : new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency,
        currencyDisplay: "name",
      }).format(amount);
  if (!name) return main;
  return main + (cents ? ` e ${integer(cents)} ${cents === 1 ? "centavo" : "centavos"}` : "");
}

export function normalizeMoney(text: string): string {
  return text.replace(
    /(?<!\p{L})(R\$|US\$|USD|BRL|EUR|€)\s*(\d+(?:[.,]\d+)*)(?!\d)/gu,
    (match, symbol: string, raw: string) => {
      const last = Math.max(raw.lastIndexOf(","), raw.lastIndexOf("."));
      const decimal = last >= 0 && raw.length - last - 1 <= 2;
      const amount = Number(
        decimal
          ? `${raw.slice(0, last).replace(/[.,]/g, "")}.${raw.slice(last + 1)}`
          : raw.replace(/[.,]/g, ""),
      );
      if (!Number.isFinite(amount) || amount >= 1_000_000_000) return match;
      return spokenMoney(
        amount,
        symbol === "R$" || symbol === "BRL"
          ? "BRL"
          : symbol === "€" || symbol === "EUR"
            ? "EUR"
            : "USD",
      );
    },
  );
}
