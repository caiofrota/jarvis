"""Train resumable segments; select checkpoints only after separate int8 stream scoring."""

import argparse
import json
import os
import random
import time
from pathlib import Path

import numpy as np
import tensorflow as tf
import train_candidate as base
import yaml
from attention_quality import required_window_frames
from microwakeword import data, mixednet, model_train_eval
from microwakeword.layers import modes
from training_window import bounded_window


class StreamingWindows(base.BoundedFeatures):
    """Expose negative prefixes and full endings, including startup's zero history."""

    def get_data(self, mode, batch_size, features_length, *args, **kwargs):
        if mode != "training":
            return super().get_data(mode, batch_size, features_length, *args, **kwargs)
        providers = [p for p in self.feature_providers if p.get_mode_size("training")]
        selected = random.choices(providers, [p.sampling_weight for p in providers], k=batch_size)
        inputs, labels, weights = [], [], []
        for provider in selected:
            # The pinned public helper scales the entire clip in "none" mode.
            # Read the mmap view directly and scale only the selected bounded slice.
            item = random.choice(provider.feature_sets["training"])
            full = provider.loaded_features[item["loaded_feature_index"]][item["subindex"]]
            if provider.label:
                end = max(1, len(full) - random.randrange(7))
            elif random.random() < 0.3:
                end = len(full)
            else:
                end = random.randrange(1, len(full) + 1)
            window = bounded_window(full, end, features_length)
            window = data.spec_augment(window, 6, 2, 4, 2)
            inputs.append(np.clip(window, 0, 26))
            labels.append(provider.label)
            weights.append(provider.penalty_weight)
        return np.asarray(inputs, dtype=np.float32), np.asarray(labels), np.asarray(weights)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--run-dir", type=Path, required=True)
    parser.add_argument("--until-step", type=int, required=True)
    parser.add_argument("--attempt", type=int, choices=(1, 2), required=True)
    args = parser.parse_args()
    if not 1000 <= args.until_step <= 8000 or args.until_step % 1000:
        raise ValueError("Bounded training segment required")
    os.nice(15)
    tf.config.threading.set_intra_op_parallelism_threads(1)
    tf.config.threading.set_inter_op_parallelism_threads(1)
    seed = 20260926 + args.attempt
    tf.keras.utils.set_random_seed(seed)
    run = args.run_dir
    run.mkdir(parents=True, exist_ok=True)
    features = args.root / "features"
    samples = json.loads((args.root / "corpus/manifest.json").read_text())["samples"]
    window_frames = required_window_frames(
        [s["duration_seconds"] for s in samples if s["split"] == "training" and s["truth"]]
    )
    config = {
        "train_dir": str(run),
        "window_step_ms": 10,
        "clip_duration_ms": 2000,
        "batch_size": 64,
        "features": [
            base.dataset(features / "positive", True, 3, "truncate_start"),
            base.dataset(features / "negative", False, 3, "random"),
            base.dataset(features / "noise", False, 0.5, "random"),
            base.dataset(Path("/work/datasets/dinner_party"), False, 2, "random"),
            base.dataset(features / "ambient", False, 0, "split"),
        ],
        "training_steps": [6000, 2000],
        "learning_rates": [0.0007, 0.0001],
        "negative_class_weight": [3, 5],
        "positive_class_weight": [1, 1],
        "seed": seed,
        "explicit_window_frames": window_frames,
        "experiment_note": "Synthetic development; int8 streaming validation chooses checkpoint",
    }
    parameter_path = run / "parameters.yaml"
    serialized = yaml.safe_dump(config, sort_keys=False)
    if parameter_path.exists() and parameter_path.read_text() != serialized:
        raise ValueError("Resume recipe changed")
    parameter_path.write_text(serialized)
    architecture = list(base.ARCHITECTURE)
    if args.attempt == 2:
        architecture[1] = "96,96,96,96"
    model_parser = argparse.ArgumentParser()
    mixednet.model_parameters(model_parser)
    flags = model_parser.parse_args(architecture)
    flags.training_config = str(parameter_path)
    config = model_train_eval.load_config(flags, mixednet)
    config["spectrogram_length"] = window_frames
    config["clip_duration_ms"] = (window_frames - 1) * 10 + 30
    config["spectrogram_length_final_layer"] = (
        window_frames - 1 - mixednet.spectrogram_slices_dropped(flags)
    ) // 3 + 1
    config["training_input_shape"] = modes.get_input_data_shape(config, modes.Modes.TRAINING)
    (run / "resolved_config.yaml").write_text(yaml.safe_dump(config))
    processor = StreamingWindows(config)
    model = mixednet.model(flags, config["training_input_shape"], 64)
    model.compile(optimizer=tf.keras.optimizers.Adam(), loss="binary_crossentropy")
    checkpoint = tf.train.Checkpoint(model=model, optimizer=model.optimizer)
    manager = tf.train.CheckpointManager(checkpoint, str(run / "resume"), max_to_keep=2)
    state_file = run / "resume-state.json"
    first, previous_elapsed, history = 1, 0.0, []
    if state_file.exists():
        state = json.loads(state_file.read_text())
        if state["step"] > args.until_step:
            raise ValueError("Cannot export an earlier step from a later checkpoint")
        checkpoint.restore(state["checkpoint"]).expect_partial()
        first, previous_elapsed, history = (
            state["step"] + 1,
            state["elapsed_seconds"],
            state["history"],
        )
        ns = state["numpy_random"]
        np.random.set_state((ns[0], np.asarray(ns[1], dtype=np.uint32), *ns[2:]))

        def tuples(value):
            return tuple(tuples(item) for item in value) if isinstance(value, list) else value

        random.setstate(tuples(state["python_random"]))
    started = time.monotonic()
    print(f"Segment {first}..{args.until_step}, parameters={model.count_params()}", flush=True)
    for step in range(first, args.until_step + 1):
        stage = int(step > 6000)
        model.optimizer.learning_rate.assign(config["learning_rates"][stage])
        x, y, weights = processor.get_data("training", 64, config["spectrogram_length"])
        weights *= np.where(y > 0, 1, config["negative_class_weight"][stage])
        model.reset_metrics()
        loss = float(model.train_on_batch(x, y.reshape(-1, 1), sample_weight=weights))
        if step % 250 == 0:
            print(f"Step {step}/8000, loss={loss:.6f}", flush=True)
        if step % 500 == 0:
            model.save_weights(str(run / "last.weights.h5"))
            path = manager.save(checkpoint_number=step)
            ns = list(np.random.get_state())
            ns[1] = ns[1].tolist()
            elapsed = previous_elapsed + time.monotonic() - started
            history.append({"step": step, "loss": loss, "elapsed_seconds": elapsed})
            state = {
                "step": step,
                "elapsed_seconds": elapsed,
                "checkpoint": path,
                "numpy_random": ns,
                "python_random": random.getstate(),
                "history": history,
                "parameters": model.count_params(),
            }
            temporary = state_file.with_suffix(".tmp")
            temporary.write_text(json.dumps(state, indent=2) + "\n")
            temporary.replace(state_file)
            print(json.dumps(history[-1]), flush=True)


if __name__ == "__main__":
    main()
