import { settingsSchema } from "@rosie/types";
import { expect, it, vi } from "vitest";
import { VoiceClient } from "../src/server/voice/client";
import { ProviderSpeech, pcm24To16 } from "../src/server/voice/providers";

it("uses the configured OpenAI key and returns mono PCM16 at 16 kHz without a local worker", async () => {
  const settings = settingsSchema.parse({ openaiKey: "fixture-openai" });
  const pcm = Buffer.alloc(4800);
  for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(1200, i);
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(new Uint8Array(pcm)));
  const providers = new ProviderSpeech(async () => settings, fetcher);
  const voices = await providers.availability();
  expect(voices.voices).toContain("openai-marin");
  expect(voices.names["openai-cedar"]).toBe("cedar · OpenAI");
  expect(fetcher).not.toHaveBeenCalled();
  const client = new VoiceClient("http://worker.invalid", "fixture", undefined, providers);
  const audio = await client.synthesize("Olá", "openai-marin", "fast");
  expect(audio.length).toBe(3200);
  expect(audio.readInt16LE(300)).toBe(1200);
  expect(fetcher.mock.calls[0][0]).toBe("https://api.openai.com/v1/audio/speech");
  expect(fetcher.mock.calls[0][1]).toMatchObject({
    redirect: "error",
    headers: { authorization: "Bearer fixture-openai" },
  });
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({
    model: "gpt-4o-mini-tts",
    voice: "marin",
    response_format: "pcm",
  });
});

it("discovers account-specific ElevenLabs voices, caches discovery and invalidates changed keys", async () => {
  const settings = settingsSchema.parse({ elevenlabsKey: "fixture-eleven" });
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) =>
    init?.method === "POST"
      ? new Response(new Uint8Array(Buffer.alloc(3200)))
      : Response.json({
          voices: [{ voice_id: "unfamiliar_voice", name: "Minha voz" }],
          has_more: false,
        }),
  );
  const providers = new ProviderSpeech(async () => settings, fetcher);
  const [a, b] = await Promise.all([providers.availability(), providers.availability()]);
  expect(a).toEqual(b);
  expect(a.names["elevenlabs-unfamiliar_voice"]).toBe("Minha voz · ElevenLabs");
  expect(fetcher).toHaveBeenCalledTimes(1);
  await providers.availability();
  expect(fetcher).toHaveBeenCalledTimes(1);
  const audio = await providers.synthesize("Teste", "elevenlabs-unfamiliar_voice", "detailed");
  expect(audio.length).toBe(3200);
  expect(String(fetcher.mock.calls[1][0])).toBe(
    "https://api.elevenlabs.io/v1/text-to-speech/unfamiliar_voice?output_format=pcm_16000",
  );
  expect(fetcher.mock.calls[1][1]?.headers).toMatchObject({ "xi-api-key": "fixture-eleven" });
  expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body)).model_id).toBe(
    "eleven_multilingual_v2",
  );
  settings.elevenlabsKey = "changed";
  await providers.availability();
  expect(fetcher).toHaveBeenCalledTimes(3);
  settings.elevenlabsKey = "";
  expect((await providers.availability()).voices).toEqual([]);
});

it("validates provider voices and missing credentials before sending requests", async () => {
  const settings = settingsSchema.parse({});
  const fetcher = vi.fn<typeof fetch>();
  const providers = new ProviderSpeech(async () => settings, fetcher);
  await expect(providers.synthesize("Teste", "openai-marin", "fast")).rejects.toThrow("chave");
  settings.openaiKey = "fixture";
  settings.elevenlabsKey = "fixture";
  await expect(providers.synthesize("Teste", "openai-unknown", "fast")).rejects.toThrow(
    "Voz inválida",
  );
  await expect(providers.synthesize("Teste", "elevenlabs-../../secret", "fast")).rejects.toThrow(
    "Voz inválida",
  );
  expect(fetcher).not.toHaveBeenCalled();
});

it("bounds audio and hides provider error bodies without silently falling back", async () => {
  const settings = settingsSchema.parse({ openaiKey: "fixture" });
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response("private provider error", { status: 401 }));
  const providers = new ProviderSpeech(async () => settings, fetcher);
  await expect(providers.synthesize("Teste", "openai-cedar", "fast")).rejects.toThrow("401");
  fetcher.mockImplementationOnce(async () => Response.json({ audio: "not PCM" }));
  await expect(providers.synthesize("Teste", "openai-cedar", "fast")).rejects.toThrow(
    "formato inválido",
  );
  fetcher.mockResolvedValue(new Response(new Uint8Array([1])));
  await expect(providers.synthesize("Teste", "openai-cedar", "fast")).rejects.toThrow(
    "áudio inválido",
  );
  fetcher.mockResolvedValue(
    new Response(new Uint8Array([0, 0]), { headers: { "content-length": "99999999" } }),
  );
  await expect(providers.synthesize("Teste", "openai-cedar", "fast")).rejects.toThrow(
    "muito grande",
  );
});

it("retains OpenAI availability when ElevenLabs discovery fails and prevents pagination loops", async () => {
  const settings = settingsSchema.parse({ openaiKey: "fixture", elevenlabsKey: "fixture" });
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async () =>
      Response.json({ voices: [], has_more: true, next_page_token: "repeat" }),
    );
  const providers = new ProviderSpeech(async () => settings, fetcher);
  const result = await providers.availability();
  expect(result.voices).toContain("openai-marin");
  expect(result.error).toContain("ElevenLabs");
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("resampling preserves duration and rejects malformed PCM", () => {
  expect(pcm24To16(Buffer.alloc(48000)).length).toBe(32000);
  expect(() => pcm24To16(Buffer.alloc(3))).toThrow("áudio inválido");
  expect(() => pcm24To16(Buffer.alloc(0))).toThrow("áudio inválido");
});
