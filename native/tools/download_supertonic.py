"""Fetch a fixed upstream Supertonic snapshot, checking each file's Git/LFS hash."""

import hashlib
import json
import urllib.request
from pathlib import Path

REPOSITORY = "supertone-oss-archive/supertonic-3"
REVISION = "aafc6e32416a594460b32413efc49d7fe4ce6d46"
DIRECTORY = Path(__file__).resolve().parent.parent / "models" / "supertonic-3"
FILES = (
    "LICENSE",
    "README.md",
    "onnx/duration_predictor.onnx",
    "onnx/text_encoder.onnx",
    "onnx/vector_estimator.onnx",
    "onnx/vocoder.onnx",
    "onnx/tts.json",
    "onnx/unicode_indexer.json",
    "voice_styles/F1.json",
    "voice_styles/M1.json",
)


def verified(path, entry):
    if not path.is_file() or path.stat().st_size != entry["size"]:
        return False
    with path.open("rb") as source:
        if "lfs" in entry:
            return hashlib.file_digest(source, "sha256").hexdigest() == entry["lfs"]["sha256"]
        # Hugging Face exposes Git object IDs for the small configuration files.
        hasher = hashlib.sha1(f"blob {entry['size']}\0".encode())
        hasher.update(source.read())
        return hasher.hexdigest() == entry["blobId"]


def main():
    url = f"https://huggingface.co/api/models/{REPOSITORY}/revision/{REVISION}?blobs=true"
    with urllib.request.urlopen(url, timeout=60) as response:
        metadata = json.load(response)
    if metadata["sha"] != REVISION:
        raise RuntimeError("Unexpected model revision")
    entries = {entry["rfilename"]: entry for entry in metadata["siblings"]}
    for name in FILES:
        entry = entries[name]
        target = DIRECTORY / name
        if verified(target, entry):
            print(f"Already verified: {name}", flush=True)
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_suffix(target.suffix + ".download")
        try:
            url = f"https://huggingface.co/{REPOSITORY}/resolve/{REVISION}/{name}"
            with urllib.request.urlopen(url, timeout=60) as response:
                with temporary.open("wb") as output:
                    while block := response.read(1024 * 1024):
                        output.write(block)
            if not verified(temporary, entry):
                raise RuntimeError(f"Integrity verification failed: {name}")
            temporary.replace(target)
            print(f"Downloaded and verified: {name}", flush=True)
        finally:
            temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
