import { once } from "node:events";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { json } from "@rosie/db";
import { schemas } from "@rosie/types";
import { expect, it, vi } from "vitest";
import WebSocket from "ws";
import { Automations } from "../src/server/automation/service";
import { Conversation } from "../src/server/conversation/service";
import { decodeBatch, encode } from "../src/server/robot/codec";
import { RobotGateway } from "../src/server/robot/gateway";
import { VoiceClient } from "../src/server/voice/client";
import { repositoryFixture } from "./fixture";
import { mockVoice } from "./mock-voice";

async function eventually(check: () => boolean) {
  for (let n = 0; n < 150; n++) {
    if (check()) return;
    await delay(10);
  }
  throw new Error("Condition not reached");
}
it("keeps two endpoints independent, negotiates codec and finishes playback on the originating box", async () => {
  const f = await repositoryFixture(),
    worker = await mockVoice(),
    server = createServer(),
    voice = new VoiceClient(worker.url, "fixture-private"),
    automations = new Automations(f.repo),
    conversation = new Conversation(f.repo, automations),
    gateway = new RobotGateway(f.repo, voice, conversation),
    sockets: WebSocket[] = [];
  gateway.attach(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("port");
  const connect = async (id: string) => {
    const ws = new WebSocket(`ws://127.0.0.1:${address.port}/ws/robot/${id}`, {
        headers: { authorization: `Bearer fixture-credential-${id}` },
      }),
      events: Record<string, unknown>[] = [];
    let bytes = 0,
      playId = "";
    sockets.push(ws);
    ws.on("message", (data, binary) => {
      if (binary) {
        bytes += decodeBatch(Buffer.from(data as Buffer), 5).length;
        ws.send(JSON.stringify({ type: "played", id: playId, bytes }));
      } else {
        const event = JSON.parse(data.toString());
        events.push(event);
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
      events.some((e) => e.type === "configure" && e.audio_batch_frames === 5),
    );
    return { ws, events };
  };
  try {
    const one = await connect("one"),
      two = await connect("two");
    one.ws.send(JSON.stringify({ type: "wake" }));
    await eventually(() => gateway.sessions.get("one")?.state === "listening");
    one.ws.send(encode(Buffer.alloc(640, 1), { predictor: 0, index: 0 }));
    await eventually(() => one.events.some((e) => e.type === "play_end"));
    await eventually(() => gateway.sessions.get("one")?.state === "listening");
    expect(two.events.some((e) => e.type === "play_start")).toBe(false);
    const ac = schemas.devices.parse({
      id: "ac-office",
      name: "Ar do escritório",
      homeId: "home",
      roomId: "office",
      kind: "climate",
      connection: "home-assistant",
      haEntityId: "climate.office",
      actions: { set_temperature: "set_temperature" },
    });
    await f.repo.db.entry.create({
      data: { collection: "devices", id: ac.id, name: ac.name, data: json(ac) },
    });
    vi.spyOn(automations.addons.homeAssistant, "comfortState").mockReturnValue({
      mode: "cool",
      temperature: 20,
      min: 17,
      max: 27,
      step: 1,
    });
    vi.spyOn(automations.addons.homeAssistant, "validateTemperature").mockImplementation(() => {});
    const send = vi.spyOn(automations.addons.homeAssistant, "execute").mockResolvedValue(undefined);
    const speech = vi.spyOn(voice, "synthesize");
    worker.setTranscript("Rosie, estou sentindo frio aqui no escritório.");
    one.ws.send(encode(Buffer.alloc(640, 1), { predictor: 0, index: 0 }));
    await eventually(() => speech.mock.calls.some((call) => call[0].includes("aumente para 22")));
    await eventually(() => gateway.sessions.get("one")?.state === "listening");
    expect(send).not.toHaveBeenCalled();
    worker.setTranscript("Não, Rosie.");
    one.ws.send(encode(Buffer.alloc(640, 1), { predictor: 0, index: 0 }));
    await eventually(() =>
      speech.mock.calls.some((call) => call[0].includes("não vou mudar nada")),
    );
    await eventually(() => gateway.sessions.get("one")?.state === "listening");
    expect(send).not.toHaveBeenCalled();
    speech.mockClear();
    const respond = vi.spyOn(conversation, "respond"),
      reset = vi.spyOn(conversation, "reset"),
      synthesize = vi.spyOn(voice, "synthesize"),
      start = one.events.length;
    worker.setTranscript("Rosie, não quero mais conversar, por favor.");
    one.ws.send(encode(Buffer.alloc(640, 1), { predictor: 0, index: 0 }));
    await eventually(() =>
      one.events
        .slice(start)
        .some((e) => e.type === "state" && e.state === "idle" && e.sleep_now === true),
    );
    expect(one.events.slice(start).some((e) => e.type === "cancel")).toBe(true);
    expect(respond).not.toHaveBeenCalled();
    expect(synthesize).not.toHaveBeenCalled();
    expect(reset).toHaveBeenCalledExactlyOnceWith("one");
    expect(gateway.sessions.get("one")?.state).toBe("idle");
    const replacement = await connect("one");
    await eventually(() => one.ws.readyState === WebSocket.CLOSED);
    expect(two.ws.readyState).toBe(WebSocket.OPEN);
    expect(gateway.sessions.size).toBe(2);
    const c = await f.repo.catalog();
    for (const endpoint of c.endpoints) {
      endpoint.acousticGroup = "shared-room";
      if (endpoint.id === "one") {
        endpoint.display.mode = "off";
        endpoint.indicatorLight = {
          enabled: true,
          listeningBrightness: 35,
          speakingMinBrightness: 15,
          speakingMaxBrightness: 75,
        };
      }
      await f.repo.db.entry.update({
        where: { collection_id: { collection: "endpoints", id: endpoint.id } },
        data: { data: json(endpoint) },
      });
    }
    await gateway.refresh();
    await eventually(() =>
      replacement.events.some((e) => e.type === "configure" && e.display_enabled === false),
    );
    const appearance = replacement.events.filter((e) => e.type === "configure").at(-1);
    expect(appearance).toMatchObject({
      led_enabled: true,
      led_listening_brightness: 35,
      led_speaking_min_brightness: 15,
      led_speaking_max_brightness: 75,
    });
    expect(two.events.filter((e) => e.type === "configure").at(-1)).toMatchObject({
      display_enabled: true,
      led_enabled: false,
    });
    await gateway.sessions.get("one")?.listen();
    await gateway.sessions.get("two")?.listen();
    expect(gateway.sessions.get("two")?.state).toBe("idle");
    await gateway.sessions.get("one")?.stop();
    await gateway.sessions.get("two")?.listen();
    expect(gateway.sessions.get("two")?.state).toBe("listening");
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-24T00:59:59.900Z"));
    try {
      const endpoint = c.endpoints.find((e) => e.id === "two");
      if (!endpoint) throw new Error("Missing second endpoint");
      endpoint.display = { mode: "auto", scheduleEnabled: true, offAt: "22:00", onAt: "07:00" };
      await f.repo.db.entry.update({
        where: { collection_id: { collection: "endpoints", id: "two" } },
        data: { data: json(endpoint) },
      });
      await gateway.refresh();
      await gateway.sessions.get("two")?.listen(false);
      const boundary = two.events.length;
      clock.mockReturnValue(Date.parse("2026-09-24T01:00:00.001Z"));
      await gateway.sessions.get("two")?.tick();
      await eventually(() =>
        two.events.slice(boundary).some((e) => e.type === "display" && e.enabled === false),
      );
      expect(gateway.sessions.get("two")?.state).toBe("listening");
      expect(two.events.slice(boundary).some((e) => e.type === "cancel")).toBe(false);
    } finally {
      clock.mockRestore();
    }
  } finally {
    for (const ws of sockets) ws.terminate();
    gateway.close();
    await new Promise<void>((r) => server.close(() => r()));
    await worker.close();
    await delay(50);
    await f.close();
  }
}, 10000);
