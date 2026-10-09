import type { EntityMap, Settings } from "@rosie/types";
import { DomainError } from "@rosie/types/context";
import mqtt, { type MqttClient } from "mqtt";
import type { Addon } from "./contract";

export class MqttAddon implements Addon {
  readonly id = "mqtt";
  readonly capabilities = ["readings", "commands"] as const;
  private client?: MqttClient;
  private values = new Map<string, { payload: string; receivedAt: number }>();
  private topics = new Set<string>();
  private commandTopics = new Set<string>();
  private onCommand?: (topic: string, payload: Buffer) => void;
  get connected() {
    return Boolean(this.client?.connected);
  }
  async configure(cfg: Settings) {
    this.close();
    if (!cfg.mqttEnabled || !cfg.mqttHost) return;
    const url = new URL(`${cfg.mqttTls ? "mqtts" : "mqtt"}://${cfg.mqttHost}:${cfg.mqttPort}`);
    const client = mqtt.connect(url.toString(), {
      username: cfg.mqttUsername || undefined,
      password: cfg.mqttPassword || undefined,
      reconnectPeriod: 5000,
      connectTimeout: 10000,
      queueQoSZero: false,
    });
    this.client = client;
    client.on("error", () => {});
    client.on("offline", () => {
      if (this.client === client) this.values.clear();
    });
    client.on("connect", () => {
      if (this.client === client && (this.topics.size || this.commandTopics.size))
        void client
          .subscribeAsync([...this.topics, ...this.commandTopics], { qos: 1 })
          .catch(() => {});
    });
    client.on("message", (topic, data, packet) => {
      if (
        this.client === client &&
        this.commandTopics.has(topic) &&
        !packet.retain &&
        data.length <= 8192
      )
        this.onCommand?.(topic, data);
      if (this.client === client && this.topics.has(topic) && data.length <= 4096)
        this.values.set(topic, { payload: data.toString(), receivedAt: Date.now() });
    });
  }
  async subscribe(topics: string[]) {
    const next = new Set(topics),
      removed = [...this.topics].filter((v) => !next.has(v) && !this.commandTopics.has(v));
    this.topics = next;
    for (const topic of removed) this.values.delete(topic);
    if (this.client?.connected) {
      if (removed.length) await this.client.unsubscribeAsync(removed);
      if (topics.length) await this.client.subscribeAsync(topics);
    }
  }
  async commands(topics: string[], handler?: (topic: string, payload: Buffer) => void) {
    const next = new Set(topics),
      removed = [...this.commandTopics].filter((t) => !next.has(t) && !this.topics.has(t));
    this.commandTopics = next;
    this.onCommand = handler;
    if (this.client?.connected) {
      if (removed.length) await this.client.unsubscribeAsync(removed);
      if (topics.length) await this.client.subscribeAsync(topics, { qos: 1 });
    }
  }
  value(device: EntityMap["devices"] | undefined, maxAgeSeconds = 900) {
    if (!device?.enabled) throw new DomainError("Sensor indisponível.");
    const reading = this.values.get(device.stateTopic);
    if (!this.connected || !reading || Date.now() - reading.receivedAt > maxAgeSeconds * 1000)
      throw new DomainError("O sensor está sem leitura recente disponível agora.");
    let value: unknown = reading.payload;
    if (device.statePath) {
      try {
        value = JSON.parse(reading.payload);
        for (const key of device.statePath.split(".")) {
          if (!value || typeof value !== "object" || !Object.hasOwn(value, key))
            throw new Error("Missing state path");
          value = (value as Record<string, unknown>)[key];
        }
      } catch {
        throw new DomainError("O sensor respondeu em formato inesperado.");
      }
    }
    if (
      value == null ||
      typeof value === "object" ||
      ["", "unknown", "unavailable", "nan"].includes(String(value).trim().toLowerCase())
    )
      throw new DomainError("O sensor está sem leitura disponível agora.");
    return String(value).slice(0, 200);
  }
  async publish(topic: string, payload: string) {
    const client = this.client;
    if (!client?.connected)
      throw new DomainError("O MQTT está desconectado. Nenhum comando foi enviado.");
    let deadline: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        client.publishAsync(topic, payload, { qos: 1, retain: false }),
        new Promise((_, reject) => {
          deadline = setTimeout(() => reject(new Error("MQTT deadline")), 5000);
        }),
      ]);
    } finally {
      clearTimeout(deadline);
    }
  }
  close() {
    const previous = this.client;
    this.client = undefined;
    previous?.end(true);
    this.values.clear();
  }
}
