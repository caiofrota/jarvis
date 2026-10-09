import { settingsSchema } from "@rosie/types";
import { afterEach, expect, it, vi } from "vitest";
import { wav } from "../src/server/robot/codec";
import { VoiceClient } from "../src/server/voice/client";
import { HomeAssistantVoice } from "../src/server/voice/home-assistant";
import { MAX_AUDIO_BYTES, pcmFromWav } from "../src/server/voice/wav";

afterEach(() => vi.unstubAllGlobals());

function fixture() {
  const settings = settingsSchema.parse({
    homeAssistantEnabled: true,
    homeAssistantUrl: "http://ha.invalid:8123",
    homeAssistantToken: "fixture-ha-secret",
    homeAssistantHomeId: "home",
  });
  const repo = { settings: async () => settings };
  const addon = {
    status: () => ({ enabled: true, connected: true, ready: true, entities: 1, error: null }),
    cloudVoices: vi.fn(async () => ["FranciscaNeural", "AntonioNeural"]),
  };
  const pcm = Buffer.alloc(3200, 10);
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) =>
    init?.method === "POST"
      ? Response.json({
          url: "https://untrusted.invalid/do-not-fetch",
          path: "/api/tts_proxy/abc_pt-br_tts.home_assistant_cloud.wav",
        })
      : new Response(new Uint8Array(wav(pcm))),
  );
  const cloud = new HomeAssistantVoice(repo, addon, fetcher);
  return { settings, repo, addon, pcm, fetcher, cloud };
}

it("synthesizes only through HA Cloud, keeping credentials on the configured origin and requiring robot PCM", async () => {
  const f = fixture();
  expect(await f.cloud.synthesize("Olá!", "ha-cloud-FranciscaNeural", "home")).toEqual(f.pcm);
  expect(f.fetcher.mock.calls.map(([url]) => String(url))).toEqual([
    "http://ha.invalid:8123/api/tts_get_url",
    "http://ha.invalid:8123/api/tts_proxy/abc_pt-br_tts.home_assistant_cloud.wav",
  ]);
  const init = f.fetcher.mock.calls[0][1];
  if (!init) throw new Error("Missing synthesis request");
  expect(init.redirect).toBe("error");
  expect(init.headers).toMatchObject({ authorization: "Bearer fixture-ha-secret" });
  expect(JSON.parse(String(init.body))).toMatchObject({
    engine_id: "tts.home_assistant_cloud",
    cache: false,
    language: "pt-BR",
    message: "Olá!",
    options: {
      voice: "FranciscaNeural",
      preferred_sample_rate: 16000,
      preferred_sample_channels: 1,
      preferred_sample_bytes: 2,
    },
  });
  expect(f.fetcher.mock.calls[1][1]?.headers).toBeUndefined();
});

it("caches and coalesces voice discovery only, invalidating it for a changed home or credential", async () => {
  const f = fixture();
  await Promise.all([f.cloud.availability(), f.cloud.availability()]);
  await f.cloud.availability();
  expect(f.addon.cloudVoices).toHaveBeenCalledTimes(1);
  f.settings.homeAssistantToken = "new-fixture";
  await f.cloud.availability();
  expect(f.addon.cloudVoices).toHaveBeenCalledTimes(2);
  f.settings.homeAssistantEnabled = false;
  expect((await f.cloud.availability()).voices).toEqual([]);
});

it.each([undefined, "other-home"])(
  "rejects a missing or foreign home (%s) before cloud traffic",
  async (home) => {
    const f = fixture();
    await expect(f.cloud.synthesize("Oi", "ha-cloud-FranciscaNeural", home)).rejects.toThrow(
      /casa/,
    );
    expect(f.fetcher).not.toHaveBeenCalled();
  },
);

it("rejects unavailable voices, disabled integration and oversized text before synthesis", async () => {
  const f = fixture();
  await expect(f.cloud.synthesize("Oi", "ha-cloud-inventada", "home")).rejects.toThrow(
    /indisponível/,
  );
  await expect(
    f.cloud.synthesize("a".repeat(2501), "ha-cloud-FranciscaNeural", "home"),
  ).rejects.toThrow(/tamanho/);
  f.settings.homeAssistantEnabled = false;
  await expect(f.cloud.synthesize("Oi", "ha-cloud-FranciscaNeural", "home")).rejects.toThrow(
    /Conecte/,
  );
  expect(f.fetcher).not.toHaveBeenCalled();
});

it.each([
  "https://evil.invalid/audio",
  "//evil.invalid/audio",
  "/api/tts_proxy/../config",
  "/api/tts_proxy/%2e%2e",
  "/api/tts_proxy/token?url=elsewhere",
])("refuses an unexpected audio address: %s", async (path) => {
  const f = fixture();
  f.fetcher.mockResolvedValue(Response.json({ path }));
  await expect(f.cloud.synthesize("Oi", "ha-cloud-FranciscaNeural", "home")).rejects.toThrow(
    /endereço/,
  );
  expect(f.fetcher).toHaveBeenCalledTimes(1);
});

