import type { IncomingMessage, ServerResponse } from "node:http";
import { type Actor, integrationApplicationSchema, personalProviderSchema } from "@rosie/types";
import { z } from "zod";
import type { Runtime } from "../runtime";
import { body, respond } from "./body";
import { HttpError } from "./errors";
export async function personalIntegrationCallback(res: ServerResponse, rt: Runtime, url: URL) {
  let target = "/integrations?oauth_error=1";
  try {
    target = `/integrations?oauth_state=${encodeURIComponent(await rt.personalIntegrations.callbackResult(url))}`;
  } catch {
    /* Never expose authorization codes or provider error descriptions. */
  }
  res.statusCode = 303;
  res.setHeader("Location", target);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.end();
}
export async function personalIntegrationRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  rt: Runtime,
  path: string,
  url: URL,
  actor: Actor,
) {
  const prefix = "/api/v1/personal-integrations";
  if (path !== prefix && !path.startsWith(`${prefix}/`)) return false;
  if (!actor.capabilities.includes("profile.manage"))
    throw new HttpError(403, "Acesso ao perfil pessoal necessário.");
  rt.auth.limits.check(`personal-integrations:${actor.user.id}`, req.method === "GET" ? 120 : 30);
  const service = rt.personalIntegrations,
    owner = actor.user.id;
  if (path === prefix && req.method === "GET") {
    respond(res, 200, await service.status(owner, actor.capabilities.includes("settings.manage")));
    return true;
  }
  if (path === `${prefix}/applications` && req.method === "PUT") {
    if (!actor.capabilities.includes("settings.manage"))
      throw new HttpError(403, "Acesso administrativo necessário.");
    await service.configure(owner, integrationApplicationSchema.parse(await body(req, 10000)));
    respond(res, 200, { ok: true });
    return true;
  }
  if (path === `${prefix}/authorize` && req.method === "POST") {
    const input = z
      .object({ provider: personalProviderSchema })
      .strict()
      .parse(await body(req, 256));
    respond(res, 200, await service.begin(owner, input.provider));
    return true;
  }
  if (path === `${prefix}/finish` && req.method === "POST") {
    const input = z
      .object({ state: z.string().min(16).max(200) })
      .strict()
      .parse(await body(req, 512));
    await service.finish(owner, input.state);
    respond(res, 200, { ok: true });
    return true;
  }
  if (path === `${prefix}/confirm` && req.method === "POST") {
    const input = z
      .object({ id: z.string().uuid() })
      .strict()
      .parse(await body(req, 256));
    respond(res, 200, await service.confirm(owner, input.id));
    return true;
  }
  const match = path.match(
    /^\/api\/v1\/personal-integrations\/connections\/([a-f0-9-]{36})(?:\/(inbox|message|calendars|events|proposals))?$/,
  );
  if (match) {
    const [, id, resource] = match;
    if (!resource && req.method === "DELETE") {
      await service.disconnect(owner, id);
      respond(res, 200, { ok: true });
      return true;
    }
    if (resource && resource !== "proposals" && req.method === "GET") {
      const item = z
        .string()
        .min(resource === "message" || resource === "events" ? 1 : 0)
        .max(512)
        .parse(url.searchParams.get("id") ?? "");
      respond(
        res,
        200,
        await service.read(
          owner,
          id,
          resource as "inbox" | "message" | "calendars" | "events",
          item,
        ),
      );
      return true;
    }
    if (resource === "proposals" && req.method === "POST") {
      const input = z
        .object({ kind: z.enum(["mail", "calendar"]), draft: z.unknown() })
        .strict()
        .parse(await body(req, 100000));
      respond(res, 201, await service.propose(owner, id, input.kind, input.draft));
      return true;
    }
  }
  throw new HttpError(404, "Rota de integração não encontrada.");
}
