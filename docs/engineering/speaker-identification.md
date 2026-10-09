# Local resident identification

The owner requested recognizing the resident speaking to a physical endpoint and
selecting that resident's existing profile. This is separate from transcription,
wake-word recognition and the experimental attention-model training.

## Contract

- Enroll an enabled, saved resident through **Moradores → Editar → Reconhecer pela
  voz**. Choose a connected, unmuted endpoint in the same home, currently idle.
  Read three displayed phrases without the wake word. Capture replaces normal
  conversation processing: enrollment audio cannot reach STT, the LLM, intents or
  automations. Only the owner can start, cancel or delete enrollment through the
  authenticated, origin-checked catalog API.
- Each attempt uses one segmented PCM16/16 kHz mono utterance, at most 20 seconds.
  Enrollment requires at least 2.5 seconds of voiced content per accepted sample,
  three consistent embeddings and at most eight attempts within three minutes.
  Disconnect, sleep, capture failure, catalog change, expiry or cancellation ends
  collection. A cancelled replacement preserves the previous complete reference.
- Normal identification uses the phrase **after** waking; the existing firmware
  does not upload the wake-word recording. No firmware update is required.
  The resident selected explicitly on an endpoint takes priority. Otherwise only
  enabled residents with an enrolled voice in that home are candidates.
- Identification evaluates short phrases with at least 0.4 seconds of detected
  speech, subject to the encoder's readiness check. It does not pad or repeat
  samples to simulate more evidence. Enrollment still requires three longer
  samples; short-phrase support does not lower comparison thresholds.
- The private speech worker uses a single CPU inference thread and shares its
  bounded queue/lock with speech synthesis and transcription. Node averages each
  resident's three unit-normalized references and compares the returned embedding
  to that centroid using cosine similarity. The initial cosine threshold is 0.70
  with a 0.08 lead over the next candidate; enrollment
  consistency threshold is 0.60. These are conservative starting heuristics, not
  calibrated probabilities or a measured household false-accept rate.
- A usable unmatched or ambiguous sample clears the selected identity. A short or
  unusable sample retains the last identity only within the current awake session;
  it cannot identify a resident in a fresh session. A service failure clears the
  identity and conversation continues without a resident. Sleep, reconnect and
  configuration refresh clear automatic identity. A confident speaker change
  resets conversational history and outstanding comfort/search proposals.
- Preferences, personal facts, conditional responses, scoped intents and routine
  selection receive the ephemeral resident. Never update `endpoint.residentId`.
  Panel text previews and other endpoints keep their own context. Delayed actions
  retain their admitted resident and original endpoint scope, revalidate the
  catalog at execution, and are cancelled if that scope changes. Removing a voice
  reference alone does not retract a previously admitted physical command.
- Direct questions such as “Quem sou eu?” and “Você consegue dizer quem está
  falando com você agora?” answer locally from that same validated turn context,
  before intent/LLM selection. An unknown voice stays unknown; a manually fixed
  profile is described as selected, not as recognized. Other conversation turns
  explicitly tell the LLM that the local voice service supplies the speaker's
  identity. Local identity replies remain in session history for follow-ups;
  identity changes clear that history as usual. The bounded `speaker_identity_reply`
  event records only endpoint/resident IDs and the source, not the utterance.
- This is personalization, not authentication or an administrative permission.
  Recordings, similar voices, overlapping speakers, illness, noise and very short
  replies may confuse the model. It does not perform speaker separation or
  anti-spoofing. Do not use it to authorize locks, payments or access to secrets.

## Storage and lifecycle

The private application database stores three numeric embeddings per resident in
`Setting` under `voiceprint:<residentId>`, with home/model/enrollment identifiers
and enrollment date. Raw microphone audio is never persisted. Intermediate
samples stay in memory only and are released on completion/cancellation/failure.
Database backup policy also applies to these references. Generic catalog and
status routes return registration metadata, never embeddings. Identification
events contain endpoint/resident IDs, outcome, elapsed time, detected speech
duration and rounded similarity/margin when available, not audio or transcription.
Similarity is a diagnostic cosine score, not a probability. The LLM receives the
selected profile's normal text context, never
the voice reference. Voice registration can be deleted separately; deleting a
resident removes its reference atomically. A changed home invalidates it.

