"""Prepare deterministic pitch/noise/room variants without crossing source splits."""

import argparse
from pathlib import Path

import numpy as np
import prepare_features as base
from scipy.signal import lfilter, resample_poly


def augment(audio, rng, clean=False):
    if not clean:
        # Resampling changes pitch and duration together; it is not another speaker.
        ratio = int(rng.integers(90, 112))
        audio = resample_poly(audio, 100, ratio).astype(np.float32)
        reflected = audio.copy()
        for _ in range(int(rng.integers(0, 5))):
            delay = int(rng.uniform(0.01, 0.18) * 16000)
            if delay < len(audio):
                reflected[delay:] += audio[:-delay] * rng.uniform(0.03, 0.22)
        audio = reflected * rng.uniform(0.07, 0.95)
    lead = int(rng.uniform(0.8, 1.3) * 16000)
    # Training may trim at most 60 ms; leave at least 100 ms after speech.
    tail = int(rng.uniform(0.1, 0.35) * 16000)
    padded = np.pad(audio, (lead, tail))
    if not clean:
        noise = lfilter([1], [1, -rng.uniform(0, 0.92)], rng.normal(0, 1, len(padded)))
        noise *= np.sqrt(np.mean(audio**2)) / (
            10 ** (rng.uniform(8, 32) / 20) * np.std(noise) + 1e-10
        )
        padded += noise
    return np.clip(padded, -1, 1).astype(np.float32)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    args = parser.parse_args()
    base.ROOT = args.root
    base.CORPUS = args.root / "corpus"
    base.OUTPUT = args.root / "features"
    base.SEED = 20260926
    base.augment = augment
    base.main()
