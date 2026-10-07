import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { Accounts } from "../src/server/auth/accounts";
import { Pairing } from "../src/server/auth/pairing";
import { Authentication } from "../src/server/auth/service";
import type { Automations } from "../src/server/automation/service";
import { ResidentCalendars } from "../src/server/calendar/service";
import { CatalogService } from "../src/server/catalog/service";
import { Conversation } from "../src/server/conversation/service";
import { api } from "../src/server/http/api";
import type { Runtime } from "../src/server/runtime";
import { VoiceProfiles } from "../src/server/voice/profiles";
import { repositoryFixture } from "./fixture";
export async function httpFixture() {
  const f = await repositoryFixture(),
    server: Server = createServer(),
    cfg = { origin: "http://localhost", adminToken: "fixture-admin-credential" };
  await new Accounts(f.repo.db).bootstrap({
    username: "admin",
    name: "Test administrator",
    password: "fixture-user-password",
    role: "admin",
    enabled: true,
  });
  const rt = {
    repo: f.repo,
    config: cfg,
    auth: new Authentication(f.repo, cfg as Runtime["config"]),
    pairing: new Pairing(),
    catalog: new CatalogService(f.repo),
    conversation: new Conversation(f.repo, {} as Automations),
    previewConversation: new Conversation(f.repo, {} as Automations),
    gateway: { sessions: new Map(), refresh: async () => {} },
    automations: { configure: async () => {}, subscribe: async () => {} },
    interactions: { configure: async () => {} },
    voice: { health: async () => ({ ready: true, voices: [], busy: false }) },
  } as unknown as Runtime;
  rt.voiceProfiles = new VoiceProfiles(rt.repo, rt.voice);
  rt.calendars = new ResidentCalendars(rt.repo, () => rt.automations.addons.calendar);
  server.on("request", (req, res) => {
    void api(req, res, rt);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture port");
  cfg.origin = `http://127.0.0.1:${address.port}`;
  return {
    ...f,
    rt,
    url: cfg.origin,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await f.close();
    },
  };
}
