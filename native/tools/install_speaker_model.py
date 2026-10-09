"""Install the pinned public speaker encoder without downloading at runtime."""

import hashlib
import os
from pathlib import Path
from urllib.request import urlopen

from voice.speaker import MODEL_FILE, MODEL_SHA256

URL = (
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/"
    "speaker-recongition-models/" + MODEL_FILE
)


def main() -> None:
    root = Path(__file__).resolve().parents[1] / "models/speaker"
    root.mkdir(parents=True, exist_ok=True)
    target = root / MODEL_FILE
    if target.exists():
        if hashlib.sha256(target.read_bytes()).hexdigest() != MODEL_SHA256:
            raise SystemExit("Existing speaker model differs; preserve and inspect it first.")
        print("Pinned speaker model already installed.")
        return
    with urlopen(URL, timeout=60) as response:
        data = response.read(30_000_001)
    if len(data) > 30_000_000 or hashlib.sha256(data).hexdigest() != MODEL_SHA256:
        raise SystemExit("Speaker model failed checksum verification.")
    temporary = target.with_suffix(".download")
    temporary.write_bytes(data)
    os.replace(temporary, target)
    print("Pinned local speaker encoder installed.")


if __name__ == "__main__":
    main()
