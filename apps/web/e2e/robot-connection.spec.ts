import { once } from "node:events";
import WebSocket from "ws";
import { expect, test } from "./fixtures";

test("opening the panel does not block robot connections or reconnections", async ({ request }) => {
  for (const path of ["/settings", "/intents", "/"]) {
    expect((await request.get(path)).ok()).toBe(true);
    const ws = new WebSocket("ws://127.0.0.1:8877/ws/robot/one", {
      headers: { authorization: "Bearer fixture-credential-one" },
      handshakeTimeout: 3000,
    });
    try {
      const first = once(ws, "message");
      // Observe both promises immediately if the handshake fails.
      const [, [data]] = await Promise.all([once(ws, "open"), first]);
      expect(JSON.parse(data.toString()).type).toBe("configure");
      const closed = once(ws, "close");
      ws.close(1000);
      await closed;
    } finally {
      ws.terminate();
    }
  }
  const unauthorized = new WebSocket("ws://127.0.0.1:8877/ws/robot/one", {
    handshakeTimeout: 3000,
  });
  try {
    await expect(once(unauthorized, "open")).rejects.toThrow("401");
  } finally {
    unauthorized.terminate();
  }
  expect((await request.get("/ws/robot/one")).status()).toBe(404);
});
