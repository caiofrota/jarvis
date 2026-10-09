"""Diagnose the best development-only checkpoint per target after training exits."""

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

from run_attention_experiment import write_json


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    args = parser.parse_args()
    os.nice(15)
    original = json.loads((args.root / "pipeline-status.json").read_text())
    if original["phase"] not in ("complete", "needs_human_samples"):
        raise ValueError("Training must finish before this sequential diagnostic job")
    output = args.root / "diagnostics"
    output.mkdir(exist_ok=True)
    status = {
        "phase": "diagnosing_quantization",
        "status": "running",
        "herdr": original["herdr"],
        "models_deployed": False,
        "acceptance_opened": False,
        "started_unix": time.time(),
    }

    def update(**fields):
        status.update(fields, updated_unix=time.time())
        write_json(output / "pipeline-status.json", status)

    try:
        update()
        for kind in ("wake", "stop"):
            candidates = []
            for report_path in (args.root / kind).glob("attempt-*/step-*/development.json"):
                result = json.loads(report_path.read_text())
                if result["cutoff_valid"]:
                    candidates.append((result["summary"]["recall"], report_path.parent))
            if not candidates:
                raise ValueError(f"No valid-threshold {kind} checkpoint to compare")
            _, checkpoint = max(candidates)
            destination = output / kind
            update(target_class=kind, checkpoint=str(checkpoint))
            if (destination / "diagnostic.json").exists():
                continue
            command = [
                sys.executable,
                str(Path(__file__).parent / "diagnose_attention_quantization.py"),
                "--root",
                str(args.root / kind),
                "--checkpoint",
                str(checkpoint),
                "--output",
                str(destination),
            ]
            with (output / f"{kind}.log").open("a") as log:
                child = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT)
                update(child_pid=child.pid)
                code = child.wait()
            if code:
                raise RuntimeError(f"{kind} diagnostic exited {code}; see preserved log")
        update(phase="complete", status="diagnostic_only_not_deployed")
    except Exception as error:
        update(phase="failed", status="failed", error=str(error))
        raise


if __name__ == "__main__":
    main()
