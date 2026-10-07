# Validation — 2026-09-22

## Silent speaker investigation — 2026-09-23

The user reported complete silence in both conversation and Testar voz after
the expression revision. A 12:48 UTC test interrupted microphone capture and
coincided with a WebSocket write timeout after 1512 ms. The device reconnected
five seconds later. This demonstrates that the larger queues did not eliminate
every transport failure; the earlier successful samples remain limited evidence.

A separate test started from idle at 12:58:44 UTC completed 100,352 decoded
bytes (3.136 s) in 3.315 s, with no new disconnect or reported playback underrun.
The user explicitly confirmed complete silence during this test. The matching
server preview contains nonzero mono 16 kHz PCM; server encode/decode preserves
its measured RMS at -19.07 dBFS (source/decoded peaks 31,128/32,305). These checks
exclude empty synthesis for this sample but do not verify physical I2S signals,
amplifier power or acoustic output. No firmware, service or network changes were
made. VIN-to-GND and SD-to-GND multimeter readings on the MAX98357A were requested
to investigate the physical output boundary before selecting a corrective patch.

The user measured 5 V between VIN and GND and 0.4 V between the unconnected SD
pad and GND. These values are consistent with supply present and the amplifier's
stereo-average channel selection, rather than shutdown. They do not establish
supply stability during playback or a working physical I2S connection. A separate
reported 1.6 V reading has no identified measurement points yet. Full power removal
from both USB and the external supply is the next controlled diagnostic, followed
by the same voice test. The user subsequently reported that it worked after
this instruction. No firmware change was made. This confirms reported acoustic
recovery, but does not isolate the electrical cause or establish a permanent fix.

## Transport buffering, continuous speech and expanded expressions — 2026-09-23

The user reported frequent `SEM SERVIDOR`, choppy playback and slow thinking.
Before changes, event records included 2.240 s of audio taking 5.311 s, and 0.832 s
of audio taking 6.222 s. Several microphone starts were followed by disconnects.
The service had no automatic restarts. TCP samples showed variable RTT and
retransmissions. Earlier USB evidence identifies the immediate failure: the
WebSocket library aborts when a 500 ms write deadline returns zero. The original
640 ms upload queue could not safely support a longer deadline on its own.

Both ESP queues now retain 128 compressed 20 ms blocks (2560 ms, approximately
21 KiB per queue). The server negotiates batches of up to five blocks and a
2400 ms decoded playback credit window, preserving legacy single-block/PCM
server behavior. Capture batches normally add at most 80 ms before upload and
reduce message frequency from 50 to 10 per second. The send deadline is 1500 ms,
below the compressed capture queue duration. Playback rebuilds its reserve
following an underrun. Prefill is configurable from 60 to 1800 ms for the new
firmware, clamped for legacy clients; the live value was changed from 300 to
600 ms. Device diagnostics now report underruns, peak upload queue duration and
maximum microphone send time. No AP or network settings were modified.

The transport image (1,312,928 bytes) was verified and written to application
address 0x10000 on the confirmed CH340 WROOM. SHA-256:
`6852895f003d67164d46f520c4026290a9822902504031d865719a8373a6bbf7`.
It preserved NVS and the experimental Acorda Rosie model. The server negotiated
five-block batches and 2400 ms credit. Two 3.136 s test phrases completed in
3.388/3.412 s; the user confirmed both were continuous without cuts. Subsequent
6.976 s speech completed in 7.141 s. During these samples, underruns remained
zero, upload queue peaked at 20 ms, maximum microphone send was 4 ms and heap
remained near 90–93 KiB. This is an observed test window, not proof that every
future Wi-Fi condition is fixed.

Thinking was measured separately: one reply took 2.15 s STT, 1.388 s LLM and
10.18 s local Dora synthesis (13.73 s to ready). New audio generation is a CPU
bottleneck independent of playback buffering. The user service now prewarms
selected local TTS/VAD/STT without output or LLM calls (8.65 s observed startup),
and the bounded RAM cache allows 32 replies within 4 MiB. An interleaved
sentence-synthesis/playback trial reduced waiting for some longer replies but
introduced pauses whenever synthesis was slower than playback. The user rejected
that behavior. The final implementation returns to a single complete audio stream
per answer. Continuous delivery is prioritized over that trial's early first
sentence. Dora, Whisper base and the provider/model selection are preserved;
previous local INT8 Dora comparisons were slower and were not repeated.

The user additionally approved confused, excited, shy, skeptical, proud and
affectionate expressions. Curiosity now uses equally open attentive eyes, while
confusion owns the uneven lids. New expressions are represented in the validated
reply enum, provider schema/instructions, panel, OLED renderer and six editable
local demonstration intents. Existing live intents and secrets are preserved.
The same renderer was exported and visually inspected, including all twelve
speaking expressions. Firmware tests verify distinct eyes and unchanged sleep,
yawn and thinking behavior; provider contract tests cover both configured
provider types and the expanded enum. Tests also cover bounded batched playback,
legacy negotiation, partial final blocks, malformed audio, model warmup and one
playback stream for multi-sentence responses.

