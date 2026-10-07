import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import type { Repository } from "@rosie/db";
import type { TurnContext } from "@rosie/types/context";
import { WebSocketServer } from "ws";
import type { Conversation } from "../conversation/service";
import type { VoiceClient } from "../voice/client";
import type { VoiceProfiles } from "../voice/profiles";
import { RobotSession } from "./session";

export class RobotGateway {
  readonly sessions = new Map<string, RobotSession>();
  private groups = new Map<string, string>();
  private wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  constructor(
    private repo: Repository,
    private voice: VoiceClient,
    private conversation: Conversation,
    private voiceProfiles?: VoiceProfiles,
  ) {}
  attach(
    server: Server,
    developmentUpgrade?: (req: IncomingMessage, socket: Duplex, head: Buffer) => Promise<void>,
  ) {
    server.on("upgrade", (req, socket, head) => {
      if (developmentUpgrade && req.url?.split("?")[0] === "/_next/hmr") {
        void developmentUpgrade(req, socket, head).catch(() => socket.destroy());
        return;
      }
      const match = req.url?.match(/^\/ws\/robot\/([a-z0-9_-]{1,64})$/);
      if (!match) {
        socket.destroy();
        return;
      }
      void this.authorize(req, match[1])
        .then((ok) => {
          if (!ok) {
            socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
            socket.destroy();
            return;
          }
          this.wss.handleUpgrade(req, socket, head, (ws) => {
            const id = match[1],
              previous = this.sessions.get(id);
            previous?.close();
            previous?.ws.close(1012);
            this.conversation.reset(id);
            const session = new RobotSession(
              id,
              ws,
              this.repo,
              this.voice,
              this.conversation,
              (ctx) => this.claim(ctx),
              () => this.release(id),
              this.voiceProfiles,
            );
            this.sessions.set(id, session);
            const ready = session.initialize();
            void ready.catch(() => ws.close(1011));
            ws.on("message", (data, binary) => {
              void ready
                .then(() => session.receive(Buffer.from(data as Buffer), binary))
                .catch(() => ws.close(1008));
            });
            ws.on("error", () => {});
            ws.on("close", (code) => {
              session.close();
              if (this.sessions.get(id) === session) {
                this.sessions.delete(id);
                this.conversation.reset(id);
              }
              void this.repo.event("disconnected", { endpoint: id, code });
            });
          });
        })
        .catch(() => socket.destroy());
    });
  }
  private async authorize(req: IncomingMessage, id: string) {
    const c = await this.repo.catalog(),
      endpoint = c.endpoints.find((v) => v.id === id && v.enabled);
    if (!endpoint) return false;
    const hash = (value: string) => createHash("sha256").update(value).digest();
    return timingSafeEqual(hash(req.headers.authorization ?? ""), hash(`Bearer ${endpoint.token}`));
  }
  private claim(ctx: TurnContext) {
    if (!ctx.endpoint.acousticGroup) return true;
    const group = `${ctx.home.id}:${ctx.endpoint.acousticGroup}`,
      owner = this.groups.get(group);
    if (owner && owner !== ctx.endpoint.id) return false;
    this.groups.set(group, ctx.endpoint.id);
    return true;
  }
  private release(id: string) {
    for (const [group, owner] of this.groups) if (owner === id) this.groups.delete(group);
  }
  async refresh() {
    for (const [id, session] of this.sessions) {
      try {
        await session.refresh();
      } catch {
        session.close();
        session.ws.close(1008);
        this.sessions.delete(id);
      }
    }
  }
  close() {
    for (const session of this.sessions.values()) {
      session.close();
      session.ws.close(1001);
    }
    this.wss.close();
  }
}
