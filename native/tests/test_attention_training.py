"""Run offline recipe safeguards in the default native test suite."""

import hashlib
import json
from pathlib import Path

import numpy as np
import pytest

from training.attention_quality import (
    quality_gate,
    required_window_frames,
    threshold_from_negatives,
)
from training.generate_attention_corpus import jobs_for
from training.run_attention_experiment import prepare_task
from training.streaming_contract import calibration_config
from training.test_attention_recipe import AttentionRecipeTests as TestAttentionRecipe
from training.training_window import bounded_window

__all__ = ["TestAttentionRecipe"]


@pytest.mark.parametrize("length,aligned", [(204, 204), (220, 222), (221, 222), (222, 222), (1, 3)])
def test_calibration_uses_complete_strides_without_changing_training_shape(length, aligned):
    config = {"spectrogram_length": length, "stride": 3, "training_input_shape": [length, 40]}
    actual = calibration_config(config)
    assert actual["spectrogram_length"] == aligned
    assert actual["training_input_shape"] == [length, 40]
    assert config["spectrogram_length"] == length


def test_calibration_rejects_invalid_stride():
    with pytest.raises(ValueError, match="Positive integer"):
        calibration_config({"spectrogram_length": 221, "stride": 0})


def test_two_detectors_keep_other_addressed_class_as_negative(tmp_path):
    content = b"test audio provenance fixture"
    samples = []
    for label in ("wake", "stop", "negative"):
        filename = f"training/{label}/example.wav"
        path = tmp_path / "corpus" / filename
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        samples.append(
            {
                "file": filename,
                "class_key": label,
                "split": "training",
                "voice": "voice-a",
                "sha256": hashlib.sha256(content).hexdigest(),
            }
        )
    shared = {
        "voice_groups": {"training": ["voice-a"], "validation": [], "testing": []},
        "samples": samples,
        "expected_count": len(samples),
    }
    (tmp_path / "corpus/manifest.json").write_text(json.dumps(shared))
    for target in ("wake", "stop"):
        prepare_task(tmp_path, target, shared)
        derived = json.loads((tmp_path / target / "corpus/manifest.json").read_text())
        assert [item["class_key"] for item in derived["samples"] if item["truth"]] == [target]
        assert all(
            item["split"] == "training" and item["voice"] == "voice-a"
            for item in derived["samples"]
        )
    (tmp_path / "corpus" / samples[0]["file"]).write_bytes(b"tampered")
    with pytest.raises(ValueError, match="Changed source clip"):
        prepare_task(tmp_path, "wake", shared)


def test_saturated_validation_negative_cannot_receive_valid_threshold():
    assert threshold_from_negatives([0.1, 1.0]) is None
    assert threshold_from_negatives([0.2, 0.3444]) == 0.36
    with pytest.raises(ValueError, match="Finite negative"):
        threshold_from_negatives([float("nan")])


def test_window_preserves_slow_augmented_full_phrase_and_trailing_silence():
    assert required_window_frames([1.5]) == 222
    assert required_window_frames([2.1546875, 1.2]) == 282
    with pytest.raises(ValueError, match="exceeds"):
        required_window_frames([4.0])


def test_background_is_sliced_before_scaling_and_padding():
    class LargeRecording:
        def __len__(self):
            return 1_000_000

        def __getitem__(self, selection):
            assert selection.stop - selection.start <= 282
            return np.full((selection.stop - selection.start, 40), 256, dtype=np.uint16)

    actual = bounded_window(LargeRecording(), 900_000, 282)
    assert actual.shape == (282, 40)
    assert np.all(actual == 10)
    padded = bounded_window(np.full((8, 40), 10, dtype=np.float32), 4, 6)
    assert np.all(padded[:2] == 0)
    assert np.all(padded[2:] == 10)


def test_quality_gate_requires_each_phrase_and_no_false_accepts():
    summary = {
        "recall": 0.95,
        "negative_detections": 0,
        "recall_by_pronunciation": {"american": 0.95, "brazilian": 0.95},
        "recall_by_phrase": {"Oi Rosie": 0.9, "Hi Rosie": 0.9},
        "recall_by_accent": {"pt_br": 0.9, "en_us": 0.9},
    }
    assert quality_gate(summary)
    assert not quality_gate({**summary, "negative_detections": 1})
    assert not quality_gate({**summary, "recall_by_phrase": {"Oi Rosie": 0.84}})
    assert not quality_gate(summary, ambient_events_per_hour=1.01)


def test_retraining_acceptance_voices_are_new_and_augmentations_stay_in_split():
    directory = Path(__file__).parents[1] / "training"
    old = json.loads((directory / "rosie_attention.json").read_text())
    new = json.loads((directory / "rosie_attention_retrain.json").read_text())
    previous = {voice for group in old["voice_groups"].values() for voice in group}
    assert not set(new["voice_groups"]["testing"]) & previous
    jobs = jobs_for(new)
    assert len(jobs) == 3600
    for voice in {job["voice"] for job in jobs}:
        assert len({job["split"] for job in jobs if job["voice"] == voice}) == 1


def test_stop_prosody_supplement_removes_pause_without_changing_splits_or_words():
    directory = Path(__file__).parents[1] / "training"
    base = json.loads((directory / "rosie_attention_retrain.json").read_text())
    supplement = json.loads((directory / "attention_continuous_stop.json").read_text())
    assert supplement["voice_groups"] == base["voice_groups"]
    continuous = jobs_for(supplement)
    paused = [job for job in jobs_for(base) if job["class_key"] == "stop"]
    assert len(continuous) == len(paused) == 480
    for before, after in zip(paused, continuous, strict=True):
        assert before["phonemes"].replace(", ", " ") == after["phonemes"]
        assert before["phrase"] == after["phrase"]
        assert before["voice"] == after["voice"]
        assert before["split"] == after["split"]
        assert before["file"] != after["file"]
