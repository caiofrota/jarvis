import { useEffect, useRef, useState } from 'react';
import { getAPI } from '../../client/api';
import { useStored } from '../../client/storage';
import { forSpeech } from '../../client/text';
import { silentFrame } from './audio-meter';
import { AudioOutput } from './audio-output';
import { SpeechPipeline } from './speech-pipeline';
import { PlaybackGuard } from './playback-guard';
import type { LocalVoiceStatus, SpeechSettings } from '../../shared/types';
type OutputChunk = { text: string; audio?: AudioBuffer };
export function useSpeech() {
  const [options, setOptions] = useStored<SpeechSettings>(
    'jarvis-voice-v1',
    { rate: 0.95, voiceURI: '', mode: 'local', localVoice: 'alex' },
    (value) => {
      const raw = value as Partial<SpeechSettings> | null;
      return {
        rate: Math.max(0.7, Math.min(1.3, Number(raw?.rate) || 1)),
        voiceURI: typeof raw?.voiceURI === 'string' ? raw.voiceURI : '',
        mode: raw?.mode && ['local', 'system', 'cloud', 'elevenlabs'].includes(raw.mode) ? raw.mode : 'local',
        elevenLabsVoice: typeof raw?.elevenLabsVoice === 'string' ? raw.elevenLabsVoice : '',
        localVoice:
          raw?.localVoice && ['alex', 'santa', 'dora'].includes(raw.localVoice) ? raw.localVoice : 'alex',
      };
    },
  );
  const [error, setError] = useState('');
  const [status, setStatus] = useState(''),
    [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]),
    [localVoiceStatus, setLocalVoiceStatus] = useState<LocalVoiceStatus | null>(null),
    [busy, setBusy] = useState(false);
  const audio = useRef<AudioOutput | null>(null),
    pipeline = useRef<SpeechPipeline<OutputChunk> | null>(null);
  const guard = useRef(new PlaybackGuard());
  const epoch = useRef(0);
  const prewarmTimer = useRef<number | undefined>(undefined);
  const lastText = useRef(''),
    systemResolve = useRef(new Set<() => void>()),
    cancelled = useRef<Promise<unknown>>(Promise.resolve());
  function unlock() {
    audio.current ??= new AudioOutput();
    void audio.current.unlock().catch((error: Error) => {
      setStatus(error.message);
      setError(error.message);
    });
  }
  function stop() {
    epoch.current++;
    guard.current.end();
    pipeline.current?.cancel();
    audio.current?.stop();
    window.speechSynthesis?.cancel();
    for (const resolve of systemResolve.current) resolve();
    systemResolve.current.clear();
    setBusy(false);
    cancelled.current = getAPI()
      .stopSpeech()
      .catch(() => {});
  }
  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const refresh = () => setVoices(synth.getVoices().filter((voice) => voice.localService));
    refresh();
    synth.addEventListener('voiceschanged', refresh);
    return () => {
      synth.removeEventListener('voiceschanged', refresh);
      pipeline.current?.cancel();
      audio.current?.stop();
      guard.current.dispose();
      synth.cancel();
    };
  }, []);
  useEffect(() => {
    if (options.mode !== 'local') {
      setLocalVoiceStatus(null);
      return;
    }
    let alive = true;
    const refresh = () =>
      getAPI()
        .localVoiceStatus()
        .then((value) => {
          if (alive) setLocalVoiceStatus(value);
        })
        .catch(() => {});
    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [options.mode]);
  useEffect(() => {
    clearTimeout(prewarmTimer.current);
    if (options.mode !== 'local') return;
    // Load Kokoro after the first paint, while the interface is idle. The
    // worker stays alive and the first spoken response no longer waits for
    // PyTorch, phonemization, and model initialization.
    prewarmTimer.current = window.setTimeout(() => {
      void getAPI()
        .localVoiceStatus()
        .then((status) => {
          if (status.ready && !status.loaded) return getAPI().warmLocalVoice('tts');
          return undefined;
        })
        .catch(() => {});
    }, 1800);
    return () => clearTimeout(prewarmTimer.current);
  }, [options.mode]);
  function begin() {
    stop();
    setError('');
    setBusy(true);
    lastText.current = '';
    const selected = { ...options },
      turn = epoch.current;
    pipeline.current = new SpeechPipeline<OutputChunk>({
      generate: async (text) => {
        await cancelled.current;
        if (turn !== epoch.current) throw new Error('Áudio cancelado.');
        text = forSpeech(text);
        if (selected.mode === 'system') return { text };
        return {
          text,
          audio: await audio.current!.prepare(
            await getAPI().speak({
              provider:
                selected.mode === 'elevenlabs' ? 'elevenlabs' : selected.mode === 'cloud' ? 'cloud' : 'local',
              text,
              speed: selected.rate,
              voice:
                selected.mode === 'elevenlabs'
                  ? selected.elevenLabsVoice
                  : selected.mode === 'cloud'
                    ? 'marin'
                    : selected.localVoice,
              consent: selected.mode === 'cloud' || selected.mode === 'elevenlabs',
            }),
          ),
        };
      },
      durationMs: (result) =>
        result.audio ? result.audio.duration * 1000 : result.text.split(/\s+/).length * 400,
      play: async (result, edges) => {
        if (turn !== epoch.current) return;
        lastText.current += ' ' + result.text;
        guard.current.begin(result.text);
        if (result.audio) {
          if (!audio.current) throw new Error('Ative o áudio primeiro.');
          return audio.current.play(result.audio, edges);
        }
        return new Promise<void>((resolve, reject) => {
          const utterance = new SpeechSynthesisUtterance(result.text);
          utterance.lang = 'pt-BR';
          utterance.rate = selected.rate;
          utterance.voice =
            voices.find((voice) => voice.voiceURI === selected.voiceURI) ||
            voices.find((voice) => voice.lang.startsWith('pt')) ||
            voices[0] ||
            null;
          if (!utterance.voice) {
            reject(new Error('Nenhuma voz local instalada. Escolha Kokoro ou instale uma voz no sistema.'));
            return;
          }
          const finish = () => {
            systemResolve.current.delete(finish);
            resolve();
          };
          systemResolve.current.add(finish);
          utterance.onend = finish;
          utterance.onerror = (event) =>
            event.error === 'canceled' || event.error === 'interrupted'
              ? finish()
              : reject(new Error(event.error));
          speechSynthesis.speak(utterance);
        });
      },
      onState: setStatus,
      onError: (error) => {
        if (turn !== epoch.current) return;
        audio.current?.stop();
        window.speechSynthesis?.cancel();
        guard.current.end();
        setError(error.message);
        setStatus(error.message);
        setBusy(false);
      },
      onDone: async (metrics) => {
        await audio.current?.finish();
        if (turn !== epoch.current) return;
        guard.current.end();
        setBusy(false);
        setStatus(
          'Concluído' +
            (metrics.firstAudioReadyMs
              ? ' · primeiro áudio em ' + (metrics.firstAudioReadyMs / 1000).toFixed(1) + ' s'
              : ''),
        );
      },
    });
  }
  return {
    options,
    error,
    setOptions,
    voices,
    localVoiceStatus,
    status,
    busy,
    lastText,
    guard: guard.current,
    visualFrame: () => audio.current?.visualFrame() ?? silentFrame,
    unlock,
    stop,
    begin,
    feed: (text: string) => pipeline.current?.feed(text),
    finish: (text: string) => pipeline.current?.finish(text),
    read: (text: string) => {
      unlock();
      begin();
      pipeline.current?.finish(text);
    },
  };
}
