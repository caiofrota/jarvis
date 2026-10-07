# Addressed attention retraining — 2026-09-25

## Status and visible job

The user requested an improved retraining run and required registration in Herdr
before it starts. The real Herdr pane **`wR:p2`**, in workspace **`wR`**, tab
**`wR:t1`**, was created without changing focus and named \*\*Rosie: treinamento wake

- parar\*\*. It is a training terminal, not another Codex agent. Its terminal ID is
  `term_65c51aaf920aff`. Control followed the installed CLI's `herdr --skill`
  instructions after verifying `HERDR_ENV=1`.

The pane displays `monitor_attention_job.py`, which reads the actual phase and
progress files. **Training and diagnostics are complete; neither target qualified.**
Both durable synthesis units completed all **4,080 clips** and source checksum/split
checks passed. Four attempts completed 32,000 gradient steps and 16 int8 validation
checkpoints. Neither wake nor addressed stop passed development; all 816 fresh
acceptance source clips remain sealed. No model was selected for production or
installed. Firmware, services and simultaneous-listening behavior were untouched.

Private output: `native/artifacts/wake/rosie_attention_retrain_20260925/`.
`herdr-registration.json` records registration; `pipeline-status.json`,
`corpus-progress.json`, `corpus.log`, per-stage logs and `jobs.json` record the
actual process state. The training controller is
[`run_attention_v2.py`](../training/run_attention_v2.py).
Training ran in detached container `rosie-attention-retrain-20260925-v4` (ID begins
`a5296b39e834`), which exited successfully at 20:09:10 UTC with no OOM. Sequential
diagnostics ran in `rosie-attention-diagnostics-20260925-v1` (ID begins
`bd52191d9bb5`), exiting successfully at 20:13:28 UTC, also without OOM. Earlier
waiting controllers remain preserved; none started a gradient step. They were
replaced during synthesis to finalize prosody coverage, complete-phrase windows and
bounded reads of long background recordings. Computation used 53.4 minutes for
gradients; the training controller's 88.1 minutes also include its initial wait,
feature preparation, exports and validation. Final diagnostics took 3.35 minutes.
`final-summary.json` contains consolidated evidence, including preservation hashes.

## Why another recipe

The [previous experiment](attention-training-2026-09-25.md) failed: wake recall was
51.3%, stop recall 75%, with false activations on confusing speech and between the
two classes. Its checkpoint selection measured final full-clip scores; the WROOM
uses continuous rolling scores. In addition, six training styles allowed severe
overfitting. Previous test data is now diagnostic data, never a fresh acceptance
claim.

The new [recipe](../training/rosie_attention_retrain.json) defines 3,600 base clips:
1,320 wake, 480 addressed stop, and 1,800 ordinary/confusing speech negatives.
Before any gradient step, review found that all stop examples had comma prosody,
which could create a pause shortcut. A [480-clip supplement](../training/attention_continuous_stop.json)
adds the same stop calls spoken continuously. This makes **4,080 clips** total,
with 960 stop positives. Both prosodies stay in the same source-voice split and
receive separate recall reporting. The supplementary synthesis waits for the base
job to finish; it adds approximately 15 minutes at the observed synthesis rate.
Twelve styles train, four validate, and four previously unused styles
(`af_jessica`, `af_sky`, `am_eric`, `am_liam`) form sealed acceptance. Matching clips
from prior corpora are reused only after complete job-identity and checksum checks.
All speeds, pitch transformations and augmentations of a source voice stay in its
split. These are still styles from one synthesizer, not independent human speakers.

Approved name phonemes remain American Rosie and Brazilian Rôzi/Rose. Greetings
retain the prior explicit coverage: Brazilian Acorda/Acorde/Ei/Oi/Olá, and native-US
plus Brazilian-accent Hello/Hi, paired with both names. American-accent Portuguese
greetings and real speakers remain unverified. New greeting prosody is synthetic;
commas indicate a pause, not spoken punctuation.

Both addressed stop orders are a separate binary class. Standalone para, cancelar
and cancele remain acoustic negatives; the server's ordinary text cancellation is
unchanged. Exact-name negatives and confusions such as Agora Rosie and Rosie
prepara o café supplement ar para vinte e dois, é para amanhã, non-directed name
mentions and ordinary speech. Identical robot playback and user speech cannot be
distinguished reliably by this classifier alone; echo control is separate.

## Bounded improvements and selection

