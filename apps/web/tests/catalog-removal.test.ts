import { json } from "@rosie/db";
import { schemas, settingsSchema } from "@rosie/types";
import { expect, it } from "vitest";
import { CatalogService } from "../src/server/catalog/service";
import { repositoryFixture } from "./fixture";

it("reviews and removes room dependencies atomically without broadening scoped rules", async () => {
  const f = await repositoryFixture();
  try {
    await f.repo.db.entry.create({
      data: {
        collection: "intents",
        id: "office-rule",
        name: "Office rule",
        data: json(
          schemas.intents.parse({
            id: "office-rule",
            name: "Office rule",
            homeId: "home",
            phrases: ["hello"],
            responses: ["hello"],
            scope: { roomIds: ["office"] },
          }),
        ),
      },
    });
    const service = new CatalogService(f.repo);
    const preview = await service.removalPreview("rooms", "office");
    expect(preview.items.map((value) => value.id)).toEqual(
      expect.arrayContaining(["office", "one", "light-office", "office-rule"]),
    );
    expect(preview.items.some((value) => value.id === "two")).toBe(false);
    expect(JSON.stringify(preview)).not.toContain("fixture-credential");
    await expect(service.remove("rooms", "office", 1)).rejects.toThrow();
    await service.remove("rooms", "office", 1, preview.review);
    const catalog = await f.repo.catalog();
    expect(catalog.rooms.map((value) => value.id)).toEqual(["kitchen"]);
    expect(catalog.endpoints.map((value) => value.id)).toEqual(["two"]);
    expect(catalog.intents.map((value) => value.id)).toEqual(["greeting"]);
  } finally {
    await f.close();
  }
});
it("rejects changed dependencies without deleting any records", async () => {
  const f = await repositoryFixture();
  try {
    const service = new CatalogService(f.repo);
    const preview = await service.removalPreview("homes", "home");
    await f.repo.db.entry.update({
      where: { collection_id: { collection: "endpoints", id: "one" } },
      data: { revision: { increment: 1 } },
    });
    await expect(service.remove("homes", "home", 1, preview.review)).rejects.toThrow(
      "vínculos mudaram",
    );
    expect((await f.repo.catalog()).homes).toHaveLength(1);
  } finally {
    await f.close();
  }
});
it("disconnects a removed HA home while preserving secrets and personal defaults", async () => {
  const f = await repositoryFixture();
  try {
    await f.repo.db.setting.update({
      where: { id: "settings" },
      data: {
        data: json(
          settingsSchema.parse({
            homeAssistantEnabled: true,
            homeAssistantHomeId: "home",
            homeAssistantToken: "fixture-secret",
            homeAssistantUrl: "http://ha.local",
          }),
        ),
      },
    });
    await f.repo.db.setting.create({
      data: {
        id: "user-profile:fixture",
        data: {
          profile: { assistants: [], defaultSharedAssistantId: "rosie" },
          revision: "original",
        },
      },
    });
    const service = new CatalogService(f.repo);
    const preview = await service.removalPreview("homes", "home");
    expect(preview.disconnectsHomeAssistant).toBe(true);
    await service.remove("homes", "home", 1, preview.review);
    expect(await f.repo.settings()).toMatchObject({
      homeAssistantEnabled: false,
      homeAssistantHomeId: "",
      homeAssistantToken: "fixture-secret",
    });
    expect(await f.repo.db.entry.count()).toBe(0);
    expect(
      (await f.repo.db.setting.findUnique({ where: { id: "user-profile:fixture" } }))?.data,
    ).toMatchObject({ profile: { defaultSharedAssistantId: null } });
  } finally {
    await f.close();
  }
});
it("ignores projected HA device references when removing an otherwise unused room", async () => {
  const f = await repositoryFixture();
  try {
    await f.repo.db.entry.deleteMany({
      where: {
        OR: [
          { collection: "devices", id: "light-office" },
          { collection: "endpoints", id: "one" },
        ],
      },
    });
    f.repo.catalogProjection = async (catalog) => {
      catalog.devices.push(
        schemas.devices.parse({
          id: "virtual",
          name: "Virtual light",
          homeId: "home",
          roomId: "office",
          connection: "home-assistant",
          haEntityId: "light.virtual",
        }),
      );
      return catalog;
    };
    const service = new CatalogService(f.repo),
      preview = await service.removalPreview("rooms", "office");
    expect(preview.items.map((item) => item.id)).toEqual(["office"]);
    await service.remove("rooms", "office", 1, preview.review);
    expect((await f.repo.catalog({ project: false })).rooms.map((value) => value.id)).toEqual([
      "kitchen",
    ]);
  } finally {
    await f.close();
  }
});
