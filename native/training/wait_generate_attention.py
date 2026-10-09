"""Run a supplementary synthesis job only after the preceding heavy job completes."""

import argparse
import json
import os
import time
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--after", type=Path, required=True)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if not args.command:
        raise ValueError("An explicit synthesis command is required")
    deadline = time.monotonic() + 4 * 3600
    print("Waiting for preceding synthesis; no second heavy job is running", flush=True)
    while time.monotonic() < deadline:
        if args.after.exists():
            report = json.loads(args.after.read_text())
            if report.get("status") == "complete_synthetic_only":
                os.execv(args.command[0], args.command)
        time.sleep(10)
    raise TimeoutError("Preceding corpus did not finish within four hours")


if __name__ == "__main__":
    main()
