import { VOICE_TIMING } from './timing';
export interface SpeechMetrics {
  firstTextMs?: number;
  firstAudioReadyMs?: number;
}
export interface PlaybackEdges {
  first: boolean;
  last: boolean;
}
interface Options<T> {
  generate(text: string): Promise<T>;
  /** Enqueues audio; resolves when this item has finished playing. */
  play(value: T, edges: PlaybackEdges): Promise<void>;
  durationMs?(value: T): number;
  reserveMs?: number;
  onState?(state: string): void;
  onDone?(metrics: SpeechMetrics): void;
  onError?(error: Error): void;
}
export class SpeechPipeline<T> {
  private items: string[] = [];
  private prepared: { value: T; duration: number }[] = [];
  private text = '';
  private ended = false;
  private cancelled = false;
  private generating = false;
  private playing = 0;
  private playedChunks = 0;
  private startedPlayback = false;
  private done = false;
  private hasDelta = false;
  private startedAt = Date.now();
  private metrics: SpeechMetrics = {};
  constructor(private options: Options<T>) {}
  feed(delta: string): void {
    if (this.cancelled || this.ended) return;
    this.hasDelta = true;
    this.metrics.firstTextMs ??= Date.now() - this.startedAt;
    this.text += delta;
    this.split(false);
    this.pump();
  }
  finish(text = ''): void {
    if (this.cancelled || this.ended) return;
    if (!this.hasDelta) this.text = text;
    this.split(true);
    this.ended = true;
    this.pump();
  }
  private split(final: boolean): void {
    // Avoid separate syntheses for "Olá." and every tiny sentence. Keep full clauses together.
    while (this.text.length > 320) {
      const prefix = this.text.slice(0, 321);
      const boundaries = [...prefix.matchAll(/[.!?](?:\s|$)/g)];
      const sentence = boundaries.findLast((match) => (match.index ?? 0) >= 140);
      let cut = sentence ? sentence.index! + sentence[0].length : prefix.lastIndexOf(' ');
      if (cut < 100) cut = 320;
      // Retain the final clause until completion so its buffer can include the tail padding.
      if (!final && !this.text.slice(cut).trim()) break;
      this.items.push(this.text.slice(0, cut).trim());
      this.text = this.text.slice(cut);
    }
    // Prepare a substantial first sentence while the model writes the next one.
    // Keep short greetings together; playback starts as soon as the audio reserve is ready.
    if (
      !final &&
      this.playedChunks === 0 &&
      !this.generating &&
      !this.items.length &&
      !this.prepared.length
    ) {
      const sentence = [...this.text.matchAll(/[.!?](?:\s|$)/g)].find((match) => (match.index ?? 0) >= 32);
      if (sentence) {
        const cut = sentence.index! + sentence[0].length;
        this.items.push(this.text.slice(0, cut).trim());
        this.text = this.text.slice(cut);
      }
    }
    if (final && this.text.trim()) {
      this.items.push(this.text.trim());
      this.text = '';
    }
  }
  private pump(): void {
    if (this.cancelled || this.done) return;
    // One synthesis at a time, at most three buffers in memory or scheduled for playback.
    if (!this.generating && this.items.length && this.prepared.length + this.playing < 3) {
      this.generating = true;
      const text = this.items.shift()!;
      void Promise.resolve()
        .then(() => this.options.generate(text))
        .then((value) => {
          if (this.cancelled) return;
          this.metrics.firstAudioReadyMs ??= Date.now() - this.startedAt;
          this.prepared.push({ value, duration: this.options.durationMs?.(value) ?? Infinity });
        })
        .catch((error) => this.fail(error))
        .finally(() => {
          this.generating = false;
          this.pump();
        });
    }
    const readyMs = this.prepared.reduce((sum, item) => sum + item.duration, 0);
    const fullyGenerated = this.ended && !this.items.length && !this.generating;
    if (
      !this.startedPlayback &&
      this.prepared.length &&
      (readyMs >= (this.options.reserveMs ?? VOICE_TIMING.playbackReserveMs) ||
        this.prepared.length >= 3 ||
        fullyGenerated)
    )
      this.startedPlayback = true;
    if (this.startedPlayback) {
      while (this.prepared.length && this.playing < 3) {
        const item = this.prepared.shift()!;
        this.playing++;
        const edges = { first: this.playedChunks++ === 0, last: fullyGenerated && !this.prepared.length };
        this.options.onState?.('Falando…');
        void Promise.resolve()
          .then(() => (this.cancelled ? undefined : this.options.play(item.value, edges)))
          .catch((error) => this.fail(error))
          .finally(() => {
            this.playing--;
            this.pump();
          });
      }
    } else if (this.generating || this.items.length || this.prepared.length) {
      this.options.onState?.('Preparando reserva de áudio…');
    }
    if (!this.playing && !this.prepared.length) {
      this.startedPlayback = false;
      if (fullyGenerated) {
        this.done = true;
        this.options.onDone?.(this.metrics);
      }
    }
  }
  private fail(cause: unknown): void {
    if (this.cancelled) return;
    this.cancel();
    this.options.onError?.(cause instanceof Error ? cause : new Error(String(cause)));
  }
  cancel(): void {
    this.cancelled = true;
    this.items.length = 0;
    this.prepared.length = 0;
    this.text = '';
  }
}
