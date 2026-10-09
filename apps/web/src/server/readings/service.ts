import type { Catalog, EntityMap } from "@rosie/types";
import type { TurnContext } from "@rosie/types/context";
import type { Automations } from "../automation/service";
import { weatherSource } from "./weather";

export type Reading = { value: string; condition?: string; source: string };
type ReadingRequest = { intent: EntityMap["intents"]; catalog: Catalog; context: TurnContext };
export interface ReadingSource {
  read(request: ReadingRequest): Promise<Reading | undefined>;
}

// Adapters return observations only; they cannot perform household commands.
export class Readings {
  private sources: Record<EntityMap["intents"]["dataSource"], ReadingSource>;
  constructor(automations: Automations) {
    this.sources = {
      weather: {
        read: async ({ context }) =>
          (automations.addons?.weather ?? weatherSource).read(context.home.weatherLocation),
      },
      sensor: {
        read: async ({ intent, catalog, context }) => {
          if (!intent.deviceId) return undefined;
          const sensor = catalog.devices.find(
            (v) => v.id === intent.deviceId && v.homeId === context.home.id && v.enabled,
          );
          return {
            value: automations.value(sensor, intent.sensorMaxAgeSeconds),
            source: sensor?.name ?? "Sensor MQTT",
          };
        },
      },
    };
  }
  async read(request: ReadingRequest, signal: AbortSignal) {
    signal.throwIfAborted();
    const result = await this.sources[request.intent.dataSource].read(request);
    signal.throwIfAborted();
    return result;
  }
}
