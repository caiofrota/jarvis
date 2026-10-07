"""Generate resumable local speech for two addressed attention classifiers."""

import argparse
import hashlib
import json
import os
import sys
import time
import wave
from math import gcd
from pathlib import Path

NATIVE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(NATIVE / "tools"))


def atomic_json(path, value):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    temporary.replace(path)


def jobs_for(recipe):
    """Keep all variants and speeds of one source voice in its declared split."""
    groups = recipe["voice_groups"]
    voices = [voice for group in groups.values() for voice in group]
    if len(voices) != len(set(voices)) or set(groups) != {"training", "validation", "testing"}:
        raise ValueError("Source voice leakage or missing splits")
    jobs = []
    for split, voices in groups.items():
        for voice in voices:
            common = {"split": split, "voice": voice, "source_group": voice}
            for prefix in recipe["wake_prefixes"]:
                for name in recipe["names"]:
                    for speed in recipe["speeds"]:
                        jobs.append(
                            dict(
                                common,
                                class_key="wake",
                                phrase=prefix["phrase"],
                                variant=name["id"],
                                accent=prefix["variant"],
                                speed=speed,
                                phonemes=prefix["phonemes"] + " " + name["phonemes"],
                            )
                        )
            for order in recipe["stop_orders"]:
                for name in recipe["names"]:
                    for stop in recipe["stop_phonemes"]:
                        for speed in recipe["speeds"]:
                            # A comma adds a short synthetizer pause; punctuation is not spoken.
                            phonemes = (
                                name["phonemes"] + recipe.get("stop_separator", ", ") + stop
                                if order == "name_first"
                                else stop + recipe.get("stop_separator", ", ") + name["phonemes"]
                            )
                            jobs.append(
                                dict(
                                    common,
                                    class_key="stop",
                                    phrase="Rosie, para"
                                    if order == "name_first"
                                    else "Para, Rosie",
                                    variant=name["id"],
                                    accent=stop,
                                    speed=speed,
                                    phonemes=phonemes,
                                )
                            )
            for phrase in recipe["negative_texts"]:
                jobs.append(
                    dict(
                        common,
                        class_key="negative",
                        phrase=phrase,
                        variant="normal_or_confusing_speech",
                        accent="pt_br",
                        speed=1.0,
                    )
                )
            for template in recipe.get("explicit_negative_templates", []):
                for name in recipe["names"]:
                    for speed in recipe["speeds"]:
                        jobs.append(
                            dict(
                                common,
                                class_key="negative",
                                phrase=template["phrase"],
                                variant=name["id"],
                                accent="explicit_approved_name",
                                speed=speed,
                                phonemes=template["phonemes"].replace("{name}", name["phonemes"]),
                            )
                        )
    for job in jobs:
        key = hashlib.sha256(json.dumps(job, sort_keys=True).encode()).hexdigest()[:20]
        job["file"] = f"{job['split']}/{job['class_key']}/{key}.wav"
    if len({job["file"] for job in jobs}) != len(jobs):
        raise ValueError("Duplicate recipe jobs")
    return jobs


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--recipe", type=Path, default=NATIVE / "training/rosie_attention.json")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--progress-file", type=Path)
    parser.add_argument("--plan-only", action="store_true")
    parser.add_argument("--reuse-corpus", type=Path, action="append", default=[])
    args = parser.parse_args()
    recipe = json.loads(args.recipe.read_text())
    jobs = jobs_for(recipe)
    if args.plan_only:
        print(
            json.dumps(
                {
                    "total": len(jobs),
                    "classes": {
                        key: sum(j["class_key"] == key for j in jobs)
                        for key in ("wake", "stop", "negative")
                    },
                }
            )
        )
        return
    import numpy as np
    from misaki.espeak import EspeakG2P
    from preview_wake_pronunciations import load_voice
    from scipy.signal import resample_poly

    os.nice(15)
    args.output.mkdir(parents=True, exist_ok=True)
    manifest = args.output / "manifest.json"
    progress = args.progress_file or args.output.parent / "corpus-progress.json"
    report = {
        "recipe": recipe,
        "voice_groups": recipe["voice_groups"],
        "samples": [],
        "expected_count": len(jobs),
        "status": "generating",
    }
    if manifest.exists():
        report = json.loads(manifest.read_text())
        if report["recipe"] != recipe:
            raise ValueError("Recipe changed; preserve this corpus and use a new directory")
    completed = {item["file"]: item for item in report["samples"]}
    reusable = {}
    for directory in args.reuse_corpus:
        prior = json.loads((directory / "manifest.json").read_text())
        if prior.get("status") != "complete_synthetic_only":
            raise ValueError("Only completed source corpora can be reused")
        for item in prior["samples"]:
            reusable[item["file"]] = (directory, item)
    atomic_json(
        progress,
        {
            "phase": "loading_synthesizer",
            "completed": len(completed),
            "total": len(jobs),
            "pid": os.getpid(),
        },
    )
    voice = load_voice()
    g2p = EspeakG2P("pt-br")
    started = time.monotonic()
    new_count = 0
    for index, job in enumerate(jobs, 1):
        path = args.output / job["file"]
        if job["file"] in completed:
            if hashlib.sha256(path.read_bytes()).hexdigest() != completed[job["file"]]["sha256"]:
                raise ValueError(f"Corpus checksum changed: {path.name}")
            continue
        if job["file"] in reusable:
            directory, prior = reusable[job["file"]]
            if any(prior.get(key) != value for key, value in job.items()):
                raise ValueError("Source job identity differs despite the same file name")
            source = directory / prior["file"]
            if hashlib.sha256(source.read_bytes()).hexdigest() != prior["sha256"]:
                raise ValueError("Reusable source checksum mismatch")
            path.parent.mkdir(parents=True, exist_ok=True)
            if not path.exists():
                os.link(source, path)
            elif hashlib.sha256(path.read_bytes()).hexdigest() != prior["sha256"]:
                raise ValueError("Reused destination checksum mismatch")
            report["samples"].append(dict(prior, reused_from=str(directory)))
            atomic_json(manifest, report)
            continue
        phonemes = job.get("phonemes") or g2p(job["phrase"])[0]
        missing = set(phonemes) - set(voice.tokenizer.vocab)
        if missing:
            raise ValueError(f"Unsupported phonemes {missing}: {job['phrase']}")
        samples, rate = voice.create(phonemes, job["voice"], speed=job["speed"], is_phonemes=True)
        divisor = gcd(rate, 16000)
        pcm = resample_poly(samples, 16000 // divisor, rate // divisor)
        if not np.isfinite(pcm).all() or not 0.15 <= len(pcm) / 16000 <= 10:
            raise ValueError("Invalid synthesized duration or samples")
        pcm = (np.clip(pcm, -1, 1) * 32767).astype("<i2")
        if not np.any(pcm):
            raise ValueError("Silent generated sample")
        path.parent.mkdir(parents=True, exist_ok=True)
        with wave.open(str(path), "wb") as target:
            target.setnchannels(1)
            target.setsampwidth(2)
            target.setframerate(16000)
            target.writeframes(pcm.tobytes())
        report["samples"].append(
            dict(
                job,
                phonemes=phonemes,
                duration_seconds=len(pcm) / 16000,
                sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
            )
        )
        new_count += 1
        atomic_json(manifest, report)
        elapsed = time.monotonic() - started
        atomic_json(
            progress,
            {
                "phase": "corpus_generation",
                "completed": len(report["samples"]),
                "total": len(jobs),
                "elapsed_seconds": elapsed,
                "pid": os.getpid(),
                "estimated_remaining_seconds": (len(jobs) - len(report["samples"]))
                * elapsed
                / new_count,
            },
        )
        if index % 20 == 0:
            print(f"Generated {index}/{len(jobs)}; {elapsed:.1f}s this invocation", flush=True)
    report["status"] = "complete_synthetic_only"
    atomic_json(manifest, report)
    atomic_json(progress, {"phase": "corpus_complete", "completed": len(jobs), "total": len(jobs)})
    print(f"Corpus complete: {len(jobs)} clips", flush=True)


if __name__ == "__main__":
    main()