it("bounds response bytes even when the server omits a content length", async () => {
  const f = fixture();
  f.fetcher
    .mockResolvedValueOnce(Response.json({ path: "/api/tts_proxy/token" }))
    .mockResolvedValueOnce(new Response(new Uint8Array(MAX_AUDIO_BYTES + 65537)));
  await expect(f.cloud.synthesize("Oi", "ha-cloud-FranciscaNeural", "home")).rejects.toThrow(
    /Não foi possível/,
  );
});

it("propagates cancellation and discards audio if integration scope changes while generating", async () => {
  const f = fixture(),
    abort = new AbortController();
  f.fetcher.mockImplementationOnce(async (_url, init) => {
    abort.abort();
    expect(init?.signal?.aborted).toBe(true);
    throw new Error("private upstream details");
  });
  await expect(
    f.cloud.synthesize("Oi", "ha-cloud-FranciscaNeural", "home", abort.signal),
  ).rejects.toThrow(/abort/i);
  const other = fixture();
  other.fetcher.mockImplementationOnce(async () => {
    other.settings.homeAssistantHomeId = "other-home";
    return Response.json({ path: "/api/tts_proxy/token" });
  });
  await expect(other.cloud.synthesize("Oi", "ha-cloud-FranciscaNeural", "home")).rejects.toThrow(
    /alterada/,
  );
});

it("caps active cloud syntheses and releases capacity after errors, without retries", async () => {
  const f = fixture(),
    waiters: Array<() => void> = [];
  f.fetcher.mockImplementation(
    () => new Promise((_resolve, reject) => waiters.push(() => reject(new Error("unavailable")))),
  );
  const pending = Array.from({ length: 4 }, () =>
    f.cloud.synthesize("Oi", "ha-cloud-FranciscaNeural", "home").catch((e: Error) => e),
  );
  await vi.waitFor(() => expect(waiters.length).toBe(4));
  await expect(f.cloud.synthesize("Oi", "ha-cloud-FranciscaNeural", "home")).rejects.toThrow(
    /ocupadas/,
  );
  for (const done of waiters) done();
  await Promise.all(pending);
  expect(f.fetcher).toHaveBeenCalledTimes(4);
  f.fetcher.mockResolvedValue(new Response(null, { status: 503 }));
  await expect(f.cloud.synthesize("Oi", "ha-cloud-FranciscaNeural", "home")).rejects.toThrow(/503/);
  expect(f.fetcher).toHaveBeenCalledTimes(5);
});

it("local voice never sends text to cloud; choosing cloud skips local TTS and has no silent fallback", async () => {
  const f = fixture();
  const local = vi.fn().mockResolvedValue(new Response(new Uint8Array(f.pcm)));
  vi.stubGlobal("fetch", local);
  const client = new VoiceClient("http://voice.invalid", "fixture-local-secret", f.cloud);
  await client.synthesize("**Olá!**", "kokoro-pf_dora", "fast", undefined, "home");
  expect(f.fetcher).not.toHaveBeenCalled();
  expect(local).toHaveBeenCalledTimes(1);
  local.mockClear();
  await client.synthesize("**Olá!**", "ha-cloud-AntonioNeural", "fast", undefined, "home");
  expect(local).not.toHaveBeenCalled();
  expect(JSON.parse(String(f.fetcher.mock.calls[0][1]?.body)).message).toBe("Olá!");
  f.fetcher.mockRejectedValue(new Error("private upstream"));
  await expect(
    client.synthesize("Oi", "ha-cloud-AntonioNeural", "fast", undefined, "home"),
  ).rejects.not.toThrow(/private upstream/);
  expect(local).not.toHaveBeenCalled();
});

it("decodes finite and ffmpeg pipe WAVs with metadata, preserving PCM", () => {
  const pcm = Buffer.alloc(3200, 7),
    standard = wav(pcm);
  expect(pcmFromWav(standard)).toEqual(pcm);
  const pipe = Buffer.from(standard);
  pipe.writeUInt32LE(0xffffffff, 4);
  pipe.writeUInt32LE(0xffffffff, 40);
  expect(pcmFromWav(pipe)).toEqual(pcm);
  const metadata = Buffer.from("4c4953540400000061626364", "hex");
  const withMetadata = Buffer.concat([pipe.subarray(0, 36), metadata, pipe.subarray(36)]);
  expect(pcmFromWav(withMetadata)).toEqual(pcm);
});

it.each([
  "stereo",
  "rate",
  "bits",
  "compressed",
  "truncated",
  "empty",
  "oversized",
  "malformed-chunk",
])("refuses %s WAV before playback", (kind) => {
  let audio = wav(Buffer.alloc(3200));
  if (kind === "stereo") audio.writeUInt16LE(2, 22);
  if (kind === "rate") audio.writeUInt32LE(24000, 24);
  if (kind === "bits") audio.writeUInt16LE(8, 34);
  if (kind === "compressed") audio.writeUInt16LE(3, 20);
  if (kind === "truncated") audio = audio.subarray(0, 100);
  if (kind === "empty") audio = wav(Buffer.alloc(0));
  if (kind === "oversized") audio = wav(Buffer.alloc(MAX_AUDIO_BYTES + 2));
  if (kind === "malformed-chunk") audio.writeUInt32LE(0xfffffff0, 16);
  expect(() => pcmFromWav(audio)).toThrow(/formato inválido/);
});
