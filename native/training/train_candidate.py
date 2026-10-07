"""Train one bounded CPU experiment using the pinned upstream microWakeWord architecture.

The local loop bounds evaluation batches and applies one sample weight per example.
Checkpoint selection uses only validation data; streaming testing follows export.
"""

import argparse
import hashlib
import json
import os
import random
import time
from pathlib import Path

import numpy as np
import tensorflow as tf
import yaml
from microwakeword import data, mixednet, model_train_eval, utils
from microwakeword.layers import modes
from streaming_contract import calibration_config

ROOT = Path("/work/acorda_rosie")
RUN = ROOT / "candidate-01"
BATCH = 128
STEPS = 10000
SEED = 20260922
MODEL_NAME = "acorda_rosie"
CLIP_MS = 1500
RESUME = False
ARCHITECTURE = [
    "--pointwise_filters",
    "64,64,64,64",
    "--repeat_in_block",
    "1,1,1,1",
    "--mixconv_kernel_sizes",
    "[5], [7,11], [9,15], [23]",
    "--residual_connection",
    "0,0,0,0",
    "--first_conv_filters",
    "32",
    "--first_conv_kernel_size",
    "5",
    "--stride",
    "3",
]


class BoundedFeatures(data.FeatureHandler):
    """Match the frontend's saturated range used by the ESP32 int8 input."""

    def get_data(self, *args, **kwargs):
        inputs, labels, weights = super().get_data(*args, **kwargs)
        return np.clip(inputs, 0, 26).astype(np.float32), labels, weights


def dataset(path, truth, weight, truncation):
    return {
        "features_dir": str(path),
        "truth": truth,
        "sampling_weight": weight,
        "penalty_weight": 1.0,
        "truncation_strategy": truncation,
        "type": "mmap",
    }


def configuration():
    features = ROOT / "features"
    config = {
        "train_dir": str(RUN),
        "window_step_ms": 10,
        "clip_duration_ms": CLIP_MS,
        "batch_size": BATCH,
        "features": [
            dataset(features / "positive", True, 2, "truncate_start"),
            dataset(features / "negative", False, 1, "random"),
            dataset(features / "noise", False, 0.5, "random"),
            dataset(Path("/work/datasets/dinner_party"), False, 4, "random"),
            dataset(features / "ambient", False, 0, "split"),
        ],
        "training_steps": [int(STEPS * 0.7), STEPS - int(STEPS * 0.7)],
        "learning_rates": [0.001, 0.0001],
        "negative_class_weight": [5, 10],
        "positive_class_weight": [1, 1],
        "seed": SEED,
        "experiment_note": "First synthetic prototype; not validated on the user's voice",
    }
    path = RUN / "parameters.yaml"
    path.write_text(yaml.safe_dump(config, sort_keys=False))
    parser = argparse.ArgumentParser()
    mixednet.model_parameters(parser)
    flags = parser.parse_args(ARCHITECTURE)
    flags.training_config = str(path)
    return model_train_eval.load_config(flags, mixednet), flags


def predict(model, inputs):
    outputs = []
    for start in range(0, len(inputs), BATCH):
        batch = inputs[start : start + BATCH].astype(np.float32)
        actual = len(batch)
        if actual < BATCH:
            batch = np.pad(batch, ((0, BATCH - actual), (0, 0), (0, 0)))
        outputs.extend(model(batch, training=False).numpy().reshape(-1)[:actual])
    return np.asarray(outputs)


