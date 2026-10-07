import type { IncomingMessage, ServerResponse } from "node:http";
import { calendarBindingSchema } from "@rosie/types";
import { z } from "zod";
import type { Runtime } from "../runtime";
import { body, respond } from "./body";
import { HttpError } from "./errors";

export async function residentCalendarRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  rt: Runtime,
  path: string,
) {
  const match = path.match(/^\/api\/v1\/catalog\/residents\/([a-z0-9_-]+)\/calendar$/);
  if (!match) return false;
  const id = match[1];
  if (req.method === "GET") respond(res, 200, await rt.calendars.status(id));
  else if (req.method === "PUT") {
    const value = z
      .object({ binding: calendarBindingSchema, revision: z.string().max(64).nullable() })
      .strict()
      .parse(await body(req, 4096));
    respond(res, 200, await rt.calendars.save(id, value.binding, value.revision));
  } else if (req.method === "DELETE") {
    const value = z
      .object({ revision: z.string().max(64).nullable() })
      .strict()
      .parse(await body(req, 1024));
    respond(res, 200, await rt.calendars.remove(id, value.revision));
  } else throw new HttpError(405, "Método não permitido.");
  return true;
}
