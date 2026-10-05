import io
import json
import os
import sys
import wave
from pathlib import Path

ROOT = Path(sys.argv[1]).resolve()
ROOT.mkdir(parents=True, exist_ok=True)
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
os.environ["HF_HUB_DISABLE_XET"] = "1"
os.environ["HF_HOME"] = str(ROOT / "cache")

KOKORO_VOICES = ["pf_dora", "pm_alex", "pm_santa"]


def status(text):
    print(json.dumps({"message": text}), flush=True)


def verify_audio_decoder():
    # Check audio decoding too; PyAV compatibility matters at transcription time.
    from faster_whisper.audio import decode_audio

    sample = io.BytesIO()
    with wave.open(sample, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes(bytes(3200))
    sample.seek(0)
    decode_audio(sample)


status("Baixando Kokoro 82M e vozes brasileiras…")
try:
    from kokoro import KPipeline

    pipeline = KPipeline(lang_code="p")
    for voice in KOKORO_VOICES:
        status("Preparando voz Kokoro: " + voice)
        # Consuming the generator forces the model and selected voice into the
        # configured Hugging Face cache, so runtime can stay offline.
        for _ in pipeline("Jarvis pronto.", voice=voice, speed=1.0, split_pattern=r"\n+"):
            pass
except ModuleNotFoundError as exc:
    raise RuntimeError(
        "A dependência Python do Kokoro não está instalada. "
        "Clique em Tentar instalar novamente para atualizar o ambiente."
    ) from exc
except Exception as exc:
    raise RuntimeError(
        "O Kokoro não conseguiu iniciar. Verifique o suporte de fonemização espeak-ng "
        "e tente novamente. Detalhe: " + str(exc)
    ) from exc

status("Baixando Whisper base multilíngue (cerca de 150 MB)…")


def download_whisper():
    from huggingface_hub import snapshot_download

    snapshot_download(
        "Systran/faster-whisper-base",
        local_dir=str(ROOT / "whisper-base"),
        allow_patterns=["config.json", "model.bin", "tokenizer.json", "vocabulary.*"],
    )


download_whisper()

status("Verificando os modelos locais…")


def verify_whisper():
    from faster_whisper import WhisperModel

    WhisperModel(
        str(ROOT / "whisper-base"), device="cpu", compute_type="int8", cpu_threads=4, local_files_only=True
    )


verify_whisper()
verify_audio_decoder()
status("Preparando o wakeword local JARVIS…")
try:
    from openwakeword.utils import download_models

    wake_root = ROOT / "wake-models"
    download_models(model_names=["hey_jarvis"], target_directory=str(wake_root))
    required = ["melspectrogram.onnx", "embedding_model.onnx", "hey_jarvis_v0.1.onnx"]
    missing = [name for name in required if not (wake_root / name).exists()]
    if missing:
        raise RuntimeError("Modelos ausentes: " + ", ".join(missing))
except Exception as exc:
    raise RuntimeError("Não foi possível preparar o wakeword local JARVIS. Detalhe: " + str(exc)) from exc
(ROOT / "kokoro.ready.json").write_text(
    json.dumps(
        {
            "engine": "kokoro",
            "voices": KOKORO_VOICES,
            "whisper": "base",
            "wakeword": "hey_jarvis",
            "version": 4,
        }
    ),
    encoding="utf-8",
)
(ROOT / "wakeword.ready.json").write_text(json.dumps({"model": "hey_jarvis", "version": 1}), encoding="utf-8")
status("Kokoro e reconhecimento local prontos. Sem cobrança por uso.")
