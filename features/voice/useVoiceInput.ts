import { useEffect, useRef, useState } from 'react';
import { useStored } from '../../client/storage';
import { getAPI } from '../../client/api';
import { BrowserRecognition } from './browser-recognition';
import { capture, type CaptureSession } from './local-capture';
import { captureCloud } from './cloud-capture';
import { ConversationTurns } from './conversation-turns';
import { useLocalVoice } from './useLocalVoice';
import type { VoiceProps } from '../controllers';
import type { InputMode, WakewordStatus } from '../../shared/types';

export function useVoiceInput({ chat, speech, ai, profile, conversation = false }: VoiceProps) {
  const [device, setDevice] = useStored<'speakers' | 'headphones'>(
    'jarvis-listening-device',
    'speakers',
    (value) => (value === 'headphones' ? 'headphones' : 'speakers'),
  );
  const [protectedInput, setProtectedInput] = useState(false);
  const unsubscribe = useRef<(() => void) | null>(null);
  const [mode, setMode] = useState<InputMode>('local');
  const [available, setAvailable] = useState(false),
    [initialized, setInitialized] = useState(false);
  const [text, setText] = useState(''),
    [state, setState] = useState('Pronto para começar.');
  const [recording, setRecording] = useState(false),
    [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [wakeword, setWakeword] = useState<WakewordStatus>({
    available: false,
    enabled: false,
    listening: false,
    phrase: 'JARVIS',
  });
  const needsLocal = mode === 'local' || (conversation && speech.options.mode === 'local');
  const localVoice = useLocalVoice(needsLocal ? 'local' : mode, initialized);
  const session = useRef<CaptureSession | null>(null),
    stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    epoch = useRef(0);
  const turns = useRef<ConversationTurns | null>(null),
    transcript = useRef('');
  const wakewordPreference = useRef(false),
    startRef = useRef<() => Promise<void>>(() => Promise.resolve()),
    recordingRef = useRef(false),
    processingRef = useRef(false);
  recordingRef.current = recording;
  processingRef.current = processing;
  const latest = useRef({ chat, speech, device });
  latest.current = { chat, speech, device };

  function updateText(value: string) {
    transcript.current = value;
    setText(value);
  }
  function cleanup() {
    epoch.current++;
    unsubscribe.current?.();
    unsubscribe.current = null;
    clearTimeout(timer.current);
    turns.current?.end();
    turns.current = null;
    if (session.current?.cancel) session.current.cancel();
    else void session.current?.stop();
    session.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    void getAPI()
      .microphone(false)
      .catch(() => {});
    void getAPI()
      .wakeword(false)
      .then((status) => setWakeword((current) => ({ ...current, ...status, enabled: wakewordPreference.current })))
      .catch(() => {});
  }
  useEffect(() => {
    const online = !!(window.SpeechRecognition || window.webkitSpeechRecognition) && !window.jarvisDesktop;
    setAvailable(online);
    let saved: string | null = null;
    try {
      saved = localStorage.getItem('jarvis-input-engine');
    } catch {}
    setMode(
      saved === 'local' || saved === 'cloud' || saved === 'browser' ? saved : online ? 'browser' : 'local',
    );
    setInitialized(true);
    return cleanup;
  }, []);
  useEffect(() => {
    let mounted = true;
    const api = getAPI();
    const saved = (() => {
      try {
        return localStorage.getItem('jarvis-wakeword');
      } catch {
        return null;
      }
    })();
    const preference = saved === null ? !!window.jarvisDesktop : saved === '1';
    wakewordPreference.current = preference;
    void api.wakewordStatus().then((status) => {
      if (!mounted) return;
      setWakeword({ ...status, enabled: preference });
      if (preference && status.available) {
        void api
          .wakeword(true)
          .then((next) => mounted && setWakeword({ ...next, enabled: preference }))
          .catch((cause: Error) => mounted && setWakeword((current) => ({ ...current, error: cause.message })));
      }
    });
    const unsubscribe = api.onWakeword(() => {
      if (
        !mounted ||
        !conversation ||
        !wakewordPreference.current ||
        recordingRef.current ||
        processingRef.current ||
        latest.current.speech.busy ||
        latest.current.chat.busy
      )
        return;
      setWakeword((current) => ({ ...current, listening: false, message: 'JARVIS detectado. Ativando conversa…' }));
      void startRef.current();
    });
    const timer = window.setInterval(() => {
      void api
        .wakewordStatus()
        .then((status) => mounted && setWakeword((current) => ({ ...status, enabled: wakewordPreference.current || current.enabled })));
    }, 1500);
    return () => {
      mounted = false;
      window.clearInterval(timer);
      unsubscribe();
    };
  }, [conversation]);
  useEffect(() => {
    if (!conversation || !wakewordPreference.current || !localVoice.status.wakewordReady || wakeword.available) return;
    void getAPI()
      .wakewordStatus()
      .then((status) => {
        if (!status.available || !wakewordPreference.current) return;
        return getAPI()
          .wakeword(true)
          .then((next) => setWakeword({ ...next, enabled: wakewordPreference.current }));
      })
      .catch(() => {});
  }, [conversation, localVoice.status.wakewordReady, wakeword.available]);
  useEffect(() => {
    const hidden = () => {
      if (document.hidden && !conversation) {
        cleanup();
        setRecording(false);
        setProcessing(false);
        setState('Ditado encerrado porque a janela ficou oculta.');
      }
    };
    document.addEventListener('visibilitychange', hidden);
    return () => document.removeEventListener('visibilitychange', hidden);
  }, [conversation]);

  function fail(message: string) {
    cleanup();
    setError(message);
    setRecording(false);
    setProcessing(false);
    resumeWakeword();
  }
  function resumeWakeword() {
    if (!conversation || !wakewordPreference.current) return;
    void getAPI()
      .wakeword(true)
      .then((status) => setWakeword({ ...status, enabled: wakewordPreference.current }))
      .catch(() => {});
  }
  async function stop(): Promise<string> {
    if (conversation) {
      cleanup();
      setRecording(false);
      setProcessing(false);
      setState('Conversa encerrada.');
      resumeWakeword();
      return transcript.current;
    }
    const current = session.current;
    session.current = null;
    clearTimeout(timer.current);
    setRecording(false);
    setProcessing(true);
    try {
      const final = await current?.stop();
      if (final !== undefined) updateText(final);
      return final ?? transcript.current;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return transcript.current;
    } finally {
      stream.current?.getTracks().forEach((track) => track.stop());
      stream.current = null;
      setProcessing(false);
      void getAPI()
        .microphone(false)
        .catch(() => {});
    }
  }
  function choose(value: InputMode) {
    cleanup();
    setRecording(false);
    setProcessing(false);
    setMode(value);
    setError('');
    try {
      localStorage.setItem('jarvis-input-engine', value);
    } catch {}
  }
  async function start() {
    cleanup();
    const id = epoch.current,
      valid = () => id === epoch.current;
    setError('');
    setProtectedInput(false);
    updateText('');
    speech.unlock();
    setState('Preparando microfone…');
    setProcessing(true);
    void getAPI()
      .wakeword(false)
      .then((status) => setWakeword((current) => ({ ...current, ...status, enabled: wakewordPreference.current })))
      .catch(() => {});
    if (conversation) {
      turns.current = new ConversationTurns({
        busy: () => latest.current.chat.busy || latest.current.speech.busy,
        speaking: () => latest.current.speech.guard.blocked,
        blocked: () => latest.current.device === 'speakers' && latest.current.speech.guard.blocked,
        spokenText: () => latest.current.speech.guard.text,
        stop: () => latest.current.chat.stop(),
        send: (phrase) => latest.current.chat.send(phrase, true),
        onError: (message) => {
          if (valid()) setError(message);
        },
      });
    }
    void ai.warm(profile).catch((cause: Error) => {
      if (valid()) setError(cause.message);
    });
    if (speech.options.mode === 'local' && localVoice.status.ready)
      void getAPI()
        .warmLocalVoice('tts')
        .catch((cause: Error) => {
          if (valid()) setError(cause.message);
        });
    const onText = (value: string) => {
      if (!valid()) return;
      updateText(value);
      if (conversation) turns.current?.partial(value);
    };
    const onUtterance = (phrase: string) => {
      if (!valid()) return;
      session.current?.resetText?.();
      updateText(phrase);
      void turns.current?.utterance(phrase);
    };
    try {
      if (mode === 'browser') {
        const recognizer = new BrowserRecognition({
          onText,
          onState: (value) => {
            if (valid()) setState(value);
          },
          onError: (message) => {
            if (valid()) fail(message);
          },
          onUtterance: conversation ? onUtterance : undefined,
        });
        session.current = recognizer;
        recognizer.start();
      } else {
        await getAPI().microphone(true);
        const media = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false,
        });
        if (!valid()) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        stream.current = media;
        const onError = (message: string) => {
          if (valid()) fail(message);
        };
        const captured =
          mode === 'local' || conversation
            ? await capture({
                stream: media,
                api: getAPI(),
                provider: mode === 'cloud' ? 'cloud' : 'local',
                onText,
                onError,
                onUtterance: conversation ? onUtterance : undefined,
                onSpeechStart: conversation ? () => turns.current?.speechStart() : undefined,
              })
            : captureCloud(media, getAPI(), onText, onError);
        if (!valid()) {
          captured.cancel?.();
          return;
        }
        session.current = captured;
        setState(mode === 'local' ? 'Ouvindo neste computador.' : 'Ouvindo · áudio enviado à OpenAI.');
      }
      if (!valid()) return;
      if (conversation) {
        unsubscribe.current = speech.guard.subscribe((blocked) => {
          if (!valid()) return;
          const protect = latest.current.device === 'speakers' && blocked;
          session.current?.setPaused?.(protect);
          setProtectedInput(protect);
        });
      }
      setRecording(true);
      if (!conversation)
        timer.current = setTimeout(() => {
          void stop();
        }, 60000);
    } catch (cause) {
      if (valid()) fail(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (valid()) setProcessing(false);
    }
  }
  startRef.current = start;
  async function toggleWakeword(enabled: boolean) {
    wakewordPreference.current = enabled;
    try {
      localStorage.setItem('jarvis-wakeword', enabled ? '1' : '0');
    } catch {}
    try {
      const status = await getAPI().wakeword(enabled);
      setWakeword({ ...status, enabled });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setWakeword((current) => ({ ...current, enabled: false, error: message, message: 'Wakeword pausado.' }));
      wakewordPreference.current = false;
    }
  }
  async function installWakeword() {
    await localVoice.retry();
    const status = await getAPI().wakewordStatus();
    setWakeword((current) => ({ ...current, ...status, enabled: wakewordPreference.current }));
    if (wakewordPreference.current && status.available) await toggleWakeword(true);
  }
  return {
    mode,
    device,
    setDevice,
    protectedInput,
    choose,
    available,
    text,
    setText: updateText,
    state,
    recording,
    processing,
    needsLocal,
    local: localVoice.status,
    wakeword,
    error: error || localVoice.error,
    start,
    stop,
    retry: localVoice.retry,
    installWakeword,
    toggleWakeword,
    send: async () => {
      speech.unlock();
      const final = await stop();
      if (final.trim()) await chat.send(final, true);
    },
  };
}
