import asyncio
import time
from types import SimpleNamespace

import pytest

from server import audio_codec
from server.app import Session
from server.reply import Reply


@pytest.mark.parametrize("codec", ["pcm_s16le", "ima_adpcm"])
def test_playback_applies_backpressure_and_waits_for_device_completion(monkeypatch, codec):
    from server import app as module

    monkeypatch.setattr(module, "store", SimpleNamespace(event=lambda *args: None))

    async def run():
        class Socket:
            def __init__(self):
                self.messages = []
                self.frames = []

            async def send_json(self, value):
                self.messages.append(value)

            async def send_bytes(self, value):
                self.frames.append(value)

        ws = Socket()
        session = Session(ws, "fixture")
        session.audio_codec = codec

        def decoded_frames():
            return [
                audio_codec.decode(frame) if codec == "ima_adpcm" else frame for frame in ws.frames
            ]

        pcm = bytes(32000)
        task = asyncio.create_task(session.play(pcm))
        await asyncio.sleep(0.02)
        assert sum(map(len, decoded_frames())) == 20480
        if codec == "ima_adpcm":
            assert sum(map(len, ws.frames)) < 6000
        assert not task.done()
        session.played = 20480
        session.ack.set()
        await asyncio.sleep(0.02)
        assert b"".join(decoded_frames()) == pcm
        assert ws.messages[-1]["type"] == "play_end"
        assert not task.done()
        session.done.set()
        await task

    asyncio.run(run())


def test_batched_playback_survives_delayed_credit_and_keeps_short_tail(monkeypatch):
    from server import app as module

    monkeypatch.setattr(module, "store", SimpleNamespace(event=lambda *args: None))

    async def run():
        class Socket:
            def __init__(self):
                self.frames = []
                self.messages = []

            async def send_json(self, value):
                self.messages.append(value)

            async def send_bytes(self, value):
                self.frames.append(value)

        ws = Socket()
        session = Session(ws, "fixture")
        session.audio_codec = "ima_adpcm"
        session.audio_batch_frames = 5
        session.playback_window = 76800
        pcm = bytes(96018)
        task = asyncio.create_task(session.play(pcm))
        await asyncio.sleep(0.02)
        assert len(ws.frames) == 24
        assert sum(len(audio_codec.decode_batch(f)) for f in ws.frames) == 76800
        # Only enough credit for two whole batches: never exceed device storage.
        session.played = 7040
        session.ack.set()
        await asyncio.sleep(0.02)
        assert len(ws.frames) == 26
        assert not task.done()
        session.played = 76800
        session.ack.set()
        await asyncio.sleep(0.02)
        assert b"".join(audio_codec.decode_batch(f) for f in ws.frames) == pcm
        assert ws.messages[-1]["type"] == "play_end"
        assert not task.done()
        session.done.set()
        await task

    asyncio.run(run())


def test_timeout_preserves_in_progress_speech_before_idle_rest(monkeypatch):
    from server import app as module

    monkeypatch.setattr(
        module,
        "store",
        SimpleNamespace(
            catalog=SimpleNamespace(settings=SimpleNamespace(listen_seconds=30, drowsy_seconds=0)),
            event=lambda *args: None,
        ),
    )
    monkeypatch.setattr(module, "conversation", SimpleNamespace(reset=lambda robot: None))

    async def run():
        class Socket:
            async def send_json(self, value):
                pass

        session = Session(Socket(), "fixture")
        session.state = "listening"
        session.deadline = time.monotonic() + 4
        await session.update_attention()
        assert session.state == "listening"
        session.utterance.voiced = 1
        session.deadline = time.monotonic() - 1
        await session.update_attention()
        assert session.state == "listening"
        session.utterance.voiced = 0
        await session.update_attention()
        assert session.state == "idle"

    asyncio.run(run())


