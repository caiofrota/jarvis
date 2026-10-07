import { setTimeout as pause } from "node:timers/promises";
import type { Repository } from "@rosie/db";
import { displayIsOn, type Expression, type Reply } from "@rosie/types";
import { context, DomainError, type TurnContext } from "@rosie/types/context";
import WebSocket from "ws";
import { isStopPhrase } from "../conversation/attention";
import type { Conversation } from "../conversation/service";
import type { VoiceClient } from "../voice/client";
import type { Enrollment, VoiceProfiles } from "../voice/profiles";
import { decodeBatch } from "./codec";
import {
  type InteractionOutcome,
  type InteractionRequest,
  interactionChoice,
  interactionRestriction,
} from "./interaction";
import { Playback } from "./playback";

export type RobotState =
  | "idle"
  | "listening"
  | "drowsy"
  | "checking"
  | "thinking"
  | "speaking"
  | "error"
  | "muted";
export class RobotSession {
  state: RobotState = "idle";
  private compressed = false;
  private batch = 1;
  private drowsy = false;
  private deadline = 0;
  private attention: RobotState = "listening";
  private misses = 0;
  private controller = new AbortController();
  private job?: Promise<void>;
  private segment?: WebSocket;
  private timer?: NodeJS.Timeout;
  private ctx?: TurnContext;
  private closed = false;
  private captureStarted = 0;
  private epoch = 0;
  private opening = false;
  private enrollment?: Enrollment;
  identifiedResident: string | null = null;
  private interaction?: {
    request: InteractionRequest;
    resolve: (outcome: InteractionOutcome) => void;
    deadline: number;
    misses: number;
  };
  private displayOn = true;
  private displayMinute = -1;
  readonly player: Playback;
  constructor(
    readonly id: string,
    readonly ws: WebSocket,
    private repo: Repository,
    private voice: VoiceClient,
    private conversation: Conversation,
    private claim: (ctx: TurnContext) => boolean,
    private release: () => void,
    private voiceProfiles?: VoiceProfiles,
  ) {
    this.player = new Playback(ws);
  }
  async initialize() {
    this.ctx = context(await this.repo.catalog(), this.id);
    await this.configure();
    await this.setState(this.ctx.endpoint.muted ? "muted" : "idle");
    this.timer = setInterval(() => {
      void this.tick().catch(() => this.fail());
    }, 250);
    this.connectSegment();
  }
  private connectSegment() {
    const channel = this.voice.segment(
      (pcm) => {
        if (this.segment !== channel || this.closed) return;
        this.captureStarted = 0;
        if (["listening", "drowsy"].includes(this.state) && !this.job) {
          this.state = "checking";
          this.start((signal) =>
            this.enrollment ? this.enrollSample(pcm, signal) : this.answer(pcm, signal),
          );
        }
      },
      () => {
        if (this.segment === channel && !this.closed)
          void this.repo.event("speech_link_error", { endpoint: this.id });
      },
      (active) => {
        if (this.segment === channel) this.captureStarted = active ? Date.now() : 0;
      },
    );
    this.segment = channel;
  }

