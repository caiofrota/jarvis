import type { IncomingMessage, ServerResponse } from "node:http";
import { type Collection, collections } from "@rosie/types";
import { queryFrom } from "../catalog/service";
import { searchWeatherLocations } from "../readings/weather";
import type { Runtime } from "../runtime";
import { body, respond } from "./body";
export async function catalogRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  rt: Runtime,
  path: string,
  url: URL,
): Promise<boolean> {
  if (path === "/api/v1/weather/locations" && req.method === "GET") {
    respond(res, 200, { items: await searchWeatherLocations(url.searchParams.get("q") ?? "") });
    return true;
  }
  const entityPath = path.match(/^\/api\/v1\/catalog\/([a-z]+)(?:\/([a-z0-9_-]+))?$/);
  if (entityPath && collections.includes(entityPath[1] as Collection)) {
    const collection = entityPath[1] as Collection,
      id = entityPath[2];
    if (req.method === "GET" && !id) {
      respond(res, 200, await rt.catalog.list(collection, queryFrom(url.searchParams)));
      return true;
    }
    if ((req.method === "POST" && !id) || (req.method === "PUT" && id)) {
      const input = await body(req),
        value = await rt.catalog.save(collection, input, id, Number(input.revision));
      await rt.gateway.refresh();
      if (collection === "endpoints") await rt.interactions.configure();
      if (collection === "devices") await rt.automations.subscribe();
      respond(res, id ? 200 : 201, value);
      return true;
    }
    if (req.method === "DELETE" && id) {
      await rt.catalog.remove(collection, id, Number((await body(req)).revision));
      if (collection === "devices") await rt.automations.subscribe();
      await rt.gateway.refresh();
      if (collection === "endpoints") await rt.interactions.configure();
      respond(res, 200, { ok: true });
      return true;
    }
  }

  return false;
}
