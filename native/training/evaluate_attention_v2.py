"""Evaluate actual int8 streaming checkpoints without opening acceptance during selection."""

import argparse
import hashlib
import json
import os
import time
from pathlib import Path

import evaluate_candidate as base
from attention_quality import quality_gate, threshold_from_negatives
from mmap_ninja.ragged import RaggedMmap


def atomic_json(path, value):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    temporary.replace(path)


def background_report():
    """Previous acceptance recordings are now a legacy regression set, explicitly labeled."""
    report = {"seconds": 0.0, "events": 0, "provenance": "previously_used_DIPCO_regression"}
    decision = json.loads((base.RUN / "development.json").read_text())
    cutoff = decision["cutoff"]
    for path in sorted(Path("/work/datasets/dinner_party_eval/testing_ambient").glob("**/*_mmap")):
        recordings = RaggedMmap(str(path))
        for index in range(len(recordings)):
            spectrogram = recordings[index]
            report["seconds"] += len(spectrogram) * 0.01
            offset = 0
            while offset < len(spectrogram) - 3:
                detected = None
                for elapsed, probability in base.Detector().stream(spectrogram[offset:]):
                    if probability >= cutoff:
                        detected = int(round(elapsed / 0.01))
                        break
                if detected is None:
                    break
                report["events"] += 1
                offset += detected
    report["events_per_hour"] = report["events"] / (report["seconds"] / 3600)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--run-dir", type=Path, required=True)
    parser.add_argument("--model-name", required=True)
    parser.add_argument("--mode", choices=("development", "acceptance"), required=True)
    args = parser.parse_args()
    os.nice(15)
    base.ROOT, base.RUN = args.root, args.run_dir
    base.MODEL = args.run_dir / f"{args.model_name}.tflite"
    digest = hashlib.sha256(base.MODEL.read_bytes()).hexdigest()
    started = time.monotonic()
    detector = base.Detector()
    report = {
        "mode": args.mode,
        "sha256": digest,
        "bytes": base.MODEL.stat().st_size,
        "ops": detector.ops,
        "input_quantization": list(detector.input["quantization"]),
        "output_quantization": list(detector.output["quantization"]),
        "rolling_window": 5,
        "warmup_inferences": 30,
        "models_deployed": False,
    }
    decision_file = args.run_dir / "development.json"
    if args.mode == "development":
        scores = base.clip_scores("validation")
        negatives = [s["max_rolling_probability"] for s in scores if s["label"] != "positive"]
        for path in sorted((args.root / "features/ambient/validation_ambient").glob("*_mmap")):
            recordings = RaggedMmap(str(path))
            for index in range(len(recordings)):
                negatives.append(
                    max((p for _, p in base.Detector().stream(recordings[index])), default=0)
                )
        cutoff = threshold_from_negatives(negatives)
        summary = base.summarize(scores, cutoff if cutoff is not None else 1.0)
        report.update(
            cutoff=cutoff,
            negative_max=max(negatives),
            summary=summary,
            gate_passed=cutoff is not None and quality_gate(summary),
            cutoff_valid=cutoff is not None,
            acceptance_opened=False,
        )
        atomic_json(args.run_dir / "development-clips.json", scores)
    else:
        decision = json.loads(decision_file.read_text())
        if not decision["gate_passed"] or decision["sha256"] != digest:
            raise ValueError("Acceptance requires a development-passing frozen model and cutoff")
        if (args.run_dir / "acceptance-opened.json").exists():
            raise ValueError(
                "Acceptance has already been opened; preserve results without retuning"
            )
        atomic_json(
            args.run_dir / "acceptance-opened.json", {"sha256": digest, "unix": time.time()}
        )
        cutoff = decision["cutoff"]
        scores = base.clip_scores("testing")
        summary = base.summarize(scores, cutoff)
        background = background_report()
        report.update(
            cutoff=cutoff,
            summary=summary,
            background=background,
            gate_passed=quality_gate(summary, background["events_per_hour"]),
            limitations=[
                "New held-out TTS styles, not independent human speakers",
                "Background hours are a previous regression set, not new untouched acceptance",
                "Human microphone, hardware arena, latency and echo acceptance remain required",
            ],
        )
        atomic_json(args.run_dir / "acceptance-clips.json", scores)
    report["elapsed_seconds"] = time.monotonic() - started
    atomic_json(args.run_dir / f"{args.mode}.json", report)
    print(json.dumps(report), flush=True)


if __name__ == "__main__":
    main()
