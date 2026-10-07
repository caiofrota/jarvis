"""Prepare private local configuration without overwriting an existing installation."""

import hashlib
import hmac
import json
import os
from pathlib import Path

root = Path(__file__).resolve().parents[1]
data = root / "native/data"
credential = data / "admin.token"
key = credential.read_bytes().strip()
if len(key) < 16:
    raise SystemExit("Existing administration credential is missing or invalid")
catalog = json.loads((data / "catalog.json").read_text())
voice_key = hmac.new(key, b"rosie:private-speech:v1", hashlib.sha256).hexdigest()
files = {
    data / "voice.token": voice_key + "\n",
    root / "apps/web/.env": (
        f"DATABASE_URL=file:{data}/application.sqlite\n"
        f"ROSIE_ADMIN_TOKEN_FILE={credential}\nROSIE_VOICE_TOKEN_FILE={data}/voice.token\n"
        "ROSIE_VOICE_URL=http://127.0.0.1:8766\nROSIE_ORIGIN=http://192.168.0.226:8765\n"
        "PORT=8765\nHOST=0.0.0.0\n"
    ),
    root / "native/voice/.env": (
        f"ROSIE_VOICE_TOKEN_FILE={data}/voice.token\nROSIE_MODEL_DIR={root}/native/models\n"
        f"ROSIE_WARM_STT={catalog['settings']['stt_model']}\n"
        f"ROSIE_WARM_VOICE={catalog['settings']['tts_voice']}\n"
    ),
}
if any(path.exists() for path in files):
    raise SystemExit("Configuration already exists; review it instead of overwriting")
for path, content in files.items():
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as stream:
        stream.write(content)
print("Private configuration prepared. No services were changed.")
