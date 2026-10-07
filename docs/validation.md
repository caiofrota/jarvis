# Validation record

## Ollama installation and CPU-only evaluation — 2026-09-22

The user explicitly requested installing Ollama and asked whether it would run
inside HA or separately. An unprivileged Debian 13 LXC 910 (`ollama`) was created
on the existing Proxmox host, using `local-lvm:16`, 2304 MiB RAM, no container swap,
two visible CPUs, a 1.5 CPU limit and CPU weight 50. Existing guests, the preferred
voice pipeline and the Sala radio configuration were not changed. The host had
about 3257 MiB available and 3735 MiB swap in use before creation; adding a large
local model was therefore inappropriate. The new guest received DHCP address
192.168.20.245 in VLAN 20, MAC BC:24:11:9E:BF:5A. No DHCP reservation was created.

Ollama 0.34.2 was installed from the official release archive after verifying
SHA-256 `e155b83589986d2c581fdbf1381ea3ebdb16549883679cd5a0627f7cdc05b12b`.
The downloaded archive was removed after extraction. Debian package updates
were applied only to the new container. Dedicated service-user, model-storage,
systemd and nftables settings are recorded in `infra/ollama/` and `docs/ollama.md`.
`systemd-analyze verify` and `nft --check` passed before starting the service.
The API is restricted to localhost, the HA address and the Proxmox address.
Cloud inference is disabled, with one loaded model/request at a time and a
two-minute idle unload. No GPU device was passed through.

Official model pulls completed with digest verification for Qwen3 1.7B
(`8f68893c685c`, 1.4 GB) and 0.6B (`7df6b6e09427`, 522 MB). Direct API tests
used Portuguese messages, 2048 context tokens, two threads, `think: false`,
temperature 0.2 and at most 100 output tokens. The 1.7B model took 19.61 s
including cold loading (46 output tokens), 13.72 s warm (48 tokens), and 14.90 s
to emit a synthetic read-only tool call. The 0.6B model took 6.06 s cold
(25 tokens), 2.92 s warm (25 tokens), and 6.23 s for the same synthetic tool.
Both tools selected the correct test room; no real service was invoked. The
larger model repeated prior wording. The smaller model made a grammatical error
and confused the user's name with its own. These single trials have different
output lengths and shared-host load; they do not establish a general performance
ratio or validate real HA tool use. STT, TTS and ESP32 transport are excluded.
No container OOM/kill events occurred during either test.

The user rejected the approximately 14-second response and confirmed no dedicated
GPU is available. The local models remain experimental and were not selected in
Rosie. The HA container successfully fetched Ollama version and model metadata,
but existing service-token requests to the HA registration API returned HTTP 401.
Authenticated UI registration remains pending; no new HA credentials were created
and no `.storage` configuration or authentication records were edited.

The first LXC reboot exposed Debian 13/systemd 257 startup failures, including
journald exit status 243/CREDENTIALS. Proxmox had warned that this systemd version
may require nesting. Enabling `nesting=1` on this new, still-unprivileged LXC and
rebooting it resolved the failed units: `systemctl is-system-running --wait`
returned `running`, with an empty failed-unit list. Ollama and its firewall
returned after reboot, and the journal explicitly reported cloud disabled.
No models were resident at handoff; the Ollama service accounted for about 48 MiB.
Only the new LXC was rebooted. Firmware files were not changed or flashed.

## Charger comparison and current speech services

The user confirmed moving the robot to a 5 V USB charger while preserving the
cable and position. A 60-second passive measurement then counted 27.11 seconds
of PCM arriving at openWakeWord, with no observed robot API TCP FIN/RST or wake
detection. Arrival remained fragmented across detection sessions. The early ICMP
sample received 5/5 replies for both 32- and 1400-byte payloads, but with respective
average RTTs of 217 and 309 ms. A later sample received 5/5 small replies and 4/5
large replies, averaging 91 and 285 ms. This is more audio than in the preceding
failing samples, but does not establish continuous transport or attribute an
improvement to the power supply: changing supply also restarted the device.
No microphone recording was retained.

A subsequent health query found openWakeWord responsive but did not find the
robot in UniFi's current client list; its API connection attempt failed with host
unreachable. The user then reported that it had started working and asked about
local STT/TTS and latency. These observations occurred at different times and
must not be presented as a continuous verified recovery.

Read-only inspection on 2026-09-22 reconfirmed the preferred Rosie pipeline:
`stt.home_assistant_cloud` / pt-BR, `conversation.chatgpt` with local intents
preferred, `tts.home_assistant_cloud` / pt-BR / LeilaNeural, and local
`wake_word.openwakeword` / `okay_nabu`. The Supervisor's installed voice-app list
contains ESPHome and openWakeWord, not Whisper or Piper; the Wyoming registry
contains only openWakeWord. No per-stage latency for the user's latest successful
interaction was obtained, and no speech service was installed or changed.

