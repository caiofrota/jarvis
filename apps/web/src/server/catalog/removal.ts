import { createHash } from "node:crypto";
import { type Catalog, type Collection, collections, type Entity } from "@rosie/types";
import { DomainError } from "@rosie/types/context";

export type RemovalItem = { collection: Collection; id: string; name: string };
export function removalItems(catalog: Catalog, collection: Collection, id: string): RemovalItem[] {
  const selected = new Map<string, RemovalItem>();
  const key = (kind: Collection, value: string) => `${kind}:${value}`;
  const has = (kind: Collection, value: string | null) =>
    Boolean(value && selected.has(key(kind, value)));
  const root = catalog[collection].find((value) => value.id === id);
  if (!root) throw new DomainError("Registro removido. Recarregue a lista.");
  selected.set(key(collection, id), { collection, id, name: root.name });
  let changed = true;
  while (changed) {
    changed = false;
    for (const kind of collections) {
      for (const entity of catalog[kind] as Entity[]) {
        if (selected.has(key(kind, entity.id))) continue;
        const referenced =
          ("homeId" in entity && has("homes", entity.homeId)) ||
          ("roomId" in entity && has("rooms", entity.roomId)) ||
          ("assistantId" in entity && has("assistants", entity.assistantId)) ||
          ("deviceId" in entity && has("devices", entity.deviceId)) ||
          ("extendsId" in entity && has(kind, entity.extendsId)) ||
          ("scope" in entity &&
            (entity.scope.roomIds.some((value) => has("rooms", value)) ||
              entity.scope.assistantIds.some((value) => has("assistants", value)))) ||
          ("steps" in entity &&
            entity.steps.some(
              (step) => has("rooms", step.roomId) || has("devices", step.deviceId),
            ));
        if (referenced) {
          selected.set(key(kind, entity.id), {
            collection: kind,
            id: entity.id,
            name: entity.name,
          });
          changed = true;
        }
      }
    }
  }
  return [...selected.values()];
}
export function removalReview(
  entries: { collection: string; id: string; revision: number }[],
  settings: unknown,
) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        entries.map(({ collection, id, revision }) => [collection, id, revision]).sort(),
        settings,
      ]),
    )
    .digest("hex");
}
