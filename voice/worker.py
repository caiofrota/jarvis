import base64
import gc
import io
import json
import os
import sys

from pathlib import Path

ROOT = Path(sys.argv[1]).resolve()
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
os.environ["HF_HOME"] = str(ROOT / "cache")

pipeline = None
whispers = {}
KOKORO_VOICES = {
    "alex": "pm_alex",
    "santa": "pm_santa",
    "dora": "pf_dora",
}


def load_voice():
    global pipeline
    if pipeline is not None:
        return pipeline
    from kokoro import KPipeline
    import torch

    # Kokoro is CPU-bound locally. Use the available cores without flooding
    # lower-end machines, and keep inter-op scheduling predictable.
    threads = min(max(2, os.cpu_count() or 4), 8)
    torch.set_num_threads(threads)
    try:
        torch.set_num_interop_threads(1)
    except RuntimeError:
        # PyTorch only allows this setting before its first parallel call.
        pass
    pipeline = KPipeline(lang_code="p")
    return pipeline


def recognition_vocabulary(values):
    if not isinstance(values, list):
        return None
    words = []
    for value in values[:100]:
        if not isinstance(value, str):
            continue
        word = " ".join(value.split())[:100]
        if word and word not in words:
            words.append(word)
    return ", ".join(words)[:1500] or None


def load_whisper():
    name = "whisper-base"
    if name not in whispers:
        from faster_whisper import WhisperModel

        whispers[name] = WhisperModel(
            str(ROOT / name),
            device="cpu",
            compute_type="int8",
            cpu_threads=4,
            num_workers=1,
            local_files_only=True,
        )
    return whispers[name]


def synthesize(text, voice_name, speed):
    import numpy as np
    import soundfile as sf

    chunks = []
    import torch

    with torch.inference_mode():
        for _, _, audio in load_voice()(
            text, voice=KOKORO_VOICES.get(voice_name, "pm_alex"), speed=speed, split_pattern=r"\n+"
        ):
            if hasattr(audio, "detach"):
                audio = audio.detach().cpu().numpy()
            chunks.append(np.asarray(audio, dtype=np.float32))
    if not chunks:
        raise ValueError("O Kokoro não gerou áudio para este texto.")
    output = io.BytesIO()
    sf.write(output, np.concatenate(chunks), 24000, format="WAV", subtype="PCM_16")
    return output.getvalue()


for line in sys.stdin:
    req = {}
    try:
        req = json.loads(line)
        if req["op"] == "warm":
            engine = req.get("engine", "both")
            if engine in ("tts", "both"):
                load_voice()
            if engine in ("stt", "both"):
                load_whisper()
            result = {"ready": True}
        elif req["op"] == "speak":
            audio = synthesize(req["text"], req.get("voice", "alex"), req["speed"])
            result = {"audio": base64.b64encode(audio).decode(), "mime": "audio/wav"}
        elif req["op"] == "transcribe":
            data = io.BytesIO(base64.b64decode(req["audio"], validate=True))
            segments, info = load_whisper().transcribe(
                data,
                language="pt",
                beam_size=3,
                vad_filter=True,
                condition_on_previous_text=False,
                # Share one decoder hint budget: two independently truncated
                # prompts can leave no tokens available for the transcription.
                hotwords=recognition_vocabulary(
                    (req.get("context", []) if isinstance(req.get("context"), list) else [])
                    + (req.get("vocabulary", []) if isinstance(req.get("vocabulary"), list) else [])
                ),
            )
            if info.duration > 65:
                raise ValueError("A gravação deve ter no máximo 60 segundos.")
            decoded = list(segments)
            result = {
                "text": " ".join(s.text.strip() for s in decoded if s.no_speech_prob < 0.8).strip()[:16000],
                # Decoder failure thresholds, not a calibrated confidence percentage.
                "needsReview": any(
                    getattr(s, "avg_logprob", 0) < -1.0
                    or s.no_speech_prob > 0.6
                    or getattr(s, "compression_ratio", 0) > 2.4
                    for s in decoded
                ),
            }
        else:
            raise ValueError("Operação inválida.")
        print(json.dumps({"ok": True, "value": result}, ensure_ascii=True), flush=True)
    except Exception as exc:
        # Drop the heavyweight TTS graph after a failed load so a retry can
        # recover from a transient model or phonemizer error.
        if req.get("op") in ("warm", "speak"):
            pipeline = None
            gc.collect()
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=True), flush=True)