The proposed comparison is Piper for local speech generation first, then a measured
Whisper comparison for open-ended transcription on the existing i3-4160 host / HA
VM with 2 vCPUs. Local synthesis cannot by itself correct the observed HA-to-ESP32
transport failures, and changing STT/TTS does not change the conversation agent's
processing time. Backend provider selection does not require new ESP32 firmware.

## Follow-up: source comparison and listening pause

The user confirmed that the ESP32 antenna end is unobstructed. A fresh inventory
of the actual ESPHome configuration on 2026-09-22 confirmed that both current YAML
hashes match the local source: base `f4e4c81c5704c29f4a5932898a68351af2233caa05918d684bb9b63dadbd514e`
and OLED `c6b693fbedd2a707ee6f21eacf6946fa756ad2f13dbea106685606f68a90c6b8`.
The OLED file includes `desk-robot.yaml`; it preserves the conversation controls,
speaker buffer and retry cooldown. The user's latest USB log confirms recurring
failed starts, now spaced apart rather than a retry storm. This does not mean the
underlying communication defect was previously fixed.

A 40-second passive TCP header capture on HA interface `enp6s19` confirmed a direct
route from `192.168.30.11` to the robot and the expected source MAC. One established
API flow remained open, with no FIN/RST, sequence-gap events or zero receive
windows observed. Only 28,350 unique bytes arrived from the robot, in bursts;
one 10-second bucket contained just 480 payload bytes. HA acknowledged the received
data. This observation cannot expose Wi-Fi retries or bytes stalled inside the
ESP32 before transmission, and does not establish that the radio link is healthy.

The first API attempt to compare enabled and paused listening timed out before any
control change. A second attempt verified the device identity and 09:34:58 build,
then received explicit switch confirmations for OFF and ON. The 10-second enabled
baseline contained 0.56 seconds of PCM at openWakeWord; the paused phase contained
none, and the 30 seconds after re-enabling contained only 0.19 seconds. Fresh
`not-connected` warnings appeared before and after the pause. Ping replies were
0/4 for each payload size (32 and 1400 bytes) before pausing, 4/4 and 3/4 while
paused, and 3/4 and 2/4 after re-enabling. These small, sequential samples demonstrate
intermittent delivery even while paused; they do not isolate its cause or establish
a general packet-loss rate.

Listening was confirmed restored to ON. No firmware, network configuration or
service restart was performed. The user was asked to test a known-good 5 V USB
supply while preserving the cable, device position and firmware. That physical
comparison is pending; sustained recognition and spoken playback remain unresolved.

## Intermittent voice after OLED installation

On 2026-09-22, the user reported open, blinking eyes from startup but unreliable
wake-word recognition. A read-only device query reported ESPHome 2026.9.0 compiled
at 09:34:58 -0300, consistent with the OLED installation. The eye condition confirms
the microphone's running flag and an Assist client pointer; it does not confirm
that the server is receiving a continuous stream.

A passive 30-second capture counted only 0.53 seconds of PCM reaching openWakeWord.
A separate 70-second comparison counted 0.83 seconds, including a read-only native
API connection from about second 11 to second 26. That connection did not restore
continuous audio in this run. Neither capture observed a wake detection. No audio
recording was retained. These are short observations, not a controlled comparison
of spoken wake phrases. The queried device simultaneously reported Assist
connected, state `Sem conexão`, and persisted error `not-connected`; those state
values alone cannot date the last failure. HA logs again showed a voice pipeline
attempting to use its API client while in `HOST_RESOLVED`.

The installed HA handlers queue incoming API audio directly; the wake-word stream
yields its audio chunks before checking its optional silence timeout. The registry
inspection found one matching ESPHome entry, retaining the historical title
`esp32-alexa`, for the robot's MAC and IP. openWakeWord answered Describe and listed
`okay_nabu`. These checks do not prove ongoing detection or identify the origin of
the API connection failures.

A later UniFi sample showed Sala channel 6, 20 MHz unchanged, RSSI -81 dBm,
47.6% client transmit retries, and 75% radio utilization. A short ICMP comparison
from HA received 5/5 replies with a 32-byte payload (7-25 ms), but only 3/5 with a
1400-byte payload (235-336 ms). This demonstrates degraded delivery for larger
packets in that sample, independently of a voice pipeline command. It does not
establish a sustained loss percentage, MTU defect, or specific RF/hardware cause.
The user was asked whether the ESP32 antenna end is obstructed by the new mounting.

Firmware, listening controls, network configuration and services were not changed
or restarted during this investigation. No new firmware correction is ready for
flashing; physical acceptance and the underlying transport failure remain open.

## OLED eyes follow microphone capture

On 2026-09-22, the user requested a face for a 0.96-inch I2C OLED, probably
128x64, with eyes closed when not actually listening and open during capture.
The existing OLED variant now gates open eyes on the listening switch, the Assist
client connection, the physical microphone's running state and conversation not
closing. This keeps eyes closed during mute, disconnects and half-duplex response
playback, even when the listening switch remains ON. Open eyes blink for about
200 ms every 4.8 seconds. The mouth animates during speech and processing dots
remain available. Refresh is reduced from 10 to 5 frames per second to moderate
I2C work. Controller/address are provisionally SSD1306 128x64 / 0x3C; physical
confirmation is still needed. Wiring remains 3V3, GND, SDA GPIO21, SCL GPIO22.

