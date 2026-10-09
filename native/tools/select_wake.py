"""Embed exactly one v2 microWakeWord model; model artifacts are not application code."""

import argparse
import hashlib
import json
from pathlib import Path
from urllib.parse import urljoin
from urllib.request import urlopen

parser = argparse.ArgumentParser()
parser.add_argument("manifest", help="local JSON file or HTTPS v2 model manifest")
parser.add_argument("--sha256", help="expected SHA256 for the .tflite model")
args = parser.parse_args()
remote = args.manifest.startswith("https://")
meta = json.loads(
    urlopen(args.manifest, timeout=30).read() if remote else Path(args.manifest).read_text()
)
if meta.get("version") != 2 or meta.get("type") != "micro":
    raise SystemExit("Use a version 2 microWakeWord manifest.")
path = meta["model"]
if remote:
    url = urljoin(args.manifest, path)
    if not url.startswith("https://"):
        raise SystemExit("Model must use HTTPS.")
    data = urlopen(url, timeout=30).read(1024 * 1024)
else:
    data = (Path(args.manifest).parent / path).read_bytes()
digest = hashlib.sha256(data).hexdigest()
if args.sha256 and digest != args.sha256:
    raise SystemExit("Model checksum mismatch.")
if len(data) < 16 or data[4:8] != b"TFL3" or len(data) > 512 * 1024:
    raise SystemExit("Invalid or oversized TFLite model.")
m = meta["micro"]
if int(m["feature_step_size"]) not in (10, 20) or not 1 <= int(m["sliding_window_size"]) <= 30:
    raise SystemExit("Unsupported frontend parameters.")
if not 4096 <= int(m["tensor_arena_size"]) <= 96000 or not 0 < float(m["probability_cutoff"]) <= 1:
    raise SystemExit("Model memory/threshold outside WROOM limits.")
header = f"""#pragma once
#include <cstdint>
#define WAKE_NAME {json.dumps(meta["wake_word"])}
#define WAKE_ARENA {int(m["tensor_arena_size"]) + 2048}
#define WAKE_STEP_MS {int(m["feature_step_size"])}
#define WAKE_WINDOW {int(m["sliding_window_size"])}
#define WAKE_CUTOFF {float(m["probability_cutoff"])}f
alignas(16) static const uint8_t wake_model[] = {{
"""
header += (
    "\n".join(",".join(str(x) for x in data[i : i + 24]) + "," for i in range(0, len(data), 24))
    + "\n};\n"
)
root = Path(__file__).resolve().parents[1]
(root / "firmware/main/wake_model.h").write_text(header)
print(
    json.dumps(
        {
            "wake_word": meta["wake_word"],
            "sha256": digest,
            "bytes": len(data),
            "arena": int(m["tensor_arena_size"]) + 2048,
        }
    )
)
