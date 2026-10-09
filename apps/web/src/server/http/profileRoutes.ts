import { createHash, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { json } from "@rosie/db";
import {
  type Actor,
  companionProfileSchema,
  settingsSchema,
  sharedAssistantSchema,
} from "@rosie/types";
import { DomainError } from "@rosie/types/context";
import { z } from "zod";
import type { Runtime } from "../runtime";
import { body, respond } from "./body";
import { HttpError } from "./errors";

const revision = (profile: unknown) =>
  createHash("sha256").update(JSON.stringify(profile)).digest("hex");
export async function profileRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  rt: Runtime,
  path: string,
  actor: Actor,
) {
  if (path === "/api/v1/me/conversation-models") {
    if (!actor.capabilities.includes("profile.manage"))
      throw new HttpError(403, "Acesso ao perfil pessoal necessário.");
    if (req.method !== "GET") throw new HttpError(405, "Método não permitido.");
    const provider = new URL(req.url ?? "", rt.config.origin).searchParams.get("provider");
    if (provider !== "openai" && provider !== "deepseek")
      throw new HttpError(422, "Provedor inválido.");
    rt.auth.limits.check(`models:${actor.user.id}`, 20);
    respond(res, 200, { models: await rt.models.list(provider) });
    return true;
  }
  if (path === "/api/v1/me/assistant-options") {
    if (!actor.capabilities.includes("profile.manage"))
      throw new HttpError(403, "Acesso ao perfil pessoal necessário.");
    if (req.method !== "GET") throw new HttpError(405, "Método não permitido.");
    const [settings, speech, catalog] = await Promise.all([
      rt.repo.settings(),
      rt.voice.health().catch(() => ({ voices: [] as string[] })),
      rt.repo.catalog(),
    ]);
    respond(res, 200, {
      defaultProfile: settings.companionProfile,
      voices: speech.voices,
      voiceNames: "voiceNames" in speech ? speech.voiceNames : {},
      voiceError: "providerError" in speech ? speech.providerError : undefined,
      shared: catalog.assistants
        .filter((value) => value.enabled)
        .map((value) => sharedAssistantSchema.parse(value)),
    });
    return true;
  }
  if (path === "/api/v1/me/assistants") {
    if (!actor.capabilities.includes("profile.manage"))
      throw new HttpError(403, "Acesso ao perfil pessoal necessário.");
    if (!["POST", "PUT"].includes(req.method ?? ""))
      throw new HttpError(405, "Método não permitido.");
    const input = z
      .object({
        revision: z.string().uuid().nullable(),
        assistant: companionProfileSchema.extend({
          id: z.union([z.string().uuid(), z.literal("")]),
        }),
      })
      .strict()
      .parse(await body(req, 10000));
    const status = await rt.profiles.get(actor.user.id);
    if (status.revision !== input.revision)
      throw new DomainError("Seu perfil mudou. Recarregue antes de salvar.");
    const existing = status.profile.assistants.find((a) => a.id === input.assistant.id);
    if (req.method === "PUT" && !existing)
      throw new HttpError(404, "Assistente pessoal não encontrado.");
    if (req.method === "POST" && input.assistant.id)
      throw new HttpError(422, "O servidor define o identificador do novo assistente.");
    const assistant = { ...input.assistant, id: existing?.id ?? randomUUID() };
    const assistants = existing
      ? status.profile.assistants.map((a) => (a.id === assistant.id ? assistant : a))
      : [...status.profile.assistants, assistant];
    respond(
      res,
      req.method === "POST" ? 201 : 200,
      await rt.profiles.save(actor.user, {
        revision: status.revision,
        profile: {
          ...status.profile,
          assistants,
          defaultAssistantId:
            status.profile.defaultAssistantId ??
            (!status.profile.assistants.length && !status.profile.defaultSharedAssistantId
              ? assistant.id
              : null),
        },
      }),
    );
    return true;
  }
  if (path !== "/api/v1/assistant-default") return false;
  if (!actor.capabilities.includes("settings.manage"))
    throw new HttpError(403, "Acesso administrativo necessário.");
  if (req.method === "GET") {
    const cfg = await rt.repo.settings();
    respond(res, 200, { profile: cfg.companionProfile, revision: revision(cfg.companionProfile) });
    return true;
  }
  if (req.method !== "PUT") throw new HttpError(405, "Método não permitido.");
  const input = z
    .object({ profile: companionProfileSchema, revision: z.string().regex(/^[a-f0-9]{64}$/) })
    .strict()
    .parse(await body(req, 10000));
  const result = await rt.repo.db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: actor.user.id } });
    if (!user?.enabled || user.role !== "admin")
      throw new HttpError(403, "Acesso administrativo necessário.");
    const row = await tx.setting.findUnique({ where: { id: "settings" } });
    const cfg = settingsSchema.parse(row?.data ?? {});
    if (revision(cfg.companionProfile) !== input.revision)
      throw new DomainError("O Jarvis padrão mudou. Recarregue antes de salvar.");
    const data = json({ ...cfg, companionProfile: input.profile });
    await tx.setting.upsert({
      where: { id: "settings" },
      create: { id: "settings", data },
      update: { data },
    });
    await tx.event.create({
      data: { kind: "default_assistant_saved", detail: { actor: actor.user.id } },
    });
    return { profile: input.profile, revision: revision(input.profile) };
  });
  respond(res, 200, result);
  return true;
}
