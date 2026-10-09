"""Download the pinned CPU model and voice styles from the upstream release."""

import hashlib
import urllib.request
from pathlib import Path

DIRECTORY = Path(__file__).resolve().parent.parent / "models" / "kokoro"
RELEASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/"
FILES = {
    "kokoro-v1.0.onnx": (
        "model-files-v1.0",
        "7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5",
    ),
    "voices-v1.0.bin": (
        "model-files-v1.1",
        "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d",
    ),
}


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def main():
    DIRECTORY.mkdir(parents=True, exist_ok=True)
    for name, (version, expected) in FILES.items():
        target = DIRECTORY / name
        if target.exists() and digest(target) == expected:
            print(f"Already verified: {name}", flush=True)
            continue
        temporary = target.with_suffix(target.suffix + ".download")
        try:
            with urllib.request.urlopen(RELEASE + version + "/" + name, timeout=60) as response:
                with temporary.open("wb") as output:
                    while block := response.read(1024 * 1024):
                        output.write(block)
            if digest(temporary) != expected:
                raise RuntimeError(f"SHA-256 mismatch: {name}")
            temporary.replace(target)
            print(f"Downloaded and verified: {name}", flush=True)
        finally:
            temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
