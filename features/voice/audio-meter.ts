export interface VoiceFrame {
  level: number;
  bass: number;
  mid: number;
  high: number;
}
export const silentFrame: VoiceFrame = { level: 0, bass: 0, mid: 0, high: 0 };

/** Read-only analysis of the output signal. Never opens the microphone. */
export class AudioMeter {
  input: AnalyserNode | null = null;
  private wave = new Uint8Array(512);
  private spectrum = new Uint8Array(256);
  private frame: VoiceFrame = { ...silentFrame };
  attach(context: AudioContext): void {
    if (this.input || typeof context.createAnalyser !== 'function') return;
    this.input = context.createAnalyser();
    this.input.fftSize = 512;
    this.input.smoothingTimeConstant = 0.65;
    this.input.connect(context.destination);
  }
  sample(active: boolean): VoiceFrame {
    if (!active || !this.input) return silentFrame;
    this.input.getByteTimeDomainData(this.wave);
    this.input.getByteFrequencyData(this.spectrum);
    let squares = 0;
    for (const value of this.wave) squares += ((value - 128) / 128) ** 2;
    const average = (from: number, to: number) => {
      let total = 0;
      for (let i = from; i < to; i++) total += this.spectrum[i];
      return total / ((to - from) * 255);
    };
    this.frame.level = Math.min(1, Math.sqrt(squares / this.wave.length) * 3);
    this.frame.bass = average(1, 6);
    this.frame.mid = average(6, 32);
    this.frame.high = average(32, 100);
    return this.frame;
  }
}
