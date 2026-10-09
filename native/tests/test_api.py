import asyncio
import base64
import io
import wave

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect


def test_admin_auth_and_secret_redaction(tmp_path, monkeypatch):
    monkeypatch.setenv("ROSIE_DATA", str(tmp_path))
    from server import app as module
    from server.automation import Automations
    from server.catalog import Catalog
    from server.store import Store

    store = Store(tmp_path)
    store.save(
        Catalog.model_validate(
            {
                "settings": {
                    "api_key": "private-fixture-key",
                    "mqtt_password": "private-fixture-password",
                }
            }
        )
    )
    monkeypatch.setattr(module, "store", store)
    monkeypatch.setattr(module, "automations", Automations(store))
    with TestClient(module.app) as client:
        assert client.get("/api/config").status_code == 401
        headers = {
            "Authorization": "Basic "
            + base64.b64encode(("admin:" + store.admin_token).encode()).decode()
        }
        response = client.get("/api/config", headers=headers)
        assert response.status_code == 200
        assert "private-fixture" not in response.text
        assert response.json()["credentials"]["api_key"]
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect("/ws/robot/missing") as websocket:
                websocket.receive_json()


def test_voice_preview_only_uses_installed_models_and_preserves_selection(tmp_path, monkeypatch):
    from server import app as module
    from server.automation import Automations
    from server.speech import VOICE_TEST_TEXT, Speech
    from server.store import Store

    store = Store(tmp_path / "data")
    speech = Speech(store, tmp_path / "models")
    voices = speech.model_dir / "piper"
    voices.mkdir(parents=True)
    for name in ("pt_BR-faber-medium", "pt_BR-cadu-medium"):
        (voices / (name + ".onnx")).touch()
        (voices / (name + ".onnx.json")).write_text("{}")
    (voices / "incomplete.onnx").touch()
    outside = tmp_path / "private.onnx"
    outside.touch()
    (voices / "linked.onnx").symlink_to(outside)
    (voices / "linked.onnx.json").write_text("{}")
    kokoro = speech.model_dir / "kokoro"
    kokoro.mkdir()
    (kokoro / "kokoro-v1.0.onnx").touch()
    calls = []
    pcm = b"\x01\x00" * 320

    def synthesize(text, name, quality):
        calls.append((text, name))
        return pcm

    monkeypatch.setattr(speech, "_synthesize", synthesize)
    monkeypatch.setattr(module, "store", store)
    monkeypatch.setattr(module, "speech", speech)
    monkeypatch.setattr(module, "automations", Automations(store))
    monkeypatch.setattr(module, "work_lock", asyncio.Lock())
    headers = {
        "Authorization": "Basic "
        + base64.b64encode(("admin:" + store.admin_token).encode()).decode()
    }
    original = store.catalog.settings.tts_voice
    with TestClient(module.app) as client:
        assert client.get("/api/voices").status_code == 401
        assert client.post("/api/voice_preview?voice=pt_BR-cadu-medium").status_code == 401
        assert client.get("/api/voices", headers=headers).json()["voices"] == [
            "pt_BR-cadu-medium",
            "pt_BR-faber-medium",
        ]
        (kokoro / "voices-v1.0.bin").touch()
        assert "kokoro-pf_dora" in client.get("/api/voices", headers=headers).json()["voices"]
        for name, code in (("missing", 404), ("linked", 404), ("../private", 422)):
            response = client.post("/api/voice_preview", params={"voice": name}, headers=headers)
            assert response.status_code == code
        assert not calls
        response = client.post("/api/voice_preview?voice=pt_BR-cadu-medium", headers=headers)
        assert response.status_code == 200
        assert response.headers["content-type"] == "audio/wav"
        with wave.open(io.BytesIO(response.content), "rb") as wav:
            assert (wav.getnchannels(), wav.getsampwidth(), wav.getframerate()) == (1, 2, 16000)
            assert wav.readframes(wav.getnframes()) == pcm
        assert calls == [(VOICE_TEST_TEXT, "pt_BR-cadu-medium")]
        response = client.post("/api/voice_preview?voice=kokoro-pf_dora", headers=headers)
        assert response.status_code == 200
        assert calls[-1] == (VOICE_TEST_TEXT, "kokoro-pf_dora")
        assert store.catalog.settings.tts_voice == original
