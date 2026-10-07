import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import type { Runtime } from "../runtime";
import { body, respond } from "./body";
import { HttpError } from "./errors";

export async function residentVoiceRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  rt: Runtime,
  path: string,
) {
  const match = path.match(
    /^\/api\/v1\/catalog\/residents\/([a-z0-9_-]+)\/voice(?:\/(enroll|cancel))?$/,
  );
  if (!match) return false;
  const [, id, action] = match;
  if (!action && req.method === "GET") {
    respond(res, 200, await rt.voiceProfiles.status(id));
  } else if (action === "enroll" && req.method === "POST") {
    const input = z
      .object({ endpointId: z.string().regex(/^[a-z0-9_-]{1,64}$/) })
      .parse(await body(req, 1024));
    const session = rt.gateway.sessions.get(input.endpointId);
    if (!session) throw new HttpError(409, "Caixinha desconectada.");
    const job = await rt.voiceProfiles.begin(id, input.endpointId);
    try {
      await session.enrollVoice(job);
    } catch (error) {
      rt.voiceProfiles.fail(job, "Não consegui abrir o microfone da caixinha.");
      throw error;
    }
    respond(res, 200, await rt.voiceProfiles.status(id));
  } else if (
    (action === "cancel" && req.method === "POST") ||
    (!action && req.method === "DELETE")
  ) {
    await rt.voiceProfiles.status(id);
    const job = rt.voiceProfiles.current(id);
    if (job) {
      rt.voiceProfiles.cancel(job);
      await rt.gateway.sessions.get(job.endpointId)?.cancelEnrollment(job.id);
    }
    if (req.method === "DELETE") {
      await rt.voiceProfiles.remove(id);
      await rt.gateway.refresh();
    }
    respond(res, 200, await rt.voiceProfiles.status(id));
  } else throw new HttpError(405, "Método não permitido.");
  return true;
}