The final local suite passed 113 tests; lint, source formatting, documentation
links and the pinned offline ESP-IDF build passed. Existing TestClient dependency
deprecation warnings remain. The final expression image is 1,314,672 bytes,
SHA-256 `d95c651c334ffc9bfe5b548c2a33393ffc59dbab78951ee087602f36cd271770`.
The preceding transport image is retained on Proxmox as
`/root/rosie-backups/rosie-native-before-expanded-faces.bin` for app-only rollback.
The final image was subsequently flashed with hash verification; boot loaded
Acorda Rosie and reached the server in approximately 3.08 s. All six new local
intent phrases returned their expected expressions through the authenticated
live API. The seven changed/new expression controls were exercised on the
connected robot. Final-image 3.136 s voice samples completed in 3.348, 3.429 and
3.319 s, with zero reported underruns and 4 ms maximum microphone send in the
observed window. Subjective acceptance of the new face artwork remains a user
judgment. The user had already confirmed uninterrupted transport-revision audio.

## Acorda Rosie: first trained model and experimental device trial

The first experiment completed 520 checksum-verified, mono 16 kHz synthetic
clips: 120/40/40 positives and 192/64/64 negatives across training/validation/test.
The ten source voices are disjoint between those splits. Augmentation produced
1920 training positives, 768 training negatives and 128 synthetic noise examples;
held-out splits each have 120 positives, 128 negatives and 24 noise examples.
Recorded CHiME training features complement synthetic negatives. A separate
120-second CHiME subset is used for validation, and 5.3347 hours of DIPCO features
were reserved for the final background evaluation. No user recordings were
collected, and all positive examples use the same Kokoro engine.

Ten thousand CPU training steps and quantization finished successfully in
1526.4 seconds, excluding corpus generation and feature preparation. Corpus
generation took approximately 22 minutes after its initial resumed batch.
The best validation checkpoint was step 2500; later training did not improve it.
A preserved snapshot was converted and evaluated while training continued. The
final run's best-weight checksum matches that snapshot. The selected, evaluated
snapshot is `artifacts/wake/acorda_rosie/candidate-01-probe/acorda_rosie.tflite`,
60,840 bytes, SHA-256
`451091af6ac6be6963e483cbd82c9a6c7b66dfe4a8a20fd312884e2d273bfc95`.
The final trainer's separate quantized export is not the selected device artifact.

The probability cutoff was calibrated exclusively on validation data. A fixed
0.5 cutoff missed many positives; a 0.10 cutoff, above the largest validation
negative score plus a margin, detected 109/120 validation positives with no
negative-clip detections. The firmware's int8 rounding/saturation, five-output
mean and 30-inference warm-up were applied in streaming evaluation. Held-out
results at that cutoff were:

- 101/120 positive detections: 58/60 Brazilian pronunciations and 43/60 American
  pronunciations. These are augmented synthetic examples, not independent humans.
- Two of 152 negative clips triggered: clean and augmented versions of the same
  held-out voice saying “Faz cara de feliz”.
- Two detections in 19,204.99 seconds of held-out background audio, approximately
  0.375 events/hour in this particular corpus. This is not a home false-wake forecast.

The candidate **did not pass the intended offline quality gate**: American-name
recall remains weak and negative phrases produced false accepts. It is an
experimental device trial, not a production-qualified model. The user explicitly
kept Acorda Rosie alone and requested this first physical test before training
other calls. The limitations were explained before the reversible USB installation.
The source recipe remains a historical record of the approved data-generation
inputs; it is not the live deployment-status source.

The trial application is 1,311,984 bytes, SHA-256
`28eb30ec21a7ccf53e6c88ae6ad0afa8b99134b97fa6a3083bfc628d69aff15f`.
The CH340/MAC identity and the previous native image were checked before app-only
flashing at 0x10000, 115200 baud. Esptool verified the written data hash. NVS,
pairing, bootloader and the unrelated CP2102 adapter were preserved. The detector
loaded successfully with 20,572 bytes of actual tensor-arena use from a 28,128-byte
reservation, and the server connected around three seconds after reset. A later
device sample reported 93,768 bytes free heap and an 8.55 ms inference-bearing
feed call. These are samples, not worst-case timing or heap guarantees.

The user then confirmed “Acorda Rôzi”, followed by “bom dia”, **woke the device and
produced a spoken reply**. Serial logs independently recorded the custom wake
detection and a speaking expression. This establishes one successful human trial;
American pronunciation, distance/noise robustness and sustained transport quality
remain unverified. Disconnect/reconnect events also occurred after the flash, so
this change must not be described as resolving the separate transport problem.
The server settings, Home Assistant and UniFi configuration were not changed.

The native rollback image on Proxmox is
`/root/rosie-backups/rosie-native-before-acorda-rosie.bin`, SHA-256
`1ddb711343dc66a5d9a8be19e4de73338760a236c1b518843adf7d706b749013`.
The matching local header and application are preserved under
`native/artifacts/wake/before-acorda-rosie/`. Restore only the application at
0x10000 on the confirmed WROOM; the older full-flash backup restores ESPHome and
is not the appropriate first rollback for this model trial.

