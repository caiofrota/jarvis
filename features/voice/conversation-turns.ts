interface Port {
  busy(): boolean;
  speaking(): boolean;
  spokenText(): string;
  blocked?(): boolean;
  stop(): Promise<unknown>;
  send(text: string): Promise<unknown>;
  onError(message: string): void;
}
function normalize(text: string) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
export function isPlaybackEcho(heard: string, spoken: string): boolean {
  const a = normalize(heard),
    b = normalize(spoken);
  return (
    !!a &&
    !!b &&
    (b.includes(a) ||
      (a.split(' ').length >= 5 &&
        a.split(' ').filter((word) => b.split(' ').includes(word)).length / a.split(' ').length > 0.85))
  );
}
export class ConversationTurns {
  private enabled = true;
  private echoText = '';
  private interrupting = false;
  private cancellation: Promise<unknown> = Promise.resolve();
  constructor(private port: Port) {}
  partial(text: string): void {
    if (!this.enabled || !text.trim() || this.port.blocked?.()) return;
    if (isPlaybackEcho(text, this.port.spokenText())) {
      this.echoText = this.port.spokenText();
      return;
    }
    if (!this.port.busy()) return;
    if (this.port.speaking() && isPlaybackEcho(text, this.port.spokenText())) {
      this.echoText = this.port.spokenText();
      return;
    }
    this.echoText = '';
    this.interrupt();
  }
  speechStart(): void {
    // Audio energy is not a confirmed interruption: noise and breath also
    // trigger capture. Wait for recognized text in partial/utterance.
  }
  private interrupt(): void {
    if (this.interrupting) return;
    this.interrupting = true;
    this.cancellation = this.port.stop().catch((error) => this.port.onError(String(error)));
  }
  async utterance(text: string): Promise<void> {
    text = text.trim();
    if (!this.enabled || !text || this.port.blocked?.()) return;
    if (this.echoText && isPlaybackEcho(text, this.echoText)) {
      this.echoText = '';
      return;
    }
    if (isPlaybackEcho(text, this.port.spokenText())) return;
    if (this.port.busy()) this.interrupt();
    await this.cancellation;
    if (!this.enabled) return;
    this.interrupting = false;
    try {
      await this.port.send(text);
    } catch (error) {
      if (this.enabled) this.port.onError(error instanceof Error ? error.message : String(error));
    }
  }
  end(): void {
    this.enabled = false;
    void this.port.stop().catch(() => {});
  }
}
