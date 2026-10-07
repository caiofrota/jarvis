import type { Settings, WeatherLocation } from "@rosie/types";
import { DomainError } from "@rosie/types/context";
import { WeatherSource } from "../readings/weather";
import type { Addon } from "./contract";

export class WeatherAddon implements Addon {
  readonly id = "weather";
  readonly capabilities = ["readings"] as const;
  private enabled = true;
  private source = new WeatherSource();
  async configure(settings: Settings) {
    this.enabled = settings.weatherEnabled;
  }
  async read(location: WeatherLocation | null) {
    if (!this.enabled) throw new DomainError("O addon de clima está desativado em Voz e conexões.");
    const result = await this.source.read(location);
    if (!this.enabled) throw new DomainError("O addon de clima foi desativado.");
    return result;
  }
  close() {
    this.enabled = false;
  }
}