## Model installation and attribution

From `native/`, install the locked dependencies with `uv sync --locked`, then run:

```sh
.venv/bin/python -m tools.install_speaker_model
```

The installer downloads the unmodified `wespeaker_en_voxceleb_resnet34_LM.onnx`
encoder from the upstream
[sherpa-onnx speaker release](https://github.com/k2-fsa/sherpa-onnx/releases/tag/speaker-recongition-models).
Size: 26,530,550 bytes. SHA-256:
`e9848563da86f263117134dfd7ad63c92355b37de492b55e325400c9d9c39012`.
This checksum pins the artifact obtained over TLS, not a publisher signature.
Weights stay in ignored runtime storage under `native/models/speaker`; runtime
never downloads them. Both `sherpa-onnx` and its split native library
`sherpa-onnx-core` are pinned at 1.13.8. The explicit core dependency also avoids
incomplete dependency metadata in the published wheel index.

[WeSpeaker's model notice](https://github.com/wenet-e2e/wespeaker/blob/master/docs/pretrained.md)
attributes VoxCeleb-trained models to CC BY 4.0. Credit the WeSpeaker authors and
the [VoxCeleb dataset authors](https://www.robots.ox.ac.uk/~vgg/data/voxceleb/)
when redistributing the model; retain the
[CC BY 4.0 terms](https://creativecommons.org/licenses/by/4.0/). The model is
not covered by the application source license. See also
[native third-party notices](../../native/THIRD_PARTY.md).

## Validation and household acceptance

Automated checks cover private/authenticated and bounded worker requests,
cancellation while native inference continues, unknown/ambiguous voices,
cross-home isolation, enrollment cancellation/revision/expiry, private metadata,
resident deletion, real WebSocket capture integration, per-endpoint identity,
routine selection and delayed scope changes. Browser checks exercise the resident
form, progress, cancellation and explicit reference deletion on desktop/mobile.

On this miniPC, two existing **synthetic** 3.7–4.4 second voiced clips produced
256-dimensional embeddings in 0.38–0.47 seconds after loading (1.11 seconds on the
first invocation), while the attention training ran separately. This is a timing
smoke test, not human identification accuracy. Household acoustic acceptance is
pending enrollment by each resident.

After enrolling, leave **Morador fixo** unset on the endpoint. Wake Rosie and say
“Você consegue dizer quem está falando com você agora?”. Check the `speaker_identified`
event in the panel and the spoken answer. Repeat with another enrolled resident
and with an unregistered person, then sleep/wake and try a short phrase. Confirm
the endpoint's fixed resident stays unset and another endpoint remains unaffected.
Use **Apagar voz cadastrada** to disable automatic matching for that person.

## Installed verification — 2026-09-25

The local `rosie-app` and `rosie-voice` user services were restarted after the
production build and checks. The physical endpoint `rosie` reconnected idle;
authenticated status reported `speakerIdentification: true` and no identified
resident. A synthetic sample sent through the installed private worker returned
256 dimensions with quality `ready` in 594 ms. No voice profile was created from
that synthetic sample. At the initial rollout there were no residents; the owner
subsequently created and enrolled resident `caio` through the panel.

Validation: 274 application tests, 10 shared-contract tests, 6 worker tests and
4 desktop/mobile browser cases passed. The production build, TypeScript, Python
type/lint checks, source secret checks and document links passed. The private
database was backed up before rollout. Firmware and the installed wake model were
not changed. Human recognition accuracy and microphone enrollment remain pending
the user's acoustic test.

The owner's first acoustic test successfully matched resident `caio`, but spoken
answers still denied knowing the speaker. Metadata confirmed several matched
turns followed by LLM replies; utterance/response text was not persisted. The
previous prompt only labelled the record as a resident and direct identity
questions had no local handler. The response correction above makes known direct
queries deterministic and gives general generation explicit recognition provenance.
The later short “Quem sou eu?” attempts had `too_short` with no active identity.
The worker previously rejected recordings shorter than two seconds before
comparison and required 1.5 seconds of detected speech. These gates now use the
0.4-second minimum above; no comparison threshold or saved enrollment was changed.
Unknown replies ask the speaker to repeat, without pretending to recognize them
or requiring the longer enrollment phrases in normal conversation.

The short-phrase correction passed 37 focused application tests and three worker
tests, including short genuine/impostor vectors, the unchanged enrollment minimum,
and exact unpadded encoder input. A real-encoder smoke test with crops of three
existing synthetic recordings produced usable embeddings for 0.52–1.4 seconds of
detected speech in 75–186 ms after loading. Some shorter crops contained too little
detected speech. Similarity against the originating full recording ranged from
0.685 to 0.894, including one result below the unchanged 0.70 threshold. These
overlapping synthetic crops only verify execution and timing; they cannot measure
household recognition accuracy or false accepts. Acoustic acceptance with short
human utterances remains necessary.

After this correction, both local services were restarted. Authenticated status
confirmed the physical endpoint reconnected idle, speaker identification was ready,
and the existing `caio` enrollment remained registered with no fixed endpoint
resident. The installed worker returned a valid 256-dimensional embedding in
810 ms on its first synthetic probe. No firmware or enrollment was replaced.

Subsequent household attempts reached comparison with 1.248, 1.292 and 1.404 seconds
of speech. Their mean per-sample similarities were 0.676, 0.699 and 0.737; only the
third matched. The three enrollment samples were mutually consistent (pairwise
cosines 0.871–0.889). Scoring now compares against their combined, normalized voice
reference instead of averaging independent cosine scores. Averaging normalized
enrollment embeddings into speaker profiles is also described by
[Tan et al. (ASRU 2021, section 3.1)](https://cdn.amazon.science/c3/d3/bf8a5bd04316b67cd3256855fd66/improving-speaker-identification-for-shared-devices-by-adapting-embeddings-to-speaker-subsets.pdf).
This implementation uses only the centroid principle, not that paper's learned
household adaptation network or its reported performance.

The numerical threshold and runner-up margin remain 0.70/0.08, but the score
distribution changes: old and new scores are not directly interchangeable. Based
on the saved rounded scores and reference norm (0.95932), the three preceding
attempts would score approximately 0.705, 0.729 and 0.768. This is a mathematical
counterfactual, not a replay of stored microphone audio. Six short/long crops from
three synthetic voices scored 0.430–0.573 against the saved resident reference,
all below the cutoff; this small check is not household false-accept calibration.
The combined-reference correction passed 38 focused application tests, including
a nearby unknown voice below cutoff and the existing ambiguity/isolation cases.

After restarting the application with combined-reference scoring, the owner
confirmed that the short “Quem sou eu?” test answered Caio. The latest matching
event measured 1.292 seconds of detected speech, 0.740 similarity and 214 ms for
identification. This confirms one household success after the correction, not a
general accuracy rate; other residents and unregistered human voices remain to be
checked.

## Importing existing residents and enrolled voices

`apps/web/tools/import-residents.ts` plans the transfer of household resident
records and `voiceprint:` settings from a separate Rosie SQLite snapshot. Set
`ROSIE_SOURCE_DATABASE_URL` and `DATABASE_URL`; run with no arguments for a metadata-only
plan, then use `--apply` after a private online backup and rehearsal on a copy.
The resident/home bindings and canonical voice profile schema are validated before
any writes. Existing identical references remain untouched; conflicting resident
records or voice enrollments abort the transaction instead of replacing newer data.
No embeddings, personal facts, provider secrets or account sessions are printed.

These references continue to personalize physical endpoint sessions; they do not
identify an authenticated web account. Verify worker readiness and encoder model
compatibility separately. Importing a complete reference does not prove current
microphone recognition accuracy; validate that with the enrolled people when the
endpoint is connected. No enrollment capture or firmware update is required for
compatible existing references.