`make test` passes. `make validate` passes for both profiles. `make build-oled`
passes with an image size of 852,167 bytes and static DRAM of 49,520 bytes. The
OLED YAML was also schema-validated in the installed HA ESPHome with the actual
secrets, then staged with a backup at
`/config/esphome/.desk-robot-before-oled-eyes-1790080495`. Before replacing it,
revision checks confirmed the expected base YAML, header and prior OLED YAML.
Only `desk-robot-oled.yaml` changed remotely; secrets, audio configuration and
network settings were preserved. Its SHA-256 is
`c6b693fbedd2a707ee6f21eacf6946fa756ad2f13dbea106685606f68a90c6b8`.
No remote flash occurred. The user must install the OLED profile through their
Windows USB host and confirm screen behavior and voice playback together.

The user also clarified that speech remains quiet at 100% volume, first describing
it as clean, then correcting this to slightly distorted while the local tones
remain loud and clean. A proposed voice-only gain control was therefore not
implemented. FFmpeg measurements of the three newest cached WAV responses gave
mean levels of -19.1, -17.9 and -19.4 dBFS, with peaks at -3.2, -3.2 and -2.8 dBFS.
These files were not correlated to an exact robot pipeline execution. They support
the distinction between average speech level and a full-scale test tone, but do
not establish the source of audible distortion on this device. More gain could
exhaust the remaining peak headroom.

A read-only attempt to obtain a browser comparison URL from the cached filename
returned HTTP 404. Inspection confirms this HA release serves TTS streams by
temporary token, not cached filename. No working playback link was obtained, no
audio was made public, and no HA audio processing was changed. Audio quality
remains pending a comparison of the generated speech with physical playback.

## Live inspection after installation of the buffer revision

The user subsequently reported that a cable had disconnected and that restoring
the connection made spoken responses audible. They did not identify which cable.
This explains the reported silence according to their physical check; it does not
establish a cause for the earlier intermittent transport errors. They now report
that the diagnostic tones are much louder than spoken replies.

Inspection of the generated ESPHome sources confirms that RTTTL generates a
full-scale 16-bit sine wave and uses the same speaker volume as the voice path.
The configured speaker uses software attenuation: 75% maps to -12.25 dB and 100%
bypasses attenuation. The most recent device query before this report showed
75%. The actual TTS waveform level has not been measured, so lower source level
remains a hypothesis rather than a confirmed defect. No gain, firmware, or remote
volume setting was changed during this comparison.

On 2026-09-22, the user confirmed installing the new revision over USB and enabling
listening. The physical device reports ESPHome 2026.9.0, compiled on
2026-09-21 at 17:25:22 -0300. Its state subscription confirms listening and
continuous conversation ON, a 500 ms speaker buffer, a 30-second reply window,
Assist connected, no active conversation, and an empty last-error state. Free heap
was 140,680 bytes with a recorded minimum of 105,372 bytes. This supersedes the
earlier temporary OFF state used to contain the retry storm.

The recent HA log query returned no matching robot/voice errors. openWakeWord
responded to a Wyoming Describe request and advertised `okay_nabu`. UniFi reports
the robot on the Sala AP, still using channel 6 at 20 MHz; RSSI was -75 dBm and
client transmit retries 21.3%. No network configuration was changed.

A passive 70-second observation measured 69.57 seconds of 16 kHz mono PCM
arriving at openWakeWord, with no observed robot API TCP closes or wake detections.
The signal measured -60.8 dBFS RMS and a peak magnitude of 650 out of 32768.
Only aggregate statistics were retained, not an audio recording. The user was
asked to speak during this window; confirmation that they did so is pending.
Consequently, the low measured level does not yet establish inadequate speech
gain or microphone failure. The observation establishes audio transport during
that interval, not reliable wake detection, response playback, or resolution of
the previously intermittent transport failure. No firmware changes or remote
flashing were performed during this inspection.

## Retry storm correction and adjustable speaker buffer

The user installed the continuous-conversation firmware, reported as built on
2026-09-21 at 17:01:16 -0300. USB logs show successful boot and Wi-Fi association,
then `Stop request dropped, TCP buffer full` and bursts of many `not-connected`
errors per second after a speaker test. This rate is a regression from the earlier
approximately 10-second retries; it is distinct from the pre-existing transport
failure that triggers the errors.

Source inspection established the cycle: ESPHome reports a failed start through
`on_error`; that automation closes the conversation, and `close_conversation`
calls `resume_listening` as soon as the pipeline is idle. Its connected check only
requires an Assist client pointer, so the blocked transport can immediately be
used again. A shared cooldown now starts before closing an errored conversation
and gates every script-driven restart for at least 10 seconds. Normal successful
follow-ups and empty-transcription handling keep their existing behavior.

