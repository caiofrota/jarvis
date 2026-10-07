# Addressed attention training — 2026-09-25

## Scope and current status

**Both candidates completed training and offline evaluation. Neither passed the
acoustic quality gates; neither was selected or installed.** The original Acorda
Rosie model and firmware header remain unchanged. The completed dataset and
checkpoints are preserved for further work, with the observed limitations below.

The user authorized background training for additional Rosie greetings and the
addressed stop phrases **“Rosie, para”** and **“Para, Rosie”**. This experiment
produces two distinct streaming binary candidates. Neither is selected, flashed
or enabled in the application. Firmware interruption/echo-control work remains
separate; see [the integration contract](../../docs/engineering/voice-interruption.md).

Corpus generation ran as the durable user systemd unit
`rosie-attention-corpus-20260925.service`. The final detached container,
`rosie-attention-training-20260925-v3`, completed feature preparation, training and
held-out evaluation for wake and stop, sequentially. Its ID begins `f104652341a8`;
it exited with code 0 and no OOM event. Closing the chat or a tool session did not
cancel these jobs. Status files retain the complete execution record; the elapsed
time in the final pipeline status describes the resumed v3 invocation, not the
whole experiment.

The private experiment directory is
`native/artifacts/wake/rosie_attention_20260925/`. Existing Acorda Rosie weights,
corpus, tests and flashed model remain preserved in their original directories.

## Data and pronunciation coverage

The [base recipe](../training/rosie_attention.json) defines **1,560** synthetic clips:
660 wake positives, 240 addressed stop positives and 660 ordinary/confusing speech
negatives. Each detector treats the other addressed class as negative. Standalone
“para”, “cancelar” and “cancele” are negative for this acoustic stop experiment;
existing server-side text cancellation remains independent.

Pre-training inspection found that automatic Portuguese phonemization did not
represent the American Rosie name alone in the negative clips. A separately
preserved [120-clip supplement](../training/attention_name_negatives.json) adds
both exact name phonemes alone and in a non-directed mention, with the same source
voice splits and three speeds. The combined corpus contains **1,680 clips**.
This addition was decided before either candidate trained or saw held-out results.
The initial waiting container was stopped and preserved; the v2 snapshot waits
for both corpora. Base synthesis is not repeated or replaced.

All speed variants and later gain/noise/reflection augmentations of each source
voice remain in one split: six training styles, two validation styles and two test
styles. These are ten Kokoro styles from one synthesizer, **not ten independent
human speakers**. Held-out synthesized speech does not establish real microphone
accuracy, distance tolerance or reliability during speaker playback.

| Greeting                        | Prefix variants                                  | Name variants                          |
| ------------------------------- | ------------------------------------------------ | -------------------------------------- |
| Acorda Rosie / Acorde Rosie     | Brazilian /h/ and tap-r                          | American Rosie and Brazilian Rôzi/Rose |
| Ei Rosie / Oi Rosie / Olá Rosie | Brazilian greeting phonemes                      | Both name variants                     |
| Hello Rosie / Hi Rosie          | Native-US and Brazilian-accent greeting phonemes | Both name variants                     |

The name phonemes reuse the two drafts approved on September 22. New prefixes and
comma prosody have not received human acoustic approval. American voice styles do
not prove American-accent Portuguese greetings; those combinations remain
unverified. Commas create synthesis prosody and are not spoken symbols.

Negatives include “ar para vinte e dois”, “é para amanhã”, name mentions,
non-directed speech, confusable greetings and routine commands. Synthetic hum,
impulses, horn-like tones and noise complement the existing real background-speech
dataset. No microphone is recorded, no paid API is called, and no conversation
history or household credentials are mounted into the trainer.

The background dataset retains its **CC-BY-NC-4.0** restriction. This personal
experiment does not authorize commercial use or redistribution of its data or
derived weights.

## Isolation and reproducibility

