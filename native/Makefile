UV ?= uv
IDF_IMAGE := espressif/idf@sha256:4317595a911886e04cbc6d731315d5fc2918e510b6733fc7d03381ab2d270082

.PHONY: install start test lint format build model models
install:
	$(UV) sync --locked
	pnpm install --frozen-lockfile
start:
	.venv/bin/uvicorn server.app:app --host 0.0.0.0 --port 8765 --ws-max-size 8192 --ws-max-queue 8
test:
	$(UV) run --locked pytest -q
lint:
	.venv/bin/ruff check server voice tools tests training
	.venv/bin/ruff format --check server voice tools tests training
	$(UV) run --locked mypy
	.venv/bin/python -m compileall -q server voice tools training
	node --check server/static/app.js
	pnpm run format:assets:check
	.venv/bin/python tools/check_docs.py
	.venv/bin/clang-format --dry-run --Werror firmware/main/main.cpp firmware/main/wake.cpp firmware/main/face.cpp firmware/main/provision.cpp firmware/main/robot.h firmware/main/audio_codec.h firmware/main/face_art.h firmware/main/appearance.h tools/render_faces.cpp
format:
	.venv/bin/ruff check server voice tools tests training --fix
	.venv/bin/ruff format server voice tools tests training
	pnpm run format:assets
	.venv/bin/clang-format -i firmware/main/main.cpp firmware/main/wake.cpp firmware/main/face.cpp firmware/main/provision.cpp firmware/main/robot.h firmware/main/audio_codec.h firmware/main/face_art.h firmware/main/appearance.h tools/render_faces.cpp
model:
	python3 tools/select_wake.py https://raw.githubusercontent.com/esphome/micro-wake-word-models/main/models/v2/okay_nabu.json --sha256 0689abe1912a95a3318a0d8cb2e67bad0cbcfe3e24dd6e050c75debddfb6f891
build:
	docker run --rm --cpus=2 --memory=1500m -v $(CURDIR)/firmware:/project -w /project $(IDF_IMAGE) bash -c 'idf.py reconfigure && ninja -C build -j2'
models:
	.venv/bin/python -m piper.download_voices --data-dir models/piper pt_BR-faber-medium
	.venv/bin/python -c 'from faster_whisper import WhisperModel; WhisperModel("base",device="cpu",compute_type="int8",cpu_threads=2,download_root="models/whisper")'
