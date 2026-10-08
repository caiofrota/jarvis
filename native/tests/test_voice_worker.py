import asyncio

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from voice.app import create_app
from voice.speaker import SpeakerEmbedding


class Engine:
    def __init__(self):
        self.lock = asyncio.Lock()
        self.calls = []

    def available_voices(self):
        return ["fixture-voice"]

    async def synthesize(self, text, voice, quality):
        self.calls.append((text, voice, quality))
        return bytes(640)

    async def has_speech(self, pcm):
        return any(pcm)

    async def transcribe(self, pcm, model, context=""):
        self.calls.append((model, context) if context else model)
        return "bom dia"


def test_private_speech_routes_and_per_request_selection():
    engine = Engine()
    headers = {"authorization": "Bearer fixture-private-token"}
    with TestClient(create_app(engine, "fixture-private-token")) as client:
        assert client.get("/health").status_code == 401
        assert client.get("/health", headers=headers).json()["voices"] == ["fixture-voice"]
        response = client.post(
            "/synthesize",
            headers=headers,
            json={"text": "Olá", "voice": "fixture-voice", "quality": "detailed"},
        )
        assert response.content == bytes(640)
        assert engine.calls[-1] == ("Olá", "fixture-voice", "detailed")
        assert (
            client.post(
                "/synthesize", headers=headers, json={"text": "Olá", "voice": "../other"}
            ).status_code
            == 422
        )
        assert client.post(
            "/transcribe?model=tiny", headers=headers, content=b"\x01\x00" * 320
        ).json() == {"speech": True, "text": "bom dia"}
        assert engine.calls[-1] == "tiny"
        assert (
            client.post(
                "/transcribe",
                params={"context": "Aster, Luz Aurora"},
                headers=headers,
                content=b"\x01\x00" * 320,
            ).status_code
            == 200
        )
        assert engine.calls[-1] == ("base", "Aster, Luz Aurora")
        assert (
            client.post(
                "/transcribe",
                params={"context": "x" * 1001},
                headers=headers,
                content=b"\x01\x00" * 320,
            ).status_code
            == 422
        )
        assert client.post("/transcribe", headers=headers, content=bytes(640)).json() == {
            "speech": False,
            "text": "",
        }
        assert client.post("/transcribe", headers=headers, content=b"x").status_code == 422
        assert client.post("/transcribe", headers=headers, content=bytes(640002)).status_code == 413


def test_segment_rejects_oversized_messages():
    with TestClient(create_app(Engine(), "fixture-private-token")) as client:
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect("/segment"):
                pass
        with client.websocket_connect(
            "/segment", headers={"authorization": "Bearer fixture-private-token"}
        ) as ws:
            ws.send_bytes(bytes(6402))
            with pytest.raises(WebSocketDisconnect):
                ws.receive_bytes()


def test_speaker_embedding_is_private_bounded_and_serialized(monkeypatch):
    engine = Engine()
    headers = {"authorization": "Bearer fixture-private-token"}
    monkeypatch.setattr(SpeakerEmbedding, "available", property(lambda self: True))

    async def extract(self, pcm):
        assert engine.lock.locked()
        assert len(pcm) == 128000
        return {
            "model": "fixture",
            "quality": "ready",
            "speechSeconds": 4,
            "embedding": [0.0] * 256,
        }

    monkeypatch.setattr(SpeakerEmbedding, "extract", extract)
    with TestClient(create_app(engine, "fixture-private-token")) as client:
        assert client.post("/speaker-embedding", content=bytes(128000)).status_code == 401
        assert client.post("/speaker-embedding", headers=headers, content=b"x").status_code == 422
        assert (
            client.post("/speaker-embedding", headers=headers, content=bytes(640002)).status_code
            == 413
        )
        response = client.post("/speaker-embedding", headers=headers, content=bytes(128000))
        assert response.status_code == 200
        assert response.json()["quality"] == "ready"
        assert not engine.lock.locked()
        assert engine.calls == []


def test_speaker_model_absence_is_explicit(monkeypatch):
    monkeypatch.setattr(SpeakerEmbedding, "available", property(lambda self: False))
    headers = {"authorization": "Bearer fixture-private-token"}
    with TestClient(create_app(Engine(), "fixture-private-token")) as client:
        assert client.get("/health", headers=headers).json()["speakerIdentification"] is False
        assert (
            client.post("/speaker-embedding", headers=headers, content=bytes(128000)).status_code
            == 503
        )


def test_decoder_uses_bounded_context_and_beam_search():
    from types import SimpleNamespace
    from unittest.mock import Mock

    from server.speech import Speech

    engine = Speech.__new__(Speech)
    engine.whisper_name = "base"
    engine.whisper = SimpleNamespace(
        transcribe=Mock(return_value=([SimpleNamespace(text=" Aster ")], None))
    )
    assert engine._transcribe(bytes(640), "base", "Aster, Luz Aurora") == "Aster"
    options = engine.whisper.transcribe.call_args.kwargs
    assert options["initial_prompt"] == "Aster, Luz Aurora"
    assert options["beam_size"] == 5
    assert options["language"] == "pt"
    engine._transcribe(bytes(640), "base", "x" * 2000)
    assert len(engine.whisper.transcribe.call_args.kwargs["initial_prompt"]) == 1000
