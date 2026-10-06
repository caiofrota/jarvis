import { VOICE_TIMING } from './timing';
import type { JarvisAPI, VoiceProvider } from '../../shared/types';
export interface CaptureSession {
  stop(): Promise<string | undefined> | string;
  cancel?(): void;
  resetText?(): void;
  setPaused?(paused: boolean): void;
}
interface Options {
  stream: MediaStream;
  api: Pick<JarvisAPI, 'transcribe' | 'cancelVoice'>;
  provider?: VoiceProvider;
  recognitionContext?(): string[];
  onText(text: string): void;
  onError(message: string): void;
  onReview?(message: string): void;
  onUtterance?(text: string): void;
  onSpeechStart?(): void;
}
interface Segment {
  parts: Float32Array[];
  count: number;
  submitted: number;
  silence: number;
  speech: boolean;
  voicedSamples: number;
  text: string;
  group: number;
  version: number;
  transcribed: number;
  ended: boolean;
  needsReview?: boolean;
}
interface Job {
  epoch: number;
  segment: Segment;
  samples: Float32Array;
  version: number;
}
function wav(samples: Float32Array, rate: number): string {
  const buffer = new ArrayBuffer(44 + samples.length * 2),
    view = new DataView(buffer);
  const write = (at: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i));
  };
  write(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((value, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, value)) * 32767, true));
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 32768)
    binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(binary);
}
export async function capture({
  stream,
  api,
  provider = 'local',
  recognitionContext,
  onText,
  onError,
  onReview = onError,
  onUtterance,
  onSpeechStart,
}: Options): Promise<CaptureSession> {
  const context = new AudioContext({ sampleRate: 16000 });
  await context.audioWorklet.addModule('pcm-worklet.js');
  await context.resume();
  const source = context.createMediaStreamSource(stream),
    node = new AudioWorkletNode(context, 'jarvis-pcm');
  source.connect(node);
  node.connect(context.destination);
  let running = true,
    cancelled = false,
    busy = false,
    group = 0,
    utteranceActive = false;
  let paused = false,
    captureEpoch = 0,
    preRoll: Float32Array[] = [];
  function remember(samples: Float32Array) {
    preRoll.push(samples);
    const limit = Math.round((context.sampleRate * VOICE_TIMING.capturePreRollMs) / 1000);
    let total = preRoll.reduce((sum, part) => sum + part.length, 0);
    while (total > limit && preRoll.length) {
      const excess = total - limit,
        first = preRoll[0];
      if (first.length <= excess) {
        preRoll.shift();
        total -= first.length;
      } else {
        preRoll[0] = first.slice(excess);
        break;
      }
    }
  }
  let flushResolve: (() => void) | null = null,
    current: Segment | null = null,
    segments: Segment[] = [];
  let waiters: (() => void)[] = [];
  const queue: Job[] = [],
    closedGroups = new Set<number>();
  const allText = () =>
    segments
      .map((segment) => segment.text)
      .filter(Boolean)
      .join(' ');
  function update() {
    onText(allText());
  }
  function idle() {
    if (!busy && !queue.length) {
      waiters.forEach((resolve) => resolve());
      waiters = [];
    }
  }
  function emitReady() {
    if (!onUtterance || cancelled) return;
    for (const id of closedGroups) {
      const parts = segments.filter((segment) => segment.group === id);
      if (parts.some((segment) => !segment.ended || segment.transcribed < segment.version)) break;
      const text = parts
        .map((segment) => segment.text)
        .filter(Boolean)
        .join(' ')
        .trim();
      closedGroups.delete(id);
      segments = segments.filter((segment) => segment.group !== id);
      if (text && parts.some((segment) => segment.needsReview))
        onReview(
          'Não consegui reconhecer sua fala com segurança. Repita o pedido; nenhuma ação foi executada.',
        );
      else if (text) onUtterance(text);
    }
  }
  async function drain() {
    if (busy || cancelled) return;
    busy = true;
    try {
      while (queue.length && !cancelled) {
        const job = queue.shift()!;
        try {
          const result = await api.transcribe({
            provider,
            mime: 'audio/wav',
            audio: wav(job.samples, context.sampleRate),
            live: provider === 'local',
            consent: provider !== 'local',
            context: provider === 'local' ? recognitionContext?.() : undefined,
          });
          if (!cancelled && job.epoch === captureEpoch) {
            job.segment.text = result.text;
            job.segment.needsReview = result.needsReview;
            job.segment.transcribed = job.version;
            update();
            emitReady();
          }
        } catch (error) {
          if (!cancelled && job.epoch === captureEpoch)
            onError(error instanceof Error ? error.message : String(error));
        }
      }
    } finally {
      busy = false;
      idle();
    }
  }
  function schedule(segment: Segment) {
    if (!segment.speech || segment.submitted === segment.count) {
      emitReady();
      return;
    }
    const samples = new Float32Array(segment.count);
    let offset = 0;
    for (const part of segment.parts) {
      samples.set(part, offset);
      offset += part.length;
    }
    const job = { epoch: captureEpoch, segment, samples, version: ++segment.version };
    const existing = queue.findIndex((item) => item.segment === segment);
    if (existing >= 0) queue[existing] = job;
    else queue.push(job);
    segment.submitted = segment.count;
    void drain();
  }
  function finishSegment(endOfUtterance: boolean) {
    const segment = current;
    current = null;
    if (segment) {
      segment.ended = true;
      schedule(segment);
    }
    if (endOfUtterance) {
      closedGroups.add(group++);
      utteranceActive = false;
      emitReady();
    }
  }
  node.port.onmessage = (event: MessageEvent<Float32Array | 'flushed'>) => {
    if (event.data === 'flushed') {
      flushResolve?.();
      return;
    }
    if (cancelled || paused || !(event.data instanceof Float32Array)) return;
    const samples = event.data;
    let power = 0;
    for (const value of samples) power += value * value;
    const talking = Math.sqrt(power / samples.length) > 0.008;
    if (!current && !talking) {
      remember(samples);
      return;
    }
    if (!current) {
      current = {
        parts: preRoll,
        count: preRoll.reduce((sum, part) => sum + part.length, 0),
        submitted: 0,
        silence: 0,
        speech: false,
        voicedSamples: 0,
        text: '',
        group,
        version: 0,
        transcribed: 0,
        ended: false,
      };
      segments.push(current);
      preRoll = [];
    }
    current.parts.push(samples);
    current.count += samples.length;
    if (talking) {
      current.speech = true;
      current.silence = 0;
      current.voicedSamples += samples.length;
      if (
        !utteranceActive &&
        current.voicedSamples >= (context.sampleRate * VOICE_TIMING.speechConfirmationMs) / 1000
      ) {
        utteranceActive = true;
        onSpeechStart?.();
      }
    } else {
      current.silence += samples.length;
      if (!utteranceActive) current.voicedSamples = 0;
    }
    if (current.speech && current.silence >= (context.sampleRate * VOICE_TIMING.captureEndSilenceMs) / 1000)
      finishSegment(true);
    else if (current.count >= context.sampleRate * 20) finishSegment(false);
    else if (
      provider === 'local' &&
      !busy &&
      current.speech &&
      current.count - current.submitted >= context.sampleRate * 1.5
    )
      schedule(current);
    else if (!current.speech && !utteranceActive && current.count > context.sampleRate) {
      segments.pop();
      current = null;
    }
  };
  async function close() {
    source.disconnect();
    node.disconnect();
    if (context.state !== 'closed') await context.close();
  }
  return {
    setPaused(value: boolean) {
      if (paused === value) return;
      paused = value;
      captureEpoch++;
      current = null;
      segments = [];
      preRoll = [];
      queue.length = 0;
      closedGroups.clear();
      utteranceActive = false;
    },
    async stop() {
      if (!running) return;
      running = false;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 500);
        flushResolve = () => {
          clearTimeout(timer);
          resolve();
        };
        node.port.postMessage('flush');
      });
      finishSegment(true);
      await close();
      if (busy || queue.length) await new Promise<void>((resolve) => waiters.push(resolve));
      if (segments.some((segment) => segment.needsReview)) {
        onReview(
          'Não consegui reconhecer sua fala com segurança. Repita o pedido; nenhuma ação foi executada.',
        );
        return '';
      }
      return allText();
    },
    cancel() {
      cancelled = true;
      running = false;
      queue.length = 0;
      void api.cancelVoice().catch(() => {});
      void close().catch(() => {});
      idle();
    },
  };
}
export function chunks(text: string): string[] {
  const parts = text.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) || [text],
    result: string[] = [];
  for (let part of parts) {
    part = part.trim();
    while (part.length > 180) {
      let at = part.lastIndexOf(' ', 160);
      if (at < 40) at = 160;
      result.push(part.slice(0, at));
      part = part.slice(at).trim();
    }
    if (part) result.push(part);
  }
  return result;
}
