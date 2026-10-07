import { emptyCatalog, schemas } from "@rosie/types";
import { expect, it } from "vitest";
import { mergeRosieCatalog } from "../src/server/catalog/rosie-import";
import { catalogFixture } from "./fixture";

it("merges Rosie into an initialized home, preserving endpoint credentials and inherited audio", () => {
  const source = catalogFixture(),
    destination = emptyCatalog();
  source.homes[0].defaults.volume = 67;
  source.homes[0].facts = "Private household context";
  destination.homes = [
    schemas.homes.parse({ ...source.homes[0], name: "Existing home", defaults: { volume: 25 } }),
  ];
  destination.homes[0].facts = "";
  destination.rooms = [
    schemas.rooms.parse({ id: "existing-office", name: "Escritório", homeId: "home" }),
  ];
  const plan = mergeRosieCatalog(source, destination);
  expect(plan.catalog.homes).toHaveLength(1);
  expect(plan.catalog.homes[0].name).toBe("Existing home");
  expect(plan.catalog.homes[0].facts).toBe("Private household context");
  expect(plan.catalog.endpoints[0]).toMatchObject({
    id: "one",
    token: "fixture-credential-one",
    roomId: "existing-office",
    volume: 67,
  });
  expect(plan.catalog.devices[0].roomId).toBe("existing-office");
  expect(mergeRosieCatalog(source, plan.catalog).added).toHaveLength(0);
  expect(mergeRosieCatalog(source, plan.catalog).updated).toHaveLength(0);
});
it("rejects conflicting identities without mutating the destination", () => {
  const source = catalogFixture(),
    destination = catalogFixture();
  destination.assistants[0].voice = "kokoro-pm_alex";
  const before = structuredClone(destination);
  expect(() => mergeRosieCatalog(source, destination)).toThrow("Conflito");
  expect(destination).toEqual(before);
});
