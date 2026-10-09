# Voice interruption and addressed attention

## Status and requested behavior

On 2026-09-25 the owner requested a separate offline training job while other
application work continues. The requested wake group is “Acorda Rosie”, “Acorde
Rosie”, “Ei Rosie”, “Oi Rosie”, “Olá Rosie”, “Hello Rosie” and “Hi Rosie”, with
Brazilian and American pronunciations of the name. The addressed acoustic stop
phrases are “Rosie, para” and “Para, Rosie”. Bare mentions of the name are not a
new activation requirement.

Training candidates and integrating interruption are separate stages. This
document describes the integration contract; it does not claim that new acoustic
commands, echo cancellation or simultaneous listening are installed. Existing
production firmware and the Acorda Rosie model remain selected while candidates
are trained and evaluated independently.

| Recognized input                       | Required behavior                                                                                                                                |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Wake phrase while idle                 | Open a new conversation using the endpoint's existing identity and room.                                                                         |
| Wake phrase while speaking or thinking | Silence the interrupted response, discard its pending audio/work, and listen for a replacement request while retaining the conversation context. |
| Addressed stop while awake             | Silence playback locally, end the conversation and display immediate sleep with closed eyes and zzz.                                             |
| Wake phrase while muted                | Remain muted.                                                                                                                                    |
| Stop while already idle                | Remain asleep without starting a conversation.                                                                                                   |

The existing standalone text stop commands, including “para”, “cancelar” and
“cancele”, continue to work after transcription during listening. The new acoustic
stop experiment intentionally uses the addressed pair instead of detecting every
spoken occurrence of “para”. “Ajusta o ar para 22” and “é para amanhã” must not be
session cancellation commands. Punctuation represents a pause, not a spoken word.

Sleeping retains the local wake detector. It does not mean mute or continuous
microphone upload. Neither wake nor stop detection should require a cloud LLM.
Conversation cancellation does not undo household commands that already executed
or imply that separately scheduled, accepted routines were cancelled.

## Current implementation boundaries

- `native/firmware/main/wake.cpp` accepts one binary streaming microWakeWord model.
  It cannot distinguish a wake label from a stop label in its current interface.
- `native/firmware/main/main.cpp` feeds that model only in idle/offline. It captures
  and uploads conversation audio only in listening/drowsy, so speech during
  playback is not currently recognized.
- `apps/web/src/server/robot/session.ts` accepts a wake event only while idle.
  Its existing stop path aborts work, clears capture/history and sends playback
  cancellation plus immediate sleep. An interruption that preserves context
  needs a separate transition.
- `apps/web/src/server/robot/playback.ts` checks abort signals and correlates
  acknowledgements with playback IDs. Binary audio packets carry no independent
  playback ID. Device-side cancellation alone is therefore insufficient as a
  complete protocol for rejecting late state/control/audio messages.

The installed WROOM has no PSRAM. Earlier healthy transport samples reported
roughly 90–93 KiB free heap and the selected model used 20,572 bytes of its 28,128
byte tensor arena. These historical samples do not establish the peak headroom
for two detectors during network playback. See
[hardware validation](../../native/docs/validation.md).

## Integration requirements

The future integration must negotiate a capability rather than changing the
meaning of legacy wake events silently. Distinguish wake/interrupt from stop,
bind each event to the authenticated endpoint and current connection/operation,
and reject repeated or stale events without replaying household actions.

When a detector recognizes an interruption, the device should stop I2S output
and clear its playback queue before waiting for a network round trip. Local stop
must remain effective if the server is slow or disconnected. Apply the matching
mouth/indicator/sleep transition at that boundary. The server must invalidate the
interrupted response and discard late synthesis/provider results and speaker
acknowledgements. A replacement listening session must not inherit samples from
the old utterance or accept leftover audio as new playback. The protocol needs
an explicit operation boundary for this; it is not enough to enable wake
inference in the speaking branch.

Use a bounded handoff to the network task rather than sending from the capture
or playback task. Exclusive speech-model work retains its resource lock until
the underlying computation actually finishes, even if its result is discarded.
Cancellation affects only the originating endpoint, including when two endpoints
share the same digital assistant.

## Acoustic and model acceptance

Training uses separate compact binary candidates for the wake group and addressed
stop group, with cross-group negatives. Verify model frontend/version, operations,
quantization, arena requirement and streaming timing before considering firmware
selection. Synthetic source voices and all their augmentations must stay within
one train/validation/test split. Choose thresholds using validation data only;
report held-out recall by phrase and pronunciation, confusing negatives and false
activations per hour of continuous background audio. Synthetic acceptance is not
physical acceptance.

Playback echo needs a separate solution: a classifier cannot identify whether
identical words came from the owner or the robot's own loudspeaker just from the
phrase label. Training on noise does not replace echo cancellation. Evaluate a
playback-reference echo strategy and its actual CPU/RAM cost on this hardware;
do not assume an ESP32-S3 implementation or memory budget applies to WROOM.

Before enabling interruption for normal use, test with the real microphone and
speaker at multiple volumes/distances. Include wake/stop during prefill, active
speech and underrun recovery, the robot saying its own name or quoting a stop
phrase, TV/background speech, late frames after cancellation, reconnects, repeated
interruptions, mute, and two independent endpoints. Record recognition-to-silence
latency separately from acoustic recall, free/minimum heap, upload/backpressure
and playback underruns. Do not promise zero delay or infer reliable interruption
from export, compilation or one successful spoken trial.
