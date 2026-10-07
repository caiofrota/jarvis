import { describe, expect, it, vi } from "vitest";
import type { HomeAssistantAddon } from "../src/server/addons/home-assistant";
import { CompanionConversation } from "../src/server/conversation/companion";
import { wav } from "../src/server/robot/codec";
import { httpFixture } from "./http-fixture";

describe("companion API", () => {
  it("requires authentication, origin, ownership and bounded PCM audio", async () => {
    const f = await httpFixture();
    const transcribe = vi.fn(async () => ({ speech: true, text: "Boa tarde" }));
    const synthesize = vi.fn(async () => Buffer.alloc(3200));
    f.rt.voice.transcribe = transcribe;
    f.rt.voice.synthesize = synthesize;
    f.rt.voice.health = async () => ({
      ready: true,
      voices: ["kokoro-pf_dora"],
      busy: false,
      cloudHomeId: undefined,
      cloudError: undefined,
    });
    f.rt.companion = new CompanionConversation(f.repo, {
      status: () => ({ ready: false }),
    } as HomeAssistantAddon);
    try {
      const path = f.url + "/api/v1/companion/";
      expect((await fetch(path + "options")).status).toBe(401);
      const login = await fetch(f.url + "/api/v1/login", {
        method: "POST",
        headers: { origin: f.url, "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "fixture-user-password" }),
      });
      const headers = {
        cookie: (login.headers.get("set-cookie") ?? "").split(";")[0],
        origin: f.url,
        "content-type": "application/json",
      };
      const send = (route: string, input: unknown) =>
        fetch(path + route, { method: "POST", headers, body: JSON.stringify(input) });
      expect(
        (
          await fetch(path + "session", {
            method: "POST",
            headers: { ...headers, origin: "https://invalid.example" },
            body: "{}",
          })
        ).status,
      ).toBe(403);
      const { sessionId } = await (await send("session", {})).json();
      const options = await (await fetch(path + "options", { headers })).json();
      expect(options).toMatchObject({ name: "Jarvis", areas: [] });
      const audio = wav(Buffer.alloc(3200)).toString("base64");
      expect(await (await send("transcribe", { sessionId, audio })).json()).toEqual({
        text: "Boa tarde",
      });
      expect(transcribe).toHaveBeenCalledWith(expect.any(Buffer), "base", expect.any(AbortSignal));
      transcribe.mockResolvedValueOnce({ speech: false, text: "discard" });
      expect(await (await send("transcribe", { sessionId, audio })).json()).toEqual({ text: "" });
      expect(
        (await send("transcribe", { sessionId, audio: Buffer.from("invalid").toString("base64") }))
          .status,
      ).toBe(409);
      expect(
        (
          await send("transcribe", {
            sessionId,
            audio: wav(Buffer.alloc(640002)).toString("base64"),
          })
        ).status,
      ).toBe(409);
      const other = f.rt.companion.create("other-user");
      expect((await send("transcribe", { sessionId: other, audio })).status).toBe(409);
      expect((await send("message", { sessionId, text: "x".repeat(4001) })).status).toBe(422);
      const speech = await (await send("speak", { sessionId, text: "Olá" })).json();
      expect(Buffer.from(speech.audio, "base64").toString("ascii", 0, 4)).toBe("RIFF");
      expect(speech.mime).toBe("audio/wav");
      expect((await send("speak", { sessionId, text: "Olá", voice: "not-installed" })).status).toBe(
        409,
      );
      expect((await send("speak", { sessionId, text: "x".repeat(2501) })).status).toBe(409);
      const user = await f.repo.db.user.findUniqueOrThrow({ where: { username: "admin" } });
      await f.repo.db.user.update({ where: { id: user.id }, data: { role: "viewer" } });
      expect((await send("session", {})).status).toBe(403);
    } finally {
      await f.close();
    }
  });
});