def test_followup_window_starts_only_after_playback_finishes(monkeypatch):
    from server import app as module

    async def run():
        released = asyncio.Event()
        speaking = asyncio.Event()

        class Socket:
            def __init__(self):
                self.states = []

            async def send_json(self, value):
                self.states.append(value)
                if value.get("state") == "speaking":
                    speaking.set()

        class Speech:
            async def has_speech(self, pcm):
                return True

            async def transcribe(self, pcm):
                return "bom dia"

            async def synthesize(self, text):
                assert text == "Bom dia!"
                return bytes(640)

        class Conversation:
            async def respond(self, robot, text):
                return Reply(text="Bom dia!", expression="happy")

        monkeypatch.setattr(module, "speech", Speech())
        monkeypatch.setattr(module, "conversation", Conversation())
        monkeypatch.setattr(module, "work_lock", asyncio.Lock())
        monkeypatch.setattr(
            module,
            "store",
            SimpleNamespace(
                catalog=SimpleNamespace(
                    settings=SimpleNamespace(listen_seconds=30, tts_voice="fixture")
                ),
                event=lambda *args: None,
            ),
        )
        session = Session(Socket(), "fixture")

        async def playback(pcm):
            await released.wait()

        session.play = playback
        task = asyncio.create_task(session.answer(bytes(640)))
        await asyncio.wait_for(speaking.wait(), 1)
        assert session.deadline == 0
        assert session.ws.states[-1] == {
            "type": "state",
            "state": "speaking",
            "expression": "happy",
            "sleep_now": False,
        }
        released.set()
        await task
        assert session.state == "listening"
        assert session.ws.states[-1]["expression"] == "neutral"
        assert 29 < session.deadline - time.monotonic() <= 30

    asyncio.run(run())


@pytest.fixture
def voice_session(monkeypatch):
    from unittest.mock import AsyncMock, Mock

    from server import app as module

    engine = SimpleNamespace(
        has_speech=AsyncMock(return_value=True),
        transcribe=AsyncMock(return_value=""),
        synthesize=AsyncMock(return_value=bytes(640)),
    )
    agent = SimpleNamespace(reset=Mock(), respond=AsyncMock(return_value=Reply.plain("Bom dia!")))
    monkeypatch.setattr(module, "speech", engine)
    monkeypatch.setattr(module, "conversation", agent)
    monkeypatch.setattr(module, "work_lock", asyncio.Lock())
    monkeypatch.setattr(
        module,
        "store",
        SimpleNamespace(
            catalog=SimpleNamespace(
                settings=SimpleNamespace(listen_seconds=30, drowsy_seconds=10, tts_voice="fixture")
            ),
            event=Mock(),
        ),
    )
    session = Session(SimpleNamespace(send_json=AsyncMock()), "fixture")
    session.play = AsyncMock()
    session.state = "listening"
    session.deadline = time.monotonic() + 30
    return session, engine, agent


def test_rejected_noise_never_thinks_transcribes_or_extends_attention(voice_session):
    session, speech, conversation = voice_session
    speech.has_speech.return_value = False
    deadline = session.deadline
    asyncio.run(session.answer(bytes(640)))
    assert session.state == "listening"
    assert session.deadline == deadline
    assert session.misunderstandings == 0
    speech.transcribe.assert_not_awaited()
    speech.synthesize.assert_not_awaited()
    conversation.respond.assert_not_awaited()
    assert all(c.args[0].get("state") != "thinking" for c in session.ws.send_json.call_args_list)
    session.deadline = time.monotonic() - 1
    asyncio.run(session.answer(bytes(640)))
    assert session.state == "idle"


def test_two_empty_transcriptions_sleep_without_repeated_prompt_or_timer_renewal(voice_session):
    session, speech, conversation = voice_session

    async def run():
        deadline = session.deadline
        await session.answer(bytes(640))
        assert session.state == "listening"
        assert session.deadline == deadline
        assert session.misunderstandings == 1
        await session.answer(bytes(640))
        assert session.state == "idle"
        assert session.ws.send_json.call_args.args[0]["sleep_now"] is True
        speech.synthesize.assert_awaited_once_with("Não entendi. Pode repetir?")
        conversation.respond.assert_not_awaited()
        conversation.reset.assert_called_once_with("fixture")
        await session.listen(new=True)
        assert session.misunderstandings == 0

    asyncio.run(run())


def test_understood_speech_resets_consecutive_misses(voice_session):
    session, speech, _ = voice_session

    async def run():
        await session.answer(bytes(640))
        assert session.misunderstandings == 1
        speech.transcribe.return_value = "bom dia"
        await session.answer(bytes(640))
        assert session.misunderstandings == 0
        speech.transcribe.return_value = ""
        await session.answer(bytes(640))
        assert session.misunderstandings == 1
        assert session.state == "listening"

    asyncio.run(run())


