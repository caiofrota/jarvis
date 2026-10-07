import type { IncomingMessage, ServerResponse } from "node:http";
import { expressionSchema } from "@rosie/types";
import { context } from "@rosie/types/context";
import type { Runtime } from "../runtime";
import { body, respond } from "./body";
import { HttpError } from "./errors";
export async function endpointRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  rt: Runtime,
  path: string,
  _url: URL,
): Promise<boolean> {
  const endpointAction = path.match(
    /^\/api\/v1\/endpoints\/([a-z0-9_-]+)\/(pair-code|effective|test-voice|test-expression|listen|sleep|mute)$/,
  );
  if (endpointAction) {
    const [, id, action] = endpointAction;
    const ctx = context(await rt.repo.catalog(), id);
    if (action === "effective" && req.method === "GET") {
      respond(res, 200, {
        audio: ctx.audio,
        sources: ctx.sources,
        assistant: ctx.assistant.name,
        room: ctx.room.name,
        resident: ctx.resident?.name ?? null,
        mode: ctx.mode?.name ?? null,
        wakeWord: ctx.endpoint.wakeWord,
      });
      return true;
    }
    if (req.method !== "POST") throw new HttpError(405, "Método não permitido.");
    if (action === "pair-code") {
      respond(res, 200, rt.pairing.issue(id));
      return true;
    }
    const session = rt.gateway.sessions.get(id);
    if (!session) throw new HttpError(409, "Caixinha desconectada.");
    if (action === "test-voice") await session.testVoice();
    else if (action === "test-expression")
      await session.testExpression(expressionSchema.parse((await body(req)).expression));
    else if (action === "listen") await session.listen();
    else await session.stop(action === "mute");
    respond(res, 200, { ok: true });
    return true;
  }

  return false;
}
