import asyncio
import threading
from pathlib import Path

import numpy as np
import pytest

from voice.speaker import SpeakerEmbedding


def test_short_clipped_and_silent_audio_never_loads_the_model(tmp_path, monkeypatch):
    speaker = SpeakerEmbedding(tmp_path)
    assert speaker.compute(bytes(8000))["quality"] == "too_short"
    assert speaker.compute(np.full(48000, 32767, dtype="<i2").tobytes())["quality"] == "clipped"
    monkeypatch.setattr("faster_whisper.vad.get_speech_timestamps", lambda *args: [])
    assert speaker.compute(bytes(128000))["quality"] == "no_speech"
    assert speaker.extractor is None


def test_short_voiced_utterance_reaches_the_encoder_without_padding(tmp_path, monkeypatch):
    class Stream:
        def accept_waveform(self, sample_rate, waveform):
            assert sample_rate == 16000
            assert len(waveform) == 11200

        def input_finished(self):
            pass

    class Encoder:
        def create_stream(self):
            return Stream()

        def is_ready(self, stream):
            return True

        def compute(self, stream):
            return np.ones(256, dtype=np.float32)

    speaker = SpeakerEmbedding(tmp_path)
    speaker.extractor = Encoder()
    monkeypatch.setattr(
        "faster_whisper.vad.get_speech_timestamps",
        lambda *args: [{"start": 1600, "end": 12800}],
    )
    pcm = np.full(14400, 5000, dtype="<i2").tobytes()
    result = speaker.compute(pcm)
    assert result["quality"] == "ready"
    assert result["speechSeconds"] == 0.7
    assert np.linalg.norm(result["embedding"]) == pytest.approx(1)


def test_cancellation_waits_for_native_inference_before_releasing_capacity():
    async def check():
        started, release = threading.Event(), threading.Event()
        speaker = SpeakerEmbedding(Path("/not-used"))

        def compute(pcm):
            started.set()
            release.wait(5)
            return {}

        speaker.compute = compute
        task = asyncio.create_task(speaker.extract(b""))
        await asyncio.to_thread(started.wait, 2)
        task.cancel()
        await asyncio.sleep(0.01)
        assert not task.done()
        release.set()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(check())
