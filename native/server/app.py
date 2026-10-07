import asyncio
import base64
import contextlib
import io
import json
import os
import secrets
import time
import wave
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from . import audio_codec
from .attention import is_stop_phrase
from .automation import Automations
from .catalog import Catalog, normalize
from .conversation import Conversation
from .pairing import Pairing
from .reply import Expression, Reply
from .speech import VOICE_TEST_TEXT, Speech, Utterance
from .store import Store

ROOT = Path(__file__).resolve().parent.parent
store = Store(Path(os.getenv("ROSIE_DATA", ROOT / "data")))
automations = Automations(store)
conversation = Conversation(store, automations)
speech = Speech(store, Path(os.getenv("ROSIE_MODELS", ROOT / "models")))
sessions = {}
work_lock = asyncio.Lock()
pairing_codes = Pairing()


@asynccontextmanager
async def lifespan(app):
    automations.connect()
    warmup = asyncio.create_task(speech.warmup()) if os.getenv("ROSIE_PREWARM") == "1" else None
    try:
        yield
    finally:
        if warmup:
            warmup.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await warmup
        automations.close()


app = FastAPI(title="Rosie", lifespan=lifespan, docs_url=None, redoc_url=None)
app.mount("/static", StaticFiles(directory=ROOT / "server" / "static"), name="static")


def admin(request: Request):
    supplied = request.headers.get("authorization", "")
    try:
        scheme, value = supplied.split(" ", 1)
        user, token = base64.b64decode(value).decode().split(":", 1)
        valid = (
            scheme.lower() == "basic"
            and user == "admin"
            and secrets.compare_digest(token, store.admin_token)
        )
    except (ValueError, UnicodeError):
        valid = False
    if not valid:
        raise HTTPException(401, "Acesso não autorizado.")


@app.get("/")
def index():
    return FileResponse(ROOT / "server" / "static" / "index.html")


@app.get("/health")
def health():
    return {"status": "ok", "version": "0.1.0"}


@app.get("/api/config", dependencies=[Depends(admin)])
def config():
    return store.public()


@app.put("/api/config", dependencies=[Depends(admin)])
async def save_config(request: Request):
    if work_lock.locked():
        raise HTTPException(409, "Aguarde a conversa terminar para salvar.")
    data = await request.json()
    data.pop("credentials", None)
    for key in ("api_key", "mqtt_password"):
        if not data.get("settings", {}).get(key):
            data.setdefault("settings", {})[key] = getattr(store.catalog.settings, key)
    existing = {r.id: r.token for r in store.catalog.robots}
    for robot in data.get("robots", []):
        if not robot.get("token"):
            robot["token"] = existing.get(robot["id"], secrets.token_urlsafe(24))
    try:
        value = Catalog.model_validate(data)
    except ValueError as exc:
        # Pydantic error input can include credentials, so only expose messages.
        errors = exc.errors() if hasattr(exc, "errors") else []
        raise HTTPException(422, "; ".join(str(e["msg"]) for e in errors) or "Cadastro inválido.")
    store.save(value)
    automations.connect()
    for robot_id, session in list(sessions.items()):
        if not any(r.id == robot_id for r in value.robots):
            await session.ws.close(code=1008)
        else:
            await session.configure()
    return store.public()


@app.get("/api/robots/{robot_id}/pairing", dependencies=[Depends(admin)])
def pairing(robot_id: str):
    robot = next((r for r in store.catalog.robots if r.id == robot_id), None)
    if robot is None:
        raise HTTPException(404)
    return {"id": robot.id, "token": robot.token}


@app.get("/api/status", dependencies=[Depends(admin)])
def status():
    return {
        "mqtt": automations.connected,
        "robots": {k: v.state for k, v in sessions.items()},
        "events": store.events(),
        "tts_ready": store.catalog.settings.tts_voice in speech.available_voices(),
    }


@app.get("/api/voices", dependencies=[Depends(admin)])
def voices():
    return {"voices": speech.available_voices(), "sample_text": VOICE_TEST_TEXT}


