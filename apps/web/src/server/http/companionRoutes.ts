import type { IncomingMessage, ServerResponse } from "node:http";
import {
  type Actor,
  companionAudioSchema,
  companionComputerResultSchema,
  companionMessageSchema,
  companionSpeechSchema,
} from "@rosie/types";
import { DomainError } from "@rosie/types/context";
import { wav } from "../robot/codec";
import type { Runtime } from "../runtime";
import { pcmFromWav } from "../voice/wav";
import { body, respond } from "./body";

const audioWork = new WeakMap<Runtime, number>();

export async function companionRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  rt: Runtime,
  path: string,
  actor: Actor,
) {
  if (!path.startsWith("/api/v1/companion/")) return false;
  if (path === "/api/v1/companion/computer-result" && req.method === "POST") {
    rt.auth.limits.check(`computer-result:${actor.user.id}`, 60);
    respond(
      res,
      200,
      await rt.companion.computerResult(
        actor.user.id,
        companionComputerResultSchema.parse(await body(req)),
      ),
    );
    return true;
  }
  if (path === "/api/v1/companion/tasks" && req.method === "GET") {
    respond(res, 200, await rt.tasks.get(actor.user.id));
    return true;
  }
  if (path === "/api/v1/companion/tasks" && req.method === "PUT") {
    rt.auth.limits.check(`tasks:${actor.user.id}`, 60);
    respond(res, 200, await rt.tasks.save(actor.user.id, await body(req)));
    return true;
  }
  if (path === "/api/v1/companion/tasks/import" && req.method === "POST") {
    rt.auth.limits.check(`tasks-import:${actor.user.id}`, 20);
    respond(res, 200, await rt.tasks.import(actor.user.id, await body(req)));
    return true;
  }
  if (path === "/api/v1/companion/options" && req.method === "GET") {
    const [personal, areas, settings, speech, catalog] = await Promise.all([
      rt.profiles.get(actor.user.id),
      rt.companion.areas().catch(() => []),
      rt.repo.settings(),
      rt.voice.health(),
      rt.repo.catalog(),
    ]);
    respond(res, 200, {
      assistants: [
        ...personal.profile.assistants,
        ...catalog.assistants.filter((value) => value.enabled),
      ].map((a) => ({ id: a.id, name: a.name, voice: a.voice })),
      defaultAssistantId:
        personal.profile.defaultAssistantId ?? personal.profile.defaultSharedAssistantId,
      voices: speech.voices,
      defaultProfile: settings.companionProfile,
      areas,
      name:
        personal.profile.assistants.find((a) => a.id === personal.profile.defaultAssistantId)
          ?.name ??
        catalog.assistants.find(
          (a) => a.id === personal.profile.defaultSharedAssistantId && a.enabled,
        )?.name ??
        settings.companionProfile.name,
    });
    return true;
  }
  if (path === "/api/v1/companion/session" && req.method === "POST") {
    rt.auth.limits.check(`companion-session:${actor.user.id}`, 20);
    respond(res, 200, { sessionId: rt.companion.create(actor.user.id) });
    return true;
  }
  if (
    req.method !== "POST" ||
    ![
      "/api/v1/companion/message",
      "/api/v1/companion/transcribe",
      "/api/v1/companion/speak",
    ].includes(path)
  )
    return false;
  rt.auth.limits.check(`companion:${actor.user.id}`, 60);
  const abort = new AbortController();
  const disconnect = () => abort.abort();
  res.once("close", disconnect);
  const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(120000)]);
  const audioRequest = !path.endsWith("/message");
  if (audioRequest && (audioWork.get(rt) ?? 0) >= 4) {
    res.off("close", disconnect);
    throw new DomainError("O serviço de voz está ocupado. Tente novamente em instantes.");
  }
  if (audioRequest) audioWork.set(rt, (audioWork.get(rt) ?? 0) + 1);
  try {
    if (path.endsWith("/message")) {
      const input = companionMessageSchema.parse(await body(req, 650000));
      respond(res, 200, await rt.companion.respond(actor.user.id, input, signal));
    } else if (path.endsWith("/transcribe")) {
      const input = companionAudioSchema.parse(await body(req, 1550000));
      rt.companion.session(actor.user.id, input.sessionId);
      const pcm = pcmFromWav(Buffer.from(input.audio, "base64"));
      if (pcm.length > 640000) throw new DomainError("Envie trechos de áudio de até 20 segundos.");
      const context = await rt.companion.transcriptionContext(actor.user.id, input);
      const result = await rt.voice.transcribe(
        pcm,
        (await rt.repo.settings()).sttModel,
        signal,
        context,
      );
      respond(res, 200, { text: result.speech ? result.text : "" });
    } else {
      const input = companionSpeechSchema.parse(await body(req));
      rt.companion.session(actor.user.id, input.sessionId);
      const profile = await rt.companion.profile(input, actor.user.id);
      const health = await rt.voice.health();
      const voice = input.voice ?? profile.voice;
      if (!health.voices.includes(voice))
        throw new DomainError("A voz selecionada está indisponível.");
      if (input.text.length > 2500)
        throw new DomainError("Envie trechos de fala de até 2500 caracteres.");
      const pcm = await rt.voice.synthesize(
        input.text,
        voice,
        profile.quality,
        signal,
        (await rt.repo.settings()).homeAssistantHomeId,
      );
      respond(res, 200, { audio: wav(pcm).toString("base64"), mime: "audio/wav" });
    }
    return true;
  } finally {
    if (audioRequest) audioWork.set(rt, (audioWork.get(rt) ?? 1) - 1);
    res.off("close", disconnect);
  }
}
