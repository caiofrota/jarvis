import type { IncomingMessage, ServerResponse } from "node:http";
import { type Actor, passwordSchema } from "@rosie/types";
import { z } from "zod";
import type { Runtime } from "../runtime";
import { body, respond } from "./body";
import { HttpError } from "./errors";

export async function accountRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  rt: Runtime,
  path: string,
  url: URL,
  actor: Actor,
) {
  if (path === "/api/v1/me/profile") {
    if (!actor.capabilities.includes("profile.manage"))
      throw new HttpError(403, "Acesso ao perfil pessoal necessário.");
    if (req.method === "GET") respond(res, 200, await rt.profiles.get(actor.user.id));
    else if (req.method === "PUT")
      respond(res, 200, await rt.profiles.save(actor.user, await body(req, 100000)));
    else throw new HttpError(405, "Método não permitido.");
    return true;
  }
  if (path === "/api/v1/me/password" && req.method === "POST") {
    rt.auth.limits.check(`password:${actor.user.id}`, 5);
    const input = z
      .object({ currentPassword: z.string().min(1).max(128), password: passwordSchema })
      .parse(await body(req, 2048));
    await rt.auth.accounts.changePassword(actor.user, input.currentPassword, input.password);
    await rt.auth.logout(req, res);
    respond(res, 200, { ok: true });
    return true;
  }
  const match = /^\/api\/v1\/users(?:\/([a-zA-Z0-9-]+))?$/.exec(path);
  if (!match) return false;
  if (!actor.capabilities.includes("users.manage"))
    throw new HttpError(403, "Acesso administrativo necessário.");
  const id = match[1];
  if (req.method === "GET" && !id) {
    respond(res, 200, await rt.auth.accounts.list(url.searchParams));
    return true;
  }
  if ((req.method === "POST" && !id) || (req.method === "PUT" && id)) {
    rt.auth.limits.check(`accounts:${actor.user.id}`, 10);
    respond(
      res,
      id ? 200 : 201,
      await rt.auth.accounts.save(actor.user, await body(req, 4096), id),
    );
    return true;
  }
  throw new HttpError(405, "Método não permitido.");
}
