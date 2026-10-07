> For the current Node/React application and private Python worker, see
> [application context](../../docs/engineering/context.md). This document retains
> the native hardware/protocol design and the original Python runtime history.

# Runtime boundaries

The ESP32 runs ESP-IDF, a single microWakeWord v2 model, I2S capture/playback,
SSD1306 animation, Wi-Fi provisioning and an authenticated WebSocket client.
It contains no ESPHome runtime or Home Assistant native API client.

The Python process owns WebRTC segmentation, local Silero speech confirmation,
faster-whisper CPU/int8, Piper, Kokoro or Supertonic, conversation
history, deterministic intents, provider requests and validated MQTT automation.
The browser edits the server catalog. SQLite keeps bounded diagnostic events;
microphone recordings and conversation transcripts are not written to disk.
Open-ended conversation sends transcribed text and a bounded history/catalog
to the selected provider. Wake detection, STT, TTS and direct intents stay local.

## Audio protocol

The robot connects to `/ws/robot/{id}` with `Authorization: Bearer <robot token>`.
An unknown token is rejected. A new connection authenticated as the same robot
replaces its previous socket, which may be half-open after a network failure.
The old conversation task is cancelled; its eventual cleanup cannot remove the
new session or reset the new conversation. Incoming messages
are size limited. Control frames are JSON. Audio is mono at 16 kHz, with signed
16-bit little-endian PCM at the capture and playback boundaries. New firmware
announces `audio_codec:ima_adpcm` in `hello`; a matching `configure` enables the
codec in both directions. The current firmware requires this negotiation before audio capture. The server retains PCM and single-block ADPCM support for older firmware. A new `audio_batch_frames:5` capability enables batches in both directions and a 2400 ms playback credit window. TLS is supported by the firmware with the
ESP certificate bundle when a `wss://` endpoint is configured.

1. `wake` requests a new session. Server `state:listening` enables audio upload.
   Capture compresses independent blocks into a bounded queue of 128 frames (2560 ms). Socket writes run in another task, grouping up to five frames (100 ms of audio, normally at most 80 ms added delay), with a 1500 ms timeout. Overflow aborts the utterance rather
   than silently dropping samples. Wake events and diagnostics also run outside
   the capture task.
2. The server VAD keeps 300 ms preroll, ends after 800 ms trailing silence,
   rejects very short speech and caps an utterance at 20 seconds.
   A proposed segment is checked by the bundled Silero v6 model with threshold
   0.6 and a minimum 200 ms speech span before changing the face to thinking.
   Rejected noise resumes the existing listening deadline without calling STT,
   conversation or TTS. The check uses one local CPU thread and saves no recording.
3. `state:thinking` covers STT, response generation and TTS. The complete reply
   is synthesized before one continuous playback stream begins. A sentence-at-a-time
   trial was rejected because this CPU sometimes synthesizes slower than real time,
   creating gaps that sound like a turn boundary. There is no LLM-token streaming.
4. `state:speaking` includes a bounded `expression`: neutral, happy, sad, angry, surprised, curious, confused, excited, shy, skeptical, proud or affectionate. Missing or unknown firmware values render neutral.
   Then `play_start` announces ID, length and sample rate.
   Frames represent up to 640 PCM bytes / 20 ms. Negotiated IMA ADPCM reduces a
   full frame to 165 wire bytes. Batches concatenate up to five independent blocks, including a partial final block. The server limits outstanding decoded PCM to 76,800 bytes (2400 ms) for the new firmware, or 20,480 bytes for legacy clients. The entire next batch must fit the credit window.
5. The ESP holds 128 compressed frames (2560 ms, about 21 KiB per direction), starts after a configurable 60–1800 ms prefill (600 ms default), and queues cumulative `played` acknowledgements as I2S
   accepts samples. A separate task sends the latest progress at most every
   40 ms; the playback task never waits on the network. The WebSocket component
   uses separate receive/transmit locks. I2S DMA can still contain up to about
   20 ms of sound. On an underrun, playback rebuilds the configured reserve before resuming; it never speeds up samples. Device diagnostics include cumulative underruns, peak microphone queue duration and maximum microphone send time.
6. `play_end` marks EOF. The device waits for queued samples and a 35 ms drain
   before `play_done`. Only then does the next listening window start.