  send(type: string, extra: Record<string, unknown> = {}) {
    if (this.closed || this.ws.readyState !== WebSocket.OPEN) return Promise.resolve();
    return this.player.send(JSON.stringify({ type, ...extra }));
  }
  async configure() {
    const ctx = context(await this.repo.catalog(), this.id);
    this.ctx = ctx;
    this.displayOn = displayIsOn(ctx.endpoint.display, ctx.home.timezone, new Date(Date.now()));
    this.displayMinute = Math.floor(Date.now() / 60000);
    await this.send("configure", {
      audio_codec: this.compressed ? "ima_adpcm" : "pcm_s16le",
      audio_batch_frames: this.batch,
      volume: ctx.audio.volume,
      prefill_ms: Math.min(ctx.audio.prefillMs, this.batch === 5 ? 1800 : 600),
      drowsy_seconds: ctx.audio.drowsySeconds,
      display_enabled: this.displayOn,
      led_enabled: ctx.endpoint.indicatorLight.enabled,
      led_listening_brightness: ctx.endpoint.indicatorLight.listeningBrightness,
      led_speaking_min_brightness: ctx.endpoint.indicatorLight.speakingMinBrightness,
      led_speaking_max_brightness: ctx.endpoint.indicatorLight.speakingMaxBrightness,
    });
  }
  async refresh() {
    const old = this.ctx,
      ctx = context(await this.repo.catalog(), this.id);
    if (
      old &&
      (old.assistant.id !== ctx.assistant.id ||
        old.endpoint.residentId !== ctx.endpoint.residentId ||
        old.endpoint.modeId !== ctx.endpoint.modeId ||
        old.endpoint.roomId !== ctx.endpoint.roomId ||
        old.endpoint.acousticGroup !== ctx.endpoint.acousticGroup ||
        old.endpoint.muted !== ctx.endpoint.muted)
    )
      await this.stop(ctx.endpoint.muted);
    await this.configure();
    // Catalog edits may delete or move the resident/profile while a session is awake.
    this.identifiedResident = null;
    if (this.enrollment) await this.stop();
  }
  async setState(state: RobotState, expression: Expression = "neutral", sleepNow = false) {
    this.state = state;
    await this.send("state", { state, expression, sleep_now: sleepNow });
    if (state === "idle" || state === "muted") this.release();
    await this.repo.event("state", { endpoint: this.id, state, expression });
  }
  private clearCapture() {
    this.captureStarted = 0;
    if (this.segment?.readyState === WebSocket.OPEN) this.segment.send("clear");
  }
  private start(task: (signal: AbortSignal) => Promise<void>) {
    const controller = new AbortController();
    this.controller = controller;
    const job = task(controller.signal)
      .catch(async () => {
        if (!controller.signal.aborted && !this.closed) await this.fail();
      })
      .finally(() => {
        if (this.job === job) this.job = undefined;
      });
    this.job = job;
  }
  async stop(muted = false, sleepNow = true) {
    if (this.enrollment) this.voiceProfiles?.cancel(this.enrollment);
    this.enrollment = undefined;
    this.identifiedResident = null;
    this.finishInteraction({ status: "cancelled" });
    this.epoch++;
    this.controller.abort();
    this.job = undefined;
    this.clearCapture();
    this.misses = 0;
    this.conversation.reset(this.id);
    await this.send("cancel");
    await this.setState(muted ? "muted" : "idle", "neutral", sleepNow);
  }
  async listen(fresh = true, internal = false) {
    if ((!internal && this.job) || this.opening) return;
    this.opening = true;
    const epoch = this.epoch;
    try {
      this.ctx = context(await this.repo.catalog(), this.id);
      if (this.ctx.endpoint.muted) {
        await this.setState("muted");
        return;
      }
      if (fresh) {
        if (!this.claim(this.ctx)) {
          await this.send("state", { state: "idle", sleep_now: true });
          return;
        }
        this.conversation.reset(this.id);
        this.identifiedResident = null;
        this.misses = 0;
      }
      if (this.segment?.readyState !== WebSocket.OPEN) {
        this.segment?.close();
        this.connectSegment();
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Speech worker unavailable")), 5000);
          this.segment?.once("open", () => {
            clearTimeout(timeout);
            resolve();
          });
          this.segment?.once("error", () => {
            clearTimeout(timeout);
            reject(new Error("Speech worker unavailable"));
          });
        });
      }
      if (this.closed || epoch !== this.epoch) return;
      this.clearCapture();
      this.attention = "listening";
      this.deadline = Date.now() + this.ctx.audio.listenSeconds * 1000;
      await this.setState("listening");
    } finally {
      this.opening = false;
    }
  }
  async tick() {
    if (this.enrollment) {
      if (
        Date.now() >= this.enrollment.deadline ||
        !["listening", "processing"].includes(this.enrollment.phase)
      ) {
        if (Date.now() >= this.enrollment.deadline)
          this.voiceProfiles?.fail(
            this.enrollment,
            "O tempo do cadastro terminou. Inicie novamente.",
          );
        this.enrollment = undefined;
        await this.stop();
      }
      return;
    }
    if (this.interaction && Date.now() >= this.interaction.deadline) {
      this.finishInteraction({ status: "timeout" });
      await this.stop();
      return;
    }
    const minute = Math.floor(Date.now() / 60000);
    if (this.ctx && minute !== this.displayMinute) {
      this.displayMinute = minute;
      const on = displayIsOn(
        this.ctx.endpoint.display,
        this.ctx.home.timezone,
        new Date(Date.now()),
      );
      if (on !== this.displayOn) {
        this.displayOn = on;
        await this.send("display", { enabled: on });
      }
    }
    if (this.captureStarted && Date.now() - this.captureStarted < 21000) return;
    if (!["listening", "drowsy"].includes(this.state) || Date.now() < this.deadline) return;
    if (this.state === "listening" && this.drowsy && this.ctx?.audio.drowsySeconds) {
      this.attention = "drowsy";
      this.deadline = Date.now() + this.ctx.audio.drowsySeconds * 1000;
      await this.setState("drowsy");
    } else await this.stop(false, false);
  }
  async testVoice() {
    await this.stop();
    this.start(async (signal) => {
      const ctx = context(await this.repo.catalog(), this.id);
      await this.setState("thinking");
      await this.speak(
        {
          text: `Bom dia! Eu sou ${ctx.assistant.name}. Você quer conversar comigo?`,
          expression: "curious",
        },
        ctx,
        signal,
      );
      signal.throwIfAborted();
      await this.setState("idle");
    });
  }
  get availableForInteraction() {
    return !this.closed && !this.job && !this.opening && !this.interaction && this.state === "idle";
  }
  async interact(request: InteractionRequest): Promise<InteractionOutcome> {
    if (!this.availableForInteraction) return { status: "busy" };
    if (Date.parse(request.expiresAt) <= Date.now()) return { status: "expired" };
    // Reserve synchronously before context I/O so concurrent requests cannot overlap.
    return new Promise((resolve) => {
      this.interaction = { request, resolve, deadline: Date.now() + 90000, misses: 0 };
      this.start(async (signal) => {
        const ctx = context(await this.repo.catalog(), this.id);
        signal.throwIfAborted();
        const blocked = interactionRestriction(ctx);
        if (blocked) {
          this.finishInteraction(blocked);
          return;
        }
        if (!this.claim(ctx)) {
          this.finishInteraction({ status: "busy" });
          return;
        }
        this.conversation.reset(this.id);
        this.ctx = ctx;
        const volume = Math.min(
          ctx.endpoint.announcements.volume ?? ctx.audio.volume,
          ctx.mode?.volumeLimit ?? 100,
        );
        await this.send("configure", {
          volume,
          audio_codec: this.compressed ? "ima_adpcm" : "pcm_s16le",
          audio_batch_frames: this.batch,
        });
        await this.setState("thinking");
        await this.speak({ text: request.text, expression: request.expression }, ctx, signal);
        signal.throwIfAborted();
        if (request.type === "announce") {
          this.finishInteraction({ status: "played" });
          await this.setState("idle", "neutral", true);
        } else {
          await this.listen(true, true);
          if (this.interaction) {
            this.interaction.deadline = Date.now() + request.timeoutSeconds * 1000;
            this.deadline = this.interaction.deadline;
          }
        }
      });
    });
  }
  private finishInteraction(outcome: InteractionOutcome) {
    const pending = this.interaction;
    if (!pending) return;
    this.interaction = undefined;
    if (this.ctx)
      void this.send("configure", {
        volume: this.ctx.audio.volume,
        audio_codec: this.compressed ? "ima_adpcm" : "pcm_s16le",
        audio_batch_frames: this.batch,
      }).catch(() => {});
    pending.resolve(outcome);
  }
  async cancelInteraction(id: string) {
    if (this.interaction?.request.id === id) await this.stop();
  }
  async testExpression(expression: Expression) {
    await this.stop();
    this.start(async (signal) => {
      await this.setState("speaking", expression);
      await pause(3000, undefined, { signal });
      await this.setState("idle");
    });
  }
  private async resume() {
    this.clearCapture();
    if (Date.now() >= this.deadline) {
      this.state = this.attention;
      await this.tick();
    } else await this.setState(this.attention);
  }
  private async answer(pcm: Buffer, signal: AbortSignal) {
    const cfg = await this.repo.settings(),
      ctx = context(await this.repo.catalog(), this.id),
      started = Date.now();
    const recognized = await this.voice.transcribe(pcm, cfg.sttModel, signal);
    signal.throwIfAborted();
    await this.repo.event("stt_timing", {
      endpoint: this.id,
      seconds: (Date.now() - started) / 1000,
    });
    if (!recognized.speech) {
      await this.repo.event("noise_rejected", { endpoint: this.id });
      await this.resume();
      return;
    }
    await this.setState("thinking");
    if (!recognized.text.trim()) {
      if (++this.misses >= 2) {
        await this.stop();
        return;
      }
      if (Date.now() >= this.deadline) {
        await this.resume();
        return;
      }
      await this.speak({ text: "Não entendi. Pode repetir?", expression: "curious" }, ctx, signal);
      signal.throwIfAborted();
      await this.resume();
      return;
    }
    this.misses = 0;
    if (
      isStopPhrase(recognized.text, [ctx.assistant.name, ...ctx.assistant.aliases, "rozi", "rosy"])
    ) {
      await this.stop();
      return;
    }
    if (this.interaction) {
      const pending = this.interaction;
      if (Date.now() >= pending.deadline) {
        this.finishInteraction({ status: "timeout" });
        await this.stop();
        return;
      }
      const choice = interactionChoice(recognized.text, pending.request);
      if (choice) {
        this.finishInteraction({ status: "answered", choice });
        await this.stop();
        return;
      }
      if (++pending.misses >= 2) {
        this.finishInteraction({ status: "cancelled" });
        await this.stop();
        return;
      }
      await this.speak(
        {
          text: `Você pode responder: ${pending.request.choices.map((v) => v.label).join(" ou ")}.`,
          expression: "curious",
        },
        ctx,
        signal,
      );
      signal.throwIfAborted();
      this.deadline = pending.deadline;
      await this.resume();
      return;
    }
    if (!ctx.endpoint.residentId && this.voiceProfiles) {
      const started = Date.now();
      try {
        const match = await this.voiceProfiles.identify(ctx.home.id, pcm, signal);
        signal.throwIfAborted();
        if (match.residentId !== undefined) this.identifiedResident = match.residentId;
        if (match.reason === "not_configured") this.identifiedResident = null;
        await this.repo.event("speaker_identified", {
          endpoint: this.id,
          resident: this.identifiedResident,
          result: match.reason,
          speech_seconds: match.speechSeconds,
          similarity: match.similarity,
          margin: match.margin,
          seconds: (Date.now() - started) / 1000,
        });
      } catch {
        signal.throwIfAborted();
        this.identifiedResident = null;
        await this.repo.event("speaker_identification_unavailable", { endpoint: this.id });
      }
    }
    const reply = await this.conversation.respond(
      this.id,
      recognized.text,
      signal,
      ctx.endpoint.residentId ? undefined : this.identifiedResident,
    );
    signal.throwIfAborted();
    await this.speak(reply, ctx, signal);
    signal.throwIfAborted();
    this.attention = "listening";
    this.deadline = Date.now() + ctx.audio.listenSeconds * 1000;
    await this.resume();
  }
  private async speak(reply: Reply, ctx: TurnContext, signal: AbortSignal) {
    const started = Date.now();
    const pcm = await this.voice.synthesize(
      reply.text,
      ctx.assistant.voice,
      ctx.assistant.quality,
      signal,
      ctx.home.id,
    );
    signal.throwIfAborted();
    await this.repo.event("tts_timing", {
      endpoint: this.id,
      voice: ctx.assistant.voice,
      seconds: (Date.now() - started) / 1000,
      audio_seconds: pcm.length / 32000,
    });
    await this.setState("speaking", reply.expression);
    const result = await this.player.play(pcm, this.batch, this.compressed, signal);
    await this.repo.event("playback_complete", { endpoint: this.id, ...result });
  }
  async receive(data: Buffer, binary: boolean) {
    if (binary) {
      if (data.length > 4096) throw new Error("Audio packet too large");
      if (
        ["listening", "drowsy"].includes(this.state) &&
        this.segment?.readyState === WebSocket.OPEN
      ) {
        if (this.segment.bufferedAmount > 64000) throw new Error("Speech worker backpressure");
        this.segment.send(this.compressed ? decodeBatch(data, this.batch) : data);
      }
      return;
    }
    if (data.length > 2048) throw new Error("Control frame too large");
    const event = JSON.parse(data.toString()) as Record<string, unknown>;
    if (
      event.type === "hello" &&
      event.audio_codec === "ima_adpcm" &&
      ["idle", "muted"].includes(this.state)
    ) {
      this.compressed = true;
      this.batch = event.audio_batch_frames === 5 ? 5 : 1;
      this.drowsy = event.drowsy_listening === true;
      await this.configure();
    } else if (event.type === "wake" && this.state === "idle") await this.listen();
    else if (event.type === "played" || event.type === "play_done") this.player.acknowledge(event);
    else if (event.type === "capture_error") await this.stop();
    else if (event.type === "diagnostic") {
      const values: Record<string, unknown> = { endpoint: this.id };
      for (const key of [
        "heap",
        "wake_ms",
        "wake_model",
        "rssi",
        "underruns",
        "upload_peak_ms",
        "send_max_ms",
        "led_duty",
        "display_enabled",
      ])
        if (["number", "string", "boolean"].includes(typeof event[key])) values[key] = event[key];
      await this.repo.event("device", values);
    }
  }
  async fail() {
    if (this.closed) return;
    if (this.enrollment)
      this.voiceProfiles?.fail(
        this.enrollment,
        "A conexão ou a coleta foi interrompida. Inicie novamente.",
      );
    this.enrollment = undefined;
    this.identifiedResident = null;
    this.finishInteraction({ status: "error" });
    this.controller.abort();
    this.job = undefined;
    this.clearCapture();
    await this.send("cancel");
    await this.repo.event("voice_error", { endpoint: this.id });
    await this.setState("error");
    await pause(1500);
    if (!this.closed && this.state === "error") await this.setState("idle");
  }
  close() {
    if (this.closed) return;
    if (this.enrollment)
      this.voiceProfiles?.fail(
        this.enrollment,
        "A caixinha desconectou. Inicie o cadastro novamente.",
      );
    this.enrollment = undefined;
    this.identifiedResident = null;
    this.closed = true;
    this.finishInteraction({ status: "disconnected" });
    this.controller.abort();
    if (this.timer) clearInterval(this.timer);
    this.segment?.close();
    this.release();
  }
  async enrollVoice(job: Enrollment) {
    if (!this.voiceProfiles || this.closed || this.state !== "idle" || this.job || this.opening)
      throw new DomainError(
        "A caixinha precisa estar conectada, acordável e sem conversa em andamento.",
      );
    this.enrollment = job;
    try {
      await this.listen();
      if (
        !["listening"].includes(this.state) ||
        this.closed ||
        job.phase !== "listening" ||
        this.ctx?.home.id !== job.homeId
      )
        throw new DomainError(
          "Não consegui abrir o microfone. Confira a conexão e o grupo acústico.",
        );
    } catch (error) {
      this.voiceProfiles.fail(job, "Não consegui abrir o microfone da caixinha.");
      this.enrollment = undefined;
      await this.stop();
      throw error;
    }
    this.deadline = job.deadline;
  }
  async cancelEnrollment(id: string) {
    if (this.enrollment?.id === id) await this.stop();
  }
  private async enrollSample(pcm: Buffer, signal: AbortSignal) {
    const job = this.enrollment;
    if (!job || !this.voiceProfiles) return;
    await this.setState("thinking");
    const done = await this.voiceProfiles.accept(job, pcm, signal);
    signal.throwIfAborted();
    if (this.enrollment !== job) return;
    if (done || job.phase !== "listening") {
      this.enrollment = undefined;
      await this.stop();
      return;
    }
    this.clearCapture();
    await this.setState("listening");
  }
}