The physical device accepted a command to turn **Escuta por palavra de ativação**
OFF, and its switch-state update confirmed the pause. The same query confirmed
the 17:01:16 build. Listening is intentionally left OFF until the corrected
firmware is installed and the user enables it for acceptance testing.

The user additionally requested configurable audio buffering. The new **Buffer de
áudio** number has a 500 ms default, a 100–1000 ms range in 100 ms steps, and restores
its selected value after reboot. Its state callback waits for the speaker to stop
before calling the installed I2S speaker's `set_buffer_duration` setter. Inspection
of `run_speaker_task` confirms it reads that setting to allocate the ring buffer
when the task starts. This avoids changing a running task or cutting off playback.
It changes capacity only; it does not add an initial prefill threshold. Network,
audio pins, sample rates, and amplifier settings were not changed.

`make test` passes, including repeated failed-start callers, the 10-second boundary,
later retries and clock wraparound. A temporary mutation allowing unrestricted
retries fails the burst-count assertion, confirming this regression case is
detected. Generated C++ was inspected to confirm the cooldown is armed before
closing and is included in the actual restart guard. Both YAML profiles pass
schema validation. The final audio build passes, reporting an image size of
829,619 bytes and static DRAM of 49,312 bytes. The final OLED build also passes:
image size 851,871 bytes, static DRAM 49,520 bytes. `actionlint` passes. These checks
do not establish physical recovery or improved audio; static DRAM is not runtime
free heap.

Both profiles also passed schema validation with the real HA secrets before
staging. The updated base YAML and header were copied to `/config/esphome` with
backup directory `.desk-robot-before-retry-buffer-1790022318`; secrets were unchanged.
Base SHA-256: `f4e4c81c5704c29f4a5932898a68351af2233caa05918d684bb9b63dadbd514e`.
Header SHA-256: `d6c524c2d6374d1ad1089b39105aa10e28029748bf0a8b23a804c2ba576abeb7`.
No hardware was flashed remotely. Local binaries contain compile-only credentials;
the user must compile/install through HA Device Builder on their Windows USB host.

Device acceptance after installing this revision must check that failed starts
are spaced at least 10 seconds apart, successful follow-ups remain continuous,
500 ms audio is playable, a buffer change during speech takes effect after the
speaker stops, and the chosen value survives reboot. Heap and audible quality
must be observed before treating a larger buffer as an improvement.

## Continuous conversation and custom sentences

Checked on 2026-09-21 after the channel-6 test. Firmware now opens a conversation
at STT start, skips the wake-word stage for follow-ups, preserves context within
the session, and returns to wake-word listening after an explicit stop phrase or
30 seconds waiting for speech. HA VAD pauses the reply timer during speech;
processing and playback do not consume the next reply window. Empty recognition
retries retain the original deadline. Disconnects and other pipeline errors close
the session. Closing waits for the voice pipeline and speaker to become idle
before allowing listening again, and clears late native follow-up flags.

- `make test` passes with C++17 warnings treated as errors. Behavioral cases cover
  the exact timeout boundary, speech and long playback, empty recognition retries,
  callbacks after closure, clock wraparound, and whole stop phrases versus household
  commands such as "pare o ventilador". These tests exercise the session logic,
  not the full ESPHome/HA event transport.
- `make validate` passes for both profiles with pinned ESPHome 2026.9.0.
- `make build` passes: reported image size 828,615 bytes, static DRAM 49,072 bytes.
- `make build-oled` passes: reported image size 850,875 bytes, static DRAM 49,280
  bytes. Both use ESP-IDF 5.5.5 for classic ESP32; static DRAM is not runtime heap.
- `actionlint` passes. CI configuration now runs the session test before compiling.
  No GitHub-hosted workflow run or Git publication occurred.
- The installed HA ESPHome also validated both profiles using its existing secrets
  before the updated base YAML and header were staged in `/config/esphome`.
  Base SHA-256: `f6a7f3586db53d47636d3dbd932cd6bf01a2c8033b959a0f64d23b707d00a70d`.
  Header SHA-256: `17edad310b2dbf4c5146d44318d61dfd27ab53231c578ad3dde3cf2039646dc4`.
  Backup: `.desk-robot-before-conversation-1790020871.yaml`. Secrets were unchanged.

Only local compile binaries have been produced for this revision; they contain
placeholder credentials and must not be flashed. USB installation through the HA
Device Builder compiles with the actual credentials. No remote flash or physical
acceptance of continuous conversation has been performed. This feature does not
establish a correction for the existing intermittent audio/transport failures.

Required device acceptance after USB installation:

1. Wake once, ask a question, then ask a related follow-up without a wake word.
2. After the answer, remain silent for 30 seconds; confirm the session closes and
   an unprompted sentence does not start another conversation.
3. Start speaking near 25 seconds and continue beyond 30; confirm speech is not
   cut off merely because the waiting deadline passed.
