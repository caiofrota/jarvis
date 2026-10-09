"""Read only the selected mmap window before converting raw frontend values."""

import numpy as np


def bounded_window(raw, end, length):
    if not 0 < end <= len(raw) or length <= 0:
        raise ValueError("A valid bounded window is required")
    selected = raw[max(0, end - length) : end]
    unscaled = selected.dtype == np.uint16
    result = np.array(selected, dtype=np.float32, copy=True)
    if unscaled:
        result *= 0.0390625
    if len(result) < length:
        result = np.pad(result, ((length - len(result), 0), (0, 0)))
    return np.clip(result, 0, 26)
