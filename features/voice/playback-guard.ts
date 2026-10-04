import { VOICE_TIMING } from './timing';

export class PlaybackGuard {
  private listeners = new Set<(blocked: boolean) => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private history: { text: string; at: number }[] = [];
  private held = false;
  get blocked(): boolean {
    return this.held;
  }
  get text(): string {
    if (!this.held)
      this.history = this.history.filter((item) => Date.now() - item.at < VOICE_TIMING.echoHistoryMs);
    return this.history.map((item) => item.text).join(' ');
  }
  subscribe(listener: (blocked: boolean) => void): () => void {
    this.listeners.add(listener);
    listener(this.held);
    return () => {
      this.listeners.delete(listener);
    };
  }
  begin(text: string): void {
    clearTimeout(this.timer);
    if (!this.held)
      this.history = this.history.filter((item) => Date.now() - item.at < VOICE_TIMING.echoHistoryMs);
    this.history.push({ text, at: Date.now() });
    this.held = true;
    for (const listener of this.listeners) listener(true);
  }
  end(): void {
    if (!this.held) return;
    clearTimeout(this.timer);
    // Refresh the timestamp: long audio may have started several seconds earlier.
    for (const item of this.history) item.at = Date.now();
    this.timer = setTimeout(() => {
      this.held = false;
      for (const listener of this.listeners) listener(false);
    }, VOICE_TIMING.echoTailMs);
  }
  dispose(): void {
    clearTimeout(this.timer);
    this.listeners.clear();
    this.held = false;
  }
}