## Custom wake-word pronunciation preparation

The user selected Acorda Rosie as a candidate, also likes Oi Rosie, and requested
both an American rhotic Rosie and Brazilian Rôzi/Rose with first-syllable stress.
The initial data recipe targets Acorda Rosie with both name pronunciations;
Oi Rosie is an evaluation probe, not silently assigned a negative training label.

An offline helper generated 12 synthetic pronunciation drafts using the three
already installed Portuguese Kokoro styles, two prefix variants and two name
variants. Model hashes are verified before synthesis. One inference thread and
lower process priority limit the preparation load. WAVs are mono 16 kHz PCM16;
the manifest records each phoneme sequence, voice, duration and SHA-256. The
inspection of automatic phonemization emitted `ɹˈOsi` for English Rosie and
`ˌakˈɔɾədæ` for Acorda in the current setup; explicit draft phonemes avoid
uncritically expanding those outputs into a large training set. The user approved
both reference pronunciations with “Tá ótimo” after listening in the browser.

This is pronunciation preparation, not detector training or a held-out evaluation
dataset. No microphone recordings were collected or uploaded, no provider was
called, no server setting was changed, and no firmware was flashed. The upstream
training reference is pinned at 4665173cd35f1cff9a61e06fc427f124766c488e. Full
data preparation, training, independent validation and WROOM runtime measurement
remain before installing a custom model; Okay Nabu remains active.

The chat client did not expose the audio previews to the user. Two synthetic Dora
drafts are now served by the existing static mount at `/static/wake-preview.html`,
with labeled browser audio controls and direct WAV downloads. HTTP checks returned
200 for the page and both 33,496-byte WAVs, with audio content types and byte-range
support. No service restart or firmware change was needed. All 12 generated WAVs
passed independent format, duration, pronunciation-metadata and checksum checks.
Reference hashes and the 2026-09-22 approval are recorded in the training recipe.

The initial synthetic corpus is being generated with ten disjoint source-voice
groups across training, validation and testing (six/two/two voices). It contains
200 positive examples and 320 planned hard/ordinary negatives. Local Kokoro
inference is limited to one thread, one CPU and 1000 MiB, with lower scheduling
priority. This does not establish performance on human voices.

The separate Python 3.12 container image, upstream trainer archive and two
background archives are pinned and checksum-verified. Ninety-seven resolved
training dependencies have archive hashes in `training/requirements.lock`.
No dependency was installed into the live voice-server environment. The negative
dataset declares CC-BY-NC-4.0; archives and generated artifacts remain private.
A short, one-thread benchmark of the 26,049-parameter upstream MixedNet measured
0.08758 seconds per training batch of 128 after warm-up. Its roughly 15-minute
projection for 10,000 steps excludes data processing, validation and export and
must not be described as a complete training deadline.

## Editable humor for all speaking expressions

At the user's request, expanded the editable starter/live intents to angry,
happy, sad, surprised, curious and neutral, each with four short humorous replies.
Common feminine/masculine phrase variants are included where applicable. These
are exact local demonstrations of Rosie's expressions; a user's own “estou triste”
does not match a joking response. Ordinary greetings and gratitude remain unchanged.
The existing runtime resolver still owns all matching, randomness and room scope.

The six catalog entries were merged through the authenticated live API. Existing
phrases/responses were retained, and all non-intent catalog data was verified
unchanged. No restart, reflash, LLM request or household action is needed for this
change. Conversation regression tests exercise every registered phrase, reject
duplicate normalized phrase definitions, verify the selected expression/reply
pool and prohibit cloud calls or automation execution during demonstrations.
The complete regression suite passed: 89 tests. Existing TestClient dependency
deprecation warnings remain; they did not fail validation.

An additional USB observation captured `transport_ws: Error transport_poll_write`,
followed by `esp_transport_write() returned 0`, `Microphone transport stalled`
and the SDK's five-second reconnect. The current microphone send deadline is
500 ms. Inspection of the pinned WebSocket client confirms that a zero-byte
transport write aborts the connection. This identifies the immediate disconnect
mechanism during capture, but does not establish why the TCP socket stopped being
writable. Increasing that deadline alone would also exceed the current 640 ms
PCM upload queue; no timeout, queue, firmware or radio change was made as part of
the expression-intent update. Intermittent transport reliability remains open.

## Playful character and subsequent connection observation

The user reported that asking about anger produced a generic AI disclaimer and
then “SEM SERVIDOR”. The persisted prompt had only the balanced tone guidance,
with no description of embodied character play. Added explicit guidance for
playful facial demonstrations while preserving ordinary answers and honest
technical explanations. The editable `angry-face` intent handles common anger
questions and display requests locally with `expression:angry`. It lives in the
catalog and uses the existing custom-intent resolver; there is no second phrase
matching path. The bootstrap shares this starter definition for future installs.