Synthesis reuses the checksum-verified local Kokoro model and one ONNX thread.
Its systemd cgroup limits CPU to one core and memory to 1,100 MiB, prohibits swap,
and applies low CPU/I/O scheduling priority. A sample during generation used
approximately 763 MiB and zero cgroup swap.

Training uses the previously pinned Python image and microWakeWord revision in
[sources.json](../training/sources.json), with the existing isolated dependencies.
The container has no network, one CPU, a 1,536 MiB memory cap, no swap, low process
priority, a read-only base filesystem and source snapshot. Only this experiment's
artifact directory is writable; earlier artifacts and shared datasets are mounted
read-only. Waiting for synthesis does not perform a second compute-heavy job.

`recipe-snapshot-v3/` and `source-hashes-v3.json` preserve the active launched
scripts. The original snapshot remains as launch history. Generic
root/model-name options were added to the existing training stages; their default
legacy paths, architecture, seed and training duration remain unchanged. The new
candidates use the same MixedNet block configuration as the 26,049-parameter
legacy candidate, a 2,000 ms training window, seed 20260925 and 10,000 steps each.
The longer window changes the final dense-layer size; the exported report records
the actual parameter count. Actual streaming input shape,
quantization, operations and model size must pass export checks.

Checkpoint selection sees validation data only. Every 500 steps the trainer saves
weights, optimizer state, progress and Python/NumPy RNG state. Resume restores the
checkpoint; bit-for-bit replay across an interrupted TensorFlow process is not
promised. Partial feature preparation is preserved under a timestamped name
before deterministic rebuilding. Existing completed artifacts are not silently
overwritten.

Wake gradient training completed all 10,000 steps, but its first quantization
attempt exposed an upstream calibration precondition: the 2,000 ms configuration
resolves to 220 feature frames, which is not divisible by streaming stride 3.
Snapshot v3 aligns only representative calibration clips to 222 frames; the
trained graph, weights and feature splits remain unchanged. The completed
checkpoint is resumed directly for export, without repeating gradient training.
The failed export and log are preserved. Regression tests cover alignment,
unchanged graph shape and the legacy 204-frame case. This is an export correction,
not a threshold adjustment based on held-out results.

## Wake-group result

The wake candidate completed 10,000 steps and selected step 4500 using validation
data. Export contains 26,369 parameters and is 61,536 bytes, SHA-256
`80a526a9f23dc25e657c070a65449f340984db2a87a59366fca74d6d996f05af`.
It passed the streaming tensor/quantization/operation checks but **failed acoustic
quality gates and must not replace the installed detector**.

Validation negatives reached the maximum rolling score, so even the maximum
cutoff of 1.0 did not eliminate validation false detections. Held-out results at
that frozen cutoff were 203/396 positive detections (51.3%), seven false detections
among 432 negative clips, including four among 96 addressed-stop examples, and
zero events in 5.3347 hours of separate background speech. Zero events in this
limited corpus is not a guarantee about household false wakes. The score is not a
calibrated real-world probability.

| Held-out wake phrase | Recall |
| -------------------- | -----: |
| Acorda Rosie         |  36.1% |
| Acorde Rosie         |  48.6% |
| Ei Rosie             |  75.0% |
| Oi Rosie             |  58.3% |
| Olá Rosie            |  77.8% |
| Hello Rosie          |  37.5% |
| Hi Rosie             |  54.2% |

American-name recall was 42.9%; Brazilian-name recall was 59.6%. Full separate
greeting-accent/name combinations are retained in the private evaluation JSON.
No threshold was lowered after observing these test results. Future improvement
needs a new validation-led experiment and a fresh final test set; these test
examples now serve as diagnostics, not an untouched acceptance set.

## Addressed-stop result

The stop candidate also completed 10,000 steps, with step 7000 selected by
validation. It contains 26,369 parameters and is 61,536 bytes, SHA-256
`bbdd6ae74c649f74bc807b9f7f6a3a17f7cf20588c31c4fe8cf7e5b69b3b80a7`.
Its tensor, quantization and operation checks passed. **Its acoustic gate failed.**

