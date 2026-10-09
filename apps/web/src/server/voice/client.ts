import WebSocket from "ws";
import { CLOUD_PREFIX, type HomeAssistantVoice } from "./home-assistant";
import type { ProviderSpeech } from "./providers";
import { spokenText } from "./text";

export class VoiceClient {
  constructor(
    readonly url: string,
    readonly token: string,
    private readonly cloud?: HomeAssistantVoice,
    private readonly providers?: ProviderSpeech,
  ) {}
  private async request(path: string, init: RequestInit = {}) {
    const response = await fetch(new URL(path, this.url), {
      ...init,
      headers: { ...init.headers, authorization: `Bearer ${this.token}` },
      signal: init.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(180000)])
        : AbortSignal.timeout(180000),
    });
    if (!response.ok) throw new Error(`Speech service failed (${response.status})`);
    return response;
  }
  async health(): Promise<{
    ready: boolean;
    busy: boolean;
    voices: string[];
    speakerIdentification?: boolean;
    cloudHomeId?: string;
    cloudError?: string;
    voiceNames?: Record<string, string>;
    providerError?: string;
  }> {
    const [local, cloud, providers] = await Promise.all([
      this.request("/health", { signal: AbortSignal.timeout(5000) })
        .then(
          (r) =>
            r.json() as Promise<{
              ready: boolean;
              voices: string[];
              busy: boolean;
              speakerIdentification?: boolean;
            }>,
        )
        .catch(() => ({
          ready: false,
          voices: [] as string[],
          busy: false,
          speakerIdentification: false,
        })),
      this.cloud?.availability(),
      this.providers?.availability(),
    ]);
    return {
      ...local,
      voices: [...local.voices, ...(cloud?.voices ?? []), ...(providers?.voices ?? [])],
      voiceNames: providers?.names ?? {},
      providerError: providers?.error,
      cloudHomeId: cloud?.cloudHomeId,
      cloudError: cloud?.cloudError,
    };
  }
  async synthesize(
    text: string,
    voice: string,
    quality: string,
    signal?: AbortSignal,
    homeId?: string,
  ) {
    if (voice.startsWith("openai-") || voice.startsWith("elevenlabs-")) {
      if (!this.providers) throw new Error("Provedor de voz não configurado.");
      return this.providers.synthesize(spokenText(text), voice, quality, signal);
    }
    if (voice.startsWith(CLOUD_PREFIX)) {
      if (!this.cloud) throw new Error("Home Assistant Cloud não configurado.");
      return this.cloud.synthesize(spokenText(text), voice, homeId, signal);
    }
    return Buffer.from(
      await (
        await this.request("/synthesize", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: spokenText(text), voice, quality }),
          signal,
        })
      ).arrayBuffer(),
    );
  }
  async transcribe(pcm: Buffer, model: string, signal: AbortSignal, context = "") {
    return (
      await this.request(
        `/transcribe?model=${encodeURIComponent(model)}&context=${encodeURIComponent(context.slice(0, 1000))}`,
        {
          method: "POST",
          body: new Uint8Array(pcm),
          signal,
        },
      )
    ).json() as Promise<{ speech: boolean; text: string }>;
  }
  async speakerEmbedding(pcm: Buffer, signal: AbortSignal) {
    return (
      await this.request("/speaker-embedding", {
        method: "POST",
        body: new Uint8Array(pcm),
        signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
      })
    ).json() as Promise<unknown>;
  }
  segment(
    onCandidate: (pcm: Buffer) => void,
    onError: () => void,
    onActivity: (active: boolean) => void = () => {},
  ) {
    const url = new URL("/segment", this.url);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(url, {
      headers: { authorization: `Bearer ${this.token}` },
      maxPayload: 640000,
    });
    ws.on("message", (data, binary) => {
      if (binary) onCandidate(Buffer.from(data as Buffer));
      else {
        try {
          const message = JSON.parse(data.toString());
          if (message.type === "activity") onActivity(message.active === true);
        } catch {
          onError();
        }
      }
    });
    ws.on("error", onError);
    return ws;
  }
}
