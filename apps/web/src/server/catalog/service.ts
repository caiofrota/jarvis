import { randomBytes } from "node:crypto";
import { json, type Repository } from "@rosie/db";
import {
  type Catalog,
  type Collection,
  collections,
  type Entity,
  schemas,
  slug,
} from "@rosie/types";
import { DomainError, validateReferences } from "@rosie/types/context";
import { registeredCalendar } from "../calendar/service";
import { registeredVoice } from "../voice/profiles";

export const sortFields = [
  "name",
  "homeName",
  "roomName",
  "assistantName",
  "enabled",
  "kind",
  "voice",
  "city",
  "scopeLabel",
  "volume",
  "phrases",
  "expression",
  "matchMode",
  "responseMode",
  "areaName",
  "state",
  "connection",
  "voiceStatus",
  "calendarStatus",
] as const;
export type Query = {
  page: number;
  pageSize: number;
  sort: string;
  direction: "asc" | "desc";
  q: string;
  homeId: string;
};
export function queryFrom(search: URLSearchParams): Query {
  const page = Number(search.get("page") ?? 1),
    pageSize = Number(search.get("pageSize") ?? 20),
    sort = search.get("sort") ?? "name",
    direction = search.get("direction") ?? "asc";
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    ![10, 20, 50, 100].includes(pageSize) ||
    !sortFields.includes(sort as (typeof sortFields)[number]) ||
    !["asc", "desc"].includes(direction)
  )
    throw new DomainError("Paginação ou ordenação inválida.");
  return {
    page,
    pageSize,
    sort,
    direction: direction as "asc" | "desc",
    q: (search.get("q") ?? "").slice(0, 150),
    homeId: search.get("homeId") ?? "",
  };
}
export function publicEntity(entity: Entity, c: Catalog) {
  const row = { ...entity } as Record<string, unknown>;
  delete row.token;
  const title = (kind: Collection, id: unknown) => c[kind].find((v) => v.id === id)?.name ?? "";
  row.homeName = "homeId" in entity ? title("homes", entity.homeId) : entity.name;
  row.roomName = "roomId" in entity ? title("rooms", entity.roomId) : "";
  row.assistantName = "assistantId" in entity ? title("assistants", entity.assistantId) : "";
  if ("scope" in entity) {
    row.scopeLabel =
      Object.entries(entity.scope)
        .flatMap(([key, ids]) =>
          ids.map((value) =>
            title(
              (
                {
                  assistantIds: "assistants",
                  roomIds: "rooms",
                  residentIds: "residents",
                  modeIds: "modes",
                } as Record<string, Collection>
              )[key],
              value,
            ),
          ),
        )
        .join(", ") || "Toda a casa";
  }
  return row;
}
export class CatalogService {
  private mutation: Promise<unknown> = Promise.resolve();
  constructor(readonly repo: Repository) {}
  async list(collection: Collection, query: Query) {
    const c = await this.repo.catalog(),
      entries = await this.repo.db.entry.findMany({ where: { collection } });
    const voices =
      collection === "residents"
        ? await this.repo.db.setting.findMany({
            where: {
              id: { in: entries.flatMap((e) => [`voiceprint:${e.id}`, `calendar:${e.id}`]) },
            },
          })
        : [];
    const automaticCatalog = (await this.repo.settings()).homeAssistantAutomaticCatalog;
    const revisions = new Map(entries.map((entry) => [entry.id, entry.revision]));
    const rows = c[collection]
      .map(
        (e) =>
          ({
            ...publicEntity(e as Entity, c),
            revision: revisions.get(e.id) ?? 0,
            managedByHa:
              collection === "devices" &&
              "connection" in e &&
              e.connection === "home-assistant" &&
              automaticCatalog,
            ...(collection === "residents"
              ? {
                  calendarStatus: registeredCalendar(
                    voices.find((v) => v.id === `calendar:${e.id}`)?.data,
                    c.residents.find((v) => v.id === e.id)?.homeId ?? "",
                  ),
                  voiceStatus: registeredVoice(
                    voices.find((v) => v.id === `voiceprint:${e.id}`)?.data,
                    e.id,
                    c.residents.find((v) => v.id === e.id)?.homeId ?? "",
                  )
                    ? "Cadastrada"
                    : "Não cadastrada",
                }
              : {}),
          }) as Record<string, unknown>,
      )
      .filter(
        (r) =>
          (!query.homeId ||
            r.homeId === query.homeId ||
            (collection === "homes" && r.id === query.homeId)) &&
          (!query.q ||
            String(r.name).toLocaleLowerCase("pt-BR").includes(query.q.toLocaleLowerCase("pt-BR"))),
      );
    rows.sort((a, b) => {
      const primary = String(a[query.sort] ?? "").localeCompare(
        String(b[query.sort] ?? ""),
        "pt-BR",
        { numeric: true },
      );
      return (
        (query.direction === "desc" ? -primary : primary) ||
        String(a.id).localeCompare(String(b.id))
      );
    });
    return {
      items: rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize),
      total: rows.length,
      ...query,
    };
  }
  async save(collection: Collection, input: unknown, existingId?: string, revision?: number) {
    const work = async () => {
      const c = await this.repo.catalog();
      if (
        collection === "devices" &&
        (await this.repo.settings()).homeAssistantAutomaticCatalog &&
        ((input as Record<string, unknown>).connection === "home-assistant" ||
          c.devices.some(
            (device) => device.id === existingId && device.connection === "home-assistant",
          ))
      )
        throw new DomainError("Edite os dispositivos no Home Assistant; o catálogo é automático.");
      const old = existingId
        ? await this.repo.db.entry.findUnique({
            where: { collection_id: { collection, id: existingId } },
          })
        : null;
      if (existingId && !old) throw new DomainError("Registro não encontrado.");
      if (old && old.revision !== revision)
        throw new DomainError("Este registro foi alterado. Recarregue antes de salvar.");
      const raw = { ...(input as Record<string, unknown>) };
      let id = existingId ?? slug(String(raw.name ?? ""));
      if (!existingId && c[collection].some((v) => v.id === id))
        id = `${id}-${randomBytes(3).toString("hex")}`;
      if (collection === "endpoints")
        raw.token = old
          ? (old.data as Record<string, unknown>).token
          : randomBytes(32).toString("base64url");
      const value = schemas[collection].parse({ ...raw, id }) as Entity;
      (c[collection] as Entity[]) = (c[collection] as Entity[]).filter((v) => v.id !== id);
      (c[collection] as Entity[]).push(value);
      if (c[collection].length > 500) throw new DomainError("Limite de 500 registros atingido.");
      validateReferences(c);
      const result = await this.repo.db.entry.upsert({
        where: { collection_id: { collection, id } },
        create: { collection, id, name: value.name, data: json(value) },
        update: { name: value.name, data: json(value), revision: { increment: 1 } },
      });
      await this.repo.event("catalog_saved", { collection, id });
      return { ...publicEntity(value, c), revision: result.revision };
    };
    const result = this.mutation.then(work);
    this.mutation = result.catch(() => {});
    return result;
  }
  async remove(collection: Collection, id: string, revision: number) {
    const work = async () => {
      const c = await this.repo.catalog();
      if (
        collection === "devices" &&
        (await this.repo.settings()).homeAssistantAutomaticCatalog &&
        c.devices.some((device) => device.id === id && device.connection === "home-assistant")
      )
        throw new DomainError(
          "Remova a exposição ao Assist no Home Assistant para retirar este dispositivo.",
        );
      const row = await this.repo.db.entry.findUnique({
        where: { collection_id: { collection, id } },
      });
      if (!row || row.revision !== revision)
        throw new DomainError("Registro removido ou alterado. Recarregue a lista.");
      (c[collection] as Entity[]) = (c[collection] as Entity[]).filter((v) => v.id !== id);
      validateReferences(c);
      await this.repo.db.$transaction(async (tx) => {
        await tx.entry.delete({ where: { collection_id: { collection, id } } });
        if (collection === "residents")
          await tx.setting.deleteMany({
            where: { id: { in: [`voiceprint:${id}`, `calendar:${id}`] } },
          });
      });
      await this.repo.event("catalog_deleted", { collection, id });
    };
    const result = this.mutation.then(work);
    this.mutation = result.catch(() => {});
    return result;
  }
  async options() {
    const c = await this.repo.catalog();
    return Object.fromEntries(
      collections.map((kind) => [
        kind,
        c[kind].map((v) => ({
          id: v.id,
          name: v.name,
          ...("homeId" in v ? { homeId: v.homeId } : {}),
          ...("roomId" in v ? { roomId: v.roomId } : {}),
          ...("actions" in v
            ? {
                actions: Object.keys(v.actions).filter((action) => action !== "set_temperature"),
                kind: v.kind,
              }
            : {}),
        })),
      ]),
    );
  }
}