@app.post("/api/voice_preview", dependencies=[Depends(admin)])
async def voice_preview(
    voice: str = Query(pattern=r"^[A-Za-z0-9_-]{1,100}$"),
    quality: Literal["fast", "detailed"] | None = None,
):
    if voice not in speech.available_voices():
        raise HTTPException(404, "Voz não instalada neste servidor.")
    if work_lock.locked():
        raise HTTPException(409, "Aguarde a conversa terminar para ouvir a amostra.")
    async with work_lock:
        try:
            pcm = await speech.synthesize(VOICE_TEST_TEXT, voice=voice, quality=quality)
        except Exception as exc:
            store.event("preview_error", {"voice": voice, "kind": type(exc).__name__})
            raise HTTPException(503, "Não foi possível gerar a amostra desta voz.")
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes(pcm)
    return Response(
        output.getvalue(), media_type="audio/wav", headers={"Cache-Control": "no-store"}
    )


@app.post("/api/robots/{robot_id}/pair_code", dependencies=[Depends(admin)])
def pair_code(robot_id: str):
    if not any(r.id == robot_id for r in store.catalog.robots):
        raise HTTPException(404, "Robô não cadastrado.")
    return {"pin": pairing_codes.issue(robot_id), "expires_seconds": 300}


@app.post("/api/pair")
async def redeem_pair(request: Request):
    raw = await request.body()
    if len(raw) > 256:
        raise HTTPException(413)
    try:
        body = json.loads(raw)
        pin = body.get("pin") if isinstance(body, dict) else None
        if not isinstance(pin, str) or len(pin) != 6 or not pin.isdigit():
            raise ValueError("Informe os seis dígitos do PIN.")
        robot_id = pairing_codes.redeem(pin, request.client.host)
    except ValueError as exc:
        raise HTTPException(401, str(exc))
    except RuntimeError as exc:
        raise HTTPException(429, str(exc))
    robot = next((r for r in store.catalog.robots if r.id == robot_id), None)
    if robot is None:
        raise HTTPException(401, "Cadastro removido. Gere outro PIN.")
    return {"id": robot.id, "token": robot.token}


@app.post("/api/test", dependencies=[Depends(admin)])
async def test(request: Request):
    body = await request.json()
    robot_id, text = body.get("robot"), body.get("text", "")
    if (
        not any(r.id == robot_id for r in store.catalog.robots)
        or not isinstance(text, str)
        or not 1 <= len(text) <= 4000
    ):
        raise HTTPException(422, "Selecione um robô cadastrado e escreva uma frase.")
    async with work_lock:
        try:
            answer = await conversation.respond(robot_id, text)
            return {"answer": answer.text, "expression": answer.expression}
        except httpx_error_types():
            raise HTTPException(502, "O provedor não respondeu. Confira modelo e chave.")


def httpx_error_types():
    import httpx

    return (httpx.HTTPError, KeyError, ValueError)


@app.post("/api/robots/{robot_id}/{action}", dependencies=[Depends(admin)])
async def robot_action(robot_id: str, action: str, expression: Expression = "neutral"):
    session = sessions.get(robot_id)
    if session is None:
        raise HTTPException(409, "Robô desconectado.")
    if action == "listen":
        await session.listen(new=True)
    elif action in ("sleep", "mute"):
        await session.stop(muted=action == "mute", sleep_now=action == "sleep")
    elif action == "test_voice":
        await session.stop()
        session.job = asyncio.create_task(session.test_voice())
    elif action == "test_expression":
        previous = "muted" if session.state == "muted" else "idle"
        await session.stop(muted=previous == "muted")
        session.job = asyncio.create_task(session.test_expression(expression, previous))
    else:
        raise HTTPException(404)
    return {"ok": True}


