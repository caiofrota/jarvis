"""Run durable offline preparation and training after the complete corpus is available."""

import json
import subprocess
import sys
import time
from pathlib import Path

manifest = Path("/work/acorda_rosie/corpus/manifest.json")
deadline = time.monotonic() + 3600
while True:
    if manifest.exists() and len(json.loads(manifest.read_text())["samples"]) == 520:
        break
    if time.monotonic() > deadline:
        raise SystemExit("Corpus did not complete within one hour; training was not started")
    time.sleep(10)

for script in ("prepare_features.py", "train_candidate.py"):
    print(f"Starting {script}", flush=True)
    subprocess.run([sys.executable, f"/recipe/{script}"], check=True)
