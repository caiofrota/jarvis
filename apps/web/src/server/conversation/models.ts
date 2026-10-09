import { createHash } from "node:crypto";
import type { Settings } from "@rosie/types";
import { DomainError } from "@rosie/types/context";

export class ConversationModels {
  private cache = new Map<string, { expires: number; models: string[] }>();
  constructor(
    private readonly settings: () => Promise<Settings>,
    private readonly fetcher: typeof fetch = fetch,
  ) {}
  async list(provider: "openai" | "deepseek") {
    const settings = await this.settings();
    const key = provider === "openai" ? settings.openaiKey : settings.deepseekKey;
    if (!key)
      throw new DomainError("Configure a chave deste provedor em Voz e conexões → Conversa.");
    const hash = `${provider}:${createHash("sha256").update(key).digest("hex")}`;
    const cached = this.cache.get(hash);
    if (cached && cached.expires > Date.now()) return cached.models;
    const response = await this.fetcher(
      provider === "openai"
        ? "https://api.openai.com/v1/models"
        : "https://api.deepseek.com/models",
      {
        headers: { authorization: `Bearer ${key}` },
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new DomainError(`Não foi possível consultar os modelos (${response.status}).`);
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 2000000) throw new DomainError("Catálogo de modelos muito grande.");
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    const payload = JSON.parse(Buffer.concat(chunks).toString());
    if (!Array.isArray(payload.data)) throw new DomainError("Catálogo de modelos inválido.");
    const models: string[] = [
      ...new Set<string>(
        payload.data
          .slice(0, 2000)
          .map((item: { id?: unknown }) => item?.id)
          .filter(
            (id: unknown): id is string =>
              typeof id === "string" &&
              id.length <= 200 &&
              (provider !== "openai" ||
                (/^(gpt-|o[1-9]|chat-latest)/.test(id) &&
                  !/audio|transcribe|realtime|image|tts|codex|embedding|search|moderation/i.test(
                    id,
                  ))),
          ),
      ),
    ].sort();
    this.cache.clear();
    this.cache.set(hash, { expires: Date.now() + 300000, models });
    return models;
  }
}
