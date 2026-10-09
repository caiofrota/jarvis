import { createHash } from "node:crypto";
import type { Repository } from "@rosie/db";
import {
  type Catalog,
  type EntityMap,
  homeAssistantDeviceKinds,
  normalize,
  schemas,
} from "@rosie/types";
import type { HomeAssistantAddon } from "../addons/home-assistant";

type Source = Pick<HomeAssistantAddon, "discover" | "exposed"> & {
  status: () => { ready: boolean };
};
type Discovery = Awaited<ReturnType<Source["discover"]>>;

// HA owns metadata. The database retains local references and legacy permissions only.
export class HomeAssistantCatalog {
  private snapshot: Discovery = [];
  private key = "";
  private expires = 0;
  private pending?: Promise<void>;
  private available = false;
  constructor(
    private repo: Repository,
    private source: Source,
  ) {}
  async project(catalog: Catalog): Promise<Catalog> {
    const cfg = await this.repo.settings();
    if (!cfg.homeAssistantAutomaticCatalog) return catalog;
    const key = JSON.stringify([
      cfg.homeAssistantUrl,
      cfg.homeAssistantHomeId,
      cfg.homeAssistantToken,
    ]);
    if (this.key !== key) {
      this.key = key;
      this.snapshot = [];
      this.expires = 0;
      this.available = false;
    }
    if (cfg.homeAssistantEnabled && this.source.status().ready && Date.now() >= this.expires) {
      if (!this.pending) {
        this.pending = (async () => {
          try {
            const [entities, exposed] = await Promise.all([
              this.source.discover(cfg.homeAssistantHomeId),
              this.source.exposed(cfg.homeAssistantHomeId),
            ]);
            if (this.key !== key) return;
            this.snapshot = entities.filter((entity) => exposed.has(entity.id)).slice(0, 500);
            this.available = true;
          } catch {
            if (this.key === key) this.available = false;
          } finally {
            this.expires = Date.now() + 5000;
            this.pending = undefined;
          }
        })();
      }
      await this.pending;
    }
    const ready = cfg.homeAssistantEnabled && this.source.status().ready && this.available;
    const legacy = catalog.devices.filter((device) => device.connection === "home-assistant");
    catalog.devices = catalog.devices.filter((device) => device.connection !== "home-assistant");
    const projected = new Set<string>();
    let newDevices = 0;
    const capacity = Math.max(0, 500 - catalog.devices.length - legacy.length);
    for (const entity of this.snapshot) {
      const old = legacy.find(
        (device) => device.homeId === cfg.homeAssistantHomeId && device.haEntityId === entity.id,
      );
      if (!old && newDevices >= capacity) continue;
      const rooms = catalog.rooms.filter(
        (room) =>
          room.homeId === cfg.homeAssistantHomeId &&
          (room.haAreaId
            ? room.haAreaId === entity.areaId
            : Boolean(entity.areaName) &&
              [room.name, ...room.aliases].some(
                (name) => normalize(name) === normalize(entity.areaName),
              )),
      );
      // Never guess between two rooms. Legacy bindings remain usable for entities without an area.
      const room =
        rooms.length === 1
          ? rooms[0]
          : !entity.areaId && old
            ? catalog.rooms.find((value) => value.id === old.roomId && value.homeId === old.homeId)
            : undefined;
      if (!room) continue;
      const domain = entity.id.split(".")[0];
      const actions: EntityMap["devices"]["actions"] = ["sensor", "binary_sensor"].includes(domain)
        ? {}
        : ["scene", "script"].includes(domain)
          ? { on: "turn_on" }
          : {
              on: "turn_on",
              off: "turn_off",
              ...(entity.canSetTemperature ? { set_temperature: "set_temperature" } : {}),
            };
      const device = schemas.devices.parse({
        ...(old ?? {}),
        id:
          old?.id ??
          `ha-${createHash("sha256").update(`${cfg.homeAssistantHomeId}:${entity.id}`).digest("hex").slice(0, 24)}`,
        name: entity.name,
        homeId: cfg.homeAssistantHomeId,
        roomId: room.id,
        aliases: [
          ...new Set(
            [...entity.aliases, ...(old?.aliases ?? [])]
              .map((alias) => alias.trim().slice(0, 100))
              .filter(Boolean),
          ),
        ].slice(0, 30),
        kind: old?.kind ?? homeAssistantDeviceKinds(entity.id)[0],
        connection: "home-assistant",
        haEntityId: entity.id,
        enabled: ready && entity.available && room.enabled && (old?.enabled ?? true),
        actions: old?.actions ?? actions,
      });
      if (catalog.devices.some((value) => value.id === device.id)) continue;
      catalog.devices.push(device);
      if (!old) newDevices++;
      projected.add(device.id);
    }
    // Keep IDs used by routines/defaults, but never authorize a missing or unexposed entity.
    catalog.devices.push(
      ...legacy
        .filter((device) => !projected.has(device.id))
        .map((device) => ({ ...device, enabled: false })),
    );
    return catalog;
  }
}
