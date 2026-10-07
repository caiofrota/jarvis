"""Scan only repository source; never send source or credentials to a scanner service."""

import hashlib
import io
import platform
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TOOLS = {
    "gitleaks": (
        "https://github.com/gitleaks/gitleaks/releases/download/v8.24.2/gitleaks_8.24.2_linux_x64.tar.gz",
        "fa0500f6b7e41d28791ebc680f5dd9899cd42b58629218a5f041efa899151a8e",
    ),
    "actionlint": (
        "https://github.com/rhysd/actionlint/releases/download/v1.7.7/actionlint_1.7.7_linux_amd64.tar.gz",
        "023070a287cd8cccd71515fedc843f1985bf96c436b7effaecce67290e7e0757",
    ),
}


def main() -> None:
    if platform.system() != "Linux" or platform.machine() != "x86_64":
        raise SystemExit("This validation target requires Linux x86_64, as used in CI")
    cache = ROOT / ".cache/security"
    cache.mkdir(parents=True, exist_ok=True)
    for name, (url, checksum) in TOOLS.items():
        archive = cache / f"{name}.tar.gz"
        if not archive.exists():
            with urllib.request.urlopen(url, timeout=45) as response:
                archive.write_bytes(response.read())
        payload = archive.read_bytes()
        if hashlib.sha256(payload).hexdigest() != checksum:
            raise SystemExit(
                f"Checksum mismatch for {name}; remove the cached archive and inspect"
            )
        with tarfile.open(fileobj=io.BytesIO(payload)) as bundle:
            stream = bundle.extractfile(name)
            if stream is None:
                raise SystemExit(f"Missing executable: {name}")
            (cache / name).write_bytes(stream.read())
            (cache / name).chmod(0o700)
    subprocess.run([str(cache / "actionlint")], cwd=ROOT, check=True)
    with tempfile.TemporaryDirectory(prefix="rosie-source-scan-") as directory:
        stage = Path(directory)
        files = (
            subprocess.check_output(
                ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
                cwd=ROOT,
            )
            .decode()
            .split("\0")
        )
        for name in set(files) - {""}:
            source = ROOT / name
            if source.is_file() and not source.is_symlink():
                target = stage / name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source, target)
        command = [
            str(cache / "gitleaks"),
            "dir",
            "--redact",
            "--no-banner",
            str(stage),
        ]
        subprocess.run(command, check=True)
    with tempfile.TemporaryDirectory(prefix="rosie-scanner-fixture-") as directory:
        # Deliberately synthetic scanner fixture, assembled only in disposable storage.
        candidate = "AKIA" + "1234567890ABCDEF"
        Path(directory, "fixture.env").write_text(f"AWS_ACCESS_KEY_ID={candidate}\n")
        result = subprocess.run(
            [str(cache / "gitleaks"), "dir", "--redact", "--no-banner", directory],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        if result.returncode != 1:
            raise SystemExit("Secret scanner did not detect its synthetic fixture")
    print("Source secrets, scanner fixture, and workflow syntax checks passed")


if __name__ == "__main__":
    main()
