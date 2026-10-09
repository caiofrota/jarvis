import type { Repository } from "@rosie/db";
import type { Settings } from "@rosie/types";
import { CalendarAddon } from "./calendar";
import type { Addon } from "./contract";
import { HomeAssistantAddon } from "./home-assistant";
import { MqttAddon } from "./mqtt";
import { WeatherAddon } from "./weather";
import { WebSearchAddon } from "./web-search";

// Built-in modules share a lifecycle; untrusted runtime code is not loaded.
export class Addons {
  readonly mqtt = new MqttAddon();
  readonly homeAssistant = new HomeAssistantAddon();
  readonly calendar = new CalendarAddon(this.homeAssistant);
  readonly weather = new WeatherAddon();
  readonly webSearch: WebSearchAddon;
  private modules: Addon[];
  constructor(repo: Repository) {
    this.webSearch = new WebSearchAddon(repo);
    this.modules = [this.mqtt, this.homeAssistant, this.weather, this.webSearch, this.calendar];
  }
  async configure(settings: Settings) {
    for (const addon of this.modules) await addon.configure(settings);
  }
  close() {
    for (const addon of this.modules) addon.close();
  }
}
