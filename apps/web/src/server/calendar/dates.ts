import { DomainError } from "@rosie/types/context";

export function localDate(now: Date, zone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(value.getTime()) ||
    value.toISOString().slice(0, 10) !== date
  )
    throw new DomainError("Informe uma data válida para a agenda.");
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function zonedTime(date: string, time: string, zone: string) {
  addDays(date, 0);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
    throw new DomainError("Informe um horário válido para o compromisso.");
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const target = `${date} ${time}`,
    naive = Date.parse(`${date}T${time}:00Z`);
  let guess = naive;
  for (let i = 0; i < 3; i++)
    guess += naive - Date.parse(`${formatter.format(new Date(guess)).replace(" ", "T")}:00Z`);
  const candidates = [-7200000, -3600000, -1800000, 0, 1800000, 3600000, 7200000]
    .map((offset) => guess + offset)
    .filter((t) => formatter.format(new Date(t)) === target);
  if (candidates.length !== 1)
    throw new DomainError(
      "Esse horário é inexistente ou ambíguo no fuso da casa. Escolha outro horário.",
    );
  return new Date(candidates[0]).toISOString();
}
export function dateLabel(date: string) {
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}
export function timeLabel(instant: string, zone: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(instant));
}
