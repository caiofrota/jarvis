import type { IncomingMessage, ServerResponse } from "node:http";
import { wav } from "../robot/codec";
import type { Runtime } from "../runtime";
import { body } from "./body";
import { HttpError } from "./errors";
export async function previewRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  rt: Runtime,
  path: string,
  _url: URL,
): Promise<boolean> {
  if (path === "/api/v1/voice-preview" && req.method === "POST") {
    const raw = await body(req),
      assistantId = String(raw.assistantId ?? ""),
      c = await rt.repo.catalog(),
      assistant = c.assistants.find((v) => v.id === assistantId);
    if (!assistant) throw new HttpError(404, "Robô não encontrado.");
    const health = await rt.voice.health();
    const selected = typeof raw.voice === "string" ? raw.voice : assistant.voice;
    if (health.busy && !selected.startsWith("ha-cloud-"))
      throw new HttpError(409, "Aguarde a fala atual terminar.");
    if (!health.voices.includes(selected)) throw new HttpError(422, "Voz indisponível.");
    const abort = new AbortController();
    const disconnect = () => abort.abort();
    res.once("close", disconnect);
    try {
      const audio = await rt.voice.synthesize(
        `Bom dia! Eu sou ${assistant.name}. Você quer conversar comigo?`,
        selected,
        assistant.quality,
        abort.signal,
        assistant.homeId,
      );
      res.setHeader("Content-Type", "audio/wav");
      res.setHeader("Cache-Control", "no-store");
      res.end(wav(audio));
    } finally {
      res.off("close", disconnect);
    }
    return true;
  }

  return false;
}
