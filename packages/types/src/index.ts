import { z } from "zod";

export type {
  CalendarBinding,
  CalendarDraft,
  CalendarEvent,
  CalendarOption,
  ResidentCalendarStatus,
} from "./calendar";
export { calendarBindingSchema } from "./calendar";

import {
  displayDefaults,
  displaySchema,
  indicatorLightDefaults,
  indicatorLightSchema,
} from "./appearance";
import {
  announcementPolicy,
  haEntityId,
  homeAssistantDeviceKinds,
  integrationSettings,
} from "./integrations";
import { conversationalIntentFields, validateIntent } from "./intent";
import { weatherLocationSchema } from "./weather";

export {
  displayDefaults,
  displayIsOn,
  displaySchema,
  indicatorLightDefaults,
  indicatorLightSchema,
} from "./appearance";
export type { HomeAssistantStatus } from "./integrations";
export { announcementPolicy, haEntityId, homeAssistantDeviceKinds } from "./integrations";
export { type IntentParameter, intentParameterSchema } from "./intent";
export {
  numericReading,
  type ResponseRule,
  responseRuleSchema,
  selectResponseRule,
} from "./intent-rules";
export { type WeatherLocation, weatherLocationSchema } from "./weather";

export const expressions = [
  "neutral",
  "happy",
  "sad",
  "angry",
  "surprised",
  "curious",
  "confused",
  "excited",
  "shy",
  "skeptical",
  "proud",
  "affectionate",
] as const;
export const expressionSchema = z.enum(expressions);
export const kinds = ["light", "switch", "fan", "climate", "sensor", "other"] as const;
const id = z.string().regex(/^[a-z0-9_-]{1,64}$/);
const name = z.string().trim().min(1).max(100);
const aliases = z.array(z.string().trim().min(1).max(100)).max(30).default([]);
const base = { id, name, enabled: z.boolean().default(true) };
const homeId = id;
const nullableId = id.nullable().default(null);
export const audioDefaults = z.object({
  volume: z.number().int().min(0).max(100).default(70),
  prefillMs: z.number().int().min(60).max(1800).default(600),
  listenSeconds: z.number().int().min(5).max(120).default(30),
  drowsySeconds: z.number().int().min(0).max(3600).default(60),
});
export const scopeSchema = z.object({
  assistantIds: z.array(id).max(50).default([]),
  roomIds: z.array(id).max(100).default([]),
  residentIds: z.array(id).max(100).default([]),
  modeIds: z.array(id).max(50).default([]),
});
export const defaultPersonality =
  "Converse em português brasileiro, com naturalidade, em 1 a 3 frases. Responda normalmente por padrão; use humor quando combinar com o assunto. Interprete sua personagem e acompanhe pedidos de expressões sem avisos genéricos sobre não sentir emoções. Explique honestamente seu funcionamento quando perguntado. Não invente fatos nem estados da casa. Faça perguntas apenas quando úteis. Sem emojis.";
