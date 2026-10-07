import type { IncomingMessage, ServerResponse } from "node:http";
import { context, DomainError } from "@rosie/types/context";
import { ZodError } from "zod";
import { isStopPhrase } from "../conversation/attention";
import type { Runtime } from "../runtime";
import { accountRoutes } from "./accountRoutes";
import { body, respond } from "./body";
import { catalogRoutes } from "./catalogRoutes";
import { companionRoutes } from "./companionRoutes";
import { endpointRoutes } from "./endpointRoutes";
import { HttpError } from "./errors";
import { integrationRoutes } from "./integrationRoutes";
import { previewRoutes } from "./previewRoutes";
import { residentCalendarRoutes } from "./residentCalendarRoutes";
import { residentVoiceRoutes } from "./residentVoiceRoutes";
import { settingsRoutes } from "./settingsRoutes";

export async function api(
  req: IncomingMessage,
  res: ServerResponse,
  rt: Runtime,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", rt.config.origin),
    path = url.pathname;
  if (!path.startsWith("/api/")) return false;
  try {
    if (path === "/api/pair" && req.method === "POST") {
      const input = await body(req, 256),
        id = rt.pairing.redeem(input.pin, req.socket.remoteAddress ?? "unknown"),
        c = await rt.repo.catalog(),
        endpoint = c.endpoints.find((v) => v.id === id && v.enabled);
      if (!endpoint) throw new HttpError(401, "Cadastro indisponível.");
      respond(res, 200, { id, token: endpoint.token });
      return true;
    }
    if (!path.startsWith("/api/v1/")) throw new HttpError(404, "Rota não encontrada.");
    if (!["GET", "HEAD"].includes(req.method ?? "")) rt.auth.checkOrigin(req);
    if (path === "/api/v1/login" && req.method === "POST") {
      const input = await body(req, 2048);
      await rt.auth.login(req, res, input.username, input.password);
      respond(res, 200, { ok: true });
      return true;
    }
    const actor = await rt.auth.require(req, res);
    if (path === "/api/v1/session" && req.method === "GET") {
      respond(res, 200, actor);
      return true;
    }
    if (path === "/api/v1/logout" && req.method === "POST") {
      await rt.auth.logout(req, res);
      respond(res, 200, { ok: true });
      return true;
    }
    if (await accountRoutes(req, res, rt, path, url, actor)) return true;
    const readOnlyRequest =
      req.method === "GET" &&
      (path === "/api/v1/status" ||
        path === "/api/v1/options" ||
        /^\/api\/v1\/catalog\/[a-z]+$/.test(path) ||
        /^\/api\/v1\/endpoints\/[a-z0-9_-]+\/effective$/.test(path));
    const capability = /^\/api\/v1\/home-assistant\/authoriz(?:e|ation)$/.test(path)
      ? "settings.manage"
      : path.includes("/catalog/") ||
          path.includes("/home-assistant/") ||
          path.endsWith("/options") ||
          path.endsWith("/weather/locations")
        ? "catalog.manage"
        : path.endsWith("/settings") || path.endsWith("/voice-preview")
          ? "settings.manage"
          : "robot.control";
    if (!readOnlyRequest && !actor.capabilities.includes(capability))
      throw new HttpError(403, "Você não tem acesso a esta ação.");
    if (await companionRoutes(req, res, rt, path, actor)) return true;
    if (path === "/api/v1/options" && req.method === "GET") {
      respond(res, 200, await rt.catalog.options());
      return true;
    }
    if (path === "/api/v1/status" && req.method === "GET") {
      const health = await rt.voice
        .health()
        .catch(() => ({ ready: false, voices: [], busy: false }));
      respond(res, 200, {
        robots: Object.fromEntries([...rt.gateway.sessions].map(([id, s]) => [id, s.state])),
        identifiedResidents: Object.fromEntries(
          [...rt.gateway.sessions].map(([id, s]) => [id, s.identifiedResident]),
        ),
        mqtt: rt.automations.connected,
        homeAssistant: rt.automations.addons.homeAssistant.status(),
        webSearch: await rt.automations.addons.webSearch.status(),
        voiceReferences: rt.conversation.webReferences(),
        speech: health,
        events: await rt.repo.db.event.findMany({ orderBy: { id: "desc" }, take: 40 }),
      });
      return true;
    }
    if (path === "/api/v1/conversation/reset" && req.method === "POST") {
      const id = String((await body(req)).endpointId ?? "");
      context(await rt.repo.catalog(), id);
      rt.previewConversation.reset(id);
      respond(res, 200, { ok: true });
      return true;
    }
    if (path === "/api/v1/conversation" && req.method === "POST") {
      const raw = await body(req),
        text = String(raw.text ?? "");
      if (!text.trim() || text.length > 4000)
        throw new HttpError(422, "Escreva uma frase de até 4000 caracteres.");
      const id = String(raw.endpointId ?? ""),
        ctx = context(await rt.repo.catalog(), id);
      if (isStopPhrase(text, [ctx.assistant.name, ...ctx.assistant.aliases, "rozi", "rosy"])) {
        rt.previewConversation.reset(id);
        respond(res, 200, { text: "Conversa encerrada.", expression: "neutral" });
        return true;
      }
      respond(res, 200, await rt.previewConversation.respond(id, text, AbortSignal.timeout(45000)));
      return true;
    }
    for (const route of [
      settingsRoutes,
      previewRoutes,
      endpointRoutes,
      catalogRoutes,
      residentVoiceRoutes,
      residentCalendarRoutes,
      integrationRoutes,
    ])
      if (await route(req, res, rt, path, url)) return true;
    throw new HttpError(404, "Rota não encontrada.");
  } catch (error) {
    if (error instanceof HttpError) respond(res, error.status, { error: error.message });
    else if (error instanceof ZodError)
      respond(res, 422, {
        error: error.issues[0]?.message ?? "Confira os campos.",
        fields: error.flatten().fieldErrors,
      });
    else if (error instanceof DomainError) respond(res, 409, { error: error.message });
    else {
      console.error("Request failed", error instanceof Error ? error.name : "unknown");
      respond(res, 503, {
        error: "Não foi possível concluir. Verifique as conexões e tente novamente.",
      });
    }
    return true;
  }
}
