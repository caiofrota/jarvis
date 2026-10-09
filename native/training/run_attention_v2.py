"""Bounded two-attempt offline retraining, with sealed acceptance and no deployment."""

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

from run_attention_experiment import prepare_task, write_json


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    args = parser.parse_args()
    root = args.root
    registered = json.loads((root / "herdr-registration.json").read_text())
    if not registered["registered_before_training"] or not registered["pane"]:
        raise ValueError("User-required Herdr registration is a prerequisite")
    os.nice(15)
    status_path = root / "pipeline-status.json"
    started = time.time()
    status = {
        "herdr": registered,
        "status": "running",
        "phase": "waiting_for_corpus",
        "pid": os.getpid(),
        "started_unix": started,
        "models_deployed": False,
        "maximum_attempts_per_target": 2,
        "steps_per_attempt": 8000,
    }

    def update(phase, **extra):
        status.update(phase=phase, updated_unix=time.time(), **extra)
        write_json(status_path, status)
        print(json.dumps(status), flush=True)

    def run(script, label, *parameters):
        command = [sys.executable, str(Path(__file__).parent / script), *map(str, parameters)]
        update(script.removesuffix(".py"), stage_label=label, command=command)
        with (root / f"{label}.log").open("a") as log:
            child = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT)
            update(script.removesuffix(".py"), child_pid=child.pid)
            code = child.wait()
        if code:
            raise RuntimeError(f"{label} exited {code}; see preserved stage log")

    try:
        update("waiting_for_corpus")
        while True:
            manifest_path = root / "corpus/manifest.json"
            supplement_path = root / "continuous-stop/manifest.json"
            if manifest_path.exists() and supplement_path.exists():
                shared = json.loads(manifest_path.read_text())
                supplement = json.loads(supplement_path.read_text())
                if shared.get("status") == supplement.get("status") == "complete_synthetic_only":
                    if len(shared["samples"]) != shared["expected_count"]:
                        raise ValueError("Incomplete corpus")
                    if len(supplement["samples"]) != supplement["expected_count"]:
                        raise ValueError("Incomplete prosody supplement")
                    if shared["voice_groups"] != supplement["voice_groups"]:
                        raise ValueError("Prosody supplement source splits differ")
                    for item in shared["samples"]:
                        if item["class_key"] == "stop":
                            item["prosody"] = "comma_pause"
                    for item in supplement["samples"]:
                        shared["samples"].append(
                            dict(
                                item,
                                file="continuous/" + item["file"],
                                source_file=item["file"],
                                source_corpus="continuous-stop",
                                prosody="continuous",
                            )
                        )
                    shared["expected_count"] += supplement["expected_count"]
                    shared["prosody_recipe"] = supplement["recipe"]
                    manifest_path = root / "combined-corpus-manifest.json"
                    write_json(manifest_path, shared)
                    break
            if time.time() - started > 4 * 3600:
                raise TimeoutError("Corpus did not complete within four hours")
            time.sleep(10)
        # All hashes and source memberships are checked before gradient training.
        recipe = shared["recipe"]
        prior = json.loads(
            (root.parent / "rosie_attention_20260925/combined-corpus-manifest.json").read_text()
        )
        prior_voices = {s["voice"] for s in prior["samples"]}
        if set(recipe["voice_groups"]["testing"]) & prior_voices:
            raise ValueError("New acceptance voices appeared in the previous experiment")
        hashes = {}
        for item in shared["samples"]:
            if item["voice"] not in shared["voice_groups"][item["split"]]:
                raise ValueError("Split membership mismatch")
            path = (
                root / item.get("source_corpus", "corpus") / item.get("source_file", item["file"])
            )
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            if digest != item["sha256"]:
                raise ValueError("Corpus checksum mismatch")
            if digest in hashes and hashes[digest] != item["split"]:
                raise ValueError("Identical audio crosses splits")
            hashes[digest] = item["split"]
        write_json(
            root / "frozen-acceptance.json",
            {
                "manifest_sha256": hashlib.sha256(manifest_path.read_bytes()).hexdigest(),
                "voices": recipe["voice_groups"]["testing"],
                "samples": [s for s in shared["samples"] if s["split"] == "testing"],
                "role": "immutable_source_definition; evaluation openings are recorded per candidate",
            },
        )
        results = {}
        for kind in ("wake", "stop"):
            task_root = root / kind
            update("preparing_features", target_class=kind)
            prepare_task(root, kind, shared)
            if not (task_root / "features/manifest.json").exists():
                partial = task_root / "features"
                if partial.exists():
                    partial.rename(partial.with_name(f"features-interrupted-{time.time_ns()}"))
                run("prepare_attention_v2.py", f"{kind}-features", "--root", task_root)
            candidates = []
            selected = None
            for attempt in (1, 2):
                attempt_dir = task_root / f"attempt-{attempt:02d}"
                for step in (2000, 4000, 6000, 8000):
                    update("training", target_class=kind, attempt=attempt, until_step=step)
                    snapshot = attempt_dir / f"step-{step:05d}"
                    if not (snapshot / "export.json").exists():
                        run(
                            "train_attention_v2.py",
                            f"{kind}-attempt-{attempt}-train",
                            "--root",
                            task_root,
                            "--run-dir",
                            attempt_dir,
                            "--attempt",
                            attempt,
                            "--until-step",
                            step,
                        )
                        snapshot.mkdir(exist_ok=True)
                        for source, destination in (
                            ("last.weights.h5", "best.weights.h5"),
                            ("resolved_config.yaml", "resolved_config.yaml"),
                        ):
                            shutil.copy2(attempt_dir / source, snapshot / destination)
                        run(
                            "export_checkpoint.py",
                            f"{kind}-attempt-{attempt}-step-{step}-export",
                            snapshot,
                            "--model-name",
                            f"rosie_{kind}",
                        )
                    if not (snapshot / "development.json").exists():
                        run(
                            "evaluate_attention_v2.py",
                            f"{kind}-attempt-{attempt}-step-{step}-development",
                            "--root",
                            task_root,
                            "--run-dir",
                            snapshot,
                            "--model-name",
                            f"rosie_{kind}",
                            "--mode",
                            "development",
                        )
                    development = json.loads((snapshot / "development.json").read_text())
                    candidates.append(
                        {
                            "attempt": attempt,
                            "step": step,
                            "path": str(snapshot),
                            "development": development,
                        }
                    )
                    write_json(task_root / "development-results.json", candidates)
                    if development["gate_passed"]:
                        selected = snapshot
                        break
                if selected:
                    break
            if selected:
                # Selection is final before acceptance opens. A failure is not a new tuning round.
                write_json(
                    task_root / "frozen-candidate.json",
                    {
                        "path": str(selected),
                        "decision": json.loads((selected / "development.json").read_text()),
                    },
                )
                if not (selected / "acceptance.json").exists():
                    run(
                        "evaluate_attention_v2.py",
                        f"{kind}-acceptance",
                        "--root",
                        task_root,
                        "--run-dir",
                        selected,
                        "--model-name",
                        f"rosie_{kind}",
                        "--mode",
                        "acceptance",
                    )
                results[kind] = json.loads((selected / "acceptance.json").read_text())
            else:
                results[kind] = {
                    "gate_passed": False,
                    "acceptance_opened": False,
                    "reason": "No development candidate passed; real samples needed",
                    "attempts": 2,
                    "checkpoints_evaluated": len(candidates),
                }
            write_json(root / "results.json", results)
        passed = all(result["gate_passed"] for result in results.values())
        update(
            "complete" if passed else "needs_human_samples",
            status="offline_only_not_deployed",
            results=results,
            elapsed_seconds=time.time() - started,
        )
    except Exception as error:
        update("failed", status="failed", error=str(error))
        raise


if __name__ == "__main__":
    main()