The installed user service enables `ROSIE_PREWARM=1`: it exercises the selected local voice, speech confirmation and STT at server startup without playing audio or calling an LLM. Up to 32 synthesized replies share a bounded 4 MiB RAM cache. A server restart clears this cache; a device restart does not. This removes cold initialization from later requests but cannot eliminate CPU inference time for new phrases.

The fixed queue capacity and configurable prefill are distinct. Raising prefill
adds initial latency; it does not fix a sustained link slower than real-time.
Overflow/stall aborts playback instead of silently dropping or speeding samples.
Speaker I2S uses duplicated stereo slots to avoid the classic ESP32 16-bit mono
sample-order quirk documented in the [ESP-IDF I2S guide](https://docs.espressif.com/projects/esp-idf/en/v5.4.2/esp32/api-reference/peripherals/i2s.html).
The amplifier still drives one physical speaker.

IMA ADPCM is lossy, while preserving the original sample rate and duration. Each
block contains a little-endian sample count (uint16), initial predictor (int16),
step index (uint8), then 4-bit codes with the high nibble first. Blocks carry their
own decoder state; the final block may contain fewer than 320 samples. Invalid
counts, lengths or indices are rejected. Progress and completion always count
decoded PCM bytes, independently of the negotiated transport codec.

## Commands and persistence

Robot rooms are stored server-side, so a room change requires saving the catalog,
not reflashing. The resolver treats an explicit unknown room as an error and never
falls back to the current room. Routines cannot contain cross-room devices.
Registered custom intents precede deterministic home commands and the LLM.
Secrets are omitted from ordinary config responses; the authenticated pairing
endpoint reveals only the requested robot token.

Atomic catalog replacement uses mode 0600 in a mode 0700 data directory. The
administrator password is independently generated. This LAN installation uses
HTTP and ws; credentials are not encrypted in transit without TLS/VPN. No public
ingress or router changes are part of deployment.

Speech/model execution is serialized on this CPU-only host. Cancelling a session
waits for a running native inference call before releasing its model lock. MQTT
actions resolve only registered topics/payloads and do not claim physical success
from a broker acknowledgement. Provider tool requests are limited to one action
round per response; requests are not automatically retried by application code.

An in-memory TTS LRU cache is keyed by exact text, voice and quality, bounded to
eight replies / 4 MiB, with a 1 MiB per-item limit. This avoids repeat inference
for common short phrases without recording conversations to disk or reusing an
answer across different text/settings. New replies retain the normal inference
path. STT, TTS and total preparation times are recorded separately.

The provider returns a validated `Reply` containing text and expression in the
same request. OpenAI uses strict JSON schema; DeepSeek uses JSON mode followed
by the same local validation. Invalid or truncated output is never read aloud
as JSON. The text, including question punctuation, goes to TTS; expression
metadata goes only to the display. Local intents have an editable expression
and do not need an LLM call. Normal answers are the personality default.

Follow-up listening lasts the configured `listen_seconds`. Once it ends,
`state:drowsy` keeps microphone capture/upload and the conversation active for
`drowsy_seconds` (default 60, range 0–3600), timed by the server. Firmware advertises
`hello.drowsy_listening:true`; older firmware skips this new state. Speech begun
before either deadline can finish; a successful reply restores the normal listening
window. Noise rejection preserves the current phase and deadline. A pure firmware
timer schedules a 2.5-second yawn starting two seconds into each 25-second cycle.
After the server ends the drowsy phase, idle runs only the local wake detector,
the eyes close and zzz appears, without blinking. Explicit
sleep/stop phrases send `state:idle,sleep_now:true` to skip the visual delay.
Thinking/speaking interrupt the rest cycle. Muted/offline also close the eyes. Status text is
reserved for connection, provisioning and errors. The pure `face_art.h`
renderer can be previewed on a desktop with `tools/render_faces.cpp`.

Thinking moves the entire face horizontally by up to four pixels in a smooth
3.2-second cycle, with the eyes at their normal height. It has no thought bubble.
Speaking and yawning mouths are filled.

## Endpoint light and display

The current Node panel stores per-endpoint `indicatorLight` and `display` settings.
Existing endpoints default to a disabled indicator and an enabled display with no
schedule. Their authenticated configuration supplies the light's enable flag and
listening/minimum-speaking/maximum-speaking percentages. All percentages are bounded
to 0–100, with minimum no greater than maximum. Older firmware ignores these fields.

One ordinary indicator LED on GPIO18 uses hardware LEDC at 5 kHz and 10-bit duty.
The playback task is the only PWM writer; there is no network call or added task
in its light update. Listening and drowsy capture use fixed brightness. Speaking
uses the decoded PCM energy already measured for the mouth, with an attack/release
envelope between configured limits. Playback prefill, underrun recovery, zero audio
volume, sleeping, thinking, mute, errors, disconnection and provisioning turn it off.
Expression previews without audio do not pulse the LED. GPIO19 remains unused.
PWM does not replace the physical series resistor or permit a power LED load.

The display offers automatic, forced-on and forced-off modes. Automatic scheduling
uses the home's IANA timezone, every day, with an inclusive off boundary and exclusive
on boundary. Both daytime and overnight windows are supported; equal boundaries are
rejected. Manual modes override the schedule. The server evaluates time once per
minute from its existing session timer, sends a display-only event at transitions,
and recomputes on settings changes and reconnect. It never resets conversation,
microphone or LED state to change the screen. There is no autonomous clock schedule
on the ESP: if the server disconnects, the last display decision holds until reconnect.

The SSD1306 receives display-off/on commands rather than repeated blank frames.
While off, face frame transfers are suspended. Opening Wi-Fi provisioning temporarily
enables the display to show its password; closing it restores the configured state.
Initial startup may show connection status before server configuration arrives.

## Local attention commands

Explicit standalone stop/cancel/sleep commands bypass the LLM and TTS and go
directly to sleep. Addressing Rosie or adding “por favor” is accepted; negated
phrases and commands targeting appliances are not intercepted as session stops.
After one empty speech transcription, a single repeat prompt is allowed within
the remaining listening deadline. A second consecutive empty transcription sends
immediate sleep. Successful transcription or a new wake resets the counter.
Noise rejection does not count as a failed transcription or renew attention.
Speech from a video can still pass because speaker identity is not modeled.

## Hardware limits

Classic WROOM has no PSRAM. The wake model uses a static quantized TFLite blob,
an arena sized from its manifest, a separate resource-variable arena and a
streaming frontend. Compile success does not prove sufficient runtime heap,
real-time inference or reliable acoustic detection. Validate free heap and wake
timing on the actual device before adding models or larger queues.

Speech preview uses the same local synthesis path as the robot, but returns a
WAV file before transport and amplifier stages. The selected voice ID determines
Piper, Kokoro or Supertonic; one TTS model is kept resident. Kokoro uses the official pf_dora
style, Misaki's Brazilian Portuguese phonemizer and a pinned FP32 ONNX export.
This export measured faster than both INT8 exports on the current i3. Both engines
are limited to two CPU inference threads and converted to the same 16 kHz PCM
contract. Supertonic 3 uses four synthesis steps by default (eight in the optional
detailed mode), Portuguese language conditioning,
and local F1/M1 styles. Its 44.1 kHz float output is resampled and normalized to
the same PCM contract. Switching F1/M1 reuses the loaded engine. Runtime model
downloads are disabled; the installer pins and verifies the model artifacts.
The browser preview does not change the configured voice until saved. Eyes
express emotions independently; current TTS adapters have no emotional style control.

The NodeMCU ESP8266MOD is outside this profile. An S3 profile requires explicit
board identification, pin assignment and separate build/runtime validation.

## Provisioning revision

The panel issues a single-use six-digit pairing code, valid for five minutes. A
public, rate-limited redemption endpoint returns that robot's internal token to
the ESP after it connects to Wi-Fi. Reissuing a code invalidates the previous one
for that robot. No API key or broker credentials are sent to the device. The
setup AP has an independent eight-digit WPA2 password shown on the OLED; the
form does not require re-entering that password. An IP/address is accepted instead
of requiring users to construct a WebSocket URL.

The setup AP answers DNS A queries and HTTP probe paths to assist captive-portal
discovery. The manual address remains available if the OS does not open the
portal. Wi-Fi changes preserve an existing binding when the panel address is
unchanged and no new PIN is entered. The firmware delays the WebSocket until an
IP address is assigned and any requested pairing has completed.
