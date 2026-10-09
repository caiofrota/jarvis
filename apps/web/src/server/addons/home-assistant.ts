import type {
  CalendarDraft,
  CalendarEvent,
  CalendarOption,
  EntityMap,
  HomeAssistantStatus,
  Settings,
} from "@rosie/types";
import { DomainError } from "@rosie/types/context";
import WebSocket from "ws";
import { z } from "zod";
import type { Addon } from "./contract";

const stateSchema = z.object({
  entity_id: z.string().max(200),
  state: z.string().max(500),
  attributes: z.record(z.string(), z.unknown()),
  last_updated: z.string(),
});
type State = z.infer<typeof stateSchema>;
type Pending = {
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};
export class HomeAssistantAddon implements Addon {
  readonly id = "home-assistant";
  readonly capabilities = ["commands", "readings"] as const;
  private ws?: WebSocket;
  private settings?: Settings;
  private configuration = "";
  private stopped = true;
  private reconnect?: NodeJS.Timeout;
  private heartbeat?: NodeJS.Timeout;
  private pending = new Map<number, Pending>();
  private nextId = 0;
  private states = new Map<string, State>();
  private ready = false;
  private temperatureUnit?: string;
  private error: string | null = null;
  status(): HomeAssistantStatus {
    return {
      enabled: this.settings?.homeAssistantEnabled ?? false,
      connected: this.ws?.readyState === WebSocket.OPEN,
      ready: this.ready,
      entities: this.states.size,
      error: this.error,
    };
  }
  async configure(settings: Settings) {
    const key = JSON.stringify([
      settings.homeAssistantEnabled,
      settings.homeAssistantUrl,
      settings.homeAssistantToken,
      settings.homeAssistantHomeId,
    ]);
    if (key === this.configuration && !this.stopped) return;
    this.close();
    this.configuration = key;
    this.settings = settings;
    if (!settings.homeAssistantEnabled) return;
    if (
      !settings.homeAssistantUrl ||
      !settings.homeAssistantToken ||
      !settings.homeAssistantHomeId
    ) {
      this.error = "Informe endereço, token e casa do Home Assistant.";
      return;
    }
    this.stopped = false;
    this.connect();
  }
  private connect() {
    if (this.stopped || !this.settings) return;
    const url = new URL(this.settings.homeAssistantUrl.replace(/\/$/, "") + "/api/websocket");
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(url, {
      maxPayload: 8 * 1024 * 1024,
      handshakeTimeout: 8000,
      followRedirects: false,
    });
    this.ws = ws;
    this.error = null;
    let authenticated = false;
    const authDeadline = setTimeout(() => ws.terminate(), 10000);
    ws.on("message", (raw) => {
      if (this.ws !== ws) return;
      try {
        const message = JSON.parse(raw.toString());
        if (message.type === "auth_required")
          ws.send(
            JSON.stringify({ type: "auth", access_token: this.settings?.homeAssistantToken }),
          );
        else if (message.type === "auth_invalid") {
          this.error = "Token do Home Assistant inválido.";
          this.stopped = true;
          ws.close();
        } else if (message.type === "auth_ok" && !authenticated) {
          authenticated = true;
          clearTimeout(authDeadline);
          void this.initialize(ws).catch(() => {
            if (this.ws === ws) ws.terminate();
          });
        } else if (message.type === "result" || message.type === "pong") {
          const item = this.pending.get(message.id);
          if (!item) return;
          this.pending.delete(message.id);
          clearTimeout(item.timer);
          if (message.type === "pong" || message.success) item.resolve(message.result);
          else item.reject(new DomainError("O Home Assistant recusou a operação."));
        } else if (message.type === "event" && message.event?.event_type === "state_changed") {
          const state = stateSchema.safeParse(message.event.data?.new_state);
          if (state.success) this.update(state.data);
          else if (message.event.data?.new_state === null)
            this.states.delete(message.event.data.entity_id);
        }
      } catch {
        this.error = "Resposta inesperada do Home Assistant.";
        ws.terminate();
      }
    });
    ws.on("error", () => {
      if (this.ws === ws) this.error = "Sem conexão com o Home Assistant.";
    });
    ws.on("close", () => {
      clearTimeout(authDeadline);
      if (this.ws !== ws) return;
      this.ready = false;
      this.states.clear();
      clearInterval(this.heartbeat);
      for (const item of this.pending.values()) {
        clearTimeout(item.timer);
        item.reject(
          new DomainError(
            "A conexão com o Home Assistant caiu; a ação pode ter ocorrido. Não vou repeti-la.",
          ),
        );
      }
      this.pending.clear();
      if (!this.stopped) this.reconnect = setTimeout(() => this.connect(), 5000);
    });
  }
  private update(state: State) {
    const old = this.states.get(state.entity_id);
    if (old && Date.parse(old.last_updated) > Date.parse(state.last_updated)) return;
    if (old || this.states.size < 5000) this.states.set(state.entity_id, state);
  }
  private async initialize(ws: WebSocket) {
    await this.request({ type: "subscribe_events", event_type: "state_changed" });
    const [rawStates, rawConfig] = await Promise.all([
      this.request({ type: "get_states" }),
      this.request({ type: "get_config" }),
    ]);
    const states = z.array(stateSchema).max(5000).parse(rawStates);
    if (this.ws !== ws) return;
    for (const state of states) this.update(state);
    const config = z
      .object({ unit_system: z.object({ temperature: z.string() }) })
      .safeParse(rawConfig);
    this.temperatureUnit = config.success ? config.data.unit_system.temperature : undefined;
    this.ready = true;
    this.heartbeat = setInterval(() => {
      void this.request({ type: "ping" }).catch(() => ws.terminate());
    }, 30000);
  }
  private request(command: Record<string, unknown>): Promise<unknown> {
    const ws = this.ws;
    if (ws?.readyState !== WebSocket.OPEN || this.pending.size >= 32)
      return Promise.reject(new DomainError("O Home Assistant não está disponível agora."));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new DomainError(
            "O Home Assistant não confirmou a operação a tempo; ela pode ter ocorrido. Não vou repeti-la.",
          ),
        );
      }, 8000);
      this.pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ ...command, id }), (error) => {
        if (error) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(new DomainError("Falha ao enviar ao Home Assistant. A entrega é incerta."));
        }
      });
    });
  }
  private ensure(homeId: string) {
    if (homeId !== this.settings?.homeAssistantHomeId)
      throw new DomainError("Esse Home Assistant pertence a outra casa.");
    if (!this.ready) throw new DomainError("O Home Assistant está desconectado ou sincronizando.");
  }
  async calendars(homeId: string): Promise<CalendarOption[]> {
    this.ensure(homeId);
    const entries = z
      .array(
        z.object({
          entity_id: z.string(),
          platform: z.string(),
          disabled_by: z.string().nullable().optional(),
          aliases: z.array(z.string()).optional(),
        }),
      )
      .max(10000)
      .parse(await this.request({ type: "config/entity_registry/list" }));
    this.ensure(homeId);
    return entries
      .filter(
        (v) =>
          v.platform === "google" && !v.disabled_by && /^calendar\.[a-z0-9_]+$/.test(v.entity_id),
      )
      .flatMap((entry) => {
        const state = this.states.get(entry.entity_id);
        if (!state) return [];
        return [
          {
            id: entry.entity_id,
            name: String(state.attributes.friendly_name ?? entry.entity_id).slice(0, 150),
            canCreate: (Number(state.attributes.supported_features ?? 0) & 1) !== 0,
            available: !["unavailable", "unknown"].includes(state.state),
          },
        ];
      })
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }
  private async ensureCalendar(homeId: string, entityId: string, write = false) {
    const entry = (await this.calendars(homeId)).find((v) => v.id === entityId);
    if (!entry?.available)
      throw new DomainError("Essa agenda do Google está indisponível no Home Assistant.");
    if (write && !entry.canCreate)
      throw new DomainError(
        "Essa agenda não permite criar eventos. Confira a permissão no Google e no Home Assistant.",
      );
  }
  async calendarEvents(
    homeId: string,
    entityId: string,
    start: string,
    end: string,
  ): Promise<CalendarEvent[]> {
    await this.ensureCalendar(homeId, entityId);
    const result = z
      .object({
        response: z.record(
          z.string(),
          z.object({
            events: z
              .array(
                z.object({
                  summary: z.string().max(2000),
                  start: z.string().max(60),
                  end: z.string().max(60),
                }),
              )
              .max(1000),
          }),
        ),
      })
      .parse(
        await this.request({
          type: "call_service",
          domain: "calendar",
          service: "get_events",
          target: { entity_id: entityId },
          service_data: { start_date_time: start, end_date_time: end },
          return_response: true,
        }),
      );
    this.ensure(homeId);
    const events = result.response[entityId]?.events;
    if (!events)
      throw new DomainError("O Home Assistant não devolveu os compromissos desta agenda.");
    return events.map((v) => ({
      title: v.summary,
      start: v.start,
      end: v.end,
      allDay: /^\d{4}-\d{2}-\d{2}$/.test(v.start),
    }));
  }
  async createCalendarEvent(
    homeId: string,
    entityId: string,
    event: CalendarDraft,
    signal: AbortSignal,
    validate: () => Promise<void>,
  ) {
    const connection = this.configuration;
    await this.ensureCalendar(homeId, entityId, true);
    await validate();
    signal.throwIfAborted();
    this.ensure(homeId);
    if (connection !== this.configuration)
      throw new DomainError("A conexão da agenda mudou antes do envio. Faça o pedido novamente.");
    await this.request({
      type: "call_service",
      domain: "calendar",
      service: "create_event",
      target: { entity_id: entityId },
      service_data: {
        summary: event.title,
        ...(event.allDay
          ? { start_date: event.start, end_date: event.end }
          : { start_date_time: event.start, end_date_time: event.end }),
      },
    });
  }
  async cloudVoices(homeId: string) {
    this.ensure(homeId);
    if (!this.states.has("tts.home_assistant_cloud")) return [];
    const result = z
      .object({
        voices: z
          .array(z.object({ voice_id: z.string().max(100), name: z.string().max(100) }))
          .max(100),
      })
      .parse(
        await this.request({
          type: "tts/engine/voices",
          engine_id: "tts.home_assistant_cloud",
          language: "pt-BR",
        }),
      );
    // Standard voices only. Emotional styles need their own explicit product setting.
    return result.voices
      .filter((v) => /^[A-Za-z][A-Za-z0-9_-]{0,70}$/.test(v.voice_id))
      .map((v) => v.voice_id);
  }
  async exposed(homeId: string) {
    this.ensure(homeId);
    const result = z
      .object({
        exposed_entities: z.record(z.string(), z.object({ conversation: z.boolean().optional() })),
      })
      .parse(await this.request({ type: "homeassistant/expose_entity/list" }));
    return new Set(
      Object.entries(result.exposed_entities)
        .filter(([, value]) => value.conversation === true)
        .map(([id]) => id),
    );
  }
  async areas(homeId: string) {
    this.ensure(homeId);
    return z
      .array(z.object({ area_id: z.string(), name: z.string() }))
      .max(500)
      .parse(await this.request({ type: "config/area_registry/list" }))
      .map((area) => ({ id: area.area_id, name: area.name, homeId }));
  }
  async discover(homeId: string) {
    this.ensure(homeId);
    const [areas, registry, devices] = await Promise.all([
      this.request({ type: "config/area_registry/list" }),
      this.request({ type: "config/entity_registry/list" }),
      this.request({ type: "config/device_registry/list" }),
    ]);
    const areaNames = new Map(
      z
        .array(z.object({ area_id: z.string(), name: z.string() }))
        .parse(areas)
        .map((v) => [v.area_id, v.name]),
    );
    const deviceAreas = new Map(
      z
        .array(z.object({ id: z.string(), area_id: z.string().nullable() }))
        .parse(devices)
        .map((v) => [v.id, v.area_id]),
    );
    const entries = z
      .array(
        z.object({
          entity_id: z.string(),
          area_id: z.string().nullable().optional(),
          device_id: z.string().nullable().optional(),
          disabled_by: z.string().nullable().optional(),
          aliases: z.array(z.string()).optional(),
        }),
      )
      .parse(registry);
    return [...this.states.values()]
      .filter((v) =>
        /^(light|switch|fan|climate|sensor|binary_sensor|scene|script)\./.test(v.entity_id),
      )
      .map((state) => {
        const entry = entries.find((v) => v.entity_id === state.entity_id);
        const areaId =
          entry?.area_id || (entry?.device_id ? deviceAreas.get(entry.device_id) : null);
        return {
          id: state.entity_id,
          name: String(state.attributes.friendly_name || state.entity_id).slice(0, 100),
          state: state.state,
          kind: state.entity_id.split(".")[0],
          areaId: areaId ?? "",
          aliases: (entry?.aliases ?? []).slice(0, 30),
          areaName: areaId ? (areaNames.get(areaId) ?? "") : "",
          available: !entry?.disabled_by && !["unknown", "unavailable"].includes(state.state),
          ...(state.entity_id.startsWith("climate.") &&
          typeof state.attributes.supported_features === "number" &&
          (state.attributes.supported_features & 1) !== 0
            ? { canSetTemperature: true }
            : {}),
        };
      });
  }
  value(device: EntityMap["devices"] | undefined, maxAgeSeconds: number) {
    if (!device?.enabled) throw new DomainError("Sensor indisponível.");
    this.ensure(device.homeId);
    const state = device.haEntityId ? this.states.get(device.haEntityId) : undefined;
    if (!state || ["unknown", "unavailable"].includes(state.state))
      throw new DomainError("O sensor do Home Assistant está indisponível.");
    // HA's last_updated timestamps a changed state, not a fresh measurement. Be explicit about freshness.
    if (Date.now() - Date.parse(state.last_updated) > maxAgeSeconds * 1000)
      throw new DomainError("O sensor do Home Assistant está sem atualização recente.");
    const value = device.statePath ? state.attributes[device.statePath] : state.state;
    if (value == null || typeof value === "object")
      throw new DomainError("A leitura do sensor não está disponível.");
    return String(value).slice(0, 200);
  }
  currentTemperature(device: EntityMap["devices"] | undefined, maxAgeSeconds = 300) {
    if (!device?.enabled || device.connection !== "home-assistant" || device.kind !== "climate")
      throw new DomainError("A temperatura atual desse aparelho não está disponível.");
    this.ensure(device.homeId);
    const state = device.haEntityId ? this.states.get(device.haEntityId) : undefined;
    if (!state || ["unknown", "unavailable"].includes(state.state))
      throw new DomainError("A temperatura atual do ar está indisponível no Home Assistant.");
    if (Date.now() - Date.parse(state.last_updated) > maxAgeSeconds * 1000)
      throw new DomainError("A temperatura atual do ar não foi atualizada recentemente.");
    const value = state.attributes.current_temperature;
    if (typeof value !== "number" || !Number.isFinite(value))
      throw new DomainError("O Home Assistant não informou a temperatura atual do ar.");
    return value;
  }
  validateTemperature(device: EntityMap["devices"], temperature: number) {
    this.ensure(device.homeId);
    if (
      !device.enabled ||
      device.kind !== "climate" ||
      device.connection !== "home-assistant" ||
      !device.haEntityId?.startsWith("climate.") ||
      device.actions.set_temperature !== "set_temperature"
    )
      throw new DomainError("O ajuste de temperatura não está habilitado nesse dispositivo.");
    const state = device.haEntityId ? this.states.get(device.haEntityId) : undefined;
    if (!state || ["unknown", "unavailable"].includes(state.state))
      throw new DomainError("O ar-condicionado está indisponível no Home Assistant.");
    if (Object.keys(device.haTemperatureScenes).length) {
      const scene = device.haTemperatureScenes[String(temperature)];
      if (!scene || !this.states.has(scene) || this.states.get(scene)?.state === "unavailable")
        throw new DomainError(
          "Não há uma cena cadastrada e disponível para essa temperatura. Nenhum comando foi enviado.",
        );
      if (state.state !== "cool")
        throw new DomainError(
          "Ligue o ar em refrigeração antes de ajustar a temperatura por essa cena.",
        );
      return;
    }
    const attrs = state.attributes;
    if (typeof attrs.supported_features !== "number" || !(attrs.supported_features & 1))
      throw new DomainError(
        "Esse aparelho não permite ajustar uma temperatura única pelo Home Assistant.",
      );
    if (this.temperatureUnit !== "°C")
      throw new DomainError(
        "Configure o Home Assistant para usar graus Celsius antes de ajustar a temperatura pela Rosie.",
      );
    const min = attrs.min_temp,
      max = attrs.max_temp,
      step = attrs.target_temp_step;
    if (
      typeof min !== "number" ||
      !Number.isFinite(min) ||
      typeof max !== "number" ||
      !Number.isFinite(max) ||
      min > max
    )
      throw new DomainError("O Home Assistant não informou os limites de temperatura do aparelho.");
    if (!Number.isFinite(temperature) || temperature < min || temperature > max)
      throw new DomainError(
        `${device.name} aceita de ${min} a ${max} graus Celsius. Nenhum ajuste foi enviado.`,
      );
    if (
      typeof step === "number" &&
      Number.isFinite(step) &&
      step > 0 &&
      Math.abs((temperature - min) / step - Math.round((temperature - min) / step)) > 0.000001
    )
      throw new DomainError(
        `${device.name} aceita ajustes de ${String(step).replace(".", ",")} grau. Nenhum ajuste foi enviado.`,
      );
  }
  comfortState(device: EntityMap["devices"]) {
    this.ensure(device.homeId);
    if (
      !device.enabled ||
      device.connection !== "home-assistant" ||
      !["climate", "fan"].includes(device.kind)
    )
      throw new DomainError("Esse dispositivo não oferece uma leitura de conforto.");
    const state = device.haEntityId ? this.states.get(device.haEntityId) : undefined;
    if (!state || ["unknown", "unavailable"].includes(state.state))
      throw new DomainError("Não consegui consultar o estado desse aparelho agora.");
    const a = state.attributes;
    const temperatures = Object.entries(device.haTemperatureScenes).map(([temperature, scene]) => ({
      temperature: Number(temperature),
      at: Date.parse(this.states.get(scene)?.state ?? ""),
    }));
    if (temperatures.length) {
      const latest = temperatures
        .filter((v) => Number.isFinite(v.at))
        .sort((a, b) => b.at - a.at)[0];
      return {
        mode: state.state,
        modes: ["cool", "off"],
        source: "command" as const,
        ...(latest ? { temperature: latest.temperature } : {}),
        min: Math.min(...temperatures.map((v) => v.temperature)),
        max: Math.max(...temperatures.map((v) => v.temperature)),
        step: 1,
      };
    }
    const number = (value: unknown) =>
      typeof value === "number" && Number.isFinite(value) ? value : undefined;
    return {
      mode: state.state,
      ...(device.kind === "climate"
        ? {
            modes: Array.isArray(a.hvac_modes)
              ? a.hvac_modes.filter((v): v is string => typeof v === "string").sort()
              : [],
          }
        : {}),
      ...(device.kind === "climate" && this.temperatureUnit === "°C"
        ? {
            temperature: number(a.temperature),
            min: number(a.min_temp),
            max: number(a.max_temp),
            step: number(a.target_temp_step),
          }
        : {}),
    };
  }
  async execute(
    device: EntityMap["devices"],
    action: string,
    temperature?: number,
    requireExposure = false,
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted();
    const connection = this.configuration;
    this.ensure(device.homeId);
    if (
      (requireExposure || this.settings?.homeAssistantAutomaticCatalog) &&
      !(await this.exposed(device.homeId)).has(device.haEntityId ?? "")
    )
      throw new DomainError("Esse dispositivo não está exposto ao Assist no Home Assistant.");
    signal?.throwIfAborted();
    this.ensure(device.homeId);
    if (connection !== this.configuration)
      throw new DomainError("A conexão da casa mudou antes do envio. Faça o pedido novamente.");
    const entity = device.haEntityId,
      service = device.actions[action];
    if (!entity || !this.states.has(entity))
      throw new DomainError("A entidade não foi encontrada no Home Assistant.");
    const domain = entity.split(".")[0];
    if (action === "set_temperature") {
      if (temperature === undefined)
        throw new DomainError("Informe a temperatura desejada em graus Celsius.");
      this.validateTemperature(device, temperature);
      const scene = device.haTemperatureScenes[String(temperature)];
      if (scene) {
        await this.request({
          type: "call_service",
          domain: "scene",
          service: "turn_on",
          target: { entity_id: scene },
        });
        return;
      }
      await this.request({
        type: "call_service",
        domain: "climate",
        service: "set_temperature",
        target: { entity_id: entity },
        service_data: { temperature },
      });
      return;
    }
    if (temperature !== undefined) throw new DomainError("Essa ação não recebe uma temperatura.");
    if (
      !["light", "switch", "fan", "climate", "scene", "script"].includes(domain) ||
      !["turn_on", "turn_off"].includes(service) ||
      (domain === "scene" && service !== "turn_on")
    )
      throw new DomainError("Ação do Home Assistant não cadastrada ou não suportada.");
    await this.request({ type: "call_service", domain, service, target: { entity_id: entity } });
  }
  close() {
    this.stopped = true;
    clearTimeout(this.reconnect);
    clearInterval(this.heartbeat);
    const old = this.ws;
    this.ws = undefined;
    old?.terminate();
    this.ready = false;
    this.temperatureUnit = undefined;
    this.states.clear();
    for (const item of this.pending.values()) {
      clearTimeout(item.timer);
      item.reject(new DomainError("A conexão com o Home Assistant foi encerrada."));
    }
    this.pending.clear();
  }
}