class Session:
    def __init__(self, ws, robot_id):
        self.ws, self.robot_id = ws, robot_id
        self.state = "idle"
        self.utterance = Utterance()
        self.deadline = 0
        self.job = None
        self.ack = asyncio.Event()
        self.done = asyncio.Event()
        self.played = 0
        self.play_id = ""
        self.audio_codec = "pcm_s16le"
        self.audio_batch_frames = 1
        self.playback_window = 20480
        self.misunderstandings = 0
        self.drowsy_listening = False
        self.attention_state = "listening"

    async def send(self, event, **payload):
        await self.ws.send_json({"type": event, **payload})

    async def configure(self):
        cfg = store.catalog.settings
        await self.send(
            "configure",
            prefill_ms=min(cfg.prefill_ms, self.playback_window // 32 - 40),
            audio_batch_frames=self.audio_batch_frames,
            volume=cfg.volume,
            drowsy_seconds=cfg.drowsy_seconds,
            audio_codec=self.audio_codec,
        )

    async def set_state(self, state, expression: Expression = "neutral", sleep_now=False):
        self.state = state
        expression = expression if state == "speaking" else "neutral"
        store.event("state", {"robot": self.robot_id, "state": state, "expression": expression})
        await self.send("state", state=state, expression=expression, sleep_now=sleep_now)

    async def update_attention(self):
        if self.state not in ("listening", "drowsy"):
            return
        if time.monotonic() >= self.deadline and not self.utterance.voiced:
            await self.advance_attention()

    async def advance_attention(self):
        seconds = store.catalog.settings.drowsy_seconds
        if self.attention_state == "listening" and self.drowsy_listening and seconds > 0:
            self.attention_state = "drowsy"
            self.deadline = time.monotonic() + seconds
            await self.set_state("drowsy")
        else:
            await self.stop(sleep_now=True)

    async def test_expression(self, expression, previous):
        await self.set_state("speaking", expression)
        await asyncio.sleep(3)
        await self.set_state(previous)

    async def test_voice(self):
        try:
            async with work_lock:
                await self.set_state("thinking")
                audio = await speech.synthesize(VOICE_TEST_TEXT)
                await self.set_state("speaking", "curious")
                await self.play(audio)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            store.event("voice_error", {"robot": self.robot_id, "kind": type(exc).__name__})
            await self.send("cancel")
        await self.set_state("idle")

    async def listen(self, new=False):
        if self.job and not self.job.done():
            return
        if new:
            conversation.reset(self.robot_id)
            self.misunderstandings = 0
        self.utterance.clear()
        self.attention_state = "listening"
        self.deadline = time.monotonic() + store.catalog.settings.listen_seconds
        await self.set_state("listening")

    async def stop(self, muted=False, sleep_now=False):
        if self.job and self.job is not asyncio.current_task():
            self.job.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self.job
        self.utterance.clear()
        self.misunderstandings = 0
        conversation.reset(self.robot_id)
        await self.send("cancel")
        await self.set_state("muted" if muted else "idle", sleep_now=sleep_now)

    async def play(self, pcm):
        started = time.monotonic()
        self.play_id = secrets.token_hex(6)
        self.played = 0
        self.done.clear()
        self.ack.clear()
        await self.send(
            "play_start",
            id=self.play_id,
            bytes=len(pcm),
            sample_rate=16000,
            audio_codec=self.audio_codec,
        )
        sent = 0
        encoder = (0, 0)
        while sent < len(pcm):
            # Credit is negotiated from device capacity; a batch must fit in full.
            end = min(len(pcm), sent + 640 * self.audio_batch_frames)
            while end - self.played > self.playback_window:
                self.ack.clear()
                try:
                    await asyncio.wait_for(self.ack.wait(), 8)
                except TimeoutError:
                    store.event(
                        "playback_stalled",
                        {
                            "robot": self.robot_id,
                            "sent": sent,
                            "played": self.played,
                            "total": len(pcm),
                        },
                    )
                    raise
            chunk = pcm[sent:end]
            if self.audio_codec == "ima_adpcm":
                batch = bytearray()
                for offset in range(0, len(chunk), 640):
                    packet, encoder = audio_codec.encode(chunk[offset : offset + 640], encoder)
                    batch.extend(packet)
                await self.ws.send_bytes(bytes(batch))
            else:
                await self.ws.send_bytes(chunk)
            sent += len(chunk)
        await self.send("play_end", id=self.play_id)
        try:
            await asyncio.wait_for(self.done.wait(), 10)
        except TimeoutError:
            store.event(
                "playback_incomplete",
                {"robot": self.robot_id, "sent": sent, "played": self.played, "total": len(pcm)},
            )
            raise
        store.event(
            "playback_complete",
            {
                "robot": self.robot_id,
                "bytes": len(pcm),
                "audio_seconds": round(len(pcm) / 32000, 3),
                "elapsed_seconds": round(time.monotonic() - started, 3),
                "audio_codec": self.audio_codec,
            },
        )

    async def answer(self, pcm):
        close_after = False
        sleep_now = False
        understood = False
        try:
            async with work_lock:
                if not await speech.has_speech(pcm):
                    store.event("noise_rejected", {"robot": self.robot_id})
                    await self.resume_after_noise()
                    return
                await self.set_state("thinking")
                start = time.monotonic()
                text = await speech.transcribe(pcm)
                store.event(
                    "stt_timing",
                    {"robot": self.robot_id, "seconds": round(time.monotonic() - start, 2)},
                )
                if not normalize(text):
                    self.misunderstandings += 1
                    store.event(
                        "speech_not_understood",
                        {
                            "robot": self.robot_id,
                            "count": self.misunderstandings,
                        },
                    )
                    if self.misunderstandings >= 2:
                        await self.stop(sleep_now=True)
                        return
                    if time.monotonic() >= self.deadline:
                        await self.resume_after_noise()
                        return
                    answer = Reply.plain("Não entendi. Pode repetir?")
                else:
                    self.misunderstandings = 0
                    if is_stop_phrase(text):
                        await self.stop(sleep_now=True)
                        return
                    understood = True
                    answer = await conversation.respond(self.robot_id, text)
                await self.speak_reply(answer, start)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            # Avoid recording provider responses or credentials in errors.
            store.event("voice_error", {"robot": self.robot_id, "kind": type(exc).__name__})
            await self.send("cancel")
            await self.set_state("error")
            await asyncio.sleep(2)
            close_after = True
        if close_after:
            conversation.reset(self.robot_id)
            await self.set_state("idle", sleep_now=sleep_now)
        else:
            self.utterance.clear()
            if understood:
                self.attention_state = "listening"
                self.deadline = time.monotonic() + store.catalog.settings.listen_seconds
            await self.resume_after_noise()

    async def speak_reply(self, answer, started):
        # One playback stream per answer: CPU synthesis must not introduce silent
        # gaps that sound like the conversation has returned to listening.
        begin = time.monotonic()
        audio = await speech.synthesize(answer.text)
        store.event(
            "tts_timing",
            {
                "robot": self.robot_id,
                "voice": store.catalog.settings.tts_voice,
                "seconds": round(time.monotonic() - begin, 2),
                "audio_seconds": round(len(audio) / 32000, 2),
            },
        )
        store.event(
            "reply_ready",
            {
                "robot": self.robot_id,
                "seconds": round(time.monotonic() - started, 2),
            },
        )
        await self.set_state("speaking", answer.expression)
        await self.play(audio)

    async def resume_after_noise(self):
        # A rejected sound or empty transcript cannot keep renewing the session.
        self.utterance.clear()
        if time.monotonic() >= self.deadline:
            await self.advance_attention()
        else:
            await self.set_state(self.attention_state)

    async def receive(self):
        await self.configure()
        await self.set_state("idle")
        while True:
            try:
                message = await asyncio.wait_for(self.ws.receive(), 1)
            except TimeoutError:
                message = {}
            if message.get("type") == "websocket.disconnect":
                store.event("disconnected", {"robot": self.robot_id, "code": message.get("code")})
                break
            await self.update_attention()
            data = message.get("bytes")
            if data is not None:
                if len(data) > 4096:
                    await self.ws.close(code=1009)
                    break
                if self.state in ("listening", "drowsy"):
                    if self.audio_codec == "ima_adpcm":
                        data = audio_codec.decode_batch(data, self.audio_batch_frames)
                    elif len(data) % 2:
                        await self.ws.close(code=1009)
                        break
                    pcm = self.utterance.feed(data)
                    if pcm:
                        # Reserve this candidate while validation runs; the OLED
                        # stays in listening until speech has been confirmed.
                        self.state = "checking"
                        self.job = asyncio.create_task(self.answer(pcm))
                continue
            if message.get("text"):
                if len(message["text"]) > 2048:
                    break
                event = json.loads(message["text"])
                kind = event.get("type")
                if kind == "hello" and event.get("audio_codec") == "ima_adpcm":
                    if self.state == "idle":
                        self.audio_codec = "ima_adpcm"
                        if event.get("audio_batch_frames") == 5:
                            self.audio_batch_frames = 5
                            self.playback_window = 76800
                        self.drowsy_listening = event.get("drowsy_listening") is True
                        await self.configure()
                        store.event(
                            "audio_codec",
                            {
                                "robot": self.robot_id,
                                "codec": self.audio_codec,
                                "batch_frames": self.audio_batch_frames,
                                "buffer_ms": self.playback_window // 32,
                            },
                        )
                elif kind == "capture_error":
                    store.event("capture_error", {"robot": self.robot_id})
                    await self.stop()
                elif kind == "wake" and self.state == "idle":
                    store.event("wake", {"robot": self.robot_id})
                    await self.listen(new=True)
                elif kind == "played" and event.get("id") == self.play_id:
                    self.played = max(self.played, int(event.get("bytes", 0)))
                    self.ack.set()
                elif kind == "play_done" and event.get("id") == self.play_id:
                    self.played = max(self.played, int(event.get("bytes", 0)))
                    self.ack.set()
                    self.done.set()
                elif kind == "diagnostic":
                    store.event(
                        "device",
                        {
                            "robot": self.robot_id,
                            **{
                                k: event[k]
                                for k in (
                                    "heap",
                                    "wake_ms",
                                    "wake_model",
                                    "rssi",
                                    "underruns",
                                    "upload_peak_ms",
                                    "send_max_ms",
                                )
                                if k in event
                            },
                        },
                    )


@app.websocket("/ws/robot/{robot_id}")
async def robot_ws(ws: WebSocket, robot_id: str):
    robot = next((r for r in store.catalog.robots if r.id == robot_id), None)
    auth = ws.headers.get("authorization", "")
    if robot is None or not secrets.compare_digest(auth, "Bearer " + robot.token):
        await ws.close(code=1008)
        return
    session = Session(ws, robot_id)
    previous = sessions.get(robot_id)
    # Reserve ownership without an await: an authenticated reconnect supersedes
    # its half-open socket, even before TCP detects that the old link is gone.
    sessions[robot_id] = session
    try:
        await ws.accept()
        if previous:
            store.event("session_replaced", {"robot": robot_id})
            if previous.job:
                previous.job.cancel()
            with contextlib.suppress(WebSocketDisconnect, RuntimeError, TimeoutError):
                await asyncio.wait_for(previous.ws.close(code=1012), 1)
        if sessions.get(robot_id) is not session:
            # A still newer connection won while this socket was being accepted.
            await ws.close(code=1012)
            return
        conversation.reset(robot_id)
        await session.receive()
    except (WebSocketDisconnect, ValueError, RuntimeError) as exc:
        store.event("connection_error", {"robot": robot_id, "kind": type(exc).__name__})
    finally:
        if session.job:
            session.job.cancel()
            with contextlib.suppress(asyncio.CancelledError, RuntimeError):
                await session.job
        if sessions.get(robot_id) is session:
            sessions.pop(robot_id, None)
            conversation.reset(robot_id)
