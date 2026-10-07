"""Framework-independent rules shared by development and sealed acceptance."""

import math


def required_window_frames(training_durations):
    """Keep full slow/pitch-augmented phrases plus trailing silence, using training only."""
    if not training_durations or any(not math.isfinite(x) or x <= 0 for x in training_durations):
        raise ValueError("Positive finite training durations are required")
    frames = max(222, math.ceil((max(training_durations) / 0.9 + 0.35) / 0.01) + 6)
    frames = ((frames + 2) // 3) * 3
    if frames > 330:
        raise ValueError("Positive phrase exceeds the bounded training context")
    return frames


def threshold_from_negatives(scores):
    if not scores or any(not math.isfinite(score) or not 0 <= score <= 1 for score in scores):
        raise ValueError("Finite negative scores in [0, 1] are required")
    threshold = max(0.05, math.ceil((max(scores) + 0.01) * 100) / 100)
    # A saturated negative cannot be repaired by pretending a threshold of one is safe.
    return threshold if threshold <= 1 else None


def quality_gate(summary, ambient_events_per_hour=0):
    return (
        summary["recall"] >= 0.9
        and summary["negative_detections"] == 0
        and ambient_events_per_hour <= 1
        and min(summary.get("recall_by_prosody", {"unspecified": 1}).values()) >= 0.85
        and all(
            min(summary[key].values(), default=0) >= 0.85
            for key in ("recall_by_pronunciation", "recall_by_phrase", "recall_by_accent")
        )
    )
