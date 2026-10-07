import asyncio
import sys
from types import SimpleNamespace

import numpy as np

from server.speech import SUPERTONIC_FILES, Speech
from server.store import Store


def test_complete_local_models_style_switch_and_pcm_contract(tmp_path, monkeypatch):
    speech = Speech(Store(tmp_path / "data"), tmp_path / "models")
    root = speech.model_dir / "supertonic-3"
    (root / "voice_styles").mkdir(parents=True)
    (root / "voice_styles/F1.json").touch()
    assert "supertonic-f1" not in speech.available_voices()
    for name in SUPERTONIC_FILES:
        path = root / name
        path.parent.mkdir(exist_ok=True)
        path.touch()
    assert "supertonic-f1" in speech.available_voices()
    assert "supertonic-m1" not in speech.available_voices()
    (root / "voice_styles/M1.json").touch()
    calls = []
    loads = []

    class TTS:
        sample_rate = 44100

        def __init__(self, **kwargs):
            loads.append(kwargs)
            assert kwargs["auto_download"] is False

        def get_voice_style(self, style):
            return style

        def synthesize(self, text, **kwargs):
            calls.append((text, kwargs))
            wave = 0.2 * np.sin(np.arange(44100) * 2 * np.pi * 440 / 44100)
            return wave.reshape(1, -1).astype(np.float32), np.array([1.0])

    monkeypatch.setitem(sys.modules, "supertonic", SimpleNamespace(TTS=TTS))

    async def run():
        for name in ("supertonic-f1", "supertonic-m1"):
            pcm = await speech.synthesize("Rosie, você está bem?", name)
            assert len(pcm) == 32000
            assert np.abs(np.frombuffer(pcm, dtype="<i2")).max() < 32767
        await speech.synthesize("Rôzi, você está bem?", "supertonic-f1", "detailed")

    asyncio.run(run())
    assert len(loads) == 1
    assert [call[1]["voice_style"] for call in calls] == ["F1", "M1", "F1"]
    assert [call[1]["total_steps"] for call in calls] == [4, 4, 8]
    assert all(call[0] == "Rôzi, você está bem?" for call in calls)
