import type { IncomingMessage, ServerResponse } from "node:http";
import { json } from "@rosie/db";
import { settingsSchema } from "@rosie/types";
import { DomainError } from "@rosie/types/context";
import type { Runtime } from "../runtime";
import { body, respond } from "./body";
export async function settingsRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  rt: Runtime,
  path: string,
  _url: URL,
): Promise<boolean> {
  if (path === "/api/v1/settings") {
    if (req.method === "GET") {
      const cfg = await rt.repo.settings();
      respond(res, 200, {
        ...cfg,
        openaiKey: "",
        deepseekKey: "",
        elevenlabsKey: "",
        mqttPassword: "",
        homeAssistantToken: "",
        credentials: {
          openaiKey: Boolean(cfg.openaiKey),
          deepseekKey: Boolean(cfg.deepseekKey),
          elevenlabsKey: Boolean(cfg.elevenlabsKey),
          mqttPassword: Boolean(cfg.mqttPassword),
          homeAssistantToken: Boolean(cfg.homeAssistantToken),
        },
      });
      return true;
    }
    if (req.method === "PUT") {
      const raw = await body(req),
        old = await rt.repo.settings();
      for (const key of [
        "openaiKey",
        "deepseekKey",
        "elevenlabsKey",
        "mqttPassword",
        "homeAssistantToken",
      ] as const)
        if (!raw[key]) raw[key] = old[key];
      const cfg = settingsSchema.parse(raw);
      if (
        cfg.homeAssistantEnabled &&
        !(await rt.repo.catalog()).homes.some(
          (home) => home.id === cfg.homeAssistantHomeId && home.enabled,
        )
      )
        throw new DomainError("Selecione uma casa ativa para conectar o Home Assistant.");
      await rt.repo.db.setting.upsert({
        where: { id: "settings" },
        create: { id: "settings", data: json(cfg) },
        update: { data: json(cfg) },
      });
      await rt.automations.configure();
      await rt.interactions.configure();
      await rt.repo.event("settings_saved", {});
      respond(res, 200, { ok: true });
      return true;
    }
  }

  return false;
}