The live configuration was updated through its authenticated API, without restart
or firmware changes. A private pre-change catalog backup was saved. Readback
confirmed all settings, credentials, robots and existing intents were unchanged
apart from the appended character guidance and the new intent. Regression coverage
checks local/no-provider resolution, the angry expression, editable replies,
unchanged normal greeting behavior and no household automation execution.

The server remained active with zero automatic service restarts. Device-side
disconnects at 19:27:54, 19:28:03 and 19:28:43 local time were followed by accepted
connections; the former 403 rejection did not recur in these samples. Two serial
observation windows did not capture a new transport error. The user then confirmed
“pode parar” went to sleep without “SEM SERVIDOR”. After the personality update,
a real provider response selected angry at 19:35:47; playback completed in 1.767 s
for 1.621 s of generated audio. Later neutral/happy turns also completed. This
confirms current interaction and recovery, not the root cause or permanent removal
of intermittent disconnects. No radio setting, timeout or buffer was changed on
speculation. The prompt guidance follows the official
[prompt-engineering documentation](https://developers.openai.com/api/docs/guides/prompt-engineering)
on explicit identity and examples; the existing model and API remain unchanged.

## Listening while drowsy and recovery after reconnect

The user requested eyes at their normal height while thinking and active
conversation capture during drowsiness. Drowsiness is now an explicit server
state, negotiated by `hello.drowsy_listening:true`, with the ESP capture/upload
paths accepting both listening and drowsy. The server retains conversation
context through this phase, accepts a continuation without a new wake word,
and restores the normal follow-up window after a reply. Noise preserves the
phase/deadline. Two empty transcriptions and explicit stop still sleep immediately.
Sleep uses closed eyes/zzz and only the local wake detector. The configured
rest duration now belongs to the server deadline; the firmware draws the state
and schedules yawns, avoiding a display/capture disagreement at timeout.

After the preceding installation the user reported “SEM SERVIDOR” on speech.
The server remained running, while multiple device disconnects had code 1005;
reconnect attempts sometimes received 403 because the prior socket still occupied
the robot ID. The last intentionally initiated service restart was at 19:07:04
local time, but additional disconnects followed it, so restart alone does not
explain the report. Subsequent voice turns completed, with playback measurements
of 3.264/3.471 and 2.795/2.921 seconds expected/elapsed. The new local filter also
recorded noise rejections without a transcription or thinking state. These samples
do not establish continuous transport reliability.

An authenticated connection now atomically replaces the prior session for the
same robot, cancels its old job and closes that socket. Cleanup checks ownership
before removing a session or resetting conversation history. Tests exercise stale
cleanup, a pending accept race, and invalid credentials that must not displace a
valid connection. This fixes the observed reconnect refusal; the initiating
radio/TCP disconnect remains unproven. A 50-second serial read sent no explicit
reset or line-control commands and captured no new transport error in that window.

All 82 tests and source checks passed, including normal/drowsy capture gating,
two-phase attention, speech begun near a deadline, noise that cannot renew the
timer, and immediate sleep for stop/two misses/zero configured drowsiness.
The thinking animation retains horizontal motion and filled mouths, with the
eyes centered at their normal y=27 position. Installation is recorded below.

The final application build is 1,311,408 bytes, SHA-256
`1ddb711343dc66a5d9a8be19e4de73338760a236c1b518843adf7d706b749013`, with 68%
partition space free. The service restart completed while idle and preserved
the catalog byte-for-byte: 20-second normal listening, 10-second drowsy listening,
and Kokoro Dora. The shared firmware renderer was also inspected as a six-frame
sheet showing thinking left/center/right, drowsy, yawn and filled speaking mouth.

The SSH monitoring process exited with status 143 while the remote esptool writer
was still running. No concurrent write or reset was started. After the writer
exited and the robot reconnected, a separate read-only `verify-flash` operation
confirmed all 1,311,408 application bytes against the final image by matching
digest, then reset the device normally. Final health reported idle and connected,
MQTT connected, approximately 92 KB free heap and RSSI -67 dBm. Configuration
remained 20/10 seconds and Dora. Real drowsy speech continuation and sustained
connection reliability remain physical acceptance checks.

## Noise admission, cancellation and moving thinking face

The user rejected the thought bubble, requested a side-to-side thinking face,
filled mouth, immediate sleep for cancellation commands, and sleep after two
consecutive failures to understand. They report keyboard sounds, horns and
quieter video speech being mistaken for input. Runtime metadata showed repeated
empty-transcription prompts (53,932 PCM bytes each), each renewing the listening
window; some transcription attempts took 6–15 seconds. No microphone audio or
conversation transcript was retained.

The coarse WebRTC detector admitted deterministic simulated horn, hum and keyboard
clips. A second local Silero v6 check (already bundled with locked faster-whisper)
rejects all three as well as silence/hiss before STT or the thinking state. The
same check accepts the generated Portuguese Dora greeting at normal amplitude
and 8% amplitude after IMA ADPCM encode/decode. On this CPU it took 71 ms cold
and 11–15 ms warm in the isolated check. This is synthetic regression evidence,
not proof that every real environmental sound is rejected. Video speech remains
a limitation: no speaker identification or source separation was added.

Noise cannot renew the listening deadline. One empty transcription can request
a repeat; a second consecutive empty transcription goes directly to sleep.
Successful transcription or a fresh wake clears the count. Stop/cancel/sleep
commands go to sleep without LLM or TTS, with exact phrase handling to preserve
negation, ordinary questions and appliance commands. Interruption during
playback remains outside the existing half-duplex protocol.

The firmware renderer removes the thought bubble, sways the whole face four
pixels to each side over 3.2 seconds, and fills speaking/yawning mouths. The
host renderer was visually inspected at both extremes and center. Regression
tests verify whole-face translation, no pixels in the former bubble region,
filled mouth centers, and preservation of the rest timer and closed-eye behavior.

All 75 tests and formatting/lint checks passed. Application image: 1,311,248
bytes, SHA-256 `3cbbfde6a508fc161660e5896b1528cf03407fbe870add7c3a273a47bf4a73fb`,
68% partition free. The server restarted while idle and the robot reconnected;
catalog bytes remained unchanged (listen 20 s, drowsy 10 s, Dora selected).
Direct application-only flashing verified the confirmed CH340 WROOM and original
backup first, preserving NVS. Flash readback hash verification succeeded. The reboot
temporarily associated with the existing other AP on channel 11 after an initial
channel 6 authentication failure, then returned to the Sala AP on channel 6;
no AP settings were changed. WebSocket retries included a timeout and 403 before
the server connection recovered approximately 33 seconds after boot. Health
confirmed idle, MQTT connected, approximately 94 KB free heap and RSSI -72 dBm.
These observations retain the separate intermittent transport limitation.

Real local Dora-to-Whisper checks accepted all six tested speech clips in Silero.
“Pode dormir”, “pode parar” and “chega” were transcribed and classified correctly.
“Cancela a conversa” lost the article; the phrase resolver now accepts that
natural article-free variant too. Single-word synthetic “para” and “cancela”
were mis-transcribed as “Paras” and “Concella”; no speculative typo aliases or
STT bias were added based on synthetic pronunciation. Actual human speech,
environmental noise rejection and the physical face remain user acceptance checks.

## Restore visible rest phase and distinguish thinking

The previous visual revision coupled drowsiness to the final third/five seconds
of the listening timeout. At inspection the saved timeout was 10 seconds, leaving
only 3.3 seconds of drowsiness with one 1.7-second yawn; it then closed the eyes.
The user reported missing boredom/yawns and asked for a configurable duration.
The corrected owner is the idle face timer, independently configured by
`drowsy_seconds` (default 60, range 0–3600). After a conversation timeout, the
local wake detector stays enabled while half-closed eyes and a flat mouth show
boredom, with a 2.5-second yawn every 25 seconds. Only after the configured rest
duration do straight closed eyes and zzz appear. Explicit sleep commands bypass
this delay. Listening always keeps its own complete timeout and open eyes.

Thinking now uses a symmetric upward gaze, a small thought bubble and a short
straight mouth; it no longer shares the asymmetric brow design of curiosity.
The actual firmware renderer and its timer are tested on the host, including
repeated yawns, 60/120-second durations, explicit sleep, zero duration, wake/listen
interruption and sleeping frames that do not change during blink intervals.

Recent runtime evidence showed approximately 2.1–2.7 seconds for STT, 1.7–1.8
seconds for provider replies, and additional local TTS time. Separate playback
stalls and WebSocket reconnections also remain in the event log. None is explained
by a static facial expression, and this revision does not claim to resolve the
transport failures. A serial observation included boot/association output and
therefore cannot establish uninterrupted baseline operation.

Dora CPU comparison with a fixed 3.627-second sample measured warm synthesis of
4.824 s (one thread), 5.277 s (two) and 6.967 s (four). Shared-host variance and
the small difference between one and two do not justify a thread configuration
change. A bounded in-memory cache now avoids generating identical short speech
again, keyed by text, voice and quality. Tests verify cache hits, key separation
and eviction by count and byte budget. New replies still incur synthesis latency;
STT, TTS and total reply preparation have separate diagnostic timings.

Forty tests and source checks passed; the refined half-closed eyelids also passed
the firmware-renderer regression test. The application build is 1,311,360 bytes,
SHA-256 `3fd0a85deab18b713d0f5b5c54b2aeaa275541ee9a947cc08d27ca506f8e150c`,
with 68% partition space free. The server was restarted while idle and persisted
the new setting with 60 seconds. The user's listening setting had meanwhile
changed to 20 seconds and was preserved, along with Dora and all credentials.
The first fixed Dora preview took 10.261 s including model loading and concurrent
firmware compilation; its identical cached repeat took 0.034 s. This is a cache
comparison, not a claim that uncached generation has accelerated.

The corrected application was written directly to the verified CH340 WROOM at
0x10000, preserving NVS; esptool verified the flash hash. After association
retries it reconnected at approximately 18.8 seconds after boot. The read-only
health check confirmed idle, MQTT connected, TTS ready, 60-second rest and the
user's 20-second listening timeout. It reported 94,116 bytes of free heap and
8.895 ms wake inference, with RSSI -79 dBm at that sample. Browser validation
confirmed that editing the rest duration produces an independent config field
and fits a 390 px viewport, without saving the test edit to the live catalog.
Human acceptance of the new expression/yawn appearance remains pending.

## Balanced personality, expressions and local voice comparison

The user requested ordinary answers instead of habitual jokes. Both the default
and this installation's persisted personality were changed, preserving feminine
identity, Brazilian Portuguese and no emojis. The two seeded greeting/thanks
intents also contained only jokes; these became ordinary variants after a private
catalog backup. Custom humorous intents remain supported, with editable expressions.

Open-ended replies now carry validated text and a bounded expression from the
same provider request. Mocked OpenAI/DeepSeek tests cover response contracts,
malformed/truncated output, preserved room arguments in tool calls and local
intents avoiding the provider. Real API probes returned neutral for arithmetic,
sad for a bereavement scenario, happy for celebration and curious for a requested
question, in 1.25–1.86 seconds. No household action was invoked. These samples
do not establish universal emotion classification accuracy.

The firmware renders rounded eyes, closed straight eyelids and zzz during idle,
drowsiness/yawning near the follow-up deadline, a thinking face instead of mouth
dots, and six reply expressions. The mouth is narrower with a slightly taller
speaking opening. Only connection, PIN and error captions remain. Drowsiness is
a display hint that preserves microphone capture. Tests verify that speaking
near the deadline clears drowsiness and prevents premature sleep. The independent
idle-seconds setting was removed; this visual transition follows the conversation
timeout. The pure firmware pixel renderer was compiled on the host and its
actual output was visually reviewed as a contact sheet.

The firmware application is 1,311,024 bytes with 68% of its partition free,
SHA-256 `93957f07a1e76dd19500a59b1d852e6e7c83252c70af4adc72d8dd9b9fdf5b09`.
The existing full-flash backup and MAC were checked before app-only USB flashing
at 0x10000 via CH340. Esptool verified the written hash. NVS and the separate
CP2102 adapter were preserved. Initial Wi-Fi association retries settled on the
existing channel-6 AP; the server connected about 18.5 seconds after boot.
No AP configuration changed. Serial logs confirmed all six expression values
reaching the flashed device. A Dora test completed 3.136 seconds of PCM in
3.303 seconds over IMA ADPCM; a diagnostic reported 90,212 bytes free heap and
1.62 ms wake inference. This confirms delivery and timing, not visual preference,
acoustic quality or sustained network stability. The live follow-up check was
not a controlled silent-room test; timeout behavior is covered by unit tests.

Supertonic 1.3.1 and the pinned Supertonic 3 snapshot were installed with verified
model artifacts and upstream license notices. Only F1/M1 styles were added.
Switching them reuses the engine. Tests cover complete-model availability,
disabled runtime downloads, style switching, preserved question punctuation,
resampling from 44.1 kHz to 16 kHz and the four/eight-step mode selection.

A standalone four-step benchmark generated 5.224 seconds of speech in 2.497 s
(F1) and 2.705 s (M1); eight steps took 4.061 s and 4.282 s. These shared-host
samples are not guaranteed latency. Deployed previews produced a 5.016-second
sample for both voices; F1 took 6.41 s including loading and build contention,
and the subsequent M1 request took 2.14 s. Browser checks confirmed playable WAVs,
both voices, the six-expression selector and a 390 px layout without overflow
or JavaScript errors. Previewing preserved the configured Dora voice.

The user reports that Supertonic still sounds artificial and question intonation
remains inadequate, and explicitly prefers local TTS. The optional eight-step
mode is exposed as Priorizar qualidade for comparison. No prosody improvement
is claimed without listening feedback. Facial emotion does not currently control
TTS voice style. Thirty-seven tests, lint, formatting, JavaScript syntax,
documentation-link checks and the firmware build passed. Two existing test-client
deprecation warnings remain. User acceptance of the new face is pending; the
question-prosody concern is not considered resolved.

The deployed F1 comparison measured 2.14 seconds in fast mode and 3.94 seconds
in detailed mode for the same 5.02-second sample. Preview checks preserved the
saved voice and configuration. A browser check of the new quality control
found that the label's grid styling overrode HTML hidden; a scoped CSS rule
corrected it. The repeated check verifies that only Supertonic exposes the
control and that detailed selection reaches the preview query, using an already
generated WAV fixture to avoid interrupting live speech. No subjective quality
gain has yet been confirmed by the user.

The native project is a separate successor under `native/`. No ESPHome YAML,
Home Assistant pipeline, existing appliance topic or UniFi radio setting was
modified. The active Sala radio remains on channel 6 / 20 MHz.

## Local software checks

- ESP-IDF 5.4.2 compiled the classic ESP32 firmware with the selected Okay Nabu
  v2 model. Application size: 0x13a3b0 bytes, with 69% free in the factory partition.
- Twenty-eight Python tests passed, covering room selection, unknown rooms, ambiguous
  targets, MQTT payload allowlisting, disconnected brokers, routine scope,
  sensor-backed intents, admin authentication, secret redaction, playback
  backpressure and follow-up timing after playback completion. Codec tests compile
  the actual firmware codec as a host library and verify byte-for-byte agreement
  with Python, an independent CPython audioop golden vector, malformed-block
  rejection and a synthetic 440 Hz reconstruction above 25 dB SNR.
- Ruff lint/format, JavaScript syntax and clang-format checks passed.
- Browser login and the intents page passed in Chromium at 1280×850 and
  390×844, without JavaScript errors or horizontal overflow. Screenshots are local
  in `artifacts/`, not part of the source distribution.
- A synthetic Piper→Whisper roundtrip of a short Portuguese sentence took
  3.87 s TTS / 4.03 s STT cold and 0.43 s TTS / 2.31 s STT warm. Generated speech
  lasted about 2.9 seconds. Whisper transcribed “café” as “a fé”; this is not an
  acoustic recognition accuracy test or an end-to-end latency benchmark.

The isolated command sandbox stalled asynchronous test execution; the same
tests and speech benchmark completed outside that sandbox. Piper's ONNX runtime
uses explicit two-thread intra-op / one-thread inter-op settings for this LXC.

## Installation and rollback

The existing development LXC runs `rosie-native.service` under user systemd,
with user lingering enabled, listening on 192.168.0.226:8765. Wi-Fi, broker credentials and the existing OpenAI
API key were imported into private ignored files. They were not included in source
or diagnostic output. The MQTT client connected successfully; the catalog has no
real appliance commands at initial installation.

USB probing confirmed ESP32-D0WD-V3 rev3.1, 4 MB flash, MAC 14:2b:2f:c2:0f:f8
on the CH340 adapter, `/dev/ttyUSB1` at the time. The unrelated CP2102 adapter
was left untouched. Full-flash backup at 460800 baud failed; retrying at 115200
completed successfully before any write.

The 4,194,304-byte backup is stored privately on Proxmox:
`/root/rosie-backups/esp32-14-2b-2f-c2-0f-f8-before-native.bin`.
SHA-256: `fe24d6f23bba1214af58b019848555dea718a84cd128ee7612f3b36d01bfc9ed`.
It contains the previous firmware and private configuration; do not publish it.

The initial native factory image was written at 115200 baud with successful hash
verification. Boot logs confirmed the selected model loaded with 18,396 bytes of
used tensor arena, Wi-Fi association, IP 192.168.30.201 and authenticated server
connection. Subsequent diagnostic samples reported roughly 121–124 KiB free heap
and 7.7 ms for an inference-bearing feed call. These are samples, not worst-case
performance bounds. RSSI samples were approximately −73 to −77 dBm.

Rollback, only on the verified same WROOM and with its matching wiring:

```sh
/tmp/rosie-flasher/bin/esptool --chip esp32 \
  --port /dev/serial/by-id/usb-1a86_USB_Serial-if00-port0 --baud 115200 \
  write-flash 0 /root/rosie-backups/esp32-14-2b-2f-c2-0f-f8-before-native.bin
```

The flasher environment is temporary; reinstall esptool 5.1.0 if it has been
removed. Restoring a full flash overwrites the current native NVS settings.

## Physical acceptance

The user confirmed changing OLED expressions and an audible test phrase, but
reported low volume, repeated gaps and an audio error at the end. Physical audio
acceptance is therefore incomplete. Compilation and I2S writes alone do not
prove physical audio quality. No simultaneous listening while speaking, acoustic echo
cancellation, phoneme lipsync, custom wake-model training or OTA has been claimed.
CI configuration is updated locally; no remote repository run or branch protection
was available in this uncommitted checkout.

## Pairing and screen revision

The user reported that the face changed but no speech played, and a numeric code
appeared. Later serial inspection found the saved server address was
`192.68.0.226`, missing a digit; that explained the then-current connection
failure, not necessarily the earlier silent response. The previous firmware
showed the setup password whenever the server disconnected, which was confusing.

The revised implementation shows explicit connection/voice status text, displays
the setup password only when the portal is open, enlarges the mouth and uses a
six-digit panel PIN instead of requiring a copied token. The server includes an
independent Testar voz action and connection/state diagnostics. Pairing unit tests
cover expiry, one-use semantics, reissuing and rate limiting. Firmware compilation
passed at 0x13ee30 bytes. The old 4 MB backup remains unchanged.

## Playback scheduling and mouth revision

Serial inspection during speech found repeated `Could not lock ws-client within
100 timeout` errors. Playback was synchronously sending an acknowledgement per
frame while the WebSocket receiver held its shared lock. A 117,774-byte phrase
(3.68 seconds of PCM) took approximately 22 seconds between speaking and completion.
Another run stalled after 64,640 played bytes. These measurements establish a
firmware scheduling defect; they do not rule out independent Wi-Fi jitter.

The revision separates WebSocket receive/transmit locks and moves cumulative
progress into a one-element queue consumed by a separate network task. Playback
does not perform network writes. Microphone frames use 20 ms instead of 10 ms to
reduce packet count. Server diagnostics now record expected audio duration and
elapsed playback time. The mouth is a shallow two-pixel outline instead of a large
filled opening.

The lock fix alone was insufficient: later phrases still took substantially longer
than their PCM duration. The device now negotiates independent 20 ms IMA ADPCM
blocks in both directions (165 wire bytes for 640 decoded PCM bytes). Capture has
its own bounded upload queue and network task, and playback acknowledgements count
decoded bytes. Queue overflow aborts the utterance instead of silently dropping data.

TCP inspection observed approximately 245 ms RTT, retransmissions and receiver
window pressure. ESP32 serial logs showed repeated aggregation-session changes.
AMPDU receive/transmit aggregation was disabled in the ESP32 Wi-Fi initialization;
no AP configuration was changed. Samples improved to 4.156/4.363, 9.242/9.440 and
1.660/1.872 seconds of expected/elapsed playback. Subsequent samples regressed to
3.808/5.701 and 3.692/6.122, and microphone transport stalls still occurred. These
changes improved observed behavior but do not establish sustained audio stability.

The latest application-only image is 0x13fb00 bytes. USB flashing at 115200 baud
verified its hash and preserved NVS. Free heap samples are approximately 90–94 KB.
The old full-flash backup remains unchanged. The user subsequently reported a
temporary display/power interruption while changing the external supply wiring,
then confirmed the display recovered; the exact power fault was not measured.

The WebSocket client previously did not reconnect after a clean server CLOSE.
The firmware now enables reconnect-on-close and clears the connection/playback
state on CLOSED as well as DISCONNECTED. After the installed revision, restarting
only rosie-native.service caused the robot to reconnect automatically in 5.35 s,
without opening/resetting its USB serial port during that test.

## Local voice comparison

The user reported unclear pronunciation of “dia” and “Rosie”; localized phoneme
and spoken-name substitutions improved those examples according to their report,
but word beginnings still sounded muffled. Those substitutions are a limited
pronunciation override for the upstream Piper/espeak output, not a fix for voice
quality or transport gaps. They should be removed when the selected upstream voice
pronounces these words acceptably without them. Visible conversation text is unchanged.

Faber and Cadu can now be auditioned in Voz e conexões using Ouvir no navegador.
The authenticated preview synthesizes a fixed short phrase with the selected local
model, returning 16 kHz mono WAV before ESP32 transport, compression and amplification.
Previewing does not save the voice selection or invoke the LLM. Tests cover the
authentication boundary, installed-model allowlist, path rejection, WAV format
and preserving the robot's configured voice. Only one TTS model is resident at a time.

Both real models generated valid previews: Faber produced 3.831 s of audio in
3.517 s; Cadu produced 6.014 s in 3.536 s including voice loading. These are
point-in-time measurements on the shared CPU. Articulation preference and physical
speaker acceptance remain user evaluations.

The Cadu model SHA-256 matches the official Hugging Face linked ETag:
`765f0809a6ea9035d4a6d0d008dbf8876e68b2dd32029312672fa8f405bdb535`.
Its upstream model card identifies a CC0 dataset and fine-tuning from lessac medium.

The user rejected Cadu as worse; it had been saved during comparison and was
returned to Faber. An optional third voice, Kokoro pf_dora, is now available.
Misaki handles Brazilian Portuguese phonemes; the existing spoken-name substitution
is retained but the Piper-specific “dia” phoneme override is not applied to Kokoro.

On the actual i3-4160 with two ONNX inference threads, the model-files-v1.1 INT8
export took 25.583 s cold and 22.900 s warm for approximately 3.8 s of speech.
The earlier INT8 export took 12.235/12.475 s. The selected FP32 export took
5.070/4.980 s for 3.477 s of speech, with 1.559 s separate model loading time.
These measurements demonstrate that the compact models were slower on this host;
they do not establish that quantization is generally slower. Model and style
download hashes are pinned in `tools/download_kokoro.py` and verified locally.

The deployed Dora preview returned valid mono 16 kHz WAV in 6.368 s including
loading; switching back to Faber also succeeded. Another server-only restart
reconnected the robot in 5.29 s. The configured voice remains Faber; choosing Dora
is optional because its higher generation cost can delay conversation. No firmware
change is required for this choice. Twenty-eight tests and all local source checks
passed; preview browser checks cover WAV playback and mobile layout. User approval
of Dora articulation and physical audio stability remain pending.

The user then confirmed that Faber's muffled word beginnings also occur in the
browser preview. At least this symptom is reproducible without the ESP32 codec,
speaker or Wi-Fi transport; this does not resolve the separate playback stalls.
A direct check of the current Faber synthesis path confirmed pt-br, 22,050 Hz
mono source and no phonemes missing from the model vocabulary. Conversion to
16 kHz preserved sentence durations within one output sample. Clipping introduced
by resampling was 0.00912%, 0.00592% and 0% in the three sentence chunks of that
sample. These measurements did not identify a timing or missing-phoneme defect;
they do not objectively establish articulation quality. No synthesis parameters
or firmware were changed based solely on this result. Dora listening feedback
remains pending before selecting another voice.
