import type { IncomingMessage, ServerResponse } from "node:http";
import { haEntityId, homeAssistantDeviceKinds, kinds } from "@rosie/types";
import { DomainError } from "@rosie/types/context";
import { z } from "zod";
import { homeAssistantPackage } from "../addons/home-assistant-package";
import { queryFrom } from "../catalog/service";
import type { Runtime } from "../runtime";
import { body, respond } from "./body";

export async function integrationRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  rt: Runtime,
  path: string,
  url: URL,
) {
  if (path === "/api/v1/home-assistant/authorize" && req.method === "POST") {
    const input = z
      .object({ url: z.string().max(500), homeId: z.string().max(64) })
      .parse(await body(req, 2048));
    respond(res, 200, await rt.homeAssistantAuthorization.begin(input.url, input.homeId));
    return true;
  }
  if (path === "/api/v1/home-assistant/authorization" && req.method === "POST") {
    const input = z
      .object({ state: z.string().min(32).max(100), code: z.string().min(1).max(2000) })
      .parse(await body(req, 4096));
    await rt.homeAssistantAuthorization.finish(input.state, input.code);
    await rt.automations.configure();
    respond(res, 200, { ok: true });
    return true;
  }
  const packageMatch = path.match(/^\/api\/v1\/home-assistant\/package\/([a-z0-9_-]+)$/);
  if (packageMatch && req.method === "GET") {
    const endpoint = (await rt.repo.catalog()).endpoints.find((v) => v.id === packageMatch[1]);
    if (!endpoint) throw new DomainError("Caixinha não encontrada.");
    const cfg = await rt.repo.settings();
    res.writeHead(200, {
      "content-type": "application/yaml; charset=utf-8",
      "content-disposition": `attachment; filename="rosie-${endpoint.id}.yaml"`,
      "cache-control": "no-store",
    });
    res.end(homeAssistantPackage(endpoint, cfg.interactionMqttPrefix));
    return true;
  }
  if (path === "/api/v1/home-assistant/areas" && req.method === "GET") {
    const cfg = await rt.repo.settings();
    respond(res, 200, {
      items: await rt.automations.addons.homeAssistant.areas(cfg.homeAssistantHomeId),
    });
    return true;
  }
  if (path === "/api/v1/home-assistant/entities" && req.method === "GET") {
    const cfg = await rt.repo.settings(),
      query = queryFrom(url.searchParams);
    const catalog = await rt.repo.catalog();
    const rows = (await rt.automations.addons.homeAssistant.discover(cfg.homeAssistantHomeId))
      .filter((v) =>
        `${v.name} ${v.id} ${v.areaName}`
          .toLocaleLowerCase("pt-BR")
          .includes(query.q.toLocaleLowerCase("pt-BR")),
      )
      .map((v) => ({
        ...v,
        imported: catalog.devices.some(
          (d) =>
            d.connection === "home-assistant" &&
            d.haEntityId === v.id &&
            d.homeId === cfg.homeAssistantHomeId,
        ),
      }));
    rows.sort(
      (a, b) =>
        String(a[query.sort as keyof typeof a] ?? "").localeCompare(
          String(b[query.sort as keyof typeof b] ?? ""),
          "pt-BR",
          { numeric: true },
        ) * (query.direction === "asc" ? 1 : -1) || a.id.localeCompare(b.id),
    );
    respond(res, 200, {
      items: rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize),
      total: rows.length,
      ...query,
    });
    return true;
  }
  if (path === "/api/v1/home-assistant/import" && req.method === "POST") {
    const input = z
      .object({
        entityId: haEntityId,
        roomId: z.string().min(1),
        name: z.string().trim().min(1).max(100),
        kind: z.enum(kinds).optional(),
      })
      .parse(await body(req));
    const cfg = await rt.repo.settings(),
      c = await rt.repo.catalog();
    const room = c.rooms.find(
      (v) => v.id === input.roomId && v.homeId === cfg.homeAssistantHomeId && v.enabled,
    );
    if (!room) throw new DomainError("Escolha um ambiente da casa vinculada ao Home Assistant.");
    if (
      c.devices.some(
        (v) =>
          v.connection === "home-assistant" &&
          v.haEntityId === input.entityId &&
          v.homeId === room.homeId,
      )
    )
      throw new DomainError("Essa entidade já está cadastrada. Edite o dispositivo existente.");
    const entity = (await rt.automations.addons.homeAssistant.discover(room.homeId)).find(
      (v) => v.id === input.entityId,
    );
    if (!entity) throw new DomainError("Essa entidade não está disponível no Home Assistant.");
    const domain = input.entityId.split(".")[0],
      kind = input.kind ?? homeAssistantDeviceKinds(input.entityId)[0];
    const device = await rt.catalog.save("devices", {
      name: input.name,
      homeId: room.homeId,
      roomId: room.id,
      kind,
      connection: "home-assistant",
      haEntityId: input.entityId,
      actions: ["sensor", "binary_sensor"].includes(domain)
        ? {}
        : ["scene", "script"].includes(domain)
          ? { on: "turn_on" }
          : {
              on: "turn_on",
              off: "turn_off",
              ...(domain === "climate" && entity.canSetTemperature
                ? { set_temperature: "set_temperature" }
                : {}),
            },
    });
    await rt.automations.subscribe();
    respond(res, 201, device);
    return true;
  }
  const interaction = path.match(/^\/api\/v1\/endpoints\/([a-z0-9_-]+)\/interact$/);
  if (interaction && req.method === "POST") {
    respond(res, 200, await rt.interactions.submit(interaction[1], await body(req, 8192)));
    return true;
  }
  return false;
}
