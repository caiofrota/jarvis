import asyncio

import pytest

from server.speech import Speech
from server.store import Store


@pytest.mark.parametrize("audio_bytes,capacity", [(32, 32), (1024 * 1024, 4)])
def test_repeated_reply_cache_separates_voices_quality_and_stays_bounded(
    tmp_path, monkeypatch, audio_bytes, capacity
):
    speech = Speech(Store(tmp_path / "data"), tmp_path / "models")
    calls = []

    def synthesize(text, voice, quality):
        calls.append((text, voice, quality))
        return bytes(audio_bytes)

    monkeypatch.setattr(speech, "_synthesize", synthesize)

    async def run():
        first = await speech.synthesize("Bom dia!", "voice-a", "fast")
        assert await speech.synthesize("Bom dia!", "voice-a", "fast") is first
        assert len(calls) == 1
        await speech.synthesize("Bom dia!", "voice-b", "fast")
        await speech.synthesize("Bom dia!", "voice-a", "detailed")
        assert len(calls) == 3
        for i in range(34):
            await speech.synthesize(str(i), "voice-a", "fast")
        assert len(speech.audio_cache) == capacity
        assert speech.cache_bytes <= 4 * 1024 * 1024
        count = len(calls)
        await speech.synthesize("Bom dia!", "voice-a", "fast")
        assert len(calls) == count + 1

    asyncio.run(run())


def test_warmup_uses_local_voice_and_stt_without_playback(tmp_path, monkeypatch):
    from unittest.mock import AsyncMock

    speech = Speech(Store(tmp_path / "data"), tmp_path / "models")
    for name, result in (
        ("synthesize", bytes(640)),
        ("has_speech", True),
        ("transcribe", "Bom dia"),
    ):
        monkeypatch.setattr(speech, name, AsyncMock(return_value=result))
    asyncio.run(speech.warmup())
    speech.synthesize.assert_awaited_once_with("Bom dia!")
    speech.has_speech.assert_awaited_once_with(bytes(640))
    speech.transcribe.assert_awaited_once_with(bytes(640))
    assert speech.store.events()[0]["kind"] == "speech_ready"