4. Say "encerrar conversa" and verify it returns to wake-word listening. Verify
   "pare o ventilador" remains a household command, using a suitable test device.
5. Verify mute, speaker-test and close controls, then reconnect behavior: an old
   conversation must not resume without a new activation.

The stop phrase must first be transcribed by HA and may reach its agent before
the ESP32 cancellation arrives. Physical acceptance must check this race. Speech
during TTS is not supported by this half-duplex implementation.

The user's missing humorous outside-temperature response was investigated
separately. The installed recognizer selects `pt-BR` from Rosie's STT language;
the existing folder was lowercase `pt-br`, which the loader did not select.
Testing the existing `temperature.yaml` together with `_common.yaml` from that
folder reproduced successful matching once made available for the selected
language. `_common.yaml` supplies `outside_location`; testing the temperature file
alone without that shared rule is not a valid reproduction of the complete setup.

The folder and its YAML `language` fields were corrected to `pt-BR`. The original
folder is backed up at
`/config/.desk-robot-backups/custom-sentences-1790020924/pt-br`.
An exact-byte check confirmed `configuration.yaml` was unchanged. The humorous
responses remain in its `intent_script` section.

Offline recognition with the installed Hassil package passes for "qual a
temperatura lá fora", "quantos graus está fazendo lá fora", and "qual a umidade
lá fora", selecting their expected custom intents. "Qual o clima lá fora" remains
unmatched by these custom phrases. The live HA sentence cache still needs
`conversation.reload` for `pt-BR`, followed by a spoken or Assist-text check.
There is no authenticated HA API session available here to perform that service
call or apply the proposed personality prompt; both UI steps are documented in
`docs/conversation-guide.md`.

## Software validation

Initial builds, before the speaker-test correction, checked on 2026-09-21 with the
pinned ESPHome 2026.9.0 image:

- `make validate`: both configurations pass schema validation.
- `make build`: audio profile compiles and links for classic ESP32 with ESP-IDF 5.5.5.
  The OTA binary is 822,528 bytes; reported static DRAM use is 47,520 bytes (26.3%).
  Static allocation is not a measurement of available heap during voice streaming.
- `make build-oled`: OLED profile compiles and links successfully. The OTA binary is
  844,448 bytes; reported static DRAM use is 47,728 bytes (26.4%).
- `actionlint` 1.7.7: the GitHub Actions workflow passes static validation.
  The workflow has not run on GitHub; no remote repository is configured.
- Both source files were also validated by the installed ESPHome 2026.9.0 in Home
  Assistant before copying them into its configuration directory.

Local binaries use public compile-only placeholder credentials. Actual Wi-Fi credentials
and a dedicated API/OTA key are configured only in the Home Assistant copy. This session
has not flashed a device remotely. The user selected USB installation of the OLED
profile through ESPHome on Windows. WebSerial successfully detected an ESP32-D0WD-V3,
revision 3, and started the flashing stub. Compilation on Home Assistant then failed
while downloading `esp-rom-elfs-20241011.tar.gz`, with repeated HTTP 504 responses.
This failure occurred before firmware upload. No end-to-end speech test has been performed.

The failed dependency was subsequently repaired on Home Assistant: the official archive
was downloaded from Espressif, checked against the ESP-IDF manifest SHA-256
`921f000164a421c7628fbfee55b173384aafaa51883adc65cd27bf9b0af9e9a9`, and copied to
`/data/cache/idf/dist/esp-rom-elfs-20241011.tar.gz`. The official `idf_tools.py install
esp-rom-elfs` command completed successfully, and 12 installed files were verified under
`/data/cache/idf/tools/esp-rom-elfs/20241011`. Subsequent USB installation succeeded;
the running device was inspected as recorded below.

## Speaker-test investigation and correction

Later on 2026-09-21, the new audio firmware was confirmed running on the physical
ESP32 at `192.168.30.201`, MAC `14:2B:2F:C2:0F:F8`. A direct encrypted API connection
returned its device info and entities. The running build reported compilation at
`2026-09-21 12:30:43 -0300`, about 137 KB free heap, and Wi-Fi RSSI of -67 dBm.
The user reported the documented wiring and left the amplifier SD and GAIN pins open.
Physical wiring and electrical levels have not been measured independently.

Transport was intermittent during diagnosis: one sample had five failed TCP connections
and an ARP neighbor in FAILED state; a later sample had five successful pings from both
Proxmox and Home Assistant. The Home Assistant sample ranged from about 4 to 291 ms.
The stored integration key matches the firmware configuration. Home Assistant logged
`Authenticated connection not ready yet`; USB logs supplied by the user show
`Could not request start`, `not-connected`, and `Stop request dropped, TCP buffer full`.
These observations do not identify the underlying network or transport cause. Sensors
can update between failures; an Assist subscription is separate from basic API connectivity.
The speaker test is local and does not require an active Assist pipeline.

