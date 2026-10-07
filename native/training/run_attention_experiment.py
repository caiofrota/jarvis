"""Durable, sequential, offline wake/stop pipeline; never selects or deploys models."""

import argparse
import hashlib
import json
import os
import subprocess
import sys
import time
from pathlib import Path


def write_json(path, value):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    temporary.replace(path)


def prepare_task(root, kind, shared):
    """Relabel the same split-preserving sources, including the other addressed class."""
    target = root / kind / "corpus"
    target.mkdir(parents=True, exist_ok=True)
    samples = []
    for item in shared["samples"]:
        source = root / item.get("source_corpus", "corpus") / item.get("source_file", item["file"])
        if hashlib.sha256(source.read_bytes()).hexdigest() != item["sha256"]:
            raise ValueError(f"Changed source clip: {item['file']}")
        output = target / item["file"]
        output.parent.mkdir(parents=True, exist_ok=True)
        if not output.exists():
            os.link(source, output)
        elif hashlib.sha256(output.read_bytes()).hexdigest() != item["sha256"]:
            raise ValueError("A derived corpus differs from its source")
        samples.append(dict(item, truth=item["class_key"] == kind))
    manifest = {
        "voice_groups": shared["voice_groups"],
        "samples": samples,
        "expected_count": shared["expected_count"],
        "target_class": kind,
        "shared_corpus_sha256": hashlib.sha256(
            json.dumps(shared, sort_keys=True).encode()
        ).hexdigest(),
    }
    output = target / "manifest.json"
    if output.exists() and json.loads(output.read_text()) != manifest:
        raise ValueError("Task corpus changed; choose a new experiment")
    write_json(output, manifest)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--wait-hours", type=float, default=6)
    args = parser.parse_args()
    root = args.root
    root.mkdir(parents=True, exist_ok=True)
    status_file = root / "pipeline-status.json"
    os.nice(15)
    started = time.time()
    status = {
        "status": "running",
        "phase": "waiting_for_corpus",
        "started_unix": started,
        "pid": os.getpid(),
        "models_deployed": False,
        "steps_per_candidate": 10000,
    }

    def update(phase, **extra):
        status.update(phase=phase, updated_unix=time.time(), **extra)
        write_json(status_file, status)
        print(json.dumps(status), flush=True)

    def run(script, kind, *extra):
        update(script.removesuffix(".py"), target_class=kind)
        command = [
            sys.executable,
            str(Path(__file__).parent / script),
            "--root",
            str(root / kind),
            *extra,
        ]
        with (root / f"{kind}-{script.removesuffix('.py')}.log").open("a") as log:
            child = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT)
            update(script.removesuffix(".py"), child_pid=child.pid, command=command)
            code = child.wait()
        if code:
            raise RuntimeError(f"{script} for {kind} exited {code}; see stage log")

    try:
        update("waiting_for_corpus")
        manifest = root / "corpus/manifest.json"
        supplement_manifest = root / "name-negatives/manifest.json"
        while True:
            if manifest.exists() and supplement_manifest.exists():
                shared = json.loads(manifest.read_text())
                supplement = json.loads(supplement_manifest.read_text())
                if shared.get("status") == supplement.get("status") == "complete_synthetic_only":
                    if len(shared["samples"]) != shared["expected_count"]:
                        raise ValueError("Incomplete corpus")
                    if len(supplement["samples"]) != supplement["expected_count"]:
                        raise ValueError("Incomplete supplement")
                    if shared["voice_groups"] != supplement["voice_groups"]:
                        raise ValueError("Supplement source splits differ")
                    for item in supplement["samples"]:
                        shared["samples"].append(
                            dict(
                                item,
                                file="supplement/" + item["file"],
                                source_file=item["file"],
                                source_corpus="name-negatives",
                            )
                        )
                    shared["expected_count"] += supplement["expected_count"]
                    shared["supplement_recipe"] = supplement["recipe"]
                    write_json(root / "combined-corpus-manifest.json", shared)
                    break
            if time.time() - started > args.wait_hours * 3600:
                raise TimeoutError("Corpus did not complete within the bounded wait")
            time.sleep(10)
        results = {}
        for kind in ("wake", "stop"):
            update("preparing_task_corpus", target_class=kind)
            prepare_task(root, kind, shared)
            features = root / kind / "features"
            if not (features / "manifest.json").exists():
                if features.exists():
                    # Keep evidence of an interrupted preparation before deterministic rebuilding.
                    features.rename(features.with_name(f"features-interrupted-{time.time_ns()}"))
                run("prepare_features.py", kind, "--seed", "20260925")
            candidate = root / kind / "candidate-01"
            if not (candidate / "export.json").exists():
                run(
                    "train_candidate.py",
                    kind,
                    "--seed",
                    "20260925",
                    "--clip-ms",
                    "2000",
                    "--model-name",
                    f"rosie_{kind}",
                    "--resume",
                )
            if not (candidate / "evaluation.json").exists():
                run("evaluate_candidate.py", kind, "--model-name", f"rosie_{kind}")
            evaluation = json.loads((candidate / "evaluation.json").read_text())
            export = json.loads((candidate / "export.json").read_text())
            results[kind] = {"export": export, "evaluation": evaluation}
            write_json(root / "results.json", results)
        update(
            "complete",
            status="complete_offline_candidates_not_deployed",
            quality_gates={
                key: result["evaluation"]["offline_candidate_gate_passed"]
                for key, result in results.items()
            },
            elapsed_seconds=time.time() - started,
        )
    except Exception as error:
        update(status["phase"], status="failed", error=str(error))
        raise


if __name__ == "__main__":
    main()
