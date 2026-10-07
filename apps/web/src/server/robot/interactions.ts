import { json, type Repository } from "@rosie/db";
import { context } from "@rosie/types/context";
import { z } from "zod";
import type { MqttAddon } from "../addons/mqtt";
import type { RobotGateway } from "./gateway";
import {
  type InteractionOutcome,
  type InteractionRequest,
  interactionRestriction,
  interactionSchema,
} from "./interaction";

type Job = {
  request: InteractionRequest;
  endpointId: string;
  done: (outcome: InteractionOutcome) => void;
};
const ledgerSchema = z.array(z.object({ id: z.string(), expires: z.number() })).max(64);
export class Interactions {
  private queue: Job[] = [];
  private active = new Map<string, Job>();
  private serial: Promise<unknown> = Promise.resolve();
  private pumping = false;
  private admissions = 0;
  private timer?: NodeJS.Timeout;
  private generation = 0;
  private configuration = "";
  constructor(
    private repo: Repository,
    private gateway: RobotGateway,
    private mqtt: MqttAddon,
  ) {}
  async configure() {
    const cfg = await this.repo.settings(),
      catalog = await this.repo.catalog();
    const routes = new Map(
      catalog.endpoints
        .filter((e) => e.enabled)
        .map((e) => [`${cfg.interactionMqttPrefix}/${e.homeId}/${e.id}/request`, e.id]),
    );
    const configuration = JSON.stringify([
      cfg.interactionMqttEnabled,
      cfg.mqttEnabled,
      cfg.mqttHost,
      cfg.mqttPort,
      cfg.mqttUsername,
      cfg.mqttPassword,
      cfg.mqttTls,
      [...routes],
    ]);
    if (this.configuration !== configuration) {
      this.close();
      this.configuration = configuration;
    }
    if (!this.timer) this.timer = setInterval(() => void this.pump(), 250);
    const generation = this.generation;
    await this.mqtt.commands(
      cfg.mqttEnabled && cfg.interactionMqttEnabled ? [...routes.keys()] : [],
      (topic, payload) => {
        const endpointId = routes.get(topic);
        if (!endpointId) return;
        void this.fromMqtt(endpointId, topic, payload, generation);
      },
    );
  }
  private async fromMqtt(endpointId: string, topic: string, payload: Buffer, generation: number) {
    try {
      const request = interactionSchema.parse(JSON.parse(payload.toString()));
      const outcome = await this.submit(endpointId, request);
      if (generation !== this.generation) return;
      await this.mqtt.publish(
        topic.replace(/\/request$/, "/result"),
        JSON.stringify({ id: request.id, endpointId, ...outcome }),
      );
    } catch {
      await this.repo.event("interaction_delivery_error", { endpoint: endpointId });
    }
  }
  async submit(endpointId: string, input: unknown): Promise<InteractionOutcome> {
    const request = interactionSchema.parse(input);
    if (this.admissions >= 64) return { status: "busy" };
    this.admissions++;
    let complete!: (result: InteractionOutcome) => void;
    const result = new Promise<InteractionOutcome>((resolve) => {
      complete = resolve;
    });
    const generation = this.generation;
    const work = async () => {
      if (generation !== this.generation) {
        complete({ status: "cancelled" });
        return;
      }
      const now = Date.now(),
        expires = Date.parse(request.expiresAt);
      if (expires <= now || expires > now + 120000) {
        complete({ status: "expired" });
        return;
      }
      const ctx = context(await this.repo.catalog(), endpointId),
        blocked = interactionRestriction(ctx);
      if (blocked) {
        complete(blocked);
        return;
      }
      const session = this.gateway.sessions.get(endpointId);
      if (!session) {
        complete({ status: "disconnected" });
        return;
      }
      if (
        this.queue.length + this.active.size >= 64 ||
        this.queue.filter((j) => j.endpointId === endpointId).length >= 3 ||
        (request.busyPolicy === "reject" && !session.availableForInteraction)
      ) {
        complete({ status: "busy" });
        return;
      }
      // Claim before any speech. Survives restart without storing text or replaying pending work.
      const key = `interaction-dedupe:${endpointId}`;
      const stored = await this.repo.db.setting.findUnique({ where: { id: key } });
      const ledger = ledgerSchema.parse(stored?.data ?? []).filter((v) => v.expires > now);
      if (ledger.some((v) => v.id === request.id)) {
        complete({ status: "duplicate" });
        return;
      }
      if (ledger.length >= 64) {
        complete({ status: "busy" });
        return;
      }
      ledger.push({ id: request.id, expires: now + 300000 });
      await this.repo.db.setting.upsert({
        where: { id: key },
        create: { id: key, data: json(ledger) },
        update: { data: json(ledger) },
      });
      if (generation !== this.generation) {
        complete({ status: "cancelled" });
        return;
      }
      this.queue.push({ request, endpointId, done: complete });
      void this.pump();
    };
    const pending = this.serial.then(work);
    this.serial = pending.catch(() => {});
    try {
      await pending;
      return await result;
    } finally {
      this.admissions--;
    }
  }
  private finish(job: Job, result: InteractionOutcome) {
    job.done(result);
    void this.repo
      .event("interaction_result", {
        endpoint: job.endpointId,
        id: job.request.id,
        type: job.request.type,
        status: result.status,
      })
      .catch(() => {});
  }
  private async pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      for (const job of [...this.queue]) {
        const session = this.gateway.sessions.get(job.endpointId);
        const expired = Date.parse(job.request.expiresAt) <= Date.now();
        if (!session || expired) {
          this.queue.splice(this.queue.indexOf(job), 1);
          this.finish(job, { status: expired ? "expired" : "disconnected" });
          continue;
        }
        if (this.active.has(job.endpointId) || !session.availableForInteraction) continue;
        this.queue.splice(this.queue.indexOf(job), 1);
        this.active.set(job.endpointId, job);
        void session
          .interact(job.request)
          .then((result) => this.finish(job, result))
          .catch(() => this.finish(job, { status: "error" }))
          .finally(() => {
            if (this.active.get(job.endpointId) === job) this.active.delete(job.endpointId);
          });
      }
    } finally {
      this.pumping = false;
    }
  }
  close() {
    this.generation++;
    clearInterval(this.timer);
    this.timer = undefined;
    for (const job of this.queue) this.finish(job, { status: "cancelled" });
    this.queue = [];
    for (const job of this.active.values())
      void this.gateway.sessions.get(job.endpointId)?.cancelInteraction(job.request.id);
  }
}
