import {
  type Catalog,
  collections,
  type Entity,
  emptyCatalog,
  schemas,
  settingsSchema,
} from "@rosie/types";
import { validateReferences } from "@rosie/types/context";
import { z } from "zod";

const legacySchema = z.object({
  settings: z.record(z.string(), z.unknown()),
  rooms: z.array(z.record(z.string(), z.unknown())),
  robots: z.array(z.record(z.string(), z.unknown())),
  devices: z.array(z.record(z.string(), z.unknown())),
  routines: z.array(z.record(z.string(), z.unknown())),
  intents: z.array(z.record(z.string(), z.unknown())),
});
export function migrateLegacy(input: unknown) {
  const old = legacySchema.parse(input),
    s = old.settings;
  const catalog = emptyCatalog();
  catalog.homes.push(
    schemas.homes.parse({
      id: "casa",
      name: "Minha casa",
      defaults: {
        volume: s.volume,
        prefillMs: s.prefill_ms,
        listenSeconds: s.listen_seconds,
        drowsySeconds: s.drowsy_seconds,
      },
    }),
  );
  catalog.assistants.push(
    schemas.assistants.parse({
      id: "rosie",
      name: "Rosie",
      homeId: "casa",
      personality: s.personality,
      voice: s.tts_voice,
      quality: s.tts_quality,
      provider: s.provider,
      model: s.model,
      maxOutputTokens: s.max_output_tokens,
      historyTurns: s.history_turns,
    }),
  );
  for (const room of old.rooms)
    catalog.rooms.push(schemas.rooms.parse({ ...room, homeId: "casa" }));
  for (const robot of old.robots)
    catalog.endpoints.push(
      schemas.endpoints.parse({
        ...robot,
        name: `Caixinha — ${String(robot.name)}`,
        homeId: "casa",
        roomId: robot.room,
        assistantId: "rosie",
        volume: s.volume,
        prefillMs: s.prefill_ms,
        listenSeconds: s.listen_seconds,
        drowsySeconds: s.drowsy_seconds,
      }),
    );
  for (const device of old.devices)
    catalog.devices.push(
      schemas.devices.parse({
        ...device,
        homeId: "casa",
        roomId: device.room,
        commandTopic: device.command_topic,
        stateTopic: device.state_topic,
        statePath: device.state_path,
      }),
    );
  for (const routine of old.routines)
    catalog.routines.push(
      schemas.routines.parse({
        ...routine,
        homeId: "casa",
        scope: { roomIds: [routine.room] },
        steps: z
          .array(z.object({ device: z.string(), action: z.string() }))
          .parse(routine.steps)
          .map((v) => ({ deviceId: v.device, action: v.action })),
      }),
    );
  for (const intent of old.intents)
    catalog.intents.push(
      schemas.intents.parse({
        ...intent,
        homeId: "casa",
        deviceId: intent.device ?? null,
        scope: { roomIds: intent.room ? [intent.room] : [] },
      }),
    );
  validateReferences(catalog);
  const settings = settingsSchema.parse({
    sttModel: s.stt_model,
    openaiKey: s.provider === "openai" ? s.api_key : "",
    deepseekKey: s.provider === "deepseek" ? s.api_key : "",
    mqttHost: s.mqtt_host,
    mqttPort: s.mqtt_port,
    mqttUsername: s.mqtt_username,
    mqttPassword: s.mqtt_password,
    mqttTls: s.mqtt_tls,
  });
  return { catalog, settings };
}
export function catalogEntries(catalog: Catalog) {
  return collections.flatMap((collection) =>
    (catalog[collection] as Entity[]).map((value) => ({
      collection,
      id: value.id,
      name: value.name,
      data: JSON.parse(JSON.stringify(value)),
    })),
  );
}
