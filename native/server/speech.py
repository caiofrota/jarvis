"""CPU speech engines. No microphone data is sent to a cloud STT provider."""

import asyncio
import json
import re
import time
from collections import OrderedDict
from math import gcd
from pathlib import Path

import numpy as np
import webrtcvad
from scipy.signal import resample_poly

PRONUNCIATIONS = {
    "rosie": "Rôzi",
    "alexa": "Aléksa",
    "celsius": "Célsius",
    "latam": "Latâm",
}
PRONUNCIATION_WORDS = re.compile(
    r"\b(?:" + "|".join(re.escape(word) for word in PRONUNCIATIONS) + r")\b", re.IGNORECASE
)
VOICE_TEST_TEXT = "Bom dia! Eu sou a Rosie. Você quer conversar comigo?"
KOKORO_VOICE = "kokoro-pf_dora"
SUPERTONIC_VOICES = {"supertonic-f1": "F1", "supertonic-m1": "M1"}
SUPERTONIC_FILES = (
    "onnx/duration_predictor.onnx",
    "onnx/text_encoder.onnx",
    "onnx/vector_estimator.onnx",
    "onnx/vocoder.onnx",
    "onnx/tts.json",
    "onnx/unicode_indexer.json",
)


def spoken_text(text: str) -> str:
    # Emphasis belongs to visual text, not to the synthesized utterance.
    text = re.sub(
        r"(?<![\w\\])(\*{1,3}|_{1,3})(?=\S)(.*?\S)\1(?!\w)",
        r"\2",
        text,
        flags=re.DOTALL,
    )
    text = re.sub(r"(?<!`)`([^`\n]+)`(?!`)", r"\1", text)
    # Apply pronunciation overrides only at synthesis time, preserving displayed text.
    return PRONUNCIATION_WORDS.sub(lambda match: PRONUNCIATIONS[match[0].lower()], text)


def kokoro_phonemes(text, g2p):
    phonemes, _ = g2p(spoken_text(text))
    # Misaki maps pt-BR /eɪ/ to the shared A token. Dora's word-final stressed
    # rendering is unclear; explicit /ei/ preserves the intended ending without
    # changing nasal vowels (bem/também), internal syllables or displayed text.
    return re.sub(r"ˈA(?=$|[\s.,;:!?…\"”’)\]])", "ˈei", phonemes)


def pronunciation_phonemes(sentences):
    # Correct "dia" without consuming punctuation or merging sentences, which
    # inline phoneme markup next to a sentence terminator can do in Piper.
    expected = list("dʒˈiʲɐ")
    result = []
    for sentence in sentences:
        corrected, i = [], 0
        while i < len(sentence):
            if sentence[i : i + len(expected)] == expected:
                corrected.extend("dʒˈiɐ")
                i += len(expected)
            else:
                corrected.append(sentence[i])
                i += 1
        result.append(corrected)
    return result


class Utterance:
    def __init__(self) -> None:
        self.vad = webrtcvad.Vad(2)
        self.clear()

    def clear(self) -> None:
        self.audio = bytearray()
        self.pending = bytearray()
        self.pre_roll = bytearray()
        self.voiced = 0
        self.silent = 0

    def feed(self, data: bytes) -> bytes | None:
        self.pending.extend(data)
        finished = None
        while len(self.pending) >= 640:
            frame = bytes(self.pending[:640])
            del self.pending[:640]
            speech = self.vad.is_speech(frame, 16000)
            if not self.voiced:
                self.pre_roll.extend(frame)
                self.pre_roll = self.pre_roll[-9600:]
                if speech:
                    self.audio.extend(self.pre_roll)
                    self.pre_roll.clear()
            else:
                self.audio.extend(frame)
            if speech:
                self.voiced += 1
                self.silent = 0
            elif self.voiced:
                self.silent += 1
            if self.voiced and (self.silent >= 40 or len(self.audio) >= 16000 * 2 * 20):
                if self.voiced >= 8:
                    finished = bytes(self.audio)
                self.clear()
                break
        return finished


