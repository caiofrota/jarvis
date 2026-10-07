import { once } from "node:events";
import { createServer } from "node:http";
import { expect, it, vi } from "vitest";
import { WebSocketServer } from "ws";
import { HomeAssistantAuthorization } from "../src/server/addons/home-assistant-auth";
import { repositoryFixture } from "./fixture";

it("exchanges a single-use authorization, creates the integration token and revokes the temporary grant", async () => {
  const f = await repositoryFixture(),
    requests: { url?: string; body: string }[] = [],
    commands: Record<string, unknown>[] = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({ url: req.url, body });
    res.setHeader("content-type", "application/json");
    res.end(
      req.url === "/auth/token"
        ? JSON.stringify({ access_token: "fixture-access", refresh_token: "fixture-refresh" })
        : "{}",
    );
  });
  const wss = new WebSocketServer({ server });
  wss.on("connection", (ws) => {
    ws.send(JSON.stringify({ type: "auth_required" }));
    ws.on("message", (raw) => {
      const command = JSON.parse(raw.toString());
      commands.push(command);
      if (command.type === "auth")
        ws.send(
          JSON.stringify({
            type: command.access_token === "fixture-access" ? "auth_ok" : "auth_invalid",
          }),
        );
      else
        ws.send(
          JSON.stringify({
            type: "result",
            id: command.id,
            success: true,
            result: "fixture-integration-token",
          }),
        );
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("port");
  const base = `http://127.0.0.1:${address.port}`,
    auth = new HomeAssistantAuthorization(f.repo, "http://rosie.invalid");
  try {
    await expect(auth.begin(base, "missing")).rejects.toThrow(/casa ativa/);
    const start = await auth.begin(base, "home"),
      url = new URL(start.url),
      state = url.searchParams.get("state") ?? "";
    expect(url.pathname).toBe("/auth/authorize");
    expect(url.searchParams.get("redirect_uri")).toBe("http://rosie.invalid/settings?ha_auth=1");
    await expect(auth.finish("invalid-state", "unused")).rejects.toThrow(/expirou/);
    expect(requests).toHaveLength(0);
    await auth.finish(state, "fixture-code");
    const cfg = await f.repo.settings();
    expect(cfg.homeAssistantToken).toBe("fixture-integration-token");
    expect(cfg.homeAssistantEnabled).toBe(true);
    expect(cfg.homeAssistantHomeId).toBe("home");
    expect(new URLSearchParams(requests[0].body).get("client_id")).toBe("http://rosie.invalid");
    expect(commands[1]).toMatchObject({ type: "auth/long_lived_access_token", lifespan: 3650 });
    expect(requests[1]).toEqual({ url: "/auth/revoke", body: "token=fixture-refresh" });
    await expect(auth.finish(state, "fixture-code")).rejects.toThrow(/já foi usada/);
    expect(requests).toHaveLength(2);
    const expired = new URL((await auth.begin(base, "home")).url).searchParams.get("state") ?? "";
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 300001);
    await expect(auth.finish(expired, "fixture-code")).rejects.toThrow(/expirou/);
    clock.mockRestore();
    expect(JSON.stringify(await f.repo.db.event.findMany())).not.toContain(
      "fixture-integration-token",
    );
  } finally {
    vi.restoreAllMocks();
    for (const ws of wss.clients) ws.terminate();
    wss.close();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await f.close();
  }
});
