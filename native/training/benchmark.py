"""Measure the upstream model's CPU training cost; random inputs are not training data."""

import argparse
import json
import os
import resource
import time
from pathlib import Path

import numpy as np
import tensorflow as tf
from microwakeword import mixednet
from microwakeword.layers import modes

os.nice(10)
tf.config.threading.set_intra_op_parallelism_threads(1)
tf.config.threading.set_inter_op_parallelism_threads(1)
tf.keras.utils.set_random_seed(20260922)
parser = argparse.ArgumentParser()
mixednet.model_parameters(parser)
flags = parser.parse_args(
    [
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
)
config = {
    "spectrogram_length": 1 + (1500 - 30) // 30 + mixednet.spectrogram_slices_dropped(flags),
    "stride": 3,
}
shape = modes.get_input_data_shape(config, modes.Modes.TRAINING)
batch_size = 128
model = mixednet.model(flags, shape, batch_size)
model.compile(optimizer=tf.keras.optimizers.Adam(), loss="binary_crossentropy")
rng = np.random.default_rng(20260922)
x = rng.uniform(0, 26, (batch_size, *shape)).astype(np.float32)
y = rng.integers(0, 2, (batch_size, 1)).astype(np.float32)
started = time.monotonic()
for _ in range(3):
    model.train_on_batch(x, y)
cold_seconds = time.monotonic() - started
timings = []
for i in range(10):
    started = time.monotonic()
    model.train_on_batch(x, y)
    timings.append(time.monotonic() - started)
    print(f"Benchmark step {i + 1}: {timings[-1]:.3f} s", flush=True)
report = {
    "tensorflow": tf.__version__,
    "batch_size": batch_size,
    "shape": list(shape),
    "parameters": model.count_params(),
    "cold_three_steps_seconds": cold_seconds,
    "mean_step_seconds": float(np.mean(timings)),
    "median_step_seconds": float(np.median(timings)),
    "peak_rss_mib": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024,
    "projected_10000_steps_hours_excluding_data_and_evaluation": float(
        np.mean(timings) * 10000 / 3600
    ),
    "trained_wake_model": False,
}
Path("benchmark.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report), flush=True)