class Speech:
    def __init__(self, store, model_dir: Path):
        self.store, self.model_dir = store, model_dir
        self.whisper = None
        self.whisper_name = None
        self.voice = None
        self.voice_name = None
        self.lock = asyncio.Lock()
        self.audio_cache = OrderedDict()
        self.cache_bytes = 0

    async def warmup(self):
        started = time.monotonic()
        try:
            # Exercise the same local inference paths, without speaking or an LLM call.
            audio = await self.synthesize("Bom dia!")
            await self.has_speech(audio)
            await self.transcribe(audio)
            self.store.event("speech_ready", {"seconds": round(time.monotonic() - started, 2)})
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            self.store.event("speech_warmup_error", {"kind": type(exc).__name__})

    @staticmethod
    def _has_speech(pcm):
        from faster_whisper.vad import VadOptions, get_speech_timestamps

        # WebRTC proposes segments cheaply; confirm speech before running STT.
        # This model ships with faster-whisper and runs locally on one CPU thread.
        audio = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768
        if not len(audio):
            return False
        return bool(
            get_speech_timestamps(
                audio,
                VadOptions(
                    threshold=0.6,
                    min_speech_duration_ms=200,
                    min_silence_duration_ms=300,
                    speech_pad_ms=0,
                ),
            )
        )

    async def has_speech(self, pcm):
        async with self.lock:
            return await self._run(self._has_speech, pcm)

    def _transcribe(self, pcm, name=None, context=""):
        from faster_whisper import WhisperModel

        name = name or self.store.catalog.settings.stt_model
        if self.whisper_name != name:
            self.whisper = WhisperModel(
                name,
                device="cpu",
                compute_type="int8",
                cpu_threads=2,
                num_workers=1,
                download_root=str(self.model_dir / "whisper"),
            )
            self.whisper_name = name
        audio = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768
        segments, _ = self.whisper.transcribe(
            audio,
            language="pt",
            beam_size=5,
            condition_on_previous_text=False,
            vad_filter=False,
            initial_prompt=context[:1000] or None,
        )
        return " ".join(s.text.strip() for s in segments).strip()

    async def transcribe(self, pcm, model=None, context=""):
        async with self.lock:
            if model is None and not context:
                return await self._run(self._transcribe, pcm)
            return await self._run(self._transcribe, pcm, model, context)

    def available_voices(self):
        directory = (self.model_dir / "piper").resolve()
        voices = sorted(
            path.stem
            for path in directory.glob("*.onnx")
            if re.fullmatch(r"[A-Za-z0-9_-]{1,100}", path.stem)
            and path.resolve().parent == directory
            and path.with_suffix(".onnx.json").is_file()
            and path.with_suffix(".onnx.json").resolve().parent == directory
        )
        kokoro = self.model_dir / "kokoro"
        if all((kokoro / name).is_file() for name in ("kokoro-v1.0.onnx", "voices-v1.0.bin")):
            voices.append(KOKORO_VOICE)
        supertonic = self.model_dir / "supertonic-3"
        if all((supertonic / name).is_file() for name in SUPERTONIC_FILES):
            voices.extend(
                name
                for name, style in SUPERTONIC_VOICES.items()
                if (supertonic / "voice_styles" / (style + ".json")).is_file()
            )
        return voices

    def _synthesize(self, text, name=None, quality=None):
        name = name or self.store.catalog.settings.tts_voice
        if name not in self.available_voices():
            raise ValueError("Baixe a voz indicada no painel antes do teste.")
        if name == KOKORO_VOICE:
            return self._synthesize_kokoro(text)
        if name in SUPERTONIC_VOICES:
            return self._synthesize_supertonic(
                text, name, quality or self.store.catalog.settings.tts_quality
            )

        import onnxruntime
        from piper import PiperVoice
        from piper.config import PiperConfig

        class BrazilianVoice(PiperVoice):
            def phonemize(self, text):
                sentences = super().phonemize(text)
                return (
                    pronunciation_phonemes(sentences)
                    if self.config.espeak_voice == "pt-br"
                    else sentences
                )

        if self.voice_name != name:
            path = self.model_dir / "piper" / (name + ".onnx")
            # Keep one voice resident on the shared CPU server.
            self.voice = None
            self.voice_name = None
            options = onnxruntime.SessionOptions()
            options.intra_op_num_threads = 2
            options.inter_op_num_threads = 1
            self.voice = BrazilianVoice(
                config=PiperConfig.from_dict(
                    json.loads(path.with_suffix(".onnx.json").read_text())
                ),
                session=onnxruntime.InferenceSession(
                    str(path), sess_options=options, providers=["CPUExecutionProvider"]
                ),
            )
            self.voice_name = name
        chunks = []
        for chunk in self.voice.synthesize(spoken_text(text[:2500])):
            samples = np.frombuffer(chunk.audio_int16_bytes, dtype="<i2").astype(np.float32)
            if chunk.sample_rate != 16000:
                divisor = gcd(chunk.sample_rate, 16000)
                samples = resample_poly(samples, 16000 // divisor, chunk.sample_rate // divisor)
            chunks.append(np.clip(samples, -32768, 32767).astype("<i2").tobytes())
        return b"".join(chunks)

    def _synthesize_kokoro(self, text):
        import onnxruntime
        from kokoro_onnx import Kokoro
        from misaki.espeak import EspeakG2P

        if self.voice_name != KOKORO_VOICE:
            self.voice = None
            self.voice_name = None
            path = self.model_dir / "kokoro"
            options = onnxruntime.SessionOptions()
            options.intra_op_num_threads = 2
            options.inter_op_num_threads = 1
            options.execution_mode = onnxruntime.ExecutionMode.ORT_SEQUENTIAL
            self.voice = Kokoro.from_session(
                onnxruntime.InferenceSession(
                    str(path / "kokoro-v1.0.onnx"),
                    sess_options=options,
                    providers=["CPUExecutionProvider"],
                ),
                str(path / "voices-v1.0.bin"),
            )
            self.g2p = EspeakG2P(language="pt-br")
            self.voice_name = KOKORO_VOICE
        phonemes = kokoro_phonemes(text[:2500], self.g2p)
        samples, rate = self.voice.create(phonemes, "pf_dora", is_phonemes=True)
        return self._pcm16(samples, rate)

    def _synthesize_supertonic(self, text, name, quality):
        from supertonic import TTS

        if self.voice_name != "supertonic-3":
            self.voice = None
            self.voice_name = None
            self.voice = TTS(
                model="supertonic-3",
                model_dir=str(self.model_dir / "supertonic-3"),
                auto_download=False,
                intra_op_num_threads=2,
                inter_op_num_threads=1,
            )
            self.voice_name = "supertonic-3"
        samples, _ = self.voice.synthesize(
            spoken_text(text[:2500]),
            voice_style=self.voice.get_voice_style(SUPERTONIC_VOICES[name]),
            lang="pt",
            total_steps=8 if quality == "detailed" else 4,
            speed=1.0,
        )
        return self._pcm16(samples.reshape(-1), self.voice.sample_rate)

    @staticmethod
    def _pcm16(samples, rate):
        divisor = gcd(rate, 16000)
        samples = resample_poly(samples, 16000 // divisor, rate // divisor)
        if not np.all(np.isfinite(samples)):
            raise ValueError("Invalid speech samples")
        # Piper normalizes its output. Match its useful level for comparisons,
        # with a bounded gain so a nearly silent result is not boosted excessively.
        peak = float(np.max(np.abs(samples), initial=0))
        if peak:
            samples *= min(4.0, 0.95 / peak)
        return np.clip(samples * 32767, -32768, 32767).astype("<i2").tobytes()

    async def synthesize(self, text, voice=None, quality=None):
        async with self.lock:
            voice = voice or self.store.catalog.settings.tts_voice
            quality = quality or self.store.catalog.settings.tts_quality
            key = (voice, quality, text)
            if key in self.audio_cache:
                self.audio_cache.move_to_end(key)
                return self.audio_cache[key]
            audio = await self._run(self._synthesize, text, voice, quality)
            # Repeated short replies need no new inference. Keep only a bounded
            # in-memory cache; no spoken text or recordings are written to disk.
            if len(audio) <= 1024 * 1024:
                self.audio_cache[key] = audio
                self.cache_bytes += len(audio)
                while len(self.audio_cache) > 32 or self.cache_bytes > 4 * 1024 * 1024:
                    _, expired = self.audio_cache.popitem(last=False)
                    self.cache_bytes -= len(expired)
            return audio

    @staticmethod
    async def _run(function, *args):
        # A cancelled conversation must not release the model lock while its
        # native inference thread is still running.
        task = asyncio.create_task(asyncio.to_thread(function, *args))
        try:
            return await asyncio.shield(task)
        except asyncio.CancelledError:
            await task
            raise
