import json
import queue
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(sys.argv[1]).resolve()


def emit(event):
    print(json.dumps(event, ensure_ascii=True), flush=True)


def main():
    import sounddevice as sd
    from openwakeword.model import Model

    models = ROOT / "wake-models"
    model = Model(
        wakeword_models=[str(models / "hey_jarvis_v0.1.onnx")],
        melspec_model_path=str(models / "melspectrogram.onnx"),
        embedding_model_path=str(models / "embedding_model.onnx"),
        inference_framework="onnx",
    )
    chunks = queue.Queue(maxsize=8)

    def on_audio(indata, _frames, _time, _status):
        try:
            chunks.put_nowait(np.asarray(indata[:, 0], dtype=np.int16).copy())
        except queue.Full:
            pass

    last_detection = 0.0
    emit({"type": "ready"})
    with sd.InputStream(
        samplerate=16000,
        blocksize=1280,
        channels=1,
        dtype="int16",
        latency="low",
        callback=on_audio,
    ):
        while True:
            audio = chunks.get()
            scores = model.predict(audio)
            score = max((float(value) for value in scores.values()), default=0.0)
            now = time.monotonic()
            if score >= 0.5 and now - last_detection >= 1.8:
                last_detection = now
                emit({"type": "detected", "score": round(score, 3)})


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
    except Exception as exc:
        emit({"type": "error", "error": str(exc)})
        raise
