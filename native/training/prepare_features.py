"""Prepare a reproducible first experiment without mixing source voices across splits."""

import argparse
import hashlib
import json
import wave
from pathlib import Path

import numpy as np
from microwakeword.audio.audio_utils import generate_features_for_clip
from mmap_ninja.ragged import RaggedMmap
from scipy.signal import lfilter

ROOT = Path("/work/acorda_rosie")
CORPUS = ROOT / "corpus"
OUTPUT = ROOT / "features"
SEED = 20260922


def load_audio(item):
    path = CORPUS / item["file"]
    if hashlib.sha256(path.read_bytes()).hexdigest() != item["sha256"]:
        raise ValueError(f"Corpus checksum mismatch: {item['file']}")
    with wave.open(str(path), "rb") as source:
        if (source.getframerate(), source.getnchannels(), source.getsampwidth()) != (16000, 1, 2):
            raise ValueError(f"Unexpected audio format: {item['file']}")
        return (
            np.frombuffer(source.readframes(source.getnframes()), "<i2").astype(np.float32) / 32768
        )


def augment(audio, rng, clean=False):
    """Vary gain, colored noise and short reflections; keep the complete utterance."""
    if not clean:
        reflected = audio.copy()
        for _ in range(int(rng.integers(0, 4))):
            delay = int(rng.uniform(0.015, 0.14) * 16000)
            if delay < len(audio):
                reflected[delay:] += audio[:-delay] * rng.uniform(0.04, 0.23)
        audio = reflected * rng.uniform(0.08, 0.9)
    lead = int(rng.uniform(0.8, 1.2) * 16000)
    tail = int(rng.uniform(0.04, 0.2) * 16000)
    padded = np.pad(audio, (lead, tail))
    if not clean:
        noise = rng.normal(0, 1, len(padded))
        noise = lfilter([1], [1, -rng.uniform(0, 0.92)], noise)
        speech_rms = np.sqrt(np.mean(audio**2))
        noise *= speech_rms / (10 ** (rng.uniform(10, 32) / 20) * np.std(noise) + 1e-10)
        padded += noise
    return np.clip(padded, -1, 1).astype(np.float32)


def features(audio):
    result = generate_features_for_clip(audio, step_ms=10, use_c=True)
    if result.ndim != 2 or result.shape[1] != 40 or not np.isfinite(result).all():
        raise ValueError("Invalid frontend output")
    return result.astype(np.float32)


def noise_clip(rng, kind):
    """Synthetic negatives complement, but do not replace, recorded household noise."""
    size = 3 * 16000
    time = np.arange(size) / 16000
    noise = rng.normal(0, rng.uniform(0.0001, 0.015), size)
    if kind == 0:
        noise += rng.uniform(0.002, 0.1) * np.sin(2 * np.pi * rng.choice([50, 60, 120]) * time)
    elif kind == 1:
        for _ in range(12):
            start = int(rng.integers(0, size - 1000))
            noise[start : start + 1000] += rng.normal(0, 0.2, 1000) * np.exp(-np.arange(1000) / 100)
    elif kind == 2:
        gate = (time > 1) & (time < 1.7)
        noise += gate * 0.08 * (np.sin(2 * np.pi * 440 * time) + np.sin(2 * np.pi * 550 * time))
    return np.clip(noise, -1, 1).astype(np.float32)


def main():
    manifest_bytes = (CORPUS / "manifest.json").read_bytes()
    manifest = json.loads(manifest_bytes)
    samples = manifest["samples"]
    expected = manifest.get("expected_count", 520)
    if len(samples) != expected or len({sample["file"] for sample in samples}) != expected:
        raise ValueError(f"The full {expected}-clip corpus is required")
    voices = [v for group in manifest["voice_groups"].values() for v in group]
    if len(voices) != len(set(voices)):
        raise ValueError("Source voice leakage between splits")
    digest = hashlib.sha256(manifest_bytes).hexdigest()
    completed = OUTPUT / "manifest.json"
    if completed.exists():
        if json.loads(completed.read_text())["corpus_sha256"] != digest:
            raise ValueError("Features belong to a different corpus")
        print("Features already complete", flush=True)
        return
    if OUTPUT.exists():
        raise ValueError("Partial features exist; preserve them and choose a fresh experiment path")
    OUTPUT.mkdir()
    report = {
        "corpus_sha256": digest,
        "seed": SEED,
        "window_step_ms": 10,
        "frontend": "pymicro-features 2.0.2, normalized float32",
        "evaluation_limit": "Synthetic voices from the same engine; human recognition is unverified",
        "groups": {},
        "ambient_validation_segments": [],
    }
    for split_index, split in enumerate(("training", "validation", "testing")):
        for truth in (True, False):
            label = "positive" if truth else "negative"
            selected = [s for s in samples if s["split"] == split and s["truth"] == truth]
            repeat = (16 if truth else 4) if split == "training" else (3 if truth else 2)
            rng = np.random.default_rng(SEED + 10 * split_index + int(truth))
            out = OUTPUT / label / split / "synthetic_mmap"
            out.parent.mkdir(parents=True)

            def generate(selected=selected, repeat=repeat, rng=rng, split=split):
                for item in selected:
                    if item["voice"] not in manifest["voice_groups"][split]:
                        raise ValueError("Incorrect split membership")
                    audio = load_audio(item)
                    for index in range(repeat):
                        yield features(augment(audio, rng, clean=index == 0))

            RaggedMmap.from_generator(str(out), generate(), batch_size=32, verbose=False)
            report["groups"][f"{split}/{label}"] = len(selected) * repeat
            print(f"Prepared {split}/{label}: {len(selected) * repeat}", flush=True)
        rng = np.random.default_rng(SEED + 100 + split_index)
        count = 128 if split == "training" else 24
        out = OUTPUT / "noise" / split / "synthetic_noise_mmap"
        out.parent.mkdir(parents=True)
        RaggedMmap.from_generator(
            str(out),
            (features(noise_clip(rng, i % 4)) for i in range(count)),
            batch_size=32,
            verbose=False,
        )
        report["groups"][f"{split}/noise"] = count

    # Bound validation RAM. The complete, separate testing recordings are evaluated later.
    ambient = Path("/work/datasets/dinner_party_eval/validation_ambient")
    sources = sorted(ambient.glob("**/*_mmap"))
    if not sources:
        raise ValueError("Missing validation background data")
    segments = []
    for source in sources:
        mmap = RaggedMmap(str(source))
        for index in np.linspace(0, len(mmap) - 1, min(4, len(mmap)), dtype=int):
            raw = mmap[index]
            segment = np.array(raw[:3000])  # Up to 30 seconds at the pinned 10 ms step.
            if segment.ndim != 2 or segment.shape[1] != 40:
                raise ValueError("Unexpected background shape")
            segments.append(segment)
            report["ambient_validation_segments"].append(
                {
                    "source": str(source),
                    "index": int(index),
                    "frames": len(segment),
                    "dtype": str(segment.dtype),
                }
            )
            if sum(len(s) for s in segments) >= 12000:
                break
        if sum(len(s) for s in segments) >= 12000:
            break
    out = OUTPUT / "ambient" / "validation_ambient" / "calibration_mmap"
    out.parent.mkdir(parents=True)
    RaggedMmap.from_generator(str(out), iter(segments), batch_size=4, verbose=False)
    completed.write_text(json.dumps(report, indent=2) + "\n")
    print("Feature preparation completed", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--seed", type=int, default=SEED)
    args = parser.parse_args()
    ROOT, SEED = args.root, args.seed
    CORPUS, OUTPUT = ROOT / "corpus", ROOT / "features"
    main()
