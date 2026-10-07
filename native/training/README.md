# Experimental wake-word training

This directory owns the offline Acorda Rosie experiment. It is separate from the
voice server's Python environment. Pronunciation approval is recorded in
`acorda_rosie.json`; it does not certify detector accuracy. The first candidate is
installed as an experimental trial, with one successful Brazilian-pronunciation
human test. It failed the intended offline quality gate, particularly for the
American pronunciation; this is not a production qualification. The user requested
this first physical test, and the known limitations were explained before flashing.
The prior Okay Nabu application is preserved for rollback. See the
[validation record](../docs/validation.md) for the selected artifact and measurements.

## Inputs and isolation

- `tools/generate_wake_corpus.py` uses the existing, checksum-verified Kokoro model
  to generate 200 positive and 320 negative clips. All variants of a source voice
  stay in one split: six training voices, two validation voices and two test voices.
- `sources.json` pins the Python image, upstream trainer and background dataset.
  `prepare_sources.py` verifies archive hashes before extraction and builds
  `requirements.lock` from the saved pip installation reports.
- The background dataset declares CC-BY-NC-4.0. This personal experiment does not
  grant commercial use or permission to redistribute its audio or derived models.
- There are no microphone recordings or cloud provider calls in this experiment.
  All ten synthetic styles use the same engine; held-out styles are not equivalent
  to held-out human speakers or a different synthesizer.

Artifacts live under `native/artifacts/wake`, mounted as `/work` in the pinned
Python container. Mount this directory and the read-only training scripts at
`/recipe`; do not mount the server's catalog or credentials. The separate
environment is `/work/env`. Set `PYTHONPATH` to the pinned trainer directory under
`/work/vendor`. The experiment uses one CPU, one TensorFlow/BLAS thread and a
1536 MiB memory limit with no container swap. Corpus synthesis uses one CPU and a
1000 MiB limit. Both have lower scheduling priority than the live server.

## Stages

1. Run the corpus generator in the existing native environment. It resumes only
   if the recipe, split definitions and hashes of existing clips still match.
2. Run `/work/env/bin/python /recipe/prepare_features.py` inside the training
   container. It requires all 520 unique clips and rejects partial feature output.
   Gain, noise and reflection augmentation preserve source splits. Synthetic
   noise complements real conversation backgrounds. Every feature has 40 bins at
   a 10 ms step. A fixed, small validation-background subset bounds memory use.
3. Run `/work/env/bin/python /recipe/train_candidate.py`. It uses the pinned
   upstream MixedNet architecture and export functions, with a bounded local
   training loop. Sample weights have shape `[batch]`, evaluation uses batches
   of 128 and feature values saturate at the firmware frontend range of 0–26.
   Ten thousand steps use learning rates 0.001 then 0.0001. Checkpoint selection
   sees validation data only. Existing experiment directories are never replaced.
4. Run `/work/env/bin/python /recipe/evaluate_candidate.py`. It checks the int8
   streaming input, uint8 output, calibration and firmware operation allowlist.
   Scoring uses the firmware input rounding/saturation, five-output mean and
   30-inference warm-up. Validation negatives choose the cutoff, rounded upward
   after a 0.01 margin with a 0.05 floor, before held-out testing. This weighted
   binary classifier's output is not a calibrated real-world probability.
   Long negative recordings reset model state after each detection and exclude
   any real conversation/sleep time; this is an offline stress measurement.
5. Review the separate pronunciation recalls, negative clips and background
   events per hour. Passing the experimental gate still requires measuring tensor
   arena usage, inference latency and recognition on the actual WROOM. Do not
   treat export or firmware compilation as acoustic acceptance.

`run_experiment.py` waits up to one hour for a complete corpus and executes stages
2 and 3. Run it as a durable job; closing a command session must not cancel a long
experiment. The CPU benchmark is only a rough estimate: it excludes feature
preparation, validation, quantization and background evaluation.

`export_checkpoint.py RUN_DIRECTORY` exports a preserved checkpoint while a
different training run continues. `evaluate_candidate.py --run-dir RUN_DIRECTORY`
evaluates that exact export. Preserve the original best weights, resolved config
and hashes when creating a snapshot. Different quantization calibration samples
can yield different binaries from the same checkpoint; do not silently substitute
an unevaluated export for the selected and flashed artifact.

Results, checkpoints and logs are intentionally kept outside source control.
Preserve their hashes and the final validation summary before selecting a model.
