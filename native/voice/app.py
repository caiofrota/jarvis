"""Bounded local speech API and streaming segmentation, with no household catalog."""

import asyncio
import contextlib
import logging
import os
import secrets
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace
from typing import Literal, Protocol, cast

from fastapi import Depends, FastAPI, Header, HTTPException, Request, WebSocket
from fastapi.responses import Response
from pydantic import BaseModel, Field
from starlette.websockets import WebSocketDisconnect

from server.speech import Speech, Utterance
from voice.speaker import SpeakerEmbedding

logger = logging.getLogger("rosie.voice")


class SpeechEngine(Protocol):
    lock: asyncio.Lock

    def available_voices(self) -> list[str]: ...
    async def warmup(self) -> None: ...
    async def has_speech(self, pcm: bytes) -> bool: ...
    async def transcribe(self, pcm: bytes, model: str) -> str: ...
    async def synthesize(self, text: str, voice: str, quality: str) -> bytes: ...


class RuntimeDefaults:
    def __init__(self) -> None:
        self.catalog = SimpleNamespace(
            settings=SimpleNamespace(
                stt_model=os.environ.get("ROSIE_WARM_STT", "base"),
                tts_voice=os.environ.get("ROSIE_WARM_VOICE", "kokoro-pf_dora"),
                tts_quality="fast",
            )
        )

    def event(self, kind: str, detail: dict[str, object]) -> None:
        logger.info("%s %s", kind, detail)


def create_app(speech_engine: SpeechEngine | None = None, token: str | None = None) -> FastAPI:
    key = token or Path(os.environ["ROSIE_VOICE_TOKEN_FILE"]).read_text().strip()
    if len(key) < 16:
        raise RuntimeError("ROSIE_VOICE_TOKEN_FILE must contain an existing strong credential.")
    engine = speech_engine or cast(
        SpeechEngine, Speech(RuntimeDefaults(), Path(os.environ.get("ROSIE_MODEL_DIR", "models")))
    )
    speaker = SpeakerEmbedding(Path(os.environ.get("ROSIE_MODEL_DIR", "models")))

    pending = 0

    @asynccontextmanager
    async def capacity() -> AsyncIterator[None]:
        nonlocal pending
        if pending >= 4:
            raise HTTPException(503, "Speech queue is full")
        pending += 1
        try:
            yield
        finally:
            pending -= 1

    async def authenticate(authorization: str = Header(default="")) -> None:
        if not secrets.compare_digest(authorization, "Bearer " + key):
            raise HTTPException(401, "Unauthorized")

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        task = (
            asyncio.create_task(engine.warmup()) if os.environ.get("ROSIE_PREWARM") == "1" else None
        )
        yield
        if task:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    @app.get("/health", dependencies=[Depends(authenticate)])
    def health() -> dict[str, object]:
        return {
            "ready": True,
            "voices": engine.available_voices(),
            "busy": engine.lock.locked(),
            "speakerIdentification": speaker.available,
        }

    @app.post("/speaker-embedding", dependencies=[Depends(authenticate)])
    async def speaker_embedding(request: Request) -> dict[str, object]:
        if not speaker.available:
            raise HTTPException(503, "Speaker model is not installed")
        pcm = bytearray()
        async for chunk in request.stream():
            pcm.extend(chunk)
            if len(pcm) > 640000:
                raise HTTPException(413, "Utterance exceeds 20 seconds")
        if not pcm or len(pcm) % 2:
            raise HTTPException(422, "Expected PCM16 mono at 16 kHz")
        async with capacity(), engine.lock:
            return await speaker.extract(bytes(pcm))

    class Synthesis(BaseModel):
        text: str = Field(min_length=1, max_length=2500)
        voice: str = Field(pattern=r"^[A-Za-z0-9_-]{1,100}$")
        quality: Literal["fast", "detailed"] = "fast"

    @app.post("/synthesize", dependencies=[Depends(authenticate)])
    async def synthesize(body: Synthesis) -> Response:
        if body.voice not in engine.available_voices():
            raise HTTPException(422, "Voice is not installed")
        async with capacity():
            audio = await engine.synthesize(body.text, voice=body.voice, quality=body.quality)
        if len(audio) > 32000 * 180:
            raise HTTPException(413, "Audio exceeds playback limit")
        return Response(audio, media_type="application/octet-stream")

    @app.post("/transcribe", dependencies=[Depends(authenticate)])
    async def transcribe(
        request: Request, model: Literal["tiny", "base", "small"] = "base"
    ) -> dict[str, object]:
        pcm = bytearray()
        async for chunk in request.stream():
            pcm.extend(chunk)
            if len(pcm) > 640000:
                raise HTTPException(413, "Utterance exceeds 20 seconds")
        if not pcm or len(pcm) % 2:
            raise HTTPException(422, "Expected PCM16 mono at 16 kHz")
        async with capacity():
            if not await engine.has_speech(bytes(pcm)):
                return {"speech": False, "text": ""}
            text = await engine.transcribe(bytes(pcm), model=model)
        return {"speech": True, "text": text}

    @app.websocket("/segment")
    async def segment(ws: WebSocket) -> None:
        if not secrets.compare_digest(ws.headers.get("authorization", ""), "Bearer " + key):
            await ws.close(code=1008)
            return
        await ws.accept()
        utterance = Utterance()
        try:
            while True:
                message = await ws.receive()
                if message["type"] == "websocket.disconnect":
                    return
                if message.get("text") == "clear":
                    utterance.clear()
                elif message.get("bytes") is not None:
                    data = message["bytes"]
                    if not data or len(data) > 6400 or len(data) % 2:
                        await ws.close(code=1009)
                        return
                    was_voiced = bool(utterance.voiced)
                    candidate = utterance.feed(data)
                    if bool(utterance.voiced) != was_voiced:
                        await ws.send_json({"type": "activity", "active": bool(utterance.voiced)})
                    if candidate:
                        await ws.send_bytes(candidate)
        except WebSocketDisconnect:
            return

    return app