const voice = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const topic = z
  .string()
  .max(200)
  .refine((v) => !/[#+\0]/.test(v) && !v.startsWith("$"), "Use um tópico MQTT exato.");

export const schemas = {
  homes: z.object({
    ...base,
    city: z.string().max(120).default(""),
    weatherLocation: weatherLocationSchema.nullable().default(null),
    timezone: z
      .string()
      .default("America/Fortaleza")
      .refine((v) => {
        try {
          new Intl.DateTimeFormat("pt-BR", { timeZone: v });
          return true;
        } catch {
          return false;
        }
      }, "Fuso horário inválido."),
    facts: z.string().max(3000).default(""),
    defaults: audioDefaults.default(audioDefaults.parse({})),
  }),
  rooms: z.object({
    ...base,
    homeId,
    aliases,
    haAreaId: z.string().max(200).default(""),
    defaultDevices: z.partialRecord(z.enum(kinds), id).default({}),
  }),
  assistants: z.object({
    ...base,
    homeId,
    aliases,
    personality: z.string().max(3000).default(defaultPersonality),
    worldview: z.string().trim().max(1500).default(""),
    facts: z.string().max(3000).default(""),
    voice: voice.default("kokoro-pf_dora"),
    quality: z.enum(["fast", "detailed"]).default("fast"),
    provider: z.enum(["openai", "deepseek"]).default("openai"),
    model: z.string().min(1).max(100).default("gpt-4o-mini"),
    maxOutputTokens: z.number().int().min(64).max(1000).default(300),
    historyTurns: z.number().int().min(0).max(12).default(4),
  }),
  endpoints: z.object({
    ...base,
    homeId,
    roomId: id,
    assistantId: id,
    residentId: nullableId,
    modeId: nullableId,
    token: z.string().min(16).max(128),
    volume: z.number().int().min(0).max(100).nullable().default(null),
    prefillMs: z.number().int().min(60).max(1800).nullable().default(null),
    listenSeconds: z.number().int().min(5).max(120).nullable().default(null),
    drowsySeconds: z.number().int().min(0).max(3600).nullable().default(null),
    muted: z.boolean().default(false),
    wakeWord: z.string().max(100).default("Acorda Rosie"),
    acousticGroup: z.string().max(60).default(""),
    indicatorLight: indicatorLightSchema.default(indicatorLightDefaults),
    display: displaySchema.default(displayDefaults),
    announcements: announcementPolicy.default(announcementPolicy.parse({})),
  }),
  devices: z
    .object({
      ...base,
      homeId,
      roomId: id,
      aliases,
      kind: z.enum(kinds).default("light"),
      connection: z.enum(["mqtt", "home-assistant"]).default("mqtt"),
      haEntityId: haEntityId.nullable().default(null),
      haTemperatureScenes: z
        .record(
          z.string().regex(/^-?\d{1,3}(?:\.\d)?$/),
          z
            .string()
            .regex(/^scene\.[a-z0-9_]+$/)
            .max(200),
        )
        .default({}),
      commandTopic: topic.default(""),
      stateTopic: topic.default(""),
      statePath: z.string().max(100).default(""),
      actions: z
        .record(z.string().min(1).max(40), z.string().max(4096))
        .default({ on: "ON", off: "OFF" }),
    })
    .superRefine((v, c) => {
      if (
        Object.keys(v.haTemperatureScenes).length > 64 ||
        (Object.keys(v.haTemperatureScenes).length &&
          (v.connection !== "home-assistant" || v.kind !== "climate"))
      )
        c.addIssue({
          code: "custom",
          path: ["haTemperatureScenes"],
          message:
            "Use até 64 cenas de temperatura somente em um ar-condicionado do Home Assistant.",
        });
      if (v.connection === "home-assistant" && v.haEntityId) {
        const domain = v.haEntityId.split(".")[0];
        const sensor = domain === "sensor" || domain === "binary_sensor";
        if (!homeAssistantDeviceKinds(v.haEntityId).some((kind) => kind === v.kind))
          c.addIssue({
            code: "custom",
            path: ["kind"],
            message: "Esse tipo de dispositivo não é compatível com a entidade do Home Assistant.",
          });
        if (
          Object.entries(v.actions).some(
            ([key, action]) =>
              sensor ||
              (!["turn_on", "turn_off"].includes(action) &&
                !(
                  domain === "climate" &&
                  key === "set_temperature" &&
                  action === "set_temperature"
                )) ||
              (key === "set_temperature" &&
                (domain !== "climate" || action !== "set_temperature")) ||
              (domain === "scene" && action !== "turn_on"),
          )
        )
          c.addIssue({
            code: "custom",
            path: ["actions"],
            message: "Ações inválidas para esta entidade do Home Assistant.",
          });
      }
      if (v.connection === "home-assistant" && !v.haEntityId)
        c.addIssue({
          code: "custom",
          message: "Selecione a entidade do Home Assistant.",
          path: ["haEntityId"],
        });
      if (
        v.connection === "mqtt" &&
        v.kind !== "sensor" &&
        (!v.commandTopic || !Object.keys(v.actions).length)
      )
        c.addIssue({
          code: "custom",
          message: "Informe o tópico e as ações do dispositivo.",
          path: ["commandTopic"],
        });
      if (Object.keys(v.actions).length > 20)
        c.addIssue({ code: "custom", message: "Cadastre até 20 ações.", path: ["actions"] });
    }),
  residents: z.object({
    ...base,
    homeId,
    preferences: z.string().max(2000).default(""),
    facts: z.string().max(3000).default(""),
  }),
  modes: z.object({
    ...base,
    homeId,
    instructions: z.string().max(2000).default(""),
    volumeLimit: z.number().int().min(0).max(100).nullable().default(null),
    maxOutputTokens: z.number().int().min(64).max(1000).nullable().default(null),
  }),
  routines: z.object({
    ...base,
    homeId,
    aliases,
    scope: scopeSchema.default(scopeSchema.parse({})),
    extendsId: nullableId,
    steps: z
      .array(
        z
          .object({
            deviceId: nullableId,
            kind: z.enum(kinds).nullable().default(null),
            roomId: nullableId,
            action: z.string().min(1).max(40),
          })
          .refine(
            (v) => Boolean(v.deviceId) !== Boolean(v.kind),
            "Selecione um dispositivo ou um tipo no ambiente.",
          ),
      )
      .min(1)
      .max(20),
    crossRoom: z.boolean().default(false),
  }),
  intents: z
    .object({
      ...base,
      ...conversationalIntentFields,
      homeId,
      scope: scopeSchema.default(scopeSchema.parse({})),
      extendsId: nullableId,
      phrases: z.array(z.string().trim().min(1).max(300)).min(1).max(30),
      responses: z.array(z.string().min(1).max(1000)).max(30).default([]),
      deviceId: nullableId,
      expression: expressionSchema.default("neutral"),
    })
    .superRefine(validateIntent),
};
export const collections = Object.keys(schemas) as Collection[];
export type Collection = keyof typeof schemas;
export type EntityMap = { [K in Collection]: z.infer<(typeof schemas)[K]> };
export type Entity = EntityMap[Collection];
export type Catalog = { [K in Collection]: EntityMap[K][] };
export type Scope = z.infer<typeof scopeSchema>;
export type Expression = z.infer<typeof expressionSchema>;
export type Reply = {
  text: string;
  expression: Expression;
  web?: import("./web-search").WebReferences;
};
export type { SearchBudget, WebReferences, WebSearchPeriod, WebSearchStatus } from "./web-search";
export { searchBudgetSchema, webReferencesSchema, webSourceSchema } from "./web-search";
export type Row = Omit<Entity, "token"> & {
  revision: number;
  homeName?: string;
  roomName?: string;
  assistantName?: string;
  scopeLabel?: string;
};
export const settingsSchema = z.object({
  ...integrationSettings,
  mqttEnabled: z.boolean().default(true),
  weatherEnabled: z.boolean().default(true),
  webSearchEnabled: z.boolean().default(false),
  webSearchMonthlyBudgetUsd: z.number().min(0).max(100).multipleOf(0.01).default(5),
  webSearchCacheEnabled: z.boolean().default(true),
  sttModel: z.enum(["tiny", "base", "small"]).default("base"),
  openaiKey: z.string().max(500).default(""),
  deepseekKey: z.string().max(500).default(""),
  mqttHost: z.string().max(250).default(""),
  mqttPort: z.number().int().min(1).max(65535).default(1883),
  mqttUsername: z.string().max(100).default(""),
  mqttPassword: z.string().max(500).default(""),
  mqttTls: z.boolean().default(false),
});
export type Settings = z.infer<typeof settingsSchema>;
export function emptyCatalog(): Catalog {
  return {
    homes: [],
    rooms: [],
    assistants: [],
    endpoints: [],
    devices: [],
    residents: [],
    modes: [],
    routines: [],
    intents: [],
  };
}
export function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
export function slug(value: string): string {
  return (
    normalize(value)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 55) || "registro"
  );
}
export * from "./accounts";
