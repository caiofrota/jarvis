"use client";
import type { CompanionComputerOffer } from "@rosie/types";
import { useEffect, useRef, useState } from "react";
import { AudioOutput } from "../../../../../features/voice/audio-output";
import { type CaptureSession, capture } from "../../../../../features/voice/local-capture";
import type { OrbPhase } from "../../../../../features/voice/orb/scene";
import { SpeechPipeline } from "../../../../../features/voice/speech-pipeline";
import { type Option, request } from "../../lib/api-client";
import { executeComputerRequest, readComputerCatalog } from "./computer-client";

type Message = { id: number; role: "user" | "assistant"; text: string };
type Options = { name: string; assistants: Option[]; areas: Option[] };
export function useCompanionConversation() {
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
  const [awaitingComputer, setAwaitingComputer] = useState(false);
  const computerPending = useRef(false);
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
    if (computerPending.current) void window.jarvisCompanionWindows?.cancelAction();
    setAwaitingComputer(false);
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
      if (computerPending.current) void window.jarvisCompanionWindows?.cancelAction();
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
      const computer = await readComputerCatalog().catch(() => undefined);
      if (epoch.current !== version) return;
      let reply = await request<{
        text: string;
        voice: string;
        tasksChanged?: boolean;
        computerAction?: CompanionComputerOffer;
      }>("/companion/message", {
        method: "POST",
        body: JSON.stringify({ ...selection(), text: phrase, computer }),
        signal: abort.signal,
      });
      if (epoch.current !== version) return;
      if (reply.computerAction) {
        const offer = reply.computerAction;
        computerPending.current = true;
        setAwaitingComputer(true);
        let status: "sent" | "cancelled" | "failed";
        try {
          status = await executeComputerRequest(offer, () => epoch.current === version);
        } finally {
          computerPending.current = false;
          setAwaitingComputer(false);
        }
        if (epoch.current !== version) return;
        try {
          reply = await request<{ text: string; voice: string }>("/companion/computer-result", {
            method: "POST",
            body: JSON.stringify({
              ...selection(),
              requestId: offer.requestId,
              clientId: offer.clientId,
              status,
            }),
            signal: abort.signal,
          });
        } catch {
          reply = {
            text:
              status === "sent"
                ? "O pedido de abertura foi enviado ao sistema, mas não consegui registrar o recibo no servidor."
                : status === "cancelled"
                  ? "A abertura foi cancelada."
                  : "Não consegui confirmar a abertura. Não vou repetir automaticamente.",
            voice: reply.voice,
          };
        }
        if (epoch.current !== version) return;
      }
      if (reply.tasksChanged) window.dispatchEvent(new Event("jarvis-personal-tasks-changed"));
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
                body: JSON.stringify({
                  ...selection(),
                  audio: input.audio,
                  computer: await readComputerCatalog().catch(() => undefined),
                }),
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
  return {
    options,
    awaitingComputer,
    sessionId,
    assistantId,
    areaId,
    messages,
    text,
    draft,
    phase,
    active,
    busy,
    error,
    setText,
    setAssistantId,
    setAreaId,
    setMessages,
    send,
    start,
    stop,
    interrupt,
    reset,
    visualFrame: () => output.current?.visualFrame() ?? { level: 0, bass: 0, mid: 0, high: 0 },
  };
}
