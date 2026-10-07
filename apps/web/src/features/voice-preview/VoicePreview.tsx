"use client";
import { useEffect, useRef, useState } from "react";
export function VoicePreview({
  assistantId,
  name,
  voice,
}: {
  assistantId: string;
  name: string;
  voice?: string;
}) {
  const [audio, setAudio] = useState<{ sound: string; caption: string }>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const transcript = `Bom dia! Eu sou ${name}. Você quer conversar comigo?`;
  const pending = useRef<AbortController | null>(null);
  useEffect(() => {
    return () => {
      pending.current?.abort();
      pending.current = null;
    };
  }, []);
  useEffect(
    () => () => {
      if (audio) {
        URL.revokeObjectURL(audio.sound);
        URL.revokeObjectURL(audio.caption);
      }
    },
    [audio],
  );
  return (
    <div className="voice-preview">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          const abort = new AbortController();
          pending.current = abort;
          try {
            const response = await fetch("/api/v1/voice-preview", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ assistantId, voice }),
              signal: abort.signal,
            });
            if (!response.ok) throw new Error((await response.json()).error);
            const blob = await response.blob();
            abort.signal.throwIfAborted();
            setAudio({
              sound: URL.createObjectURL(blob),
              caption: URL.createObjectURL(
                new Blob([`WEBVTT\n\n00:00:00.000 --> 00:02:59.000\n${transcript}\n`], {
                  type: "text/vtt",
                }),
              ),
            });
          } catch (e) {
            if (!abort.signal.aborted) setError((e as Error).message);
          } finally {
            if (pending.current === abort) {
              pending.current = null;
              setBusy(false);
            }
          }
        }}
      >
        {busy ? "Preparando amostra…" : "Ouvir no navegador"}
      </button>
      <p className="field-hint">{transcript}</p>
      {audio && (
        <audio src={audio.sound} autoPlay controls>
          <track kind="captions" src={audio.caption} srcLang="pt-BR" label="Português" />
        </audio>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
