"""Evaluate the quantized stream with firmware quantization and held-out source voices."""

import argparse
import json
import math
import time
from pathlib import Path

import numpy as np
from ai_edge_litert.interpreter import Interpreter, OpResolverType
from mmap_ninja.ragged import RaggedMmap

ROOT = Path("/work/acorda_rosie")
RUN = ROOT / "candidate-01"
MODEL = RUN / "acorda_rosie.tflite"
MODEL_NAME = "acorda_rosie"
WINDOW = 5
ALLOWED = {
    "CALL_ONCE",
    "VAR_HANDLE",
    "RESHAPE",
    "READ_VARIABLE",
    "STRIDED_SLICE",
    "CONCATENATION",
    "ASSIGN_VARIABLE",
    "CONV_2D",
    "MUL",
    "ADD",
    "MEAN",
    "FULLY_CONNECTED",
    "LOGISTIC",
    "QUANTIZE",
    "DEPTHWISE_CONV_2D",
    "AVERAGE_POOL_2D",
    "MAX_POOL_2D",
    "PAD",
    "PACK",
    "SPLIT_V",
}


class Detector:
    def __init__(self):
        self.model = Interpreter(
            model_path=str(MODEL),
            num_threads=1,
            experimental_op_resolver_type=OpResolverType.BUILTIN_WITHOUT_DEFAULT_DELEGATES,
        )
        self.model.allocate_tensors()
        self.input = self.model.get_input_details()[0]
        self.output = self.model.get_output_details()[0]
        if list(self.input["shape"]) != [1, 3, 40] or self.input["dtype"] != np.int8:
            raise ValueError("Unexpected streaming input contract")
        if list(self.output["shape"]) != [1, 1] or self.output["dtype"] != np.uint8:
            raise ValueError("Unexpected output contract")
        if self.output["quantization"] != (1 / 256, 0):
            raise ValueError("Unexpected output quantization")
        scale, zero = self.input["quantization"]
        if zero != -128 or not 0.100 < scale < 0.104:
            raise ValueError(f"Input calibration incompatible with firmware: {scale}, {zero}")
        ops = {item["op_name"] for item in self.model._get_ops_details()}
        if ops - ALLOWED:
            raise ValueError(f"Firmware does not register: {ops - ALLOWED}")
        self.ops = sorted(ops)

    def stream(self, spectrogram):
        raw = spectrogram if spectrogram.dtype == np.uint16 else np.rint(spectrogram / 0.0390625)
        raw = raw.astype(np.int32)
        quantized = np.clip(((raw * 256 + 333) // 666) - 128, -128, 127).astype(np.int8)
        buffer = np.zeros(WINDOW, dtype=np.uint8)
        for index, start in enumerate(range(0, len(quantized) - 2, 3)):
            self.model.set_tensor(
                self.input["index"], quantized[start : start + 3].reshape(1, 3, 40)
            )
            self.model.invoke()
            buffer[index % WINDOW] = self.model.get_tensor(self.output["index"])[0, 0]
            if index >= 30:
                yield (start + 3) * 0.01, float(buffer.sum()) / (255 * WINDOW)


def clip_scores(split):
    manifest = json.loads((ROOT / "corpus/manifest.json").read_text())
    results = []
    for label in ("positive", "negative", "noise"):
        truth = label == "positive"
        files = sorted((ROOT / "features" / label / split).glob("*_mmap"))
        sources = [s for s in manifest["samples"] if s["split"] == split and s["truth"] == truth]
        repetition = 3 if truth else 2
        for path in files:
            mmap = RaggedMmap(str(path))
            for index in range(len(mmap)):
                detector = Detector()  # Resource-variable state cannot leak across utterances.
                score = max((p for _, p in detector.stream(mmap[index])), default=0)
                item = {"label": label, "index": index, "max_rolling_probability": score}
                if label != "noise":
                    item.update(
                        {
                            key: sources[index // repetition][key]
                            for key in (
                                "file",
                                "voice",
                                "variant",
                                "phrase",
                                "accent",
                                "class_key",
                                "prosody",
                            )
                            if key in sources[index // repetition]
                        }
                    )
                results.append(item)
        print(f"Evaluated {split}/{label}", flush=True)
    return results


def summarize(results, cutoff):
    positives = [item for item in results if item["label"] == "positive"]
    negatives = [item for item in results if item["label"] != "positive"]
    result = {
        "positive_clips": len(positives),
        "positive_detections": sum(p["max_rolling_probability"] >= cutoff for p in positives),
        "recall": float(np.mean([p["max_rolling_probability"] >= cutoff for p in positives])),
        "recall_by_pronunciation": {
            variant: float(
                np.mean(
                    [
                        p["max_rolling_probability"] >= cutoff
                        for p in positives
                        if p["variant"] == variant
                    ]
                )
            )
            for variant in sorted({p["variant"] for p in positives})
        },
        "negative_clips": len(negatives),
        "negative_detections": sum(p["max_rolling_probability"] >= cutoff for p in negatives),
    }
    for key in ("phrase", "accent", "prosody"):
        values = sorted({p[key] for p in positives if key in p})
        if values:
            result[f"recall_by_{key}"] = {
                value: float(
                    np.mean(
                        [
                            p["max_rolling_probability"] >= cutoff
                            for p in positives
                            if p[key] == value
                        ]
                    )
                )
                for value in values
            }
    combinations = sorted(
        {(p["phrase"], p["accent"], p["variant"]) for p in positives if "phrase" in p}
    )
    if combinations:
        result["recall_by_phrase_accent_name"] = [
            {
                "phrase": phrase,
                "greeting_or_stop_accent": accent,
                "name_pronunciation": name,
                "clips": sum(
                    (p.get("phrase"), p.get("accent"), p["variant"]) == (phrase, accent, name)
                    for p in positives
                ),
                "recall": float(
                    np.mean(
                        [
                            p["max_rolling_probability"] >= cutoff
                            for p in positives
                            if (p.get("phrase"), p.get("accent"), p["variant"])
                            == (phrase, accent, name)
                        ]
                    )
                ),
            }
            for phrase, accent, name in combinations
        ]
    result["cross_class_confusion"] = {
        key: {
            "clips": sum(p.get("class_key") == key for p in negatives),
            "false_detections": sum(
                p.get("class_key") == key and p["max_rolling_probability"] >= cutoff
                for p in negatives
            ),
        }
        for key in ("wake", "stop")
        if any(p.get("class_key") == key for p in negatives)
    }
    return result


def main():
    started = time.monotonic()
    detector = Detector()
    report = {
        "status": "evaluating",
        "rolling_window": WINDOW,
        "warmup_inferences": 30,
        "ops": detector.ops,
        "input_quantization": list(detector.input["quantization"]),
        "output_quantization": list(detector.output["quantization"]),
        "limitations": [
            "No human positive recordings",
            "All synthetic voices use Kokoro",
            "Long background recordings are a different domain from the user's home",
            "Identical robot playback and user speech are not disambiguated; echo control is separate",
        ],
    }
    validation = clip_scores("validation")
    negatives = [p["max_rolling_probability"] for p in validation if p["label"] != "positive"]
    for path in sorted((ROOT / "features/ambient/validation_ambient").glob("*_mmap")):
        mmap = RaggedMmap(str(path))
        for i in range(len(mmap)):
            negatives.append(max((p for _, p in Detector().stream(mmap[i])), default=0))
    # This heavily weighted binary classifier is not a calibrated probability.
    # Choose the threshold from validation negatives, with a one-point margin,
    # before inspecting held-out test clips or background recordings.
    cutoff = max(0.05, min(1.0, math.ceil((max(negatives) + 0.01) * 100) / 100))
    report.update(
        {
            "cutoff": cutoff,
            "validation_negative_max": max(negatives),
            "validation": summarize(validation, cutoff),
        }
    )
    (RUN / "validation-streaming-clips.json").write_text(json.dumps(validation, indent=2) + "\n")
    testing = clip_scores("testing")
    report["testing"] = summarize(testing, cutoff)
    (RUN / "testing-streaming-clips.json").write_text(json.dumps(testing, indent=2) + "\n")
    print("Streaming clip results: " + json.dumps(report), flush=True)
    report["ambient"] = {"seconds": 0, "trigger_events": 0, "recordings": []}
    for path in sorted(Path("/work/datasets/dinner_party_eval/testing_ambient").glob("**/*_mmap")):
        mmap = RaggedMmap(str(path))
        for i in range(len(mmap)):
            spectrogram = mmap[i]
            # Recreate the interpreter after each detected wake, mirroring the model reset.
            offset, count = 0, 0
            while offset < len(spectrogram) - 3:
                detected_at = None
                for elapsed, probability in Detector().stream(spectrogram[offset:]):
                    if probability >= cutoff:
                        detected_at = int(round(elapsed / 0.01))
                        break
                if detected_at is None:
                    break
                count += 1
                offset += detected_at
            duration = len(spectrogram) * 0.01
            report["ambient"]["seconds"] += duration
            report["ambient"]["trigger_events"] += count
            report["ambient"]["recordings"].append(
                {"source": str(path), "index": i, "seconds": duration, "events": count}
            )
            (RUN / "evaluation-progress.json").write_text(json.dumps(report, indent=2) + "\n")
            print(
                f"Held-out background {i + 1}/{len(mmap)}: {duration:.1f}s, {count} events",
                flush=True,
            )
    ambient = report["ambient"]
    ambient["events_per_hour"] = ambient["trigger_events"] / (ambient["seconds"] / 3600)
    report["offline_candidate_gate_passed"] = (
        report["testing"]["recall"] >= 0.9
        and min(report["testing"]["recall_by_pronunciation"].values()) >= 0.85
        and report["testing"]["negative_detections"] == 0
        and ambient["events_per_hour"] <= 1.0
        and min(report["testing"].get("recall_by_phrase", {"legacy": 1}).values()) >= 0.85
        and min(report["testing"].get("recall_by_accent", {"legacy": 1}).values()) >= 0.85
    )
    report["status"] = "offline_evaluated_hardware_and_human_acceptance_pending"
    report["elapsed_seconds"] = time.monotonic() - started
    (RUN / "evaluation.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--run-dir", type=Path)
    parser.add_argument("--model-name", default=MODEL_NAME)
    args = parser.parse_args()
    ROOT = args.root
    RUN = args.run_dir or ROOT / "candidate-01"
    MODEL_NAME = args.model_name
    MODEL = RUN / f"{MODEL_NAME}.tflite"
    main()
