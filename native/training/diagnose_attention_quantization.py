"""Compare a frozen checkpoint's float/int8 streams on development data only."""

import argparse
import hashlib
import json
import os
import time
from pathlib import Path

import evaluate_candidate as base
import numpy as np
from ai_edge_litert.interpreter import Interpreter, OpResolverType
from attention_quality import quality_gate, threshold_from_negatives
from evaluate_attention_v2 import background_report
from mmap_ninja.ragged import RaggedMmap


class FloatDetector:
    """Diagnostic float execution; deliberately not an ESP32-compatible candidate."""

    def __init__(self):
        self.model = Interpreter(
            model_path=str(base.MODEL),
            num_threads=1,
            experimental_op_resolver_type=OpResolverType.BUILTIN_WITHOUT_DEFAULT_DELEGATES,
        )
        self.model.allocate_tensors()
        self.input = self.model.get_input_details()[0]
        self.output = self.model.get_output_details()[0]
        if (
            list(self.input["shape"]) != [1, 3, 40]
            or self.input["dtype"] != np.float32
            or list(self.output["shape"]) != [1, 1]
            or self.output["dtype"] != np.float32
        ):
            raise ValueError("Unexpected diagnostic float streaming contract")

    def stream(self, spectrogram):
        features = np.asarray(spectrogram, dtype=np.float32)
        if spectrogram.dtype == np.uint16:
            features = features * 0.0390625
        features = np.clip(features, 0, 26)
        recent = np.zeros(5, dtype=np.float32)
        for index, start in enumerate(range(0, len(features) - 2, 3)):
            self.model.set_tensor(
                self.input["index"], features[start : start + 3].reshape(1, 3, 40)
            )
            self.model.invoke()
            recent[index % 5] = self.model.get_tensor(self.output["index"])[0, 0]
            if index >= 30:
                yield (start + 3) * 0.01, float(recent.mean())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    os.nice(15)
    args.output.mkdir(parents=True, exist_ok=True)
    report_path = args.output / "diagnostic.json"
    if report_path.exists():
        raise ValueError("Preserve the existing diagnostic report")
    started = time.monotonic()
    decision = json.loads((args.checkpoint / "development.json").read_text())
    int8_path = args.checkpoint / f"rosie_{args.root.name}.tflite"
    if hashlib.sha256(int8_path.read_bytes()).hexdigest() != decision["sha256"]:
        raise ValueError("The quantized checkpoint differs from its development report")
    # Conversion is sequential and contained within the same bounded offline job.
    import tensorflow as tf

    tf.config.threading.set_intra_op_parallelism_threads(1)
    tf.config.threading.set_inter_op_parallelism_threads(1)
    float_path = args.output / "diagnostic_float.tflite"
    converter = tf.lite.TFLiteConverter.from_saved_model(
        str(args.checkpoint / "stream_state_internal")
    )
    float_path.write_bytes(converter.convert())
    base.ROOT = args.root
    base.MODEL = float_path
    int8_detector = base.Detector
    base.Detector = FloatDetector
    scores = base.clip_scores("validation")
    negatives = [item["max_rolling_probability"] for item in scores if item["label"] != "positive"]
    for path in sorted((args.root / "features/ambient/validation_ambient").glob("*_mmap")):
        recordings = RaggedMmap(str(path))
        for index in range(len(recordings)):
            negatives.append(
                max((p for _, p in FloatDetector().stream(recordings[index])), default=0)
            )
    cutoff = threshold_from_negatives(negatives)
    summary = base.summarize(scores, cutoff if cutoff is not None else 1.0)
    quantized = json.loads((args.checkpoint / "development-clips.json").read_text())
    if len(quantized) != len(scores) or any(
        (left["label"], left["index"], left.get("file"))
        != (right["label"], right["index"], right.get("file"))
        for left, right in zip(quantized, scores)
    ):
        raise ValueError("Float and int8 development examples differ")
    differences = [
        abs(left["max_rolling_probability"] - right["max_rolling_probability"])
        for left, right in zip(quantized, scores)
    ]
    # This recording set was already evaluated in the previous experiment. Replay
    # is regression evidence, not an opening of this recipe's sealed acceptance.
    base.Detector = int8_detector
    base.MODEL = int8_path
    base.RUN = args.checkpoint
    regression = background_report()
    report = {
        "purpose": "development-only quantization diagnostic; never select or deploy this float graph",
        "checkpoint": str(args.checkpoint),
        "int8_sha256": decision["sha256"],
        "float_sha256": hashlib.sha256(float_path.read_bytes()).hexdigest(),
        "float_cutoff": cutoff,
        "float_negative_max": max(negatives),
        "float_summary": summary,
        "float_gate_passed": cutoff is not None and quality_gate(summary),
        "int8_summary": decision["summary"],
        "int8_cutoff": decision["cutoff"],
        "int8_gate_passed": decision["gate_passed"],
        "int8_legacy_background_regression": regression,
        "absolute_score_difference_mean": float(np.mean(differences)),
        "absolute_score_difference_p95": float(np.quantile(differences, 0.95)),
        "absolute_score_difference_max": max(differences),
        "elapsed_seconds": time.monotonic() - started,
        "acceptance_opened": False,
        "models_deployed": False,
    }
    (args.output / "float-development-clips.json").write_text(json.dumps(scores, indent=2) + "\n")
    report_path.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report), flush=True)


if __name__ == "__main__":
    main()
