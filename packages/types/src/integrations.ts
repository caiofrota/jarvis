import { z } from "zod";

export const haEntityId = z
  .string()
  .regex(/^(light|switch|fan|climate|sensor|binary_sensor|scene|script)\.[a-z0-9_]+$/);
export function homeAssistantDeviceKinds(entityId: string) {
  switch (entityId.split(".")[0]) {
    // A relay's HA domain describes its connection, not what it powers.
    case "switch":
      return ["switch", "light", "fan", "other"] as const;
    case "light":
      return ["light"] as const;
    case "fan":
      return ["fan"] as const;
    case "climate":
      return ["climate"] as const;
    case "sensor":
    case "binary_sensor":
      return ["sensor"] as const;
    default:
      return ["other"] as const;
  }
}
export const integrationSettings = {
  homeAssistantEnabled: z.boolean().default(false),
  homeAssistantAutomaticCatalog: z.boolean().default(false),
  homeAssistantUrl: z
    .string()
    .max(500)
    .default("")
    .refine((value) => {
      if (!value) return true;
      try {
        const url = new URL(value);
        return (
          ["http:", "https:"].includes(url.protocol) &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash
        );
      } catch {
        return false;
      }
    }, "Informe um endereço HTTP ou HTTPS do Home Assistant, sem credenciais na URL."),
  homeAssistantToken: z.string().max(2000).default(""),
  homeAssistantHomeId: z
    .string()
    .regex(/^[a-z0-9_-]{0,64}$/)
    .default(""),
  interactionMqttEnabled: z.boolean().default(false),
  interactionMqttPrefix: z
    .string()
    .regex(/^[a-z0-9_-]+(?:\/[a-z0-9_-]+)*$/)
    .max(100)
    .default("rosie"),
};
export const announcementPolicy = z.object({
  enabled: z.boolean().default(true),
  quietEnabled: z.boolean().default(false),
  quietStart: z
    .string()
    .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
    .default("22:00"),
  quietEnd: z
    .string()
    .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
    .default("07:00"),
  volume: z.number().int().min(0).max(100).nullable().default(null),
});
export type HomeAssistantStatus = {
  enabled: boolean;
  connected: boolean;
  ready: boolean;
  entities: number;
  error: string | null;
};
