"""Export a preserved checkpoint without stopping or modifying an active training run."""

import argparse
import hashlib
import json
import os
from pathlib import Path

import tensorflow as tf
import yaml
from microwakeword import mixednet, utils
from microwakeword.layers import modes
from streaming_contract import calibration_config
from train_candidate import BoundedFeatures

os.nice(15)
tf.config.threading.set_intra_op_parallelism_threads(1)
tf.config.threading.set_inter_op_parallelism_threads(1)
tf.keras.utils.set_random_seed(20260922)
parser = argparse.ArgumentParser()
parser.add_argument("run", type=Path)
parser.add_argument("--model-name", default="acorda_rosie")
args = parser.parse_args()
output = args.run / f"{args.model_name}.tflite"
if output.exists():
    raise SystemExit("Preserve the existing export and use a fresh checkpoint snapshot directory")
config = yaml.safe_load((args.run / "resolved_config.yaml").read_text())
config["train_dir"] = str(args.run)
flags = argparse.Namespace(**config["flags"])
model = mixednet.model(flags, config["training_input_shape"], 1)
model.load_weights(str(args.run / "best.weights.h5"))
processor = BoundedFeatures(config)
utils.convert_model_saved(
    model, config, "stream_state_internal", modes.Modes.STREAM_INTERNAL_STATE_INFERENCE
)
utils.convert_saved_model_to_tflite(
    calibration_config(config),
    processor,
    str(args.run / "stream_state_internal"),
    str(args.run),
    output.name,
    quantize=True,
)
report = {
    "status": "checkpoint_exported_not_deployed",
    "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
    "bytes": output.stat().st_size,
}
(args.run / "export.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report), flush=True)
