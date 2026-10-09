"""Small framework-independent invariants for streaming quantization."""


def calibration_config(config):
    """Align representative clips to complete strides without changing the trained graph."""
    length, stride = config["spectrogram_length"], config["stride"]
    if not isinstance(length, int) or not isinstance(stride, int) or min(length, stride) <= 0:
        raise ValueError("Positive integer spectrogram length and stride are required")
    aligned = ((length + stride - 1) // stride) * stride
    return {**config, "spectrogram_length": aligned}
