"""Generate the explicit-name supplement only after base synthesis has finished."""

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    args = parser.parse_args()
    root = args.root
    deadline = time.monotonic() + 6 * 3600
    manifest = root / "corpus/manifest.json"
    while True:
        if (
            manifest.exists()
            and json.loads(manifest.read_text()).get("status") == "complete_synthetic_only"
        ):
            break
        if time.monotonic() > deadline:
            raise TimeoutError("Base corpus did not complete")
        time.sleep(10)
    scripts = Path(__file__).parent
    subprocess.run(
        [
            sys.executable,
            str(scripts / "generate_attention_corpus.py"),
            "--recipe",
            str(scripts / "attention_name_negatives.json"),
            "--output",
            str(root / "name-negatives"),
            "--progress-file",
            str(root / "name-negatives-progress.json"),
        ],
        check=True,
    )


if __name__ == "__main__":
    main()