Code review identified a stop/start ordering hazard in the test sequence: ESPHome's I2S
speaker keeps a stop request pending even while stopped, and its loop can cancel a pending
start when consuming that stop. The test previously issued stop unconditionally before
starting RTTTL. It now stops only an active speaker and waits for both the voice pipeline
and speaker to stop. It also logs request/start/finish/timeout and restores the selected
voice volume after RTTTL changes the underlying speaker volume.

- `make validate`, `make build`, and `make build-oled` pass after this correction.
- The corrected base YAML was backed up, replaced, and validated on Home Assistant.
  Its SHA-256 is `9cf0180e1186c5e704ac8d1191ed7106ac8a09d08f4efa7f6e45816cc6996f15`.
- Wi-Fi credentials and API keys were preserved.
- The user reflashed and restarted the device. USB logs and a direct API query confirmed
  the running build timestamp `2026-09-21 13:48:29 -0300`. The speaker remained silent.
  This correction therefore did not establish audible output or resolve the intermittent
  transport failures.

The request/start/finish messages in that correction used `logger.log` shorthand, whose
default DEBUG level was excluded by the firmware's INFO level. Missing messages could
therefore not establish whether the test ran. All three now explicitly use INFO.

- Both profiles pass schema validation and compilation after the logging correction.
  All three diagnostic strings were verified in each compiled OTA binary.
- The updated base YAML was validated and staged in Home Assistant, SHA-256
  `5c45b92a4fa80277862316a75d9ecd188b25d18e2eff218ef9cc6f7aa6dbbd9b`.
  Backup: `.desk-robot-before-audio-logs-1790011315.yaml`. Secrets were preserved.
- The user flashed this logging revision, build timestamp `2026-09-21 14:22:00 -0300`.
  USB logs show three requested/playing/finished sequences at 14:31, without timeout.
  The user first reported silence, then confirmed audible but very quiet notes.
  This establishes basic physical audio output, not acceptable loudness or voice playback.
- During staging, Proxmox guest commands became unavailable while Home Assistant remained
  reachable. Restarting only HAOS `qemu-guest.service` restored guest command execution;
  neither Home Assistant nor its VM was restarted.

## Test-volume adjustment

The quiet test used a fixed RTTTL gain of 20%, which overwrote the speaker volume at
playback start. Changing the Home Assistant voice-volume control before a test therefore
did not change its loudness. The test now copies the selected voice volume into RTTTL
before playback and logs the selected percentage. The boot/voice default remains 25%.
`make validate` passes for both profiles, and `make build` compiles the audio profile.
The compiled binary contains the new log format with the applied volume percentage.
The corrected source was validated and staged on Home Assistant, SHA-256
`2a643a488136d9571f6bd9ea748168f01ad746a3a421f0cab6441b8fafd75243`, with backup
`.desk-robot-before-test-volume-1790012130.yaml`; secrets were preserved.
The user confirmed audible success after installing this revision. A subsequent direct API
query identified the running build as `2026-09-21 14:35:35 -0300` and the volume as 80%.
An exact comparison at 25% and 50% was not recorded. The user had confirmed that increasing
the control on the previous firmware did not make its fixed-gain test louder.

The same USB excerpt shows an initial Wi-Fi handshake failure followed by a successful
connection and repeated API disconnects. These remain unresolved and are not disproved
by successful local tone playback.

After tone acceptance, a live API query found listening enabled, Assist subscribed, about
181 KB free heap, RSSI -71 dBm, and state `Erro`. Logs reproduced `Could not request start`
and `not-connected`. Home Assistant also logged a connection failure with `Errno 113`
for `192.168.30.201:6053`. Rosie remains configured for Portuguese, server wake word `alexa`,
and Home Assistant Cloud STT/TTS; the saved pipeline selection for the robot is Rosie.
Wake detection, microphone transcription, and spoken responses remain unverified.

The user confirmed that the device is already near an access point and that the network
uses UniFi. Later USB logs show initial authentication failures at both BSSIDs before a
successful association, followed by API disconnects. Distance alone is not an established
cause. The user also reported selecting Okay Nabu for the server wake word.

The attempted automated comparison with listening enabled/paused could not run because
the Proxmox guest agent was unavailable. A subsequent direct encrypted API command via
the HAOS console successfully paused the robot and received its switch-state confirmation.
Listening was intentionally left disabled for diagnosis; no firmware was flashed for this.
This does not establish the cause of the Home Assistant connection failures.
The server configuration was subsequently read back: Rosie now uses
`wake_word.openwakeword` with `okay_nabu`. A direct connection attempt from the Home
Assistant container, using its installed aioesphomeapi 45.6.1, timed out while listening
was paused. The exact request phase was not logged, so this is not evidence of a client
library incompatibility or of a causal relationship with audio streaming.

The user reports WPA2 and Force WiFi 4 Mode enabled for LC-IoT, with Client Device
Isolation disabled. Fast Roaming and PMF controls were not shown; their effective values
have not been independently inspected. These settings do not establish a configuration
defect. The user authorized UniFi inspection and requested instructions for granting access;
controller access is not yet configured. No UniFi setting has been changed.