def main():
    os.nice(15)
    tf.config.threading.set_intra_op_parallelism_threads(1)
    tf.config.threading.set_inter_op_parallelism_threads(1)
    tf.keras.utils.set_random_seed(SEED)
    if not (ROOT / "features/manifest.json").exists():
        raise ValueError("Complete feature preparation is required")
    RUN.mkdir(exist_ok=RESUME)
    requested = {
        "root": str(ROOT),
        "steps": STEPS,
        "seed": SEED,
        "model_name": MODEL_NAME,
        "clip_ms": CLIP_MS,
    }
    request_path = RUN / "run-request.json"
    if request_path.exists() and json.loads(request_path.read_text()) != requested:
        raise ValueError("Resume parameters differ from the preserved run")
    request_path.write_text(json.dumps(requested, indent=2) + "\n")
    config, flags = configuration()
    (RUN / "resolved_config.yaml").write_text(yaml.safe_dump(config))
    processor = BoundedFeatures(config)
    model = mixednet.model(flags, config["training_input_shape"], BATCH)
    model.compile(optimizer=tf.keras.optimizers.Adam(), loss="binary_crossentropy")
    checkpoint = tf.train.Checkpoint(model=model, optimizer=model.optimizer)
    manager = tf.train.CheckpointManager(checkpoint, str(RUN / "resume"), max_to_keep=2)
    utils.save_model_summary(model, str(RUN))
    validation_x, validation_y, _ = processor.get_data(
        "validation", BATCH, config["spectrogram_length"], "truncate_start"
    )
    ambient_x, _, _ = processor.get_data(
        "validation_ambient", BATCH, config["spectrogram_length"], "split"
    )
    policy = {
        "time_mask_max_size": 0,
        "time_mask_count": 0,
        "freq_mask_max_size": 2,
        "freq_mask_count": 1,
    }
    best = (-1.0, float("-inf"))
    started = time.monotonic()
    history = []
    start_step = 1
    prior_elapsed = 0.0
    state_path = RUN / "resume-state.json"
    if RESUME and state_path.exists():
        state = json.loads(state_path.read_text())
        checkpoint.restore(state["checkpoint"]).expect_partial()
        start_step = state["step"] + 1
        best = tuple(state["best"])
        history = state["history"]
        prior_elapsed = state["elapsed_seconds"]
        np_state = state["numpy_random"]
        np.random.set_state((np_state[0], np.asarray(np_state[1], dtype=np.uint32), *np_state[2:]))

        def tuples(value):
            return tuple(tuples(item) for item in value) if isinstance(value, list) else value

        random.setstate(tuples(state["python_random"]))
        print(f"Resuming checkpoint after step {state['step']}", flush=True)
    print(f"Training started: {STEPS} steps, {model.count_params()} parameters", flush=True)
    for step in range(start_step, STEPS + 1):
        stage = int(step > int(STEPS * 0.7))
        model.optimizer.learning_rate.assign(config["learning_rates"][stage])
        x, y, weights = processor.get_data(
            "training", BATCH, config["spectrogram_length"], "default", policy
        )
        weights = weights * np.where(y > 0, 1, config["negative_class_weight"][stage])
        if weights.shape != (BATCH,):
            raise ValueError("Expected one loss weight per example")
        model.reset_metrics()
        loss = float(
            model.train_on_batch(x.astype(np.float32), y.reshape(-1, 1), sample_weight=weights)
        )
        if step % 250 == 0:
            print(
                f"Step {step}/{STEPS}; loss={loss:.5f}; elapsed={time.monotonic() - started:.1f}s",
                flush=True,
            )
        if step % 500 == 0 or step == STEPS:
            predictions = predict(model, validation_x)
            ambient_predictions = predict(model, ambient_x)
            negatives = np.concatenate((predictions[validation_y == 0], ambient_predictions))
            cutoff = float(min(0.9999, max(0.5, float(negatives.max()) + 0.01)))
            recall = float(np.mean(predictions[validation_y == 1] >= cutoff))
            clipped = np.clip(predictions, 1e-7, 1 - 1e-7)
            bce = float(
                -np.mean(validation_y * np.log(clipped) + (1 - validation_y) * np.log(1 - clipped))
            )
            entry = {
                "step": step,
                "elapsed_seconds": prior_elapsed + time.monotonic() - started,
                "validation_recall": recall,
                "validation_bce": bce,
                "validation_cutoff": cutoff,
                "negative_max": float(negatives.max()),
                "negative_windows_above_cutoff": int(np.sum(negatives >= cutoff)),
            }
            history.append(entry)
            model.save_weights(str(RUN / "last.weights.h5"))
            if (recall, -bce) > best:
                best = (recall, -bce)
                model.save_weights(str(RUN / "best.weights.h5"))
                (RUN / "best-validation.json").write_text(json.dumps(entry, indent=2) + "\n")
            (RUN / "history.json").write_text(json.dumps(history, indent=2) + "\n")
            checkpoint_path = manager.save(checkpoint_number=step)
            numpy_state = list(np.random.get_state())
            numpy_state[1] = numpy_state[1].tolist()
            temporary = state_path.with_suffix(".tmp")
            temporary.write_text(
                json.dumps(
                    {
                        "step": step,
                        "best": best,
                        "history": history,
                        "elapsed_seconds": entry["elapsed_seconds"],
                        "checkpoint": checkpoint_path,
                        "numpy_random": numpy_state,
                        "python_random": random.getstate(),
                    },
                    indent=2,
                )
                + "\n"
            )
            temporary.replace(state_path)
            print("Validation: " + json.dumps(entry), flush=True)
    print("Training completed; exporting the best validation checkpoint", flush=True)
    exported = mixednet.model(flags, shape=config["training_input_shape"], batch_size=1)
    exported.load_weights(str(RUN / "best.weights.h5"))
    utils.convert_model_saved(
        exported, config, "stream_state_internal", modes.Modes.STREAM_INTERNAL_STATE_INFERENCE
    )
    utils.convert_saved_model_to_tflite(
        calibration_config(config),
        processor,
        str(RUN / "stream_state_internal"),
        str(RUN),
        f"{MODEL_NAME}.tflite",
        quantize=True,
    )
    model_file = RUN / f"{MODEL_NAME}.tflite"
    report = {
        "status": "exported_pending_streaming_and_human_evaluation",
        "sha256": hashlib.sha256(model_file.read_bytes()).hexdigest(),
        "bytes": model_file.stat().st_size,
        "elapsed_seconds": prior_elapsed + time.monotonic() - started,
        "steps": STEPS,
        "parameters": model.count_params(),
        "training_feature_frames": config["spectrogram_length"],
        "calibration_feature_frames": calibration_config(config)["spectrogram_length"],
    }
    (RUN / "export.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--run-dir", type=Path)
    parser.add_argument("--model-name", default=MODEL_NAME)
    parser.add_argument("--steps", type=int, default=STEPS)
    parser.add_argument("--seed", type=int, default=SEED)
    parser.add_argument("--clip-ms", type=int, default=CLIP_MS)
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args()
    ROOT, RUN = args.root, args.run_dir or args.root / "candidate-01"
    MODEL_NAME, STEPS, SEED, CLIP_MS = args.model_name, args.steps, args.seed, args.clip_ms
    RESUME = args.resume
    if not 1000 <= STEPS <= 20000 or not 1000 <= CLIP_MS <= 3000:
        raise SystemExit("Training bounds exceeded")
    main()
