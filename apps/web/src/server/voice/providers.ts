import { createHash } from "node:crypto";
import type { Settings } from "@rosie/types";
import { DomainError } from "@rosie/types/context";
import { MAX_AUDIO_BYTES } from "./wav";

const openaiVoices = [
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "fable",
  "nova",
  "onyx",
  "sage",
  "shimmer",
  "verse",
  "marin",
  "cedar",
];
const voiceId = /^[A-Za-z0-9_-]{1,89}$/;
export type ProviderVoices = { voices: string[]; names: Record<string, string>; error?: string };

async function read(response: Response, limit: number) {
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new DomainError(
      `O serviço de voz falhou (${response.status}). Verifique a chave, a permissão e o saldo do provedor.`,
    );
  }
  const reader = response.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    if (Number(response.headers.get("content-length")) > limit)
      throw new DomainError("Resposta de voz muito grande.");
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new DomainError("Resposta de voz muito grande.");
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Low-pass, windowed-sinc conversion from mono PCM16 24 kHz to the endpoint's 16 kHz. */
export function pcm24To16(input: Buffer) {
  if (!input.length || input.length % 2 || input.length > MAX_AUDIO_BYTES * 1.5)
    throw new DomainError("O provedor retornou áudio inválido.");
  const samples = input.length / 2;
  const output = Buffer.alloc(Math.floor((samples * 2) / 3) * 2);
  const radius = 16;
  const phases = [0, 0.5].map((phase) => {
    const weights = Array.from({ length: radius * 2 + 1 }, (_, i) => {
      const distance = i - radius - phase;
      const x = (distance * 2) / 3;
      return (
        (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)) *
        (0.5 + 0.5 * Math.cos((Math.PI * distance) / (radius + 1)))
      );
    });
    const sum = weights.reduce((a, b) => a + b, 0);
    return weights.map((weight) => weight / sum);
  });
  for (let i = 0; i < output.length / 2; i++) {
    const position = i * 1.5;
    const start = Math.floor(position) - radius;
    const weights = phases[i % 2];
    let value = 0;
    for (let tap = 0; tap < weights.length; tap++) {
      const index = Math.max(0, Math.min(samples - 1, start + tap));
      value += input.readInt16LE(index * 2) * weights[tap];
    }
    output.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(value))), i * 2);
  }
  return output;
}

export class ProviderSpeech {
  private cached?: { key: string; expires: number; result: ProviderVoices };
  private pending?: { key: string; result: Promise<ProviderVoices> };
  constructor(
    private readonly settings: () => Promise<Settings>,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async availability(): Promise<ProviderVoices> {
    const settings = await this.settings();
    const voices = settings.openaiKey ? openaiVoices.map((voice) => `openai-${voice}`) : [];
    const names: Record<string, string> = Object.fromEntries(
      voices.map((id) => [id, `${id.slice(7)} · OpenAI`]),
    );
    if (!settings.elevenlabsKey) return { voices, names };
    const key = createHash("sha256").update(settings.elevenlabsKey).digest("hex");
    let eleven: ProviderVoices;
    if (this.cached?.key === key && this.cached.expires > Date.now()) eleven = this.cached.result;
    else {
      if (this.pending?.key !== key) {
        const result = this.discover(settings.elevenlabsKey).catch(() => ({
          voices: [],
          names: {},
          error:
            "Não foi possível consultar as vozes da ElevenLabs. Verifique a chave e a conexão.",
        }));
        this.pending = { key, result };
      }
      const pending = this.pending;
      eleven = await pending.result;
      if (this.pending === pending) {
        this.cached = {
          key,
          expires: Date.now() + (eleven.error ? 15000 : 300000),
          result: eleven,
        };
        this.pending = undefined;
      }
    }
    return {
      voices: [...voices, ...eleven.voices],
      names: { ...names, ...eleven.names },
      error: eleven.error,
    };
  }
  private async discover(key: string): Promise<ProviderVoices> {
    const result: ProviderVoices = { voices: [], names: {} };
    const seen = new Set<string>();
    let next = "";
    const signal = AbortSignal.timeout(10000);
    for (let page = 0; page < 10; page++) {
      const url = new URL("https://api.elevenlabs.io/v2/voices");
      url.searchParams.set("page_size", "100");
      if (next) url.searchParams.set("next_page_token", next);
      const response = await this.fetcher(url, {
        headers: { "xi-api-key": key },
        redirect: "error",
        signal,
      });
      const payload = JSON.parse((await read(response, 2000000)).toString());
      if (!Array.isArray(payload.voices)) throw new Error("Invalid voice catalog");
      for (const voice of payload.voices.slice(0, 100)) {
        if (typeof voice.voice_id !== "string" || !voiceId.test(voice.voice_id)) continue;
        const id = `elevenlabs-${voice.voice_id}`;
        if (!result.voices.includes(id)) result.voices.push(id);
        result.names[id] =
          `${typeof voice.name === "string" ? voice.name.slice(0, 150) : voice.voice_id} · ElevenLabs`;
      }
      if (!payload.has_more) return result;
      if (
        typeof payload.next_page_token !== "string" ||
        !payload.next_page_token ||
        payload.next_page_token.length > 2000 ||
        seen.has(payload.next_page_token)
      )
        throw new Error("Invalid voice pagination");
      next = payload.next_page_token;
      seen.add(next);
    }
    throw new Error("Voice catalog exceeds its limit");
  }
  async synthesize(text: string, voice: string, quality: string, signal?: AbortSignal) {
    const settings = await this.settings();
    const openai = voice.startsWith("openai-");
    const key = openai ? settings.openaiKey : settings.elevenlabsKey;
    if (!key) throw new DomainError("Configure a chave do provedor desta voz em Voz e conexões.");
    if (!text.trim() || text.length > 4000)
      throw new DomainError("Texto fora do limite de síntese de voz.");
    const id = voice.slice((openai ? "openai-" : "elevenlabs-").length);
    if (openai ? !openaiVoices.includes(id) : !voiceId.test(id) || !voice.startsWith("elevenlabs-"))
      throw new DomainError("Voz inválida.");
    const response = await this.fetcher(
      openai
        ? "https://api.openai.com/v1/audio/speech"
        : `https://api.elevenlabs.io/v1/text-to-speech/${id}?output_format=pcm_16000`,
      {
        method: "POST",
        redirect: "error",
        headers: {
          "content-type": "application/json",
          ...(openai ? { authorization: `Bearer ${key}` } : { "xi-api-key": key }),
        },
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(90000)])
          : AbortSignal.timeout(90000),
        body: JSON.stringify(
          openai
            ? {
                model: "gpt-4o-mini-tts",
                voice: id,
                input: text,
                instructions: "Fale naturalmente em português brasileiro.",
                response_format: "pcm",
              }
            : {
                text,
                model_id: quality === "detailed" ? "eleven_multilingual_v2" : "eleven_flash_v2_5",
                language_code: "pt",
              },
        ),
      },
    );
    const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (
      response.ok &&
      contentType &&
      !["audio/pcm", "audio/x-pcm", "application/octet-stream"].includes(contentType)
    ) {
      await response.body?.cancel();
      throw new DomainError("O provedor retornou áudio em formato inválido.");
    }
    const audio = await read(response, MAX_AUDIO_BYTES * (openai ? 1.5 : 1));
    if (!audio.length || audio.length % 2)
      throw new DomainError("O provedor retornou áudio inválido.");
    return openai ? pcm24To16(audio) : audio;
  }
}
