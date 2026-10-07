import { once } from "node:events";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { json } from "@rosie/db";
import { context } from "@rosie/types/context";
import { expect, it, vi } from "vitest";
import WebSocket from "ws";
import { Automations } from "../src/server/automation/service";
import { Conversation } from "../src/server/conversation/service";
import { decodeBatch, encode } from "../src/server/robot/codec";
import { RobotGateway } from "../src/server/robot/gateway";
import {
  interactionChoice,
  interactionRestriction,
  interactionSchema,
} from "../src/server/robot/interaction";
import { Interactions } from "../src/server/robot/interactions";
import { VoiceClient } from "../src/server/voice/client";
import { catalogFixture, repositoryFixture } from "./fixture";
import { mockVoice } from "./mock-voice";

async function eventually(check: () => boolean) {
  for (let n = 0; n < 200; n++) {
    if (check()) return;
    await delay(10);
  }
  throw new Error("Condition not reached");
}
const request = (id: string, type = "ask") =>
  interactionSchema.parse({
    id,
    type,
    text: "Posso apagar a luz?",
    expiresAt: new Date(Date.now() + 120000).toISOString(),
    timeoutSeconds: 90,
  });
it("respects quiet windows and exact, unambiguous choices without interpreting negated answers as yes", () => {
  const c = catalogFixture(),
    ctx = context(c, "one"),
    r = request("choices");
  expect(interactionChoice("sim, por favor", r)).toBe("yes");
  expect(interactionChoice("não, pode deixar", r)).toBeUndefined();
  expect(interactionChoice("não", r)).toBe("no");
  ctx.endpoint.announcements.quietEnabled = true;
  expect(interactionRestriction(ctx, new Date("2026-09-24T02:00:00Z"))).toEqual({
    status: "quiet",
  });
  expect(interactionRestriction(ctx, new Date("2026-09-24T15:00:00Z"))).toBeUndefined();
  ctx.endpoint.announcements.enabled = false;
  expect(interactionRestriction(ctx)).toEqual({ status: "disabled" });
  expect(() =>
    interactionSchema.parse({
      ...r,
      choices: [
        { value: "yes", label: "Sim" },
        { value: "no", label: "sim" },
      ],
    }),
  ).toThrow();
});
it("speaks and asks on one endpoint, correlates local answers, times out and deduplicates across bridge restart", async () => {
  const f = await repositoryFixture(),
    worker = await mockVoice(),
    server = createServer(),
    voice = new VoiceClient(worker.url, "fixture-private"),
    automations = new Automations(f.repo),
    conversation = new Conversation(f.repo, automations),
    gateway = new RobotGateway(f.repo, voice, conversation);
  let bridge = new Interactions(f.repo, gateway, automations.addons.mqtt);
  const sockets: WebSocket[] = [],
    events: Record<string, unknown>[] = [];
  gateway.attach(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("port");
  const connect = async (id: string) => {
    const ws = new WebSocket(`ws://127.0.0.1:${address.port}/ws/robot/${id}`, {
      headers: { authorization: `Bearer fixture-credential-${id}` },
    });
    sockets.push(ws);
    let playId = "",
      bytes = 0;
    ws.on("message", (data, binary) => {
      if (binary) {
        bytes += decodeBatch(Buffer.from(data as Buffer), 5).length;
        ws.send(JSON.stringify({ type: "played", id: playId, bytes }));
      } else {
        const event = JSON.parse(data.toString());
        events.push({ ...event, endpoint: id });
        if (event.type === "play_start") {
          playId = event.id;
          bytes = 0;
        }
        if (event.type === "play_end")
          ws.send(JSON.stringify({ type: "play_done", id: playId, bytes }));
      }
    });
    await once(ws, "open");
    ws.send(
      JSON.stringify({
        type: "hello",
        audio_codec: "ima_adpcm",
        audio_batch_frames: 5,
        drowsy_listening: true,
      }),
    );
    await eventually(() =>
      events.some((e) => e.endpoint === id && e.type === "configure" && e.audio_batch_frames === 5),
    );
    return ws;
  };
  const say = (ws: WebSocket, text: string) => {
    worker.setTranscript(text);
    ws.send(encode(Buffer.alloc(640, 1), { predictor: 0, index: 0 }));
  };
  try {
    const one = await connect("one");
    await connect("two");
    await bridge.configure();
    const respond = vi.spyOn(conversation, "respond");
    const answer = bridge.submit("one", request("first"));
    await eventually(() => gateway.sessions.get("one")?.state === "listening");
    expect(events.some((e) => e.endpoint === "two" && e.type === "play_start")).toBe(false);
    // The request's 90-second window must override the endpoint's shorter default.
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 40000);
    await gateway.sessions.get("one")?.tick();
    clock.mockRestore();
    expect(gateway.sessions.get("one")?.state).toBe("listening");
    say(one, "sim, por favor");
    expect(await answer).toEqual({ status: "answered", choice: "yes" });
    expect(respond).not.toHaveBeenCalled();
    await eventually(() => gateway.sessions.get("one")?.availableForInteraction === true);
    expect(
      events
        .filter((e) => e.endpoint === "one" && e.type === "configure" && Object.hasOwn(e, "volume"))
        .slice(2)
        .every((e) => e.audio_codec === "ima_adpcm" && e.audio_batch_frames === 5),
    ).toBe(true);
    expect(await bridge.submit("one", request("first"))).toEqual({ status: "duplicate" });
    bridge.close();
    bridge = new Interactions(f.repo, gateway, automations.addons.mqtt);
    await bridge.configure();
    expect(await bridge.submit("one", request("first"))).toEqual({ status: "duplicate" });
    expect(await bridge.submit("one", request("notice", "announce"))).toEqual({ status: "played" });
    await eventually(() => gateway.sessions.get("one")?.availableForInteraction === true);
    const negative = bridge.submit("one", request("negative"));
    await eventually(() => gateway.sessions.get("one")?.state === "listening");
    say(one, "não");
    expect(await negative).toEqual({ status: "answered", choice: "no" });
    await eventually(() => gateway.sessions.get("one")?.availableForInteraction === true);
    const cancel = bridge.submit("one", request("cancel"));
    await eventually(() => gateway.sessions.get("one")?.state === "listening");
    say(one, "pode parar");
    expect(await cancel).toEqual({ status: "cancelled" });
    await eventually(() => gateway.sessions.get("one")?.availableForInteraction === true);
    const timeout = bridge.submit("one", { ...request("timeout"), timeoutSeconds: 5 });
    await eventually(() => gateway.sessions.get("one")?.state === "listening");
    const later = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 6000);
    await gateway.sessions.get("one")?.tick();
    later.mockRestore();
    expect(await timeout).toEqual({ status: "timeout" });
    await eventually(() => gateway.sessions.get("one")?.availableForInteraction === true);
    const lost = bridge.submit("one", request("disconnect"));
    await eventually(() => gateway.sessions.get("one")?.state === "listening");
    one.terminate();
    expect(await lost).toEqual({ status: "disconnected" });
    expect(await bridge.submit("one", request("offline"))).toEqual({ status: "disconnected" });
    const c = await f.repo.catalog();
    c.endpoints[1].announcements.enabled = false;
    await f.repo.db.entry.update({
      where: { collection_id: { collection: "endpoints", id: "two" } },
      data: { data: json(c.endpoints[1]) },
    });
    expect(await bridge.submit("two", request("disabled"))).toEqual({ status: "disabled" });
  } finally {
    vi.restoreAllMocks();
    bridge.close();
    gateway.close();
    automations.close();
    for (const ws of sockets) ws.terminate();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await worker.close();
    await delay(30);
    await f.close();
  }
});