- Pitch/rate, gain, short reflections, colored noise and frequency/time masking
  vary the source clips. Resampling is an augmentation, not another source speaker.
- Training sees negative prefixes and endings, including zero startup history,
  instead of mostly random middle windows of long negatives. Positive windows
  retain the whole phrase with varying trailing silence.
  Long recording mmaps are sliced before conversion/scaling; a training example
  cannot materialize a whole background recording just to choose a short window.
- Training and calibration shapes both align to complete three-frame strides.
  Window length is derived only from training durations, including the slowest
  resampling and maximum trailing silence. The new longest training wake phrase
  is 2.155 seconds: a 222-frame window would cut part of its start after slowing.
  Wake therefore uses 282 frames, preserving the complete phrase. Context is
  bounded to 330 frames; an oversized phrase fails explicitly.
- Each target gets at most two attempts of 8,000 steps: 64-filter then 96-filter
  blocks, distinct fixed seeds, batch 64, saved optimizer/RNG checkpoints every
  500 steps. Resume is reproducible in inputs but not promised bitwise identical.
- Every 2,000 steps is exported and scored using the actual int8 streaming graph,
  firmware rounding, five-output mean and warm-up. Validation alone chooses the
  threshold with the existing margin. Saturated negatives invalidate a threshold;
  clamping it to one does not count as a safe solution.
- The first development-passing model is frozen before opening acceptance. If
  neither bounded attempt passes development, acceptance stays sealed and the job
  stops for real recordings instead of weakening gates or looping indefinitely.
  Failure on acceptance is final for this recipe, not a signal to tune against it.

Gates remain at least 90% overall recall, 85% per phrase/name/accent aggregate, zero
negative clip detections and at most one background activation per hour. The
existing 5.33-hour DIPCO set is explicitly a **previously used regression set**;
new held-out voice clips do not make those background hours untouched. Results
must disclose that limitation and cannot certify the user's room or playback.

A subsequent [development-only diagnostic](../training/run_attention_diagnostics.py)
compares the best valid-threshold checkpoint for each target in float and int8
streaming execution. It runs after the training process finishes, using identical
validation clips, frontend scaling, three-frame strides, warm-up and smoothing.
This separates quantization loss from generalization failures before choosing the
next data or training change. Its float graph is diagnostic only, cannot satisfy
the ESP32 input/output contract and is never a deployment candidate. Acceptance
data is not read by this diagnostic. The same fixed int8 candidates also replay
the previously used DIPCO recordings to report regression events per hour; those
hours remain explicitly distinct from fresh acceptance.

## Results

These are **development** results from four withheld synthetic voice styles, with
their augmentations. They are not final acceptance results or independent human
trials. The table shows the highest recall at a valid threshold in each attempt.

| Target         | Filters | Best step | Recall           | Threshold          | Negative clips detected | Decision                    |
| -------------- | ------- | --------- | ---------------- | ------------------ | ----------------------- | --------------------------- |
| Wake           | 64      | 8,000     | 88.01% (697/792) | 0.95               | 0/1,128                 | Failed                      |
| Wake           | 96      | 8,000     | 69.70%           | 0.99               | 0/1,128                 | Failed                      |
| Addressed stop | 64      | 4,000     | 82.29% (474/576) | 0.80               | 0/1,272                 | Failed                      |
| Addressed stop | 96      | —         | —                | No valid threshold | —                       | All four checkpoints failed |

Recall for the best valid-threshold checkpoints:

| Call         | Recall |
| ------------ | ------ |
| Acorda Rosie | 81.94% |
| Acorde Rosie | 84.72% |
| Ei Rosie     | 86.11% |
| Oi Rosie     | 88.89% |
| Olá Rosie    | 97.22% |
| Hello Rosie  | 87.50% |
| Hi Rosie     | 93.75% |
| Rosie, para  | 84.72% |
| Para, Rosie  | 79.86% |

Wake recall by name pronunciation was 91.92% American and 84.09% Brazilian. For
stop it was 81.60% American and 82.99% Brazilian. Stop with a comma pause achieved
75.35%, versus 89.24% without a pause. The detailed phrase × greeting accent × name
matrix is preserved in each checkpoint's `development.json`.

At these thresholds, wake produced zero detections on 384 addressed-stop negative
clips; stop produced zero detections on 528 wake negative clips. Each fixed model
also produced zero events over 19,204.99 seconds (5.33 hours) of the old DIPCO
background regression set. This observed rate is not evidence that the user's
room, videos or the robot's own playback are safe from false activation.

