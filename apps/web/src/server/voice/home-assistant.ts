import type { Repository } from "@rosie/db";
import { DomainError } from "@rosie/types/context";
import type { HomeAssistantAddon } from "../addons/home-assistant";
import { MAX_AUDIO_BYTES, pcmFromWav } from "./wav";

export const CLOUD_PREFIX = "ha-cloud-";
type Availability = { cloudHomeId: string; voices: string[]; cloudError?: string };

async function boundedBody(response: Response, limit: number) {
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new DomainError(`A voz do Home Assistant Cloud falhou (${response.status}).`);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    if (Number(response.headers.get("content-length")) > limit) throw new Error("size");
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error("size");
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export class HomeAssistantVoice {
  private cached?: { key: string; expires: number; result: Availability };
  private pending?: { key: string; value: Promise<Availability> };
  private active = 0;
  constructor(
    private readonly repo: Pick<Repository, "settings">,
    private readonly addon: Pick<HomeAssistantAddon, "cloudVoices" | "status">,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async availability(): Promise<Availability> {
    const s = await this.repo.settings();
    if (!s.homeAssistantEnabled || !s.homeAssistantHomeId || !this.addon.status().ready)
      return {
        cloudHomeId: "",
        voices: [],
        cloudError: "Conecte o Home Assistant para consultar as vozes da nuvem.",
      };
    const key = JSON.stringify([s.homeAssistantHomeId, s.homeAssistantUrl, s.homeAssistantToken]);
    if (this.cached?.key === key && this.cached.expires > Date.now()) return this.cached.result;
    if (this.pending?.key === key) return this.pending.value;
    const value = this.addon
      .cloudVoices(s.homeAssistantHomeId)
      .then((voices) => ({
        cloudHomeId: s.homeAssistantHomeId,
        voices: voices.map((v) => CLOUD_PREFIX + v),
        ...(!voices.length
          ? { cloudError: "Home Assistant Cloud sem vozes disponíveis em português do Brasil." }
          : {}),
      }))
      .catch(() => ({
        cloudHomeId: s.homeAssistantHomeId,
        voices: [],
        cloudError: "Não foi possível consultar as vozes do Home Assistant Cloud.",
      }));
    const pending = { key, value };
    this.pending = pending;
    try {
      const result = await value;
      this.cached = { key, result, expires: Date.now() + (result.voices.length ? 60000 : 5000) };
      return result;
    } finally {
      if (this.pending === pending) this.pending = undefined;
    }
  }

  async synthesize(text: string, voice: string, homeId: string | undefined, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (!homeId || !text.trim() || text.length > 2500)
      throw new DomainError("Confira a casa e o tamanho do texto para gerar a voz.");
    if (this.active >= 4)
      throw new DomainError("As vozes da nuvem estão ocupadas. Tente novamente em instantes.");
    this.active++;
    const abort = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(45000)])
      : AbortSignal.timeout(45000);
    try {
      const s = await this.repo.settings();
      if (!s.homeAssistantEnabled || !s.homeAssistantToken || s.homeAssistantHomeId !== homeId)
        throw new DomainError(
          "Conecte o Home Assistant da casa deste robô para usar a voz da nuvem.",
        );
      const available = await this.availability();
      if (available.cloudHomeId !== homeId || !available.voices.includes(voice))
        throw new DomainError(
          available.cloudError || "Essa voz do Home Assistant Cloud está indisponível.",
        );
      abort.throwIfAborted();
      const options = { redirect: "error" as const, signal: abort };
      const response = await this.fetcher(new URL("/api/tts_get_url", s.homeAssistantUrl), {
        ...options,
        method: "POST",
        headers: {
          authorization: `Bearer ${s.homeAssistantToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          engine_id: "tts.home_assistant_cloud",
          message: text,
          language: "pt-BR",
          cache: false,
          options: {
            voice: voice.slice(CLOUD_PREFIX.length),
            preferred_format: "wav",
            preferred_sample_rate: 16000,
            preferred_sample_channels: 1,
            preferred_sample_bytes: 2,
          },
        }),
      });
      const payload = JSON.parse((await boundedBody(response, 16384)).toString());
      // Ignore the advertised URL. It may point at a public reverse proxy. Never forward credentials there.
      if (
        typeof payload.path !== "string" ||
        !/^\/api\/tts_proxy\/[A-Za-z0-9_-][A-Za-z0-9_.-]{0,299}$/.test(payload.path)
      )
        throw new DomainError("O Home Assistant retornou um endereço de áudio inválido.");
      const audio = await this.fetcher(new URL(payload.path, s.homeAssistantUrl), options);
      const pcm = pcmFromWav(await boundedBody(audio, MAX_AUDIO_BYTES + 65536));
      abort.throwIfAborted();
      const current = await this.repo.settings();
      if (
        !current.homeAssistantEnabled ||
        current.homeAssistantHomeId !== homeId ||
        current.homeAssistantUrl !== s.homeAssistantUrl ||
        current.homeAssistantToken !== s.homeAssistantToken
      )
        throw new DomainError("A conexão de voz foi alterada. Descartei a resposta anterior.");
      return pcm;
    } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof DomainError) throw error;
      throw new DomainError(
        "Não foi possível gerar a voz no Home Assistant Cloud. Confira a conexão e a assinatura.",
      );
    } finally {
      this.active--;
    }
  }
}
