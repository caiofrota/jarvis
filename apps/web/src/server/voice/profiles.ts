import { randomUUID } from "node:crypto";
import { json, type Repository } from "@rosie/db";
import { DomainError } from "@rosie/types/context";
import { z } from "zod";
import type { VoiceClient } from "./client";

export const embeddingSchema = z.object({
  model: z.string().min(1).max(100),
  quality: z.enum(["ready", "too_short", "no_speech", "quiet", "clipped"]),
  speechSeconds: z.number().finite().min(0).max(20),
  embedding: z.array(z.number().finite().min(-1).max(1)).length(256).nullable(),
});
const profileSchema = z.object({
  residentId: z.string(),
  homeId: z.string(),
  model: z.string(),
  samples: z.array(z.array(z.number().finite()).length(256)).length(3),
  enrolledAt: z.string(),
  enrollmentId: z.string(),
});
export const enrollmentPrompts = [
  "Olá, Rosie. Esta é a minha voz. Gosto de conversar com você quando chego em casa.",
  "Hoje vou organizar minhas coisas e depois descansar um pouco. Você pode me fazer companhia.",
  "Quero que você reconheça minha voz nas próximas conversas, mesmo quando eu fizer outra pergunta.",
];
export type Enrollment = {
  id: string;
  residentId: string;
  homeId: string;
  endpointId: string;
  revision: number;
  phase: "listening" | "processing" | "complete" | "cancelled" | "error";
  samples: number[][];
  model?: string;
  attempts: number;
  deadline: number;
  message: string;
};
const prefix = "voiceprint:";
export function registeredVoice(data: unknown, residentId: string, homeId: string) {
  const profile = profileSchema.safeParse(data);
  return profile.success && profile.data.residentId === residentId && profile.data.homeId === homeId
    ? { enrolledAt: profile.data.enrolledAt }
    : null;
}
export function cosine(a: number[], b: number[]) {
  const norm = (v: number[]) => Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
  const length = norm(a) * norm(b);
  return a.length === b.length && length > 1e-8
    ? a.reduce((sum, x, i) => sum + x * b[i], 0) / length
    : -1;
}
function referenceEmbedding(samples: number[][]) {
  const unit = samples.map((sample) => {
    const length = Math.sqrt(sample.reduce((sum, value) => sum + value * value, 0));
    return sample.map((value) => (length > 1e-8 ? value / length : 0));
  });
  return unit[0].map((_, i) => unit.reduce((sum, sample) => sum + sample[i], 0) / unit.length);
}
export class VoiceProfiles {
  private jobs = new Map<string, Enrollment>();
  constructor(
    private repo: Repository,
    private voice: VoiceClient,
  ) {}
  private async resident(id: string, enabled = true) {
    const row = await this.repo.db.entry.findUnique({
      where: { collection_id: { collection: "residents", id } },
    });
    const value = (await this.repo.catalog()).residents.find(
      (v) => v.id === id && (!enabled || v.enabled),
    );
    if (!row || !value) throw new DomainError("Salve e ative o morador antes de cadastrar a voz.");
    return { row, value };
  }
  private view(job?: Enrollment) {
    return job
      ? {
          id: job.id,
          endpointId: job.endpointId,
          phase: job.phase,
          completed: job.phase === "complete" ? 3 : job.samples.length,
          total: 3,
          prompt: enrollmentPrompts[job.samples.length] ?? "",
          message: job.message,
          expiresAt: new Date(job.deadline).toISOString(),
        }
      : null;
  }
  async status(residentId: string) {
    const { value } = await this.resident(residentId, false);
    const row = await this.repo.db.setting.findUnique({ where: { id: prefix + residentId } });
    const profile = registeredVoice(row?.data, residentId, value.homeId);
    const job = this.jobs.get(residentId);
    if (job && ["listening", "processing"].includes(job.phase) && Date.now() > job.deadline)
      this.fail(job, "O tempo do cadastro terminou. Inicie novamente.");
    return {
      registered: Boolean(profile),
      enrolledAt: profile?.enrolledAt ?? null,
      enrollment: this.view(job),
    };
  }
  async begin(residentId: string, endpointId: string) {
    const { row, value } = await this.resident(residentId),
      c = await this.repo.catalog();
    const endpoint = c.endpoints.find((v) => v.id === endpointId && v.enabled && !v.muted);
    if (!endpoint || endpoint.homeId !== value.homeId)
      throw new DomainError("Escolha uma caixinha ativa e sem silenciar, da mesma casa.");
    if (!(await this.voice.health()).speakerIdentification)
      throw new DomainError("O identificador local de voz ainda não está disponível.");
    for (const job of this.jobs.values()) {
      if (Date.now() > job.deadline) this.fail(job, "O tempo do cadastro terminou.");
      if (
        ["listening", "processing"].includes(job.phase) &&
        (job.endpointId === endpointId || job.residentId === residentId)
      )
        throw new DomainError("Já há um cadastro de voz em andamento. Cancele-o primeiro.");
    }
    const job: Enrollment = {
      id: randomUUID(),
      residentId,
      homeId: value.homeId,
      endpointId,
      revision: row.revision,
      phase: "listening",
      samples: [],
      attempts: 0,
      deadline: Date.now() + 180000,
      message: "Leia a frase abaixo perto da caixinha, com sua voz normal.",
    };
    this.jobs.set(residentId, job);
    // Expired status entries do not retain embeddings indefinitely.
    for (const [id, old] of this.jobs) if (Date.now() > old.deadline + 300000) this.jobs.delete(id);
    return job;
  }
  fail(job: Enrollment, message: string) {
    if (!["listening", "processing"].includes(job.phase)) return;
    job.phase = "error";
    job.message = message;
    job.samples = [];
  }
  cancel(job: Enrollment) {
    if (!["listening", "processing"].includes(job.phase)) return;
    job.phase = "cancelled";
    job.message = "Cadastro cancelado. A voz anterior foi preservada.";
    job.samples = [];
  }
  current(residentId: string) {
    return this.jobs.get(residentId);
  }
  async accept(job: Enrollment, pcm: Buffer, signal: AbortSignal) {
    if (this.jobs.get(job.residentId) !== job || job.phase !== "listening") return false;
    if (Date.now() > job.deadline) {
      this.fail(job, "O tempo do cadastro terminou.");
      return false;
    }
    job.phase = "processing";
    job.attempts++;
    const result = embeddingSchema.parse(await this.voice.speakerEmbedding(pcm, signal));
    signal.throwIfAborted();
    if (this.jobs.get(job.residentId) !== job || job.phase !== "processing") return false;
    if (Date.now() > job.deadline) {
      this.fail(job, "O tempo do cadastro terminou.");
      return false;
    }
    const { row, value } = await this.resident(job.residentId);
    const endpoint = (await this.repo.catalog()).endpoints.find(
      (v) => v.id === job.endpointId && v.enabled && !v.muted,
    );
    signal.throwIfAborted();
    if (this.jobs.get(job.residentId) !== job || job.phase !== "processing") return false;
    if (!endpoint || endpoint.homeId !== job.homeId)
      throw new DomainError("A caixinha mudou durante o cadastro. Inicie novamente.");
    if (value.homeId !== job.homeId || row.revision !== job.revision)
      throw new DomainError("O cadastro do morador mudou. Inicie a coleta novamente.");
    const vector = result.embedding;
    if (result.quality !== "ready" || !vector || result.speechSeconds < 2.5) {
      job.message =
        result.quality === "clipped"
          ? "O áudio saturou. Afaste-se um pouco e repita a frase."
          : "Não consegui uma amostra clara e longa o bastante. Leia a frase inteira novamente.";
    } else if (job.model && job.model !== result.model) {
      throw new DomainError("O modelo de identificação mudou durante o cadastro.");
    } else if (job.samples.some((v) => cosine(v, vector) < 0.6)) {
      job.message =
        "As amostras ficaram diferentes. Apenas o morador escolhido deve falar; repita em um lugar silencioso.";
    } else {
      job.model = result.model;
      job.samples.push(vector);
      job.message = "Amostra recebida. Aguarde um instante e leia a próxima frase.";
    }
    if (job.samples.length === 3) {
      signal.throwIfAborted();
      const record = profileSchema.parse({
        residentId: job.residentId,
        homeId: job.homeId,
        model: job.model,
        samples: job.samples,
        enrolledAt: new Date().toISOString(),
        enrollmentId: job.id,
      });
      await this.repo.db.$transaction(async (tx) => {
        const current = await tx.entry.findUnique({
          where: { collection_id: { collection: "residents", id: job.residentId } },
        });
        signal.throwIfAborted();
        if (current?.revision !== job.revision || job.phase !== "processing")
          throw new DomainError("Cadastro interrompido ou alterado.");
        await tx.setting.upsert({
          where: { id: prefix + job.residentId },
          create: { id: prefix + job.residentId, data: json(record) },
          update: { data: json(record) },
        });
        signal.throwIfAborted();
        if (job.phase !== "processing") throw new DomainError("Cadastro interrompido.");
      });
      job.phase = "complete";
      job.message = "Voz cadastrada. Você já pode testar uma nova conversa.";
      job.samples = [];
      await this.repo.event("voice_enrolled", {
        resident: job.residentId,
        endpoint: job.endpointId,
      });
      return true;
    }
    if (job.attempts >= 8) {
      this.fail(
        job,
        "Não consegui três amostras consistentes. Tente novamente em um ambiente mais silencioso.",
      );
      return false;
    }
    job.phase = "listening";
    return false;
  }
  async remove(residentId: string) {
    await this.resident(residentId, false);
    const job = this.jobs.get(residentId);
    if (job) this.cancel(job);
    await this.repo.db.setting.deleteMany({ where: { id: prefix + residentId } });
    this.jobs.delete(residentId);
    await this.repo.event("voice_deleted", { resident: residentId });
  }
  async identify(
    homeId: string,
    pcm: Buffer,
    signal: AbortSignal,
  ): Promise<{
    residentId?: string | null;
    reason: string;
    speechSeconds?: number;
    similarity?: number;
    margin?: number;
  }> {
    const c = await this.repo.catalog(),
      residents = c.residents.filter((v) => v.homeId === homeId && v.enabled);
    if (!residents.length) return { reason: "not_configured" };
    const rows = await this.repo.db.setting.findMany({
      where: { id: { in: residents.map((v) => prefix + v.id) } },
    });
    const profiles = rows.flatMap((row) => {
      const p = profileSchema.safeParse(row.data);
      return p.success && p.data.homeId === homeId && row.id === prefix + p.data.residentId
        ? [p.data]
        : [];
    });
    if (!profiles.length) return { reason: "not_configured" };
    const result = embeddingSchema.parse(await this.voice.speakerEmbedding(pcm, signal));
    signal.throwIfAborted();
    if (result.quality !== "ready" || !result.embedding)
      return { reason: result.quality, speechSeconds: result.speechSeconds };
    const vector = result.embedding;
    const scores = profiles
      .filter((p) => p.model === result.model)
      .map((p) => ({
        id: p.residentId,
        // Compare with the combined voice reference. Averaging separate scores
        // penalizes enrollment variability even when the speaker is unchanged.
        score: cosine(referenceEmbedding(p.samples), vector),
      }))
      .sort((a, b) => b.score - a.score);
    // Conservative starting thresholds, not a probability or authentication factor.
    const best = scores[0],
      margin = best ? best.score - (scores[1]?.score ?? -1) : 0;
    const measured = {
      speechSeconds: result.speechSeconds,
      similarity: best ? Number(best.score.toFixed(3)) : undefined,
      margin: Number(margin.toFixed(3)),
    };
    if (!best || best.score < 0.7 || margin < 0.08)
      return { residentId: null, reason: "unknown", ...measured };
    // Enrollment deletion or resident edits can happen during native inference.
    const current = await this.repo.db.setting.findUnique({ where: { id: prefix + best.id } });
    const currentProfile = profileSchema.safeParse(current?.data);
    const resident = (await this.repo.catalog()).residents.find(
      (v) => v.id === best.id && v.enabled && v.homeId === homeId,
    );
    signal.throwIfAborted();
    if (
      !resident ||
      !currentProfile.success ||
      currentProfile.data.enrollmentId !==
        profiles.find((p) => p.residentId === best.id)?.enrollmentId
    )
      return { residentId: null, reason: "profile_changed", ...measured };
    return { residentId: best.id, reason: "matched", ...measured };
  }
}