A subsequent direct API check re-enabled the listening switch and received confirmation.
Over the following 15 seconds, the device reported `Conectado=true`, `Assist conectado=false`,
and `Estado=Sem conexão`, with volume 80% and about 142 KB free heap. No new voice log
messages were observed in that sample. The general connection sensor includes the diagnostic
client itself; it does not prove that Home Assistant is connected. Listening is now enabled.
The device wake-word selectors expose local models and are unavailable with this server-side
configuration; that UI state alone does not diagnose the Assist session failure.

## Assist transport investigation

Reloading the ESPHome integration did not resolve the failure. A complete Home Assistant
trace at 15:14:30 shows the pipeline executing wake-word detection, then failing to send a
pipeline event because its ESPHome client was already reconnecting (`HOST_RESOLVED`).
This proves that the wake-word stage was entered; it does not establish a detected word
or identify what first broke the connection.

A direct API comparison successfully paused listening for 21 seconds and re-enabled it
for approximately 23 seconds. Device-info responses while paused took 10–206 ms; after
enabling, they took 41–1,337 ms. Assist subscribed during the paused period and remained
subscribed through this short comparison. Listening was left enabled. The custom `Estado`
sensor continued reporting `Microfone pausado` after the listening switch acknowledged ON;
that phase label must not be used alone to infer whether microphone audio is streaming.

A separate 48-second TCP-header capture on the HA VM interface observed the ESP32 sending
232 KB on one API connection, with the rate falling substantially during the sample. HA
acknowledged incoming packets and did not advertise a zero receive window. The first FIN
in the capture came from the ESP32, followed by reconnection. These are TCP metadata only;
no microphone recording was captured, and Wi-Fi link-layer retries are not visible here.

The existing HA UniFi integration allowed read-only inspection without obtaining new user
credentials. UniFi reported the robot associated to `U7 Lite - Sala`, BSSID
`92:30:66:52:7E:8E`, on channel 11. One sample showed signal -75 dBm, both reported link
rates at 1 Mbps, and `wifi_tx_retries_percentage=35.7`. Its 2.4 GHz radio reported 87%
channel utilization and 31.8% transmit retries. This is concrete evidence of a degraded
wireless link, but not proof that every Assist failure has the same cause. The user was
asked whether the physically nearby AP is the Sala AP or another one.

The user confirmed that the nearby AP is the Sala AP. A second UniFi sample reported
-74 dBm, 1 Mbps link rates, 35.9% retries, and 89% channel utilization. Both wired U7 Lite
APs (Sala and Suíte) were operating on channel 11 at 20 MHz; the Suíte radio reported
80% utilization. No channel change or active RF scan was performed.

A subsequent 36-second pause received switch OFF confirmation and restored the original
ON state with confirmation. The first UniFi update after pausing reported utilization
falling from 88% to 75%, and AP receive airtime from 57% to 18%. The remaining two reads
returned the same cached statistics, so these are not three independent measurements
and do not establish a settled idle baseline. Reported signal remained -74 dBm.
The user subsequently clarified that the board is loose and connected by USB, without
a breadboard, and confirmed that the INMP441 remains connected. Breadboard obstruction
and an intentionally disconnected microphone are therefore not applicable explanations.

UniFi confirms WPA2, PMF disabled, fast roaming disabled, client isolation disabled, and
U-APSD disabled on LC-IoT. No UniFi configuration was changed and no firmware was flashed
during this investigation. Wake-word recognition and a spoken response remain unverified.

A direct Wyoming `Describe` request from the HA container to `core-openwakeword:10400`
returned `Info`, with `okay_nabu` v0.1 installed and available. The service advertises
version 2.1.0; the previously inventoried add-on package version is 2.1.1. This validates
service reachability and the model listing, not detection from the physical microphone.
The user requested the microphone wiring again; it was checked against the current YAML:
3V3 supply, common GND, SCK GPIO25, WS GPIO26, SD GPIO33, and L/R GND (left channel).

After the user confirmed the wiring, a 70-second passive observation of HA-to-openWakeWord
traffic parsed repeated `detect` and `audio-start` requests with PCM payloads. One flow
provided 1.63 seconds of audio before no further payloads were observed; several subsequent
flows provided only 0.06–0.22 seconds. No `detection` response was observed. Audio was
processed in memory for duration/level statistics only; no recording was saved. Two flows
had TCP reassembly gaps, so their measured duration is only a lower bound. The Wyoming
traffic has no satellite identifier, and the user had not yet confirmed performing the
requested spoken test; this observation does not establish intelligible speech from the
robot or identify the first cause of interruption.

Optional native API connections failed during this capture; a later standalone query from
HA's aioesphomeapi 45.6.1 succeeded and verified the robot's name/MAC/version. A further
state/log query timed out. HA logged another `HOST_RESOLVED` exception while finishing
wake-word detection at 15:50:30. These mixed results do not establish client-library
incompatibility. An openWakeWord log exception occurred while replying to an `Info` request,
so it must not be presented as a failure of the detection model.