At the validation-selected cutoff of 0.36, held-out recognition was 108/144 (75.0%):
61/72 for “Rosie, para” (84.7%) and 47/72 for “Para, Rosie” (65.3%). American-name
recall was 73.6%; Brazilian-name recall was 76.4%. There were six false detections
among 600 negative clips, including two among 264 wake-phrase examples. The separate
5.3347 hours of background speech produced zero triggers. These augmented synthetic
clip counts are not independent human trials.

This candidate would miss too many requested stops and sometimes stop on a greeting.
It is therefore retained as experimental evidence, with no production model
manifest or firmware selection generated. Training completion alone does not make
either detector ready to replace the current device behavior.

Further work should broaden source voices/engines and acoustic conditions, improve
validation performance, and reserve a fresh final acceptance set. Changing the
threshold after seeing these held-out failures would not establish a reliable
model. Real WROOM microphone, speaker-echo and latency acceptance still follow a
successful offline candidate.

## Evaluation and acceptance

The streaming evaluator matches the current firmware's 40-bin, 10 ms frontend,
int8 input rounding/saturation, five-output mean and 30-inference warm-up. It
verifies `[1, 3, 40]` int8 input, `[1, 1]` uint8 output, quantization and registered
operation allowlist. The cutoff is fixed from validation negatives, with the
existing upward-rounded margin, **before** held-out scores are inspected.

Reports include recall per phrase, greeting/stop accent, name pronunciation and
their combinations; wake-versus-stop confusion; false detections on negative
clips; and events per hour over the separate long background recordings. The
predeclared experimental gate requires at least 90% overall recall, 85% in every
reported phrase/accent/name aggregate, zero negative-clip detections and no more
than one background event per hour. A failed gate is retained as a failed
candidate, not converted into production acceptance by lowering its test cutoff.

Even a passing offline candidate needs tensor-arena and inference-time
measurements on the WROOM, real human recognition tests and playback/echo tests.
The classifier alone cannot distinguish identical words spoken by a person from
the robot's own loudspeaker. No acoustic echo cancellation or immediate playback
interruption is claimed by this training experiment.

## Monitor and resume

From the repository root:

```sh
cat native/artifacts/wake/rosie_attention_20260925/corpus-progress.json
cat native/artifacts/wake/rosie_attention_20260925/name-negatives-progress.json
cat native/artifacts/wake/rosie_attention_20260925/pipeline-status.json
docker logs --tail 20 rosie-attention-training-20260925-v3
```

`corpus.log` records base synthesis. The sequential supplement uses systemd unit
`rosie-attention-name-negatives-20260925.service` and `name-negatives.log`.
Per-stage logs follow
`{wake,stop}-{prepare_features,train_candidate,evaluate_candidate}.log`.
`{wake,stop}/candidate-01/history.json` records validation checkpoints;
`evaluation-progress.json` records background evaluation, and `evaluation.json`
contains the final gate. `results.json` combines completed candidates. Do not
infer completion merely from the existence of a container or a `.tflite` file.

If a job fails, inspect its logged cause before resuming. The synthesis command
can be relaunched with the same recipe and output directory; it verifies all
completed clip hashes. `docker start rosie-attention-training-20260925-v3` resumes
the same snapshotted pipeline after an actual failure is addressed. There are no
unbounded automatic retries or automatic firmware installation.

## Software checks

Recipe tests verify split leakage rejection, requested phrase/pronunciation
coverage, addressed-only stop labels and deterministic unique sample identities.
The default native test suite also checks relabeling and source checksum failure.
The final dedicated native regression suite passed **12 tests**; Python syntax,
Ruff and internal documentation links also passed. Protected model/header hashes
were compared against the saved baseline after completion. These checks establish
pipeline safeguards, artifact preservation and export compatibility, not acoustic
model quality.