@pytest.mark.parametrize("text", ["Cancela!", "Rosie, para, por favor.", "Chega!", "Pode dormir"])
def test_stop_phrase_sleeps_without_cloud_or_tts(voice_session, text):
    session, speech, conversation = voice_session
    speech.transcribe.return_value = text
    asyncio.run(session.answer(bytes(640)))
    assert session.state == "idle"
    assert session.ws.send_json.call_args.args[0]["sleep_now"] is True
    speech.synthesize.assert_not_awaited()
    conversation.respond.assert_not_awaited()
    conversation.reset.assert_called_once_with("fixture")


def test_drowsiness_keeps_conversation_and_does_not_extend_on_noise(voice_session, monkeypatch):
    from server import app as module

    session, speech, conversation = voice_session
    now = [100.0]
    monkeypatch.setattr(module.time, "monotonic", lambda: now[0])
    session.drowsy_listening = True
    session.deadline = 100

    async def run():
        await session.update_attention()
        assert session.state == "drowsy"
        assert session.deadline == 110
        conversation.reset.assert_not_called()
        speech.has_speech.return_value = False
        now[0] = 105
        await session.answer(bytes(640))
        assert session.state == "drowsy"
        assert session.deadline == 110
        now[0] = 111
        session.utterance.voiced = 10
        await session.update_attention()
        assert session.state == "drowsy", "Finish speech begun before the deadline"
        session.utterance.voiced = 0
        await session.update_attention()
        assert session.state == "idle"
        assert session.ws.send_json.call_args.args[0]["sleep_now"] is True

    asyncio.run(run())


def test_speech_while_drowsy_resumes_normal_followup_window(voice_session):
    session, speech, conversation = voice_session
    session.drowsy_listening = True
    session.state = session.attention_state = "drowsy"
    speech.transcribe.return_value = "bom dia"
    asyncio.run(session.answer(bytes(640)))
    conversation.respond.assert_awaited_once_with("fixture", "bom dia")
    assert session.state == session.attention_state == "listening"
    assert 29 < session.deadline - time.monotonic() <= 30


@pytest.mark.parametrize("reason", ["stop", "two_misses", "zero_duration"])
def test_explicit_end_bypasses_drowsiness(voice_session, monkeypatch, reason):
    from server import app as module

    session, speech, _ = voice_session
    session.drowsy_listening = True
    if reason == "zero_duration":
        monkeypatch.setattr(module.store.catalog.settings, "drowsy_seconds", 0)
        session.deadline = time.monotonic() - 1
        asyncio.run(session.update_attention())
    else:
        session.state = session.attention_state = "drowsy"
        if reason == "two_misses":
            session.misunderstandings = 1
        else:
            speech.transcribe.return_value = "pode parar"
        asyncio.run(session.answer(bytes(640)))
    assert session.state == "idle"
    assert session.ws.send_json.call_args.args[0]["sleep_now"] is True


def test_multi_sentence_reply_is_one_continuous_playback(voice_session):
    session, speech, _ = voice_session
    text = (
        "Posso ajudar com isso. "
        "Primeiro vamos conferir se o dispositivo está conectado e se a configuração está correta. "
        "Você quer começar agora?"
    )
    deadline = session.deadline
    asyncio.run(session.speak_reply(Reply(text=text, expression="curious"), time.monotonic()))
    speech.synthesize.assert_awaited_once_with(text)
    session.play.assert_awaited_once_with(speech.synthesize.return_value)
    assert session.state == "speaking"
    assert session.deadline == deadline


@pytest.mark.parametrize("batch,window,prefill", [(None, 20480, 600), (5, 76800, 1800)])
def test_audio_capability_negotiation_limits_legacy_prefill(
    voice_session, monkeypatch, batch, window, prefill
):
    import json
    from unittest.mock import AsyncMock

    from server import app as module

    session, _, _ = voice_session
    settings = module.store.catalog.settings
    settings.prefill_ms = 1800
    settings.volume = 70
    hello = {"type": "hello", "audio_codec": "ima_adpcm", "audio_batch_frames": batch}
    session.ws.receive = AsyncMock(
        side_effect=[
            {"text": json.dumps(hello)},
            {"type": "websocket.disconnect", "code": 1000},
        ]
    )
    asyncio.run(session.receive())
    assert session.playback_window == window
    assert session.audio_batch_frames == (batch or 1)
    configs = [
        c.args[0] for c in session.ws.send_json.call_args_list if c.args[0]["type"] == "configure"
    ]
    assert configs[-1]["prefill_ms"] == prefill
