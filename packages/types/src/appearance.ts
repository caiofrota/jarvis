import { z } from "zod";

const percent = z.number().int().min(0).max(100);
export const indicatorLightDefaults = {
  enabled: false,
  listeningBrightness: 25,
  speakingMinBrightness: 10,
  speakingMaxBrightness: 80,
};
export const indicatorLightSchema = z
  .object({
    enabled: z.boolean().default(indicatorLightDefaults.enabled),
    listeningBrightness: percent.default(indicatorLightDefaults.listeningBrightness),
    speakingMinBrightness: percent.default(indicatorLightDefaults.speakingMinBrightness),
    speakingMaxBrightness: percent.default(indicatorLightDefaults.speakingMaxBrightness),
  })
  .refine((v) => v.speakingMinBrightness <= v.speakingMaxBrightness, {
    message: "O brilho mínimo da fala não pode superar o máximo.",
    path: ["speakingMinBrightness"],
  });
export const displayDefaults = {
  mode: "auto" as const,
  scheduleEnabled: false,
  offAt: "22:00",
  onAt: "07:00",
};
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Informe um horário válido.");
export const displaySchema = z
  .object({
    mode: z.enum(["auto", "on", "off"]).default(displayDefaults.mode),
    scheduleEnabled: z.boolean().default(displayDefaults.scheduleEnabled),
    offAt: time.default(displayDefaults.offAt),
    onAt: time.default(displayDefaults.onAt),
  })
  .refine((v) => !v.scheduleEnabled || v.offAt !== v.onAt, {
    message: "Escolha horários diferentes para apagar e ligar a tela.",
    path: ["onAt"],
  });

export function displayIsOn(
  display: z.infer<typeof displaySchema>,
  timezone: string,
  now = new Date(),
): boolean {
  if (display.mode !== "auto") return display.mode === "on";
  if (!display.scheduleEnabled) return true;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(now);
  const current = `${parts.find((p) => p.type === "hour")?.value}:${parts.find((p) => p.type === "minute")?.value}`;
  const { offAt, onAt } = display;
  const sleeping =
    offAt < onAt ? current >= offAt && current < onAt : current >= offAt || current < onAt;
  return !sleeping;
}
