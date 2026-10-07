import { schemas, settingsSchema } from "@rosie/types";
import { expect, it, vi } from "vitest";
import { HomeAssistantCatalog } from "../src/server/catalog/home-assistant";
import { CatalogService } from "../src/server/catalog/service";
import { catalogFixture, repositoryFixture } from "./fixture";

function source() {
  return {
    status: () => ({ ready: true }),
    discover: vi.fn(async () => [
      {
        id: "light.office",
        name: "Luminária",
        kind: "light",
        areaId: "office-ha",
        areaName: "Escritório",
        aliases: ["Abajur"],
        state: "off",
        available: true,
      },
      {
        id: "switch.hidden",
        name: "Oculto",
        kind: "switch",
        areaId: "office-ha",
        areaName: "Escritório",
        aliases: [],
        state: "off",
        available: true,
      },
    ]),
    exposed: vi.fn(async () => new Set(["light.office"])),
  };
}
it("projects exposed HA entities without database entries, with stable IDs and room isolation", async () => {
  const fixture = await repositoryFixture();
  try {
    await fixture.repo.db.setting.update({
      where: { id: "settings" },
      data: {
        data: settingsSchema.parse({
          homeAssistantEnabled: true,
          homeAssistantAutomaticCatalog: true,
          homeAssistantHomeId: "home",
        }),
      },
    });
    const ha = source();
    const projection = new HomeAssistantCatalog(fixture.repo, ha);
    fixture.repo.catalogProjection = (catalog) => projection.project(catalog);
    const first = await fixture.repo.catalog();
    const devices = first.devices.filter((device) => device.connection === "home-assistant");
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({
      name: "Luminária",
      roomId: "office",
      enabled: true,
      aliases: ["Abajur"],
    });
    expect(
      (await fixture.repo.catalog()).devices.find((device) => device.id === devices[0].id),
    ).toEqual(devices[0]);
    expect(await fixture.repo.db.entry.count({ where: { collection: "devices" } })).toBe(2);
    const catalog = new CatalogService(fixture.repo);
    expect(
      (
        await catalog.list("devices", {
          page: 1,
          pageSize: 20,
          sort: "name",
          direction: "asc",
          q: "",
          homeId: "home",
        })
      ).items,
    ).toContainEqual(
      expect.objectContaining({ id: devices[0].id, managedByHa: true, revision: 0 }),
    );
    await expect(catalog.save("devices", devices[0])).rejects.toThrow(/catálogo é automático/);
    await expect(catalog.remove("devices", devices[0].id, 0)).rejects.toThrow(
      /exposição ao Assist/,
    );
  } finally {
    await fixture.close();
  }
});
it("preserves registered IDs and permissions, disables unexposed entities and never guesses an ambiguous room", async () => {
  const fixture = await repositoryFixture();
  try {
    vi.spyOn(fixture.repo, "settings").mockResolvedValue(
      settingsSchema.parse({
        homeAssistantEnabled: true,
        homeAssistantAutomaticCatalog: true,
        homeAssistantHomeId: "home",
      }),
    );
    const catalog = catalogFixture();
    catalog.devices.push(
      schemas.devices.parse({
        id: "old",
        name: "Antigo",
        homeId: "home",
        roomId: "office",
        connection: "home-assistant",
        haEntityId: "light.office",
        actions: { off: "turn_off" },
      }),
    );
    const ha = source();
    let projected = await new HomeAssistantCatalog(fixture.repo, ha).project(
      structuredClone(catalog),
    );
    expect(projected.devices.find((device) => device.id === "old")).toMatchObject({
      name: "Luminária",
      actions: { off: "turn_off" },
      enabled: true,
    });
    ha.exposed.mockResolvedValue(new Set());
    projected = await new HomeAssistantCatalog(fixture.repo, ha).project(structuredClone(catalog));
    expect(projected.devices.find((device) => device.id === "old")?.enabled).toBe(false);
    ha.exposed.mockResolvedValue(new Set(["light.office"]));
    catalog.rooms[1].aliases = ["Escritório"];
    projected = await new HomeAssistantCatalog(fixture.repo, ha).project(structuredClone(catalog));
    expect(projected.devices.find((device) => device.id === "old")?.enabled).toBe(false);
    catalog.rooms[0].haAreaId = "office-ha";
    catalog.rooms[1].aliases = [];
    ha.status = () => ({ ready: false });
    projected = await new HomeAssistantCatalog(fixture.repo, ha).project(structuredClone(catalog));
    expect(projected.devices.find((device) => device.id === "old")?.enabled).toBe(false);
  } finally {
    await fixture.close();
  }
});

it("refreshes HA names and aliases and fails closed after an exposure query failure", async () => {
  const fixture = await repositoryFixture();
  const clock = vi.spyOn(Date, "now");
  try {
    clock.mockReturnValue(10000);
    vi.spyOn(fixture.repo, "settings").mockResolvedValue(
      settingsSchema.parse({
        homeAssistantEnabled: true,
        homeAssistantAutomaticCatalog: true,
        homeAssistantHomeId: "home",
      }),
    );
    const ha = source();
    const projection = new HomeAssistantCatalog(fixture.repo, ha);
    const first = await projection.project(catalogFixture());
    const id = first.devices.find((device) => device.haEntityId === "light.office")?.id;
    const entities = await ha.discover();
    entities[0].name = "Nome atualizado";
    entities[0].aliases = ["Novo apelido"];
    ha.discover.mockResolvedValue(entities);
    clock.mockReturnValue(16000);
    const updated = await projection.project(catalogFixture());
    expect(updated.devices.find((device) => device.id === id)).toMatchObject({
      name: "Nome atualizado",
      aliases: ["Novo apelido"],
      enabled: true,
    });
    ha.exposed.mockRejectedValue(new Error("Unavailable"));
    clock.mockReturnValue(22000);
    const failed = await projection.project(catalogFixture());
    expect(failed.devices.find((device) => device.id === id)?.enabled).toBe(false);
  } finally {
    clock.mockRestore();
    await fixture.close();
  }
});
