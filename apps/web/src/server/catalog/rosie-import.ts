import {
  type Catalog,
  type Collection,
  collections,
  type Entity,
  normalize,
  schemas,
} from "@rosie/types";
import { DomainError, validateReferences } from "@rosie/types/context";

// Merge household configuration only; accounts, sessions and installation secrets stay in place.
export function mergeRosieCatalog(source: Catalog, destination: Catalog) {
  const result = structuredClone(destination);
  const added: { collection: Collection; value: Entity }[] = [];
  const updated: { collection: Collection; value: Entity }[] = [];
  const homes = new Map<string, string>(),
    rooms = new Map<string, string>();
  for (const home of source.homes)
    homes.set(home.id, result.homes.find((value) => value.id === home.id)?.id ?? home.id);
  for (const room of source.rooms) {
    const same = result.rooms.find(
      (value) =>
        value.id === room.id ||
        (value.homeId === homes.get(room.homeId) &&
          normalize(value.name) === normalize(room.name) &&
          (!value.haAreaId || !room.haAreaId || value.haAreaId === room.haAreaId)),
    );
    rooms.set(room.id, same?.id ?? room.id);
  }
  for (const collection of collections)
    for (const original of source[collection] as Entity[]) {
      if (collection === "homes") {
        const existing = result.homes.find((value) => value.id === homes.get(original.id));
        const sourceHome = source.homes.find((value) => value.id === original.id);
        if (existing && sourceHome) {
          if (!existing.facts && sourceHome.facts) {
            existing.facts = sourceHome.facts;
            updated.push({ collection, value: existing });
          }
          continue;
        }
      }
      if (collection === "rooms") {
        const existing = result.rooms.find((value) => value.id === rooms.get(original.id));
        const sourceRoom = source.rooms.find((value) => value.id === original.id);
        if (existing && sourceRoom) {
          const before = JSON.stringify(existing);
          existing.defaultDevices = { ...sourceRoom.defaultDevices, ...existing.defaultDevices };
          if (!existing.haAreaId) existing.haAreaId = sourceRoom.haAreaId;
          if (JSON.stringify(existing) !== before) updated.push({ collection, value: existing });
          continue;
        }
      }
      const value = structuredClone(original);
      if ("homeId" in value) value.homeId = homes.get(value.homeId) ?? value.homeId;
      if ("roomId" in value) value.roomId = rooms.get(value.roomId) ?? value.roomId;
      if ("scope" in value)
        value.scope.roomIds = value.scope.roomIds.map((id) => rooms.get(id) ?? id);
      if ("steps" in value)
        for (const step of value.steps)
          if (step.roomId) step.roomId = rooms.get(step.roomId) ?? step.roomId;
      if (collection === "rooms") value.id = rooms.get(value.id) ?? value.id;
      if (collection === "endpoints" && "assistantId" in value) {
        const home = source.homes.find((home) => home.id === (original as typeof value).homeId);
        if (home)
          for (const key of ["volume", "prefillMs", "listenSeconds", "drowsySeconds"] as const)
            if (value[key] === null) value[key] = home.defaults[key];
      }
      const parsed = schemas[collection].parse(value) as Entity;
      const existing = (result[collection] as Entity[]).find((row) => row.id === parsed.id);
      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(parsed))
          throw new DomainError(
            `Conflito em ${collection}/${parsed.id}; nenhum cadastro será sobrescrito.`,
          );
        continue;
      }
      (result[collection] as Entity[]).push(parsed);
      added.push({ collection, value: parsed });
    }
  validateReferences(result);
  return {
    catalog: result,
    added,
    updated,
    mappings: { homes: Object.fromEntries(homes), rooms: Object.fromEntries(rooms) },
  };
}
