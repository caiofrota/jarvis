"use client";
import { useEffect, useRef, useState } from "react";
import { AudioOutput } from "../../../../../features/voice/audio-output";
import { type CaptureSession, capture } from "../../../../../features/voice/local-capture";
import EnergyRing from "../../../../../features/voice/orb/EnergyRing";
import type { OrbPhase } from "../../../../../features/voice/orb/scene";
import { SpeechPipeline } from "../../../../../features/voice/speech-pipeline";
import { Field } from "../../components/field/Field";
import { type Option, request } from "../../lib/api-client";

type Message = { id: number; role: "user" | "assistant"; text: string };
type Options = { name: string; assistants: Option[]; areas: Option[] };
export function Studio() {
  const [options, setOptions] = useState<Options>({ name: "Jarvis", assistants: [], areas: [] });
  const [sessionId, setSessionId] = useState("");
  const [assistantId, setAssistantId] = useState("");
  const [areaId, setAreaId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [draft, setDraft] = useState("");
  const [phase, setPhase] = useState<OrbPhase>("idle");
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const current = useRef({ sessionId, assistantId, areaId });
  current.current = { sessionId, assistantId, areaId };
  const pending = useRef<AbortController | null>(null);
  const epoch = useRef(0),
    locked = useRef(false),
    id = useRef(0),
    voiceActive = useRef(false);
  const stream = useRef<MediaStream | null>(null);
  const microphone = useRef<CaptureSession | null>(null);
  const output = useRef<AudioOutput | null>(null);
  const speech = useRef<SpeechPipeline<AudioBuffer> | null>(null);
  const settleSpeech = useRef<(() => void) | null>(null);
  function selection() {
    return {
      ...current.current,
      assistantId: current.current.assistantId || null,
      areaId: current.current.areaId || null,
    };
  }
  function interrupt() {
    epoch.current++;
    pending.current?.abort();
    speech.current?.cancel();
    settleSpeech.current?.();
    output.current?.stop();
    locked.current = false;
    setBusy(false);
    microphone.current?.resetText?.();
    microphone.current?.setPaused?.(false);
    setDraft("");
    setPhase(voiceActive.current ? "listening" : "idle");
  }
  function stop() {
    voiceActive.current = false;
    setActive(false);
    microphone.current?.cancel?.();
    microphone.current = null;
    stream.current?.getTracks().forEach((track) => {
      track.stop();
    });
    stream.current = null;
    interrupt();
  }
  useEffect(() => {
    const abort = new AbortController();
    void Promise.all([
      request<Options>("/companion/options", { signal: abort.signal }),
      request<{ sessionId: string }>("/companion/session", {
        method: "POST",
        body: "{}",
        signal: abort.signal,
      }),
    ])
      .then(([choices, session]) => {
        setOptions(choices);
        setSessionId(session.sessionId);
      })
      .catch((cause) => {
        if (!abort.signal.aborted) setError(cause.message);
      });
    return () => {
      abort.abort();
      voiceActive.current = false;
      epoch.current++;
      pending.current?.abort();
      speech.current?.cancel();
      settleSpeech.current?.();
      microphone.current?.cancel?.();
      stream.current?.getTracks().forEach((track) => {
        track.stop();
      });
      void output.current?.dispose();
    };
  }, []);
  async function send(phrase: string) {
    if (!phrase.trim() || locked.current || !current.current.sessionId) return;
    const version = ++epoch.current,
      abort = new AbortController();
    pending.current = abort;
    locked.current = true;
    microphone.current?.setPaused?.(true);
    setText("");
    setDraft("");
    setError("");
    setBusy(true);
    setPhase("thinking");
    setMessages((previous) =>
      [...previous, { id: ++id.current, role: "user" as const, text: phrase }].slice(-40),
    );
    try {
      const reply = await request<{ text: string; voice: string }>("/companion/message", {
        method: "POST",
        body: JSON.stringify({ ...selection(), text: phrase }),
        signal: abort.signal,
      });
      if (epoch.current !== version) return;
      setMessages((previous) =>
        [...previous, { id: ++id.current, role: "assistant" as const, text: reply.text }].slice(
          -40,
        ),
      );
      if (voiceActive.current && output.current) {
        const audio = output.current;
        setPhase("speaking");
        await new Promise<void>((resolve, reject) => {
          settleSpeech.current = resolve;
          const pipeline = new SpeechPipeline<AudioBuffer>({
            generate: async (text) =>
              audio.prepare(
                await request<{ audio: string; mime: string }>("/companion/speak", {
                  method: "POST",
                  body: JSON.stringify({ ...selection(), text, voice: reply.voice }),
                  signal: abort.signal,
                }),
              ),
            play: (buffer, edges) => audio.play(buffer, edges),
            durationMs: (buffer) => buffer.duration * 1000,
            onDone: () => {
              settleSpeech.current = null;
              resolve();
            },
            onError: (cause) => {
              settleSpeech.current = null;
              reject(cause);
            },
          });
          speech.current = pipeline;
          pipeline.finish(reply.text);
        });
      }
    } catch (cause) {
      if (!abort.signal.aborted && epoch.current === version) {
        speech.current?.cancel();
        output.current?.stop();
        setError((cause as Error).message);
      }
    } finally {
      if (epoch.current === version) {
        pending.current = null;
        locked.current = false;
        setBusy(false);
        microphone.current?.resetText?.();
        microphone.current?.setPaused?.(false);
        setPhase(voiceActive.current ? "listening" : "idle");
      }
    }
  }
  const submit = useRef(send);
  submit.current = send;
  async function start() {
    if (voiceActive.current || !sessionId) return;
    setError("");
    setPhase("preparing");
    const version = ++epoch.current;
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
        throw new Error(
          "Para conversar por voz na versão web, abra por HTTPS ou localhost neste computador.",
        );
      output.current ??= new AudioOutput();
      await output.current.unlock();
      const acquired = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      if (epoch.current !== version) {
        acquired.getTracks().forEach((track) => {
          track.stop();
        });
        return;
      }
      stream.current = acquired;
      const stt = new Set<AbortController>();
      microphone.current = await capture({
        stream: acquired,
        workletUrl: "/pcm-worklet.js",
        provider: "local",
        api: {
          transcribe: async (input) => {
            const abort = new AbortController();
            stt.add(abort);
            try {
              return await request<{ text: string }>("/companion/transcribe", {
                method: "POST",
                body: JSON.stringify({ ...selection(), audio: input.audio }),
                signal: abort.signal,
              });
            } finally {
              stt.delete(abort);
            }
          },
          cancelVoice: async () => {
            stt.forEach((abort) => {
              abort.abort();
            });
            stt.clear();
          },
        },
        onText: setDraft,
        onError: setError,
        onUtterance: (phrase) => {
          void submit.current(phrase);
        },
      });
      if (epoch.current !== version) {
        microphone.current.cancel?.();
        acquired.getTracks().forEach((track) => {
          track.stop();
        });
        return;
      }
      voiceActive.current = true;
      setActive(true);
      setPhase("listening");
    } catch (cause) {
      stop();
      setError((cause as Error).message);
    }
  }
  async function reset() {
    stop();
    setError("");
    setSessionId("");
    setMessages([]);
    try {
      const session = await request<{ sessionId: string }>("/companion/session", {
        method: "POST",
        body: "{}",
      });
      setSessionId(session.sessionId);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">JARVIS</p>
          <h1>Converse com seu universo.</h1>
          <p>Seu companion, onde você estiver.</p>
        </div>
      </header>
      <div className="studio-grid">
        <section className="studio-stage panel" aria-label="Assistente central">
          <div className="studio-ring">
            <EnergyRing
              phase={phase}
              profile="eco"
              motion
              sample={() => output.current?.visualFrame() ?? { level: 0, bass: 0, mid: 0, high: 0 }}
            />
            <span>
              {
                {
                  idle: "Pronto para conversar",
                  preparing: "Preparando áudio",
                  listening: "Ouvindo",
                  thinking: "Pensando",
                  speaking: "Falando",
                  settling: "Finalizando",
                }[phase]
              }
            </span>
          </div>
          <button
            type="button"
            className="primary"
            disabled={!sessionId || (!active && busy) || phase === "preparing"}
            onClick={() => (active ? stop() : void start())}
          >
            {active ? "Encerrar voz" : "Conversar por voz"}
          </button>
          {busy && (
            <button type="button" onClick={interrupt}>
              Interromper
            </button>
          )}
          <Field
            label="Assistente"
            type="select"
            value={assistantId}
            disabled={active || busy}
            options={[{ id: "", name: `${options.name} · padrão` }, ...options.assistants]}
            onChange={(value) => {
              setAssistantId(String(value));
              setMessages([]);
            }}
          />
          <Field
            label="Localização atual"
            type="select"
            value={areaId}
            disabled={busy}
            options={[{ id: "", name: "Itinerante · sem cômodo fixo" }, ...options.areas]}
            onChange={(value) => {
              interrupt();
              setAreaId(String(value));
            }}
          />
          <p className="hint">
            Você pode conversar sem cadastrar uma caixinha. Para controlar a casa, diga o ambiente
            ou o nome do dispositivo.
          </p>
          <button type="button" disabled={busy} onClick={() => void reset()}>
            Nova conversa
          </button>
        </section>
        <section className="studio-conversation panel" aria-label="Conversa">
          <div className="studio-history" role="log" aria-live="polite" aria-relevant="additions">
            {!messages.length && (
              <div className="studio-empty">
                <p className="eyebrow">COMECE POR AQUI</p>
                <h2>O que vamos fazer hoje?</h2>
                <p>Ative a voz ou escreva uma mensagem.</p>
              </div>
            )}
            {messages.map((message) => (
              <article key={message.id} className={`studio-message ${message.role}`}>
                <span>
                  {message.role === "user"
                    ? "Você"
                    : (options.assistants.find((a) => a.id === assistantId)?.name ?? options.name)}
                </span>
                <p>{message.text}</p>
              </article>
            ))}
            {draft && <p>{draft}</p>}
            {busy && (
              <p role="status">
                {phase === "speaking" ? "Resposta em voz…" : "Preparando resposta…"}
              </p>
            )}
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <form
            className="studio-composer"
            onSubmit={(event) => {
              event.preventDefault();
              void send(text);
            }}
          >
            <Field
              label="Mensagem"
              value={text}
              disabled={busy}
              onChange={(value) => setText(String(value))}
              placeholder="Escreva para seu assistente…"
            />
            <button
              className="primary"
              type="submit"
              disabled={busy || !sessionId || !text.trim() || text.length > 4000}
            >
              Enviar
            </button>
          </form>
        </section>
      </div>
    </>
  );
}
