import { schemas } from "@rosie/types";
import { context } from "@rosie/types/context";
import { describe, expect, it, vi } from "vitest";
import { CatalogService, queryFrom } from "../src/server/catalog/service";
import type { VoiceClient } from "../src/server/voice/client";
import { VoiceProfiles } from "../src/server/voice/profiles";
import { repositoryFixture } from "./fixture";

export const vector = (index: number) =>
  Array.from({ length: 256 }, (_, i) => (i === index ? 1 : 0));
const result = (embedding: number[] = vector(0)) => ({
  model: "fixture-model",
  quality: "ready",
  speechSeconds: 4,
  embedding,
});
async function setup() {
  const f = await repositoryFixture();
  const catalog = new CatalogService(f.repo);
  for (const name of ["Caio", "Lu"]) await catalog.save("residents", { name, homeId: "home" });
  const embedding = vi.fn(async (_pcm: Buffer, _signal: AbortSignal): Promise<unknown> => result());
  const voice = {
    health: async () => ({ speakerIdentification: true }),
    speakerEmbedding: embedding,
  } as unknown as VoiceClient;
  const profiles = new VoiceProfiles(f.repo, voice);
  const signal = new AbortController().signal;
  const enroll = async (id: string) => {
    const job = await profiles.begin(id, "one");
    for (let i = 0; i < 3; i++) await profiles.accept(job, Buffer.alloc(128000), signal);
    return job;
  };
  return { ...f, catalog, profiles, embedding, enroll, signal };
}
describe("local resident voice profiles", () => {
  it("compares short speech with the combined enrollment reference while rejecting a nearby unknown voice", async () => {
    const f = await setup();
    try {
      const samples = [1, 2, 3].map((index) => {
        const v = vector(0).map((value) => value * 0.95);
        v[index] = Math.sqrt(1 - 0.95 ** 2);
        return v;
      });
      const job = await f.profiles.begin("caio", "one");
      for (const sample of samples) {
        f.embedding.mockResolvedValue(result(sample));
        await f.profiles.accept(job, Buffer.alloc(128000), f.signal);
      }
      expect(job.phase).toBe("complete");
      const center = samples[0].map((_, i) => samples.reduce((sum, s) => sum + s[i], 0) / 3);
      const length = Math.sqrt(center.reduce((sum, x) => sum + x * x, 0));
      const utterance = (similarity: number) => {
        const v = center.map((x) => (x / length) * similarity);
        v[4] = Math.sqrt(1 - similarity ** 2);
        return { ...result(v), speechSeconds: 0.8 };
      };
      f.embedding.mockResolvedValue(utterance(0.72));
      expect(await f.profiles.identify("home", Buffer.alloc(25600), f.signal)).toMatchObject({
        residentId: "caio",
        reason: "matched",
        similarity: 0.72,
      });
      f.embedding.mockResolvedValue(utterance(0.69));
      expect(await f.profiles.identify("home", Buffer.alloc(25600), f.signal)).toMatchObject({
        residentId: null,
        reason: "unknown",
        similarity: 0.69,
      });
    } finally {
      await f.close();
    }
  });
  it("identifies a confident short phrase without relaxing enrollment or accepting an unknown short voice", async () => {
    const f = await setup();
    try {
      await f.enroll("caio");
      f.embedding.mockResolvedValue({ ...result(), speechSeconds: 0.7 });
      expect(await f.profiles.identify("home", Buffer.alloc(22400), f.signal)).toMatchObject({
        residentId: "caio",
        reason: "matched",
        speechSeconds: 0.7,
      });
      f.embedding.mockResolvedValue({ ...result(vector(1)), speechSeconds: 0.7 });
      expect(await f.profiles.identify("home", Buffer.alloc(22400), f.signal)).toMatchObject({
        residentId: null,
        reason: "unknown",
      });
      const job = await f.profiles.begin("lu", "one");
      await f.profiles.accept(job, Buffer.alloc(22400), f.signal);
      expect(job.samples).toHaveLength(0);
      expect(job.phase).toBe("listening");
    } finally {
      await f.close();
    }
  });
  it("requires three consistent samples, keeps embeddings private, and rejects unknown or ambiguous voices", async () => {
    const f = await setup();
    try {
      const job = await f.enroll("caio");
      expect(job.phase).toBe("complete");
      expect(job.samples).toEqual([]);
      const status = await f.profiles.status("caio");
      expect(status).toMatchObject({ registered: true, enrollment: { completed: 3 } });
      expect(JSON.stringify(status)).not.toMatch(/embedding|samples|fixture-model/);
      const page = await f.catalog.list("residents", queryFrom(new URLSearchParams()));
      expect(page.items.find((v) => v.id === "caio")?.voiceStatus).toBe("Cadastrada");
      expect(JSON.stringify(page)).not.toContain("fixture-model");
      expect(await f.profiles.identify("home", Buffer.alloc(128000), f.signal)).toMatchObject({
        residentId: "caio",
      });
      f.embedding.mockResolvedValue(result(vector(1)));
      expect(await f.profiles.identify("home", Buffer.alloc(128000), f.signal)).toMatchObject({
        residentId: null,
      });
      f.embedding.mockResolvedValue(result());
      await f.enroll("lu");
      expect(await f.profiles.identify("home", Buffer.alloc(128000), f.signal)).toMatchObject({
        residentId: null,
      });
      await f.profiles.remove("lu");
      expect((await f.profiles.status("lu")).registered).toBe(false);
    } finally {
      await f.close();
    }
  });
  it("does not guess from short, clipped or different-speaker enrollment samples and bounds attempts", async () => {
    const f = await setup();
    try {
      const job = await f.profiles.begin("caio", "one");
      f.embedding.mockResolvedValueOnce({
        ...result(),
        quality: "too_short",
        embedding: null,
        speechSeconds: 1,
      });
      await f.profiles.accept(job, Buffer.alloc(32000), f.signal);
      expect(job.samples).toHaveLength(0);
      await f.profiles.accept(job, Buffer.alloc(128000), f.signal);
      f.embedding.mockResolvedValue(result(vector(1)));
      for (let i = 0; i < 6; i++) await f.profiles.accept(job, Buffer.alloc(128000), f.signal);
      expect(job.phase).toBe("error");
      expect((await f.profiles.status("caio")).registered).toBe(false);
    } finally {
      await f.close();
    }
  });
  it("ignores cancelled late results and preserves a previous enrollment", async () => {
    const f = await setup();
    try {
      await f.enroll("caio");
      const job = await f.profiles.begin("caio", "one");
      let release!: (value: unknown) => void;
      f.embedding.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      );
      const pending = f.profiles.accept(job, Buffer.alloc(128000), f.signal);
      f.profiles.cancel(job);
      release(result(vector(1)));
      await pending;
      expect(job.phase).toBe("cancelled");
      expect((await f.profiles.identify("home", Buffer.alloc(128000), f.signal)).residentId).toBe(
        "caio",
      );
    } finally {
      await f.close();
    }
  });
  it("isolates homes, prevents concurrent capture, and deletes the reference with its resident", async () => {
    const f = await setup();
    try {
      await f.catalog.save("homes", { name: "Outra" });
      await f.catalog.save("residents", { name: "Visitante", homeId: "outra" });
      await expect(f.profiles.begin("visitante", "one")).rejects.toThrow("mesma casa");
      const outcomes = await Promise.allSettled([
        f.profiles.begin("caio", "one"),
        f.profiles.begin("lu", "one"),
      ]);
      expect(outcomes.filter((v) => v.status === "fulfilled")).toHaveLength(1);
      const first = outcomes.find((v) => v.status === "fulfilled");
      if (first?.status !== "fulfilled") throw new Error("Missing enrollment");
      f.profiles.cancel(first.value);
      await f.enroll("caio");
      f.embedding.mockClear();
      expect(await f.profiles.identify("outra", Buffer.alloc(128000), f.signal)).toEqual({
        reason: "not_configured",
      });
      expect(f.embedding).not.toHaveBeenCalled();
      const row = await f.repo.db.entry.findUniqueOrThrow({
        where: { collection_id: { collection: "residents", id: "caio" } },
      });
      await f.catalog.remove("residents", "caio", row.revision);
      expect(await f.repo.db.setting.findUnique({ where: { id: "voiceprint:caio" } })).toBeNull();
    } finally {
      await f.close();
    }
  });
  it("refuses enrollment after an edit and does not persist expired collection", async () => {
    const f = await setup();
    try {
      const job = await f.profiles.begin("caio", "one");
      await f.repo.db.entry.update({
        where: { collection_id: { collection: "residents", id: "caio" } },
        data: { revision: { increment: 1 } },
      });
      await expect(f.profiles.accept(job, Buffer.alloc(128000), f.signal)).rejects.toThrow("mudou");
      f.profiles.fail(job, "Alterado");
      const next = await f.profiles.begin("caio", "one");
      next.deadline = Date.now() - 1;
      await f.profiles.accept(next, Buffer.alloc(128000), f.signal);
      expect(next.phase).toBe("error");
      expect((await f.profiles.status("caio")).registered).toBe(false);
    } finally {
      await f.close();
    }
  });
  it("keeps a trusted turn override out of the endpoint and rejects foreign residents", async () => {
    const f = await setup();
    try {
      const c = await f.repo.catalog();
      c.residents.push(
        schemas.residents.parse({ id: "other", name: "Outra pessoa", homeId: "other-home" }),
      );
      c.endpoints[0].residentId = "lu";
      expect(context(c, "one").resident?.id).toBe("lu");
      expect(context(c, "one", "caio").resident?.id).toBe("caio");
      expect(context(c, "one", null).resident).toBeUndefined();
      expect(context(c, "one", "other").resident).toBeUndefined();
      expect(context(c, "two").resident).toBeUndefined();
      expect(c.endpoints[0].residentId).toBe("lu");
    } finally {
      await f.close();
    }
  });
});
