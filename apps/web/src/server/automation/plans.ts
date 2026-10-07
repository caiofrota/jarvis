import { createHash } from "node:crypto";
import type { EntityMap, Settings } from "@rosie/types";
import type { TurnContext } from "@rosie/types/context";
import { z } from "zod";

export const storedPlan = z.object({
  id: z.string(),
  endpointId: z.string(),
  scope: z.string(),
  residentId: z.string().nullable().optional(),
  endpointScope: z.string().optional(),
  cursor: z.number().int().min(0),
  dueAt: z.number(),
  phase: z.enum(["ready", "dispatching"]),
  steps: z
    .array(
      z.object({
        deviceId: z.string(),
        name: z.string(),
        action: z.string(),
        fingerprint: z.string(),
        routineId: z.string().nullable(),
        routineFingerprint: z.string(),
        delaySeconds: z.number().int().min(0).max(3600),
        temperature: z.number().finite().min(-100).max(100).nullable().optional(),
      }),
    )
    .min(1)
    .max(32),
});
export const storedPlans = z.array(storedPlan).max(32);
export type Plan = z.infer<typeof storedPlan>;
export const planSetting = "automation:pending-plans:v1";

export function routineFingerprint(routine: EntityMap["routines"]) {
  return createHash("sha256").update(JSON.stringify(routine)).digest("hex");
}

export function contextScope(ctx: TurnContext) {
  return JSON.stringify([
    ctx.home.id,
    ctx.room.id,
    ctx.assistant.id,
    ctx.resident?.id,
    ctx.mode?.id,
  ]);
}
export function deviceFingerprint(device: EntityMap["devices"], cfg: Settings) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        device.homeId,
        device.roomId,
        device.kind,
        device.connection,
        device.haEntityId,
        device.commandTopic,
        device.actions,
        device.haTemperatureScenes,
        device.connection === "home-assistant"
          ? [cfg.homeAssistantUrl, cfg.homeAssistantHomeId]
          : [cfg.mqttHost, cfg.mqttPort],
      ]),
    )
    .digest("hex");
}
export function intervalLabel(seconds: number) {
  if (seconds % 3600 === 0) return `${seconds / 3600} hora${seconds === 3600 ? "" : "s"}`;
  if (seconds % 60 === 0) return `${seconds / 60} minuto${seconds === 60 ? "" : "s"}`;
  return `${seconds} segundo${seconds === 1 ? "" : "s"}`;
}
