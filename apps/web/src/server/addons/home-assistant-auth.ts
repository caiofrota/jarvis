import { randomBytes } from "node:crypto";
import { json, type Repository } from "@rosie/db";
import { settingsSchema } from "@rosie/types";
import { DomainError } from "@rosie/types/context";
import WebSocket from "ws";

type Grant = { url: string; homeId: string; expires: number };
/** Owner-only HA authorization. Login stays on HA; no password is collected by Rosie. */
export class HomeAssistantAuthorization {
  private grants = new Map<string, Grant>();
  constructor(
    private repo: Repository,
    private origin: string,
  ) {}
  async begin(url: string, homeId: string) {
    const cfg = settingsSchema.parse({ homeAssistantUrl: url, homeAssistantHomeId: homeId });
    if (
      !cfg.homeAssistantUrl ||
      !(await this.repo.catalog()).homes.some((h) => h.id === homeId && h.enabled)
    )
      throw new DomainError("Informe o endereço do Home Assistant e selecione uma casa ativa.");
    for (const [state, grant] of this.grants)
      if (grant.expires <= Date.now()) this.grants.delete(state);
    if (this.grants.size >= 5)
      throw new DomainError("Há autorizações pendentes. Aguarde alguns minutos.");
    const state = randomBytes(32).toString("base64url");
    this.grants.set(state, {
      url: cfg.homeAssistantUrl.replace(/\/$/, ""),
      homeId,
      expires: Date.now() + 300000,
    });
    const authorize = new URL(`${cfg.homeAssistantUrl.replace(/\/$/, "")}/auth/authorize`);
    authorize.search = new URLSearchParams({
      client_id: this.origin,
      redirect_uri: `${this.origin}/settings?ha_auth=1`,
      state,
    }).toString();
    return { url: authorize.toString() };
  }
  async finish(state: string, code: string) {
    const grant = this.grants.get(state);
    this.grants.delete(state);
    if (!grant || grant.expires <= Date.now())
      throw new DomainError("A autorização expirou ou já foi usada. Conecte novamente.");
    let refreshToken: string | undefined;
    try {
      const response = await fetch(`${grant.url}/auth/token`, {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          client_id: this.origin,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error("HA authorization rejected");
      const tokens = await response.json();
      if (typeof tokens.access_token !== "string" || typeof tokens.refresh_token !== "string")
        throw new Error("Invalid token response");
      refreshToken = tokens.refresh_token;
      const token = await this.createLongLivedToken(grant.url, tokens.access_token);
      const cfg = settingsSchema.parse({
        ...(await this.repo.settings()),
        homeAssistantEnabled: true,
        homeAssistantUrl: grant.url,
        homeAssistantHomeId: grant.homeId,
        homeAssistantToken: token,
      });
      await this.repo.db.setting.upsert({
        where: { id: "settings" },
        create: { id: "settings", data: json(cfg) },
        update: { data: json(cfg) },
      });
      await this.repo.event("home_assistant_authorized", { home: grant.homeId });
    } catch {
      throw new DomainError(
        "Não consegui concluir a autorização no Home Assistant. Tente conectar novamente ou use um token manual.",
      );
    } finally {
      if (refreshToken)
        await fetch(`${grant.url}/auth/revoke`, {
          method: "POST",
          redirect: "error",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token: refreshToken }),
          signal: AbortSignal.timeout(5000),
        }).catch(() => {});
    }
  }
  private createLongLivedToken(base: string, accessToken: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const url = new URL(`${base}/api/websocket`);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(url, {
        maxPayload: 65536,
        handshakeTimeout: 8000,
        followRedirects: false,
      });
      let settled = false,
        requested = false;
      const done = (token?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        ws.close();
        if (token) resolve(token);
        else reject(new Error("HA token creation failed"));
      };
      const timeout = setTimeout(() => {
        done();
        ws.terminate();
      }, 12000);
      ws.on("error", () => done());
      ws.on("close", () => done());
      ws.on("message", (raw) => {
        try {
          const message = JSON.parse(raw.toString());
          if (message.type === "auth_required")
            ws.send(JSON.stringify({ type: "auth", access_token: accessToken }));
          else if (message.type === "auth_ok" && !requested) {
            requested = true;
            ws.send(
              JSON.stringify({
                id: 1,
                type: "auth/long_lived_access_token",
                client_name: `Rosie ${new Date().toISOString()}`,
                lifespan: 3650,
              }),
            );
          } else if (message.type === "auth_invalid") done();
          else if (message.type === "result" && message.id === 1)
            done(
              message.success && typeof message.result === "string" ? message.result : undefined,
            );
        } catch {
          done();
        }
      });
    });
  }
}