The latest UniFi client lookup returned HTTP 400, and its Sala AP client count fell from
26 to 25. The user was asked whether the board remained powered and whether the spoken
test was performed. Neighbor information for alternative channels was approximately
13 hours old; it does not establish which channel is currently cleanest. No network
configuration change or firmware upload was performed.

The user then confirmed unplugging or restarting the ESP32 during the attempted spoken
measurement. That run is therefore confounded and cannot establish spontaneous session
failure. A subsequent three-ping sample received all replies (5.7–27.9 ms). A controlled
repeat was prepared, and the user was asked to confirm that the board can remain powered
throughout the test before it starts.

## Intermittent voice success and recurrence

After confirming that the board could remain powered, the user reported a successful
wake-word interaction and a spoken answer to a time question. They then reported slow,
choppy audio and loss of responses, a temporary improvement, and another recurrence.
This establishes that the complete voice path has worked, but not sustained acceptance.
Conversational follow-up was discussed only; no conversational firmware change was made.

A controlled 70-second passive observation counted 50.28 seconds of PCM audio across
two Wyoming flows selecting `okay_nabu`. Neither a TCP FIN nor a reset was observed on
the robot's API connection during that window. The difference between elapsed time and
audio duration does not by itself prove lost samples: pipeline transitions and inactive
periods also matter. No microphone recording was saved.

At 16:09:37 on 2026-09-21, HA again logged an ESPHome API `HOST_RESOLVED` exception.
The user's USB logs at 16:09:47 show a successful local tone sequence alongside
`Stop request dropped, TCP buffer full`, followed by repeated `not-connected` errors.
The user clarified that their restart occurred after the error began. Supervisor also
records an openWakeWord watchdog restart at 16:11:05; this later restart cannot explain
the earlier API failure. Afterward, a direct Wyoming `Describe` returned the installed
`okay_nabu` model. Containers were running without an OOM flag; those point-in-time
checks do not establish that the service was continuously healthy beforehand.

Fresh UniFi reads reported the robot on the Sala AP, signal -72 to -74 dBm,
26.8-27.6% client transmit retries, and 83-88% 2.4 GHz channel utilization. The AP was
operating on channel 11 at 20 MHz with 26 clients; its configured channel was `auto`.
One reported link rate remained 1 Mbps while the other was 21.7-26 Mbps. This provides
a basis for a controlled channel comparison, not a definitive diagnosis of every failure.

A proposed test changes only the Sala AP's 2.4 GHz channel to 6, preserving 20 MHz and
the remaining radio settings. Its current settings and expected change are saved in the
HA container at `/tmp/desk-robot-unifi-radio-plan.json`, without credentials.
Channel 6 is a test candidate, not a channel proven clean by a current RF scan.

The user authorized this test, and UniFi acknowledged the change. Readback confirmed
channel 6 at 20 MHz with the other radio settings preserved. During a subsequent
70-second passive observation, 30.41 seconds of PCM were counted, with no observed
robot API TCP closure or wake detection. Several Wyoming flows ended after short
audio fragments; the final flow continued with irregular audio delivery. The user's
initial report was no response, followed by a later response with cuts and a perceived
improvement. These results do not establish a stable fix. A later UniFi sample showed
36.4% client retries and 91% channel utilization. An API sample found Assist subscribed,
about 146 KB free heap, and no new voice warning during its 15-second observation;
the persisted `not-connected` sensor was not evidence of a new error in that sample.

Restorations to the previous `auto` setting and reapplications of channel 6 occurred
as user feedback arrived. The user reported other devices disconnected during these
changes, then explicitly instructed leaving channel 6 enabled for their own test.
The final requested configuration is therefore **Sala 2.4 GHz: channel 6, 20 MHz**.
Wait for their feedback before any further network mutation; do not automatically
restore the AP based on the earlier negative sample. Whole-home client recovery and
sustained voice quality remain unverified. No firmware was changed.

## Physical acceptance

USB logs confirm ESP32 revision 3.1 and 4 MB flash. The remaining acceptance checks
require the physical device:

1. Independently check the documented wiring and amplifier supply/enable levels.
2. Confirm stable boot, Wi-Fi association, encrypted API connection, and heap diagnostics.
3. Select the intended Assist pipeline and confirm openWakeWord is available.
4. Test speech output at 25% volume and verify that the device remains powered and connected.
5. Say the selected wake word and a short Portuguese command; inspect the Assist pipeline trace.
6. Verify 20 consecutive turns and a five-minute waiting period without losing listening.
7. Test mute/unmute, a temporary Wi-Fi interruption, and a Home Assistant reconnect.
8. Measure wake detection, transcription, conversation, and speech-output latency separately.
9. Install the OLED variant only after identifying the display; repeat voice and heap checks.

Noise troubleshooting starts with power, common ground, short I2S wiring, microphone channel,
and playback volume. Apply input gain or noise suppression only after observing the captured
signal; increasing gain without evidence can amplify noise or cause clipping.
