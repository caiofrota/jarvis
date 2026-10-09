import { once } from "node:events";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { expect, it, vi } from "vitest";
import WebSocket from "ws";
import { Automations } from "../src/server/automation/service";
import { CatalogService } from "../src/server/catalog/service";
import { Conversation } from "../src/server/conversation/service";
import { RobotGateway } from "../src/server/robot/gateway";
import { VoiceClient } from "../src/server/voice/client";
import { VoiceProfiles } from "../src/server/voice/profiles";
import { repositoryFixture } from "./fixture";
import { mockVoice } from "./mock-voice";

async function until(check: () => boolean) {
  for (let i = 0; i < 300; i++) {
    if (check()) return;
    await delay(10);
  }
  throw new Error("Timed out waiting for session");
}
it("enrolls through the microphone without conversation calls and isolates automatic identity between sessions", async () => {
  const f = await repositoryFixture(),
    worker = await mockVoice(),
    server = createServer();
  const voice = new VoiceClient(worker.url, "fixture"),
    profiles = new VoiceProfiles(f.repo, voice);
  const automations = new Automations(f.repo),
    conversation = new Conversation(f.repo, automations);
  const gateway = new RobotGateway(f.repo, voice, conversation, profiles);
  const catalog = new CatalogService(f.repo);
  await catalog.save("residents", { name: "Caio", homeId: "home" });
  const vector = Array.from({ length: 256 }, (_, i) => (i === 0 ? 1 : 0));
  vi.spyOn(voice, "health").mockResolvedValue({
    ready: true,
    busy: false,
    voices: [],
    speakerIdentification: true,
    cloudHomeId: undefined,
    cloudError: undefined,
  });
  const embedding = vi
    .spyOn(voice, "speakerEmbedding")
    .mockResolvedValue({ model: "fixture", quality: "ready", speechSeconds: 4, embedding: vector });
  const transcribe = vi.spyOn(voice, "transcribe"),
    respond = vi.spyOn(conversation, "respond");
  gateway.attach(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("port");
  const sockets: WebSocket[] = [];
  async function connect(id: string) {
    const ws = new WebSocket(
      `ws://127.0.0.1:${address && typeof address !== "string" ? address.port : 0}/ws/robot/${id}`,
      { headers: { authorization: `Bearer fixture-credential-${id}` } },
    );
    sockets.push(ws);
    let playId = "",
      bytes = 0;
    ws.on("message", (data, binary) => {
      if (binary) {
        bytes += Buffer.from(data as Buffer).length;
        ws.send(JSON.stringify({ type: "played", id: playId, bytes }));
      } else {
        const event = JSON.parse(data.toString());
        if (event.type === "play_start") {
          playId = event.id;
          bytes = 0;
        }
        if (event.type === "play_end")
          ws.send(JSON.stringify({ type: "play_done", id: playId, bytes }));
      }
    });
    await once(ws, "open");
    await until(() => gateway.sessions.has(id));
    await delay(50);
    return ws;
  }
  try {
    const one = await connect("one"),
      two = await connect("two");
    worker.setTranscript("Você consegue dizer quem está falando com você agora?");
    const synthesize = vi.spyOn(voice, "synthesize");
    const session = gateway.sessions.get("one");
    if (!session) throw new Error("session");
    const job = await profiles.begin("caio", "one");
    await session.enrollVoice(job);
    for (let i = 0; i < 3; i++) {
      const before = embedding.mock.calls.length;
      one.send(Buffer.alloc(640, 1));
      await until(() => embedding.mock.calls.length > before);
      await until(() =>
        i === 2
          ? job.phase === "complete" && session.state === "idle"
          : job.samples.length === i + 1 && session.state === "listening",
      );
      await delay(30);
    }
    expect(transcribe).not.toHaveBeenCalled();
    expect(respond).not.toHaveBeenCalled();
    one.send(JSON.stringify({ type: "wake" }));
    await until(() => session.state === "listening");
    one.send(Buffer.alloc(640, 1));
    await until(() => respond.mock.calls.length === 1);
    await until(() => session.state === "listening");
    expect(respond.mock.calls[0][3]).toBe("caio");
    expect(synthesize.mock.calls[0][0]).toBe("Reconheci sua voz, Caio!");
    expect(session.identifiedResident).toBe("caio");
    expect(gateway.sessions.get("two")?.identifiedResident).toBeNull();
    expect((await f.repo.catalog()).endpoints[0].residentId).toBeNull();
    await session.stop();
    expect(session.identifiedResident).toBeNull();
    embedding.mockResolvedValue({
      model: "fixture",
      quality: "too_short",
      speechSeconds: 0.5,
      embedding: null,
    });
    two.send(JSON.stringify({ type: "wake" }));
    await until(() => gateway.sessions.get("two")?.state === "listening");
    two.send(Buffer.alloc(640, 1));
    await until(() => respond.mock.calls.length === 2);
    expect(respond.mock.calls[1][3]).toBeNull();
    await until(() => synthesize.mock.calls.length === 2);
    expect(synthesize.mock.calls[1][0]).toContain("Ainda não identifiquei");
    await until(() => gateway.sessions.get("two")?.state === "listening");
    const next = await profiles.begin("caio", "one");
    await session.enrollVoice(next);
    one.close();
    await until(() => next.phase === "error");
    expect((await profiles.status("caio")).registered).toBe(true);
  } finally {
    for (const ws of sockets) ws.terminate();
    gateway.close();
    automations.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await worker.close();
    await delay(50);
    await f.close();
    vi.restoreAllMocks();
  }
}, 15000);
