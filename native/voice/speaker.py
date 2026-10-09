"""Local speaker embeddings; no identities, recordings or network access."""

import asyncio
import hashlib
from pathlib import Path
from typing import Any

import numpy as np

MODEL_FILE = "wespeaker_en_voxceleb_resnet34_LM.onnx"
MODEL_SHA256 = "e9848563da86f263117134dfd7ad63c92355b37de492b55e325400c9d9c39012"
MODEL_ID = "wespeaker-resnet34-lm-" + MODEL_SHA256[:16]


class SpeakerEmbedding:
    def __init__(self, directory: Path) -> None:
        self.path = directory / "speaker" / MODEL_FILE
        self.extractor: Any = None

    @property
    def available(self) -> bool:
        return self.path.is_file()

    def compute(self, pcm: bytes) -> dict[str, object]:
        from faster_whisper.vad import VadOptions, get_speech_timestamps

        audio = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768
        result: dict[str, object] = {"model": MODEL_ID, "embedding": None, "speechSeconds": 0.0}
        # Short conversational phrases still contain useful speaker features.
        # Enrollment enforces its longer minimum separately in the application.
        if len(audio) < 6400:
            return {**result, "quality": "too_short"}
        if float(np.mean(np.abs(audio) >= 0.999)) > 0.02:
            return {**result, "quality": "clipped"}
        segments = get_speech_timestamps(
            audio,
            VadOptions(threshold=0.6, min_speech_duration_ms=250, speech_pad_ms=0),
        )
        if not segments:
            return {**result, "quality": "no_speech"}
        voiced = np.concatenate([audio[v["start"] : v["end"]] for v in segments])
        result["speechSeconds"] = round(len(voiced) / 16000, 3)
        if len(voiced) < 6400:
            return {**result, "quality": "too_short"}
        if not np.isfinite(voiced).all() or float(np.sqrt(np.mean(voiced**2))) < 0.003:
            return {**result, "quality": "quiet"}
        if self.extractor is None:
            import sherpa_onnx

            if hashlib.sha256(self.path.read_bytes()).hexdigest() != MODEL_SHA256:
                raise RuntimeError("Speaker model checksum mismatch")
            config = sherpa_onnx.SpeakerEmbeddingExtractorConfig(
                model=str(self.path), num_threads=1, debug=False, provider="cpu"
            )
            if not config.validate():
                raise RuntimeError("Speaker model configuration is invalid")
            self.extractor = sherpa_onnx.SpeakerEmbeddingExtractor(config)
        stream = self.extractor.create_stream()
        stream.accept_waveform(sample_rate=16000, waveform=voiced)
        stream.input_finished()
        if not self.extractor.is_ready(stream):
            return {**result, "quality": "too_short"}
        embedding = np.asarray(self.extractor.compute(stream), dtype=np.float32)
        length = float(np.linalg.norm(embedding))
        if embedding.shape != (256,) or not np.isfinite(embedding).all() or length < 1e-6:
            raise RuntimeError("Speaker model returned an invalid embedding")
        return {**result, "quality": "ready", "embedding": (embedding / length).tolist()}

    async def extract(self, pcm: bytes) -> dict[str, object]:
        # Caller owns the speech engine lock until native inference actually ends.
        task = asyncio.create_task(asyncio.to_thread(self.compute, pcm))
        try:
            return await asyncio.shield(task)
        except asyncio.CancelledError:
            await task
            raise
