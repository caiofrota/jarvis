# Project context

## Native successor — 2026-09-22

The user requested a separate implementation without ESPHome. `native/` owns
the ESP-IDF firmware, local Python STT/TTS, OpenAI/DeepSeek conversation adapter,
runtime Wi-Fi portal, room-scoped MQTT catalog and editable humorous intents.
The initial robot room is Escritório, editable in the panel without reflashing.
One microWakeWord model is selected at build time; the default is Okay Nabu.
The first local Acorda Rosie model is now installed as an experimental trial.
The user confirmed wake and a spoken reply using the Brazilian pronunciation.
American-pronunciation reliability remains below the intended offline quality
gate; the previous native application is preserved for rollback. See the native
validation record for exact artifacts and limitations.
The confirmed WROOM was moved to the Proxmox USB host and authorized for direct
flashing. Its CH340 path is `/dev/serial/by-id/usb-1a86_USB_Serial-if00-port0`,
MAC `14:2b:2f:c2:0f:f8`. Do not touch the separate CP2102 adapter.
The server runs as a user service in the existing development LXC at
192.168.0.226:8765, outside HA. No new guest or radio configuration was created.
The native transport now uses compressed 100 ms batches, roughly 2.5 seconds of
queue capacity and configurable 60–1800 ms prefill (live value 600 ms). Local
TTS generation on the CPU remains the main delay for new Dora replies. The user
rejected sentence-at-a-time playback because synthesis gaps sounded like turn
boundaries; deliver each answer as one continuous stream. Twelve expressions
are supported, with curiosity distinct from confusion. The user prefers Node
and React for a future application architecture; no migration was requested
or performed during this repair.
The native validation record is [native/docs/validation.md](../native/docs/validation.md).

The user now wants named digital assistants shared by multiple independent
physical boxes, with household devices kept separate. Resident profiles and
behavior-mode profiles must also be distinct. The proposed model and migration
boundaries are recorded in
[native/docs/assistant-model-proposal.md](../native/docs/assistant-model-proposal.md).
This is a design proposal; the runtime still uses the original combined robot
catalog and global voice/volume settings.

The details below describe the previous ESPHome version and its historical deployment.

- Product: a stationary desk robot with a small expressive face and Brazilian Portuguese voice.
- Confirmed controller: ESP-WROOM-32 (classic ESP32); USB boot logs confirm revision 3.1
  and 4 MB flash. WebSerial identified ESP32-D0WD-V3.
- Audio: MAX98357A amplifier; microphone identified by the user as an INMP441 reference.
- Screen: user reports a 0.96-inch I2C OLED, probably 128x64. Use the SSD1306
  128x64 / 0x3C profile provisionally; controller and address are not yet confirmed.
- Face behavior: open eyes only while the enabled microphone is actually capturing
  with an Assist connection; closed eyelids otherwise. Wake-word capture counts as
  listening. The half-duplex assistant closes its eyes during reply playback.
- Voice activation: server-side openWakeWord on the existing Home Assistant OS VM.
- First version: half-duplex speech, Home Assistant Assist, existing cloud speech services,
  and an existing conversation-agent integration.
- Compiler: ESPHome 2026.9.0 using the ESP-IDF framework.
- A local language model is optional; on-device wake-word detection is not required.
- User-facing language: pt-BR. The README is a user installation guide in Portuguese.
- Requested conversation behavior: wake word once, automatic follow-up listening after
  each spoken answer, and exit by an explicit stop phrase or 30 seconds waiting for
  speech. Speech/processing/playback must not consume the next reply window.
- Network constraint: leave the Sala AP on channel 6 at 20 MHz for the user's test;
  no further network changes until user feedback authorizes them.
- Audio buffering: the user requested a HA-adjustable speaker buffer. Default
  500 ms, range 100–1000 ms; apply changes while the speaker is stopped, without
  interrupting the current playback. This is buffer capacity, not initial prefill.
- Handbook profiles: shared baseline only; the handbook has no ESPHome-specific profile.

## Source and device boundaries

`desk-robot.yaml` is the audio baseline. `desk-robot-oled.yaml` extends it for a confirmed
SSD1306 128x64 at 0x3C. Both describe the same physical device and are alternative builds.
The OLED variant is not a second deployed node.

The user's ESP32 is connected by USB to their Windows computer. This workspace runs
on their Proxmox infrastructure and has no access to that USB port. Initial flashing
is performed through the browser on Windows using a factory binary downloaded from
the Home Assistant ESPHome Device Builder.

Compilation validates the software and target architecture, not microphone wiring, power quality,
available runtime heap, acoustic echo, Wi-Fi reachability, or cloud credentials.

## Existing infrastructure inspected on 2026-09-21

- Proxmox: i3-4160, 2 physical cores / 4 threads, about 16 GB RAM.
- Home Assistant VM 900: 2 vCPUs, 6 GB RAM; Core 2026.8.3.
- ESPHome 2026.9.0 and openWakeWord 2.1.1 are installed and running.
- Rosie pipeline: pt-BR, server-side wake word `alexa`, Home Assistant Cloud STT/TTS,
  LeilaNeural voice, built-in Home Assistant conversation agent.
- `conversation.chatgpt` exists but is not selected in Rosie.
- Existing voice projects are considered failed experiments by the user.

Later inspection on the same day confirmed Rosie had changed to
`conversation.chatgpt`, with `prefer_local_intents: true` and server wake word
`okay_nabu`. Both cloud STT and TTS use `pt-BR`. Since the LLM accepts any language,
the pipeline uses the STT language for local intents. The matching custom sentence
folder is therefore `custom_sentences/pt-BR`. The ChatGPT conversation subentry
still has the stock concise-assistant prompt and Assist tool access. The proposed
personality prompt is documented locally, not applied to that remote subentry.

Both new YAML profiles were staged and validated in `/config/esphome/` on that VM.
Existing Wi-Fi credentials were reused, with dedicated `desk_robot_*` secret keys;
the previous shared secrets file was backed up before adding these keys. Legacy YAML
files and Assist pipelines were preserved. No device was flashed remotely.

## Reported and observed failures

On 2026-09-22, the user explicitly requested installing Ollama. It was installed
in a separate unprivileged Debian LXC 910 on the Proxmox host, with CPU and memory
limits. The experimental Qwen3 1.7B and 0.6B models are available, but were not
selected in Rosie: measured latency and quality did not meet the user's expected
conversation experience. The user confirmed that this miniPC has no dedicated
GPU. See `docs/ollama.md` for runtime settings, measurements and the pending
authenticated Home Assistant integration setup.

The user reports noise, freezes, latency, and loss of listening. These are physical/runtime
symptoms and their causes have not yet been isolated on a connected device.

Validation against the installed ESPHome version rejects `esp32-alexa.yaml` and
`my-voice-assistant.yaml` because `media_player: platform: i2s_audio` has been removed.
`esp32-voice.yaml` passes configuration validation but does not establish working audio.
The legacy files also differ in microphone channel and pin assignment, and one mixes ESP32-S3
SDK options into an `esp32dev` configuration. Do not assume that every historical symptom has
the same cause as today's configuration-validation failure.
