"""Verify and unpack the downloaded background archives, including interrupted extractions."""

import hashlib
import json
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sources = json.loads((root / "training/sources.json").read_text())
data = root / "artifacts/wake/datasets"
for name, expected in sources["background"]["files"].items():
    archive = data / name
    with archive.open("rb") as stream:
        if hashlib.file_digest(stream, "sha256").hexdigest() != expected:
            raise SystemExit(f"Unverified dataset archive: {name}")
    marker = data / (name + ".complete")
    if marker.exists() and marker.read_text().strip() == expected:
        continue
    with zipfile.ZipFile(archive) as compressed:
        for entry in compressed.infolist():
            if not (data / entry.filename).resolve().is_relative_to(data.resolve()):
                raise SystemExit("Unsafe dataset archive path")
        compressed.extractall(data)
    marker.write_text(expected + "\n")
    print(f"Verified and extracted {name}", flush=True)

reports = [
    json.loads((root / "artifacts/wake" / name).read_text())
    for name in ("tensorflow-install.json", "training-install.json")
]
packages = {
    p["metadata"]["name"].lower().replace("_", "-"): p
    for report in reports
    for p in report["install"]
}
lines = ["# Isolated CPU training environment: Python 3.12 / Linux x86_64; resolved 2026-09-22."]
for name, package in sorted(packages.items()):
    download = package["download_info"]
    source = (
        (package["metadata"]["name"] + " @ " + download["url"])
        if name == "audio-metadata"
        else (package["metadata"]["name"] + "==" + package["metadata"]["version"])
    )
    lines.append(source + " --hash=sha256:" + download["archive_info"]["hashes"]["sha256"])
(root / "training/requirements.lock").write_text("\n".join(lines) + "\n")
print(f"Locked {len(packages)} training dependencies.", flush=True)
