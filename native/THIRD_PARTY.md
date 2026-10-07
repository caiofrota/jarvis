# Third-party software and models

The native implementation is provided under GPL-3.0; see `LICENSE`. This applies
to `native/`, not retroactively to the separate ESPHome project in the parent.
Dependency licenses and copyright notices remain with their original authors.

- The streaming frontend parameters and quantization convention in `wake.cpp`
  follow Kevin Ahrendt's microWakeWord and the GPL-3.0
  [standalone adaptation by 0xD34D](https://github.com/0xD34D/micro_wake_word_standalone).
  The ESPHome runtime is not linked into this firmware.
- [microWakeWord training](https://github.com/OHF-Voice/micro-wake-word) is Apache-2.0.
  The default [Okay Nabu model manifest](https://github.com/esphome/micro-wake-word-models/blob/main/models/v2/okay_nabu.json)
  credits Kevin Ahrendt. Models are downloaded separately; consult their upstream
  notices before redistributing model artifacts.
- The experimental Acorda Rosie training data uses locally generated Kokoro
  examples and the pinned dinner-party feature archives from
  [kahrendt/microwakeword](https://huggingface.co/datasets/kahrendt/microwakeword),
  which declares CC-BY-NC-4.0. Their hashes and revision are in
  `training/sources.json`. Dataset artifacts and candidate model weights remain
  separate from the GPL application source; the application license does not
  override dataset or model restrictions.
- ESP-IDF, Espressif TensorFlow Lite Micro, ESP-NN, the WebSocket component and
  [ESP Micro Speech Features](https://github.com/kahrendt/ESPMicroSpeechFeatures)
  retain their upstream notices. Firmware dependencies are captured in
  `firmware/dependencies.lock`; the speech frontend is pinned by Git commit.
- [Piper](https://github.com/OHF-Voice/piper1-gpl) is GPL-3.0. The downloaded
  `pt_BR-faber-medium` voice has a [model card](https://huggingface.co/rhasspy/piper-voices/blob/main/pt/pt_BR/faber/medium/MODEL_CARD)
  identifying a CC0 dataset and fine-tuning from lessac medium. Voice artifacts
  are not included in the source checkout.
- The optional `pt_BR-cadu-medium` Piper voice has a
  [model card](https://huggingface.co/rhasspy/piper-voices/blob/main/pt/pt_BR/cadu/medium/MODEL_CARD)
  identifying a CC0 dataset and fine-tuning from lessac medium. It is downloaded
  separately for the local voice comparison, not bundled with the application.
- [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M) model weights and
  [Misaki](https://github.com/hexgrad/misaki) are Apache-2.0.
  [kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx) is MIT.
  The optional Dora voice uses the upstream `pf_dora` style. Models are fetched
  from pinned upstream releases with SHA-256 verification by `tools/download_kokoro.py`.
  Phonemizer and eSpeak NG retain their GPL notices; the project already uses GPL-3.0.
- [Supertonic Python](https://github.com/supertone-oss-archive/supertonic-py) is MIT;
  version 1.3.1 is locked. The optional
  [Supertonic 3 weights](https://huggingface.co/supertone-oss-archive/supertonic-3)
  use the BigScience Open RAIL-M license, retained with the downloaded weights.
  `tools/download_supertonic.py` pins upstream revision
  `aafc6e32416a594460b32413efc49d7fe4ce6d46` and verifies LFS SHA-256 or Git blob
  SHA-1 metadata and size before installing each file. Only styles F1 and M1
  are included in this local comparison. The upstream repository was archived
  on 2026-09-09; ongoing maintenance must not be assumed. Weights are downloaded
  separately and are not redistributed in this checkout.
- faster-whisper, CTranslate2, Whisper model weights, ONNX Runtime, WebRTC VAD,
  FastAPI, Paho, NumPy and SciPy are independently versioned dependencies; the
  Python environment is reproduced from `uv.lock`.
- Local speaker identification uses [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)
  (Apache-2.0) and the separately downloaded, unmodified WeSpeaker ResNet34-LM
  VoxCeleb encoder. [WeSpeaker's pretrained-model notice](https://github.com/wenet-e2e/wespeaker/blob/master/docs/pretrained.md)
  identifies VoxCeleb-trained models as CC BY 4.0. Credit the WeSpeaker and
  [VoxCeleb authors](https://www.robots.ox.ac.uk/~vgg/data/voxceleb/) and retain the
  [license terms](https://creativecommons.org/licenses/by/4.0/) if redistributing
  the model. Artifact hash, installation and validation limits are in the
  [speaker identification contract](../docs/engineering/speaker-identification.md).

No provider API keys, household catalog, Wi-Fi credentials or private audio are
part of the distributed source.
