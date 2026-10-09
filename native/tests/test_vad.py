import wave
from pathlib import Path

import numpy as np
import pytest

from server import audio_codec
from server.speech import Speech, Utterance


def pcm(samples):
    return np.clip(samples * 32767, -32768, 32767).astype("<i2").tobytes()


@pytest.mark.parametrize("sound", ["horn", "hum", "keys", "hiss", "silence"])
def test_non_speech_candidates_are_rejected_by_local_confirmation(sound):
    rate = 16000
    t = np.arange(rate * 3) / rate
    rng = np.random.default_rng(42)
    samples = np.zeros(len(t))
    if sound == "horn":
        samples = 0.15 * (np.sin(2 * np.pi * 370 * t) + np.sin(2 * np.pi * 493 * t))
    elif sound == "hum":
        samples = 0.12 * np.sin(2 * np.pi * 60 * t)
    elif sound == "keys":
        for pos in range(2000, len(t) - 1600, 6400):
            samples[pos : pos + 800] = rng.normal(0, 0.15, 800) * np.exp(-np.arange(800) / 130)
    elif sound == "hiss":
        samples = rng.normal(0, 0.035, len(t))
    data = pcm(np.concatenate([samples, np.zeros(rate)]))
    detector = Utterance()
    candidates = []
    for offset in range(0, len(data), 640):
        if candidate := detector.feed(data[offset : offset + 640]):
            candidates.append(candidate)
    if sound in ("horn", "hum", "keys"):
        assert candidates, "Regression fixture must trigger the original coarse detector"
    assert not Speech._has_speech(data)
    assert all(not Speech._has_speech(candidate) for candidate in candidates)


@pytest.mark.parametrize("gain", [1, 0.08])
def test_actual_local_speech_is_kept_even_quiet_and_after_device_codec(gain):
    with wave.open(str(Path(__file__).parent / "fixtures/local-greeting.wav")) as source:
        assert source.getframerate() == 16000
        data = source.readframes(source.getnframes())
    samples = np.frombuffer(data, dtype="<i2").astype(np.float32) / 32768
    data = pcm(np.concatenate([samples * gain, np.zeros(16000)]))
    detector = Utterance()
    candidates = []
    state = (0, 0)
    for offset in range(0, len(data), 640):
        packet, state = audio_codec.encode(data[offset : offset + 640], state)
        if candidate := detector.feed(audio_codec.decode(packet)):
            candidates.append(candidate)
    assert len(candidates) == 1
    assert Speech._has_speech(candidates[0])
