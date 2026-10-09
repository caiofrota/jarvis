import type { AudioResult } from '../../shared/types';
import type { PlaybackEdges } from './speech-pipeline';
import { AudioMeter } from './audio-meter';
import { VOICE_TIMING } from './timing';

interface Scheduled {
  source: AudioBufferSourceNode;
  resolve(): void;
}
export class AudioOutput {
  private context: AudioContext | null = null;
  private scheduled = new Set<Scheduled>();
  private nextStart = 0;
  private epoch = 0;
  private needsTail = false;
  private sampleRate = 24000;
  private meter = new AudioMeter();
  visualFrame() {
    return this.meter.sample(this.scheduled.size > 0);
  }
  async unlock(): Promise<void> {
    const Constructor = window.AudioContext || window.webkitAudioContext;
    if (!Constructor) throw new Error('Áudio indisponível neste navegador.');
    this.context ??= new Constructor({ latencyHint: 'playback' });
    this.meter.attach(this.context);
    await this.context.resume();
  }
  async prepare(result: AudioResult): Promise<AudioBuffer> {
    if (!this.context) throw new Error('Clique em Conversar para ativar o áudio.');
    const bytes = Uint8Array.from(atob(result.audio), (character) => character.charCodeAt(0));
    return this.context.decodeAudioData(bytes.buffer);
  }
  async play(buffer: AudioBuffer, edges: PlaybackEdges = { first: false, last: false }): Promise<void> {
    const epoch = this.epoch,
      context = this.context;
    if (!context) throw new Error('Clique em Conversar para ativar o áudio.');
    await context.resume();
    if (epoch !== this.epoch) return;
    if (context.state === 'suspended')
      throw new Error('O navegador bloqueou o áudio. Inicie a conversa novamente.');
    this.needsTail = !edges.last;
    this.sampleRate = buffer.sampleRate;
    const lead = edges.first ? Math.round((buffer.sampleRate * VOICE_TIMING.playbackLeadMs) / 1000) : 0;
    const tail = edges.last ? Math.round((buffer.sampleRate * VOICE_TIMING.playbackTailMs) / 1000) : 0;
    if (lead || tail) {
      const padded = context.createBuffer(
        buffer.numberOfChannels,
        buffer.length + lead + tail,
        buffer.sampleRate,
      );
      for (let channel = 0; channel < buffer.numberOfChannels; channel++)
        padded.getChannelData(channel).set(buffer.getChannelData(channel), lead);
      buffer = padded;
    }
    const start = this.nextStart > context.currentTime ? this.nextStart : context.currentTime + 0.02;
    this.nextStart = start + buffer.duration;
    await new Promise<void>((resolve) => {
      const source = context.createBufferSource();
      const item = { source, resolve };
      this.scheduled.add(item);
      source.buffer = buffer;
      source.connect(this.meter.input ?? context.destination);
      source.onended = () => {
        source.disconnect();
        this.scheduled.delete(item);
        resolve();
      };
      // AudioContext schedules the next buffer before the preceding buffer ends.
      source.start(start);
    });
  }
  async finish(): Promise<void> {
    const epoch = this.epoch;
    // Streaming cannot know which sentence is last until the model finishes.
    if (this.needsTail && this.context) {
      const silence = this.context.createBuffer(
        1,
        Math.round((this.sampleRate * VOICE_TIMING.playbackTailMs) / 1000),
        this.sampleRate,
      );
      await this.play(silence);
    }
    if (epoch === this.epoch) {
      this.needsTail = false;
      this.nextStart = 0;
    }
  }
  stop(): void {
    this.epoch++;
    this.needsTail = false;
    this.nextStart = 0;
    for (const item of this.scheduled) {
      try {
        item.source.stop();
      } catch {}
      item.resolve();
    }
    this.scheduled.clear();
  }
  async dispose(): Promise<void> {
    this.stop();
    const context = this.context;
    this.context = null;
    this.meter.input?.disconnect();
    this.meter = new AudioMeter();
    if (context && context.state !== 'closed') await context.close();
  }
}
