"""Generate synthetic pronunciation drafts, not a trained wake model or evaluation set."""

import argparse
import hashlib
import json
import os
import wave
from math import gcd
from pathlib import Path

import numpy as np
import onnxruntime
from download_kokoro import FILES, digest
from kokoro_onnx import Kokoro
from scipy.signal import resample_poly

ROOT = Path(__file__).resolve().parents[1]


def load_voice():
    model_dir = ROOT / "models/kokoro"
    for name, (_, expected) in FILES.items():
        if digest(model_dir / name) != expected:
            raise SystemExit(f"Unverified model: {name}")
    options = onnxruntime.SessionOptions()
    options.intra_op_num_threads = 1
    options.inter_op_num_threads = 1
    options.execution_mode = onnxruntime.ExecutionMode.ORT_SEQUENTIAL
    return Kokoro.from_session(
        onnxruntime.InferenceSession(
            str(model_dir / "kokoro-v1.0.onnx"),
            sess_options=options,
            providers=["CPUExecutionProvider"],
        ),
        str(model_dir / "voices-v1.0.bin"),
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--recipe", type=Path, default=ROOT / "training/acorda_rosie.json")
    parser.add_argument("--output", type=Path, default=ROOT / "artifacts/wake/acorda_rosie/preview")
    args = parser.parse_args()
    recipe = json.loads(args.recipe.read_text())
    if args.output.exists():
        raise SystemExit("Output already exists; choose a new directory to retain prior samples.")
    os.nice(10)
    voice = load_voice()
    entries = []
    for style in recipe["preview_voices"]:
        if style not in voice.get_voices():
            raise SystemExit(f"Unavailable voice: {style}")
        for prefix in recipe["prefixes"]:
            for name in recipe["names"]:
                phonemes = prefix["phonemes"] + " " + name["phonemes"]
                missing = set(phonemes) - set(voice.tokenizer.vocab)
                if missing:
                    raise SystemExit(f"Unsupported phonemes: {missing}")
                entries.append((style, prefix, name, phonemes))

    args.output.mkdir(parents=True)
    report = {
        "wake_word": recipe["wake_word"],
        "status": "synthetic_pronunciation_drafts_not_approved",
        "recipe_sha256": digest(args.recipe),
        "model_sha256": {name: expected for name, (_, expected) in FILES.items()},
        "samples": [],
    }
    for style, prefix, name, phonemes in entries:
        samples, rate = voice.create(phonemes, style, is_phonemes=True)
        divisor = gcd(rate, 16000)
        pcm = resample_poly(samples, 16000 // divisor, rate // divisor)
        if not np.isfinite(pcm).all() or not 0.4 <= len(pcm) / 16000 <= 5:
            raise RuntimeError("Invalid pronunciation preview audio")
        pcm = (np.clip(pcm, -1, 1) * 32767).astype("<i2")
        if not np.any(pcm):
            raise RuntimeError("Silent pronunciation preview")
        filename = f"{name['id']}-{prefix['id']}-{style}.wav"
        path = args.output / filename
        with wave.open(str(path), "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(16000)
            wav.writeframes(pcm.tobytes())
        report["samples"].append(
            {
                "file": filename,
                "name_variant": name["id"],
                "prefix_variant": prefix["id"],
                "voice": style,
                "phonemes": phonemes,
                "duration_seconds": round(len(pcm) / 16000, 3),
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                "split": "preview_only",
            }
        )
        (args.output / "manifest.json").write_text(
            json.dumps(report, indent=2, ensure_ascii=False) + "\n"
        )
        print(f"Generated {filename}", flush=True)
    print(f"Pronunciation drafts: {len(report['samples'])}; no wake model trained or installed.")


if __name__ == "__main__":
    main()