The diagnostic ruled out a large quantization loss in these best checkpoints:

| Target         | Float recall | Int8 recall | Mean absolute score difference | Float gate |
| -------------- | ------------ | ----------- | ------------------------------ | ---------- |
| Wake           | 88.26%       | 88.01%      | 0.00266                        | Failed     |
| Addressed stop | 82.64%       | 82.29%      | 0.00233                        | Failed     |

Float and int8 thresholds were independently obtained from the same development
negatives using the same margin rule. Both representations missed the required
recall. Larger models and further steps in the bounded attempts did not solve the
generalization problem; another blind synthetic-only run is not justified by
these results. No acceptance examples were inspected to make this diagnosis.

The diagnostic wake int8 model is 64,168 bytes, SHA-256
`7252ca6199d520bd90f2281af85cd0d5ba476d68ed9678b639bf400661b1d5d7`.
The diagnostic stop int8 model is 63,400 bytes, SHA-256
`5a70687c7416a08a715634e8134346b9e3b39dc8b1bde259b376dd13f8a5c0bc`.
They use 282 and 264 training frames respectively. Both export to the checked
`int8[1,3,40]` input and `uint8[1,1]` output contract with registered firmware
operations. This compatibility check does not establish WROOM tensor-arena size,
latency or acceptable recognition; neither model is approved for installation.

The user subsequently accepted considering the 88% wake candidate for a separate
experimental trial. This does not change the quality results. A small independent
bundle is preserved at
`bundles/rosie_wake_experimental_88_20260925.zip` under the private experiment root:
45,576 bytes compressed, 94,859 bytes extracted. It contains the exact model,
checksums, thresholds, pronunciation coverage, development evidence and an ESPHome
manifest template. The ZIP SHA-256 is
`1b70162760689736916a41ac68804fcaee396419511c8857bd4e8f75f9978e8a`.
The ESPHome template deliberately leaves arena size and validated minimum version
unset; its local utility finalizes them only from explicit integration measurements.
No unsupported arena minimum was invented. The bundle excludes training audio and
large checkpoints; no installation or new training was performed to package it.

## Smallest useful next data collection

A first **diagnostic** collection can be 24 short clips from the actual microphone:
two natural repetitions of each of the seven wake calls (14), two of each stop
order (4), and six confusing phrases such as “Agora Rosie”, “Rosie”, “ar para vinte
e dois”, “é para amanhã”, “para” and “cancelar”. This should take about two or three
minutes and should use the person's everyday pronunciation, without imitating the
synthetic samples. It would reveal real microphone/domain problems; it is not
enough to certify every accent or household member.

If those recordings guide fitting or tuning, a later recording session must stay
untouched for acceptance. Repetitions, derivatives and augmented copies of one
source session must remain together. Personalizing to one person and testing a
new session does not establish recognition of unseen people. Recording requires
an explicit user collection step; this experiment did not enable a microphone or
reuse speaker-identification enrollment recordings.

## Isolation and acceptance limits

One heavy process runs at a time: synthesis, feature generation, training, export,
then evaluation. Synthesis is capped at one CPU and 1,100 MiB; the pinned training
container uses one CPU and 1,536 MiB, no swap, low priority, no network and a read-only
root filesystem. Previous artifacts are read-only; only this new experiment's
directory is writable. No paid API, user microphone capture or production restart
is part of this job. Source snapshots and hashes accompany it.

Source/background license restrictions from the previous experiment remain in
force, including CC-BY-NC-4.0 background data. No redistribution or commercial
qualification is implied. Export checks cover tensor shape, quantization and
registered operations; real WROOM tensor-arena use, inference latency, user
recognition and playback rejection are separate acceptance requirements.

If synthetic development still fails, the next useful evidence is short real
recordings of each requested phrase in separate enrollment/development and test
sessions, plus ordinary confusing speech and room noise. Collecting those requires
an explicit user recording step; this job does not turn on a microphone.

Final checks: all 18 training safeguard tests passed; Ruff and documentation checks
passed. SHA-256 verification confirmed the original active wake header, both
original Acorda Rosie exports, source-corpus manifest and feature manifest remained
unchanged. Source snapshots, logs, optimizer/RNG checkpoints and failed exports are
preserved for inspection. No paid API was used.
