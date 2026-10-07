import ctypes
import math
import random
import struct
import subprocess
from pathlib import Path

import pytest

from server import audio_codec


@pytest.fixture(scope="module")
def firmware_codec(tmp_path_factory):
    directory = tmp_path_factory.mktemp("codec")
    source = directory / "codec.cpp"
    source.write_text("""
#include "audio_codec.h"
extern "C" size_t encode(const int16_t *pcm, size_t n, uint8_t *out, int *p, int *i) {
  audio_codec::State state{*p, *i};
  auto size = audio_codec::encode(pcm, n, out, state);
  *p = state.predictor; *i = state.index; return size;
}
extern "C" size_t decode(const uint8_t *packet, size_t n, int16_t *out) {
  return audio_codec::decode(packet, n, out);
}
""")
    library = directory / "codec.so"
    root = Path(__file__).resolve().parents[1]
    subprocess.run(
        [
            "g++",
            "-std=c++17",
            "-shared",
            "-fPIC",
            "-O2",
            "-I",
            str(root / "firmware/main"),
            str(source),
            "-o",
            str(library),
        ],
        check=True,
    )
    codec = ctypes.CDLL(str(library))
    codec.encode.argtypes = [
        ctypes.POINTER(ctypes.c_int16),
        ctypes.c_size_t,
        ctypes.POINTER(ctypes.c_uint8),
        ctypes.POINTER(ctypes.c_int),
        ctypes.POINTER(ctypes.c_int),
    ]
    codec.encode.restype = ctypes.c_size_t
    codec.decode.argtypes = [
        ctypes.POINTER(ctypes.c_uint8),
        ctypes.c_size_t,
        ctypes.POINTER(ctypes.c_int16),
    ]
    codec.decode.restype = ctypes.c_size_t
    return codec


def test_known_ima_vector():
    # Golden vector generated independently with CPython 3.12 audioop.
    pcm = struct.pack(
        "<16h",
        0,
        0,
        100,
        -100,
        1000,
        -1000,
        16000,
        -16000,
        32767,
        -32768,
        0,
        0,
        200,
        -200,
        10000,
        -10000,
    )
    packet, _ = audio_codec.encode(pcm)
    assert packet[5:].hex() == "007f7f7f7f28087f"
    assert struct.unpack("<16h", audio_codec.decode(packet)) == (
        0,
        0,
        11,
        -19,
        44,
        -92,
        201,
        -430,
        927,
        -1983,
        95,
        -283,
        60,
        -252,
        4008,
        -5123,
    )


def test_batch_preserves_block_order_partial_tail_and_validation():
    blocks = [audio_codec.encode(struct.pack(f"<{n}h", *([600] * n)))[0] for n in (320, 320, 19)]
    packet = b"".join(blocks)
    assert audio_codec.decode_batch(packet) == b"".join(map(audio_codec.decode, blocks))
    for invalid in (packet[:-1], packet + b"x", b"", blocks[0] * 6):
        with pytest.raises(ValueError):
            audio_codec.decode_batch(invalid)
    with pytest.raises(ValueError):
        audio_codec.decode_batch(packet, max_frames=1)


def test_firmware_and_server_are_interoperable(firmware_codec):
    rng = random.Random(1836)
    state = (0, 0)
    predictor, index = ctypes.c_int(), ctypes.c_int()
    for count in (320, 320, 319, 1, 2, 3, 320):
        samples = [rng.randint(-32768, 32767) for _ in range(count)]
        pcm = struct.pack(f"<{count}h", *samples)
        packet, state = audio_codec.encode(pcm, state)
        encoded = (ctypes.c_uint8 * 165)()
        size = firmware_codec.encode(
            (ctypes.c_int16 * count)(*samples),
            count,
            encoded,
            ctypes.byref(predictor),
            ctypes.byref(index),
        )
        assert bytes(encoded[:size]) == packet
        assert (predictor.value, index.value) == state
        decoded = (ctypes.c_int16 * 320)()
        received = firmware_codec.decode(encoded, size, decoded)
        assert received == count
        assert struct.pack(f"<{count}h", *decoded[:count]) == audio_codec.decode(packet)


def test_speech_band_tone_quality_and_wire_size():
    state = (0, 0)
    original, restored = [], []
    for frame in range(20):
        samples = [
            int(12000 * math.sin(2 * math.pi * 440 * (frame * 320 + i) / 16000)) for i in range(320)
        ]
        packet, state = audio_codec.encode(struct.pack("<320h", *samples), state)
        assert len(packet) == 165
        original.extend(samples)
        restored.extend(struct.unpack("<320h", audio_codec.decode(packet)))
    signal = sum(x * x for x in original[320:])
    noise = sum((x - y) ** 2 for x, y in zip(original[320:], restored[320:], strict=True))
    assert 10 * math.log10(signal / noise) > 25


@pytest.mark.parametrize(
    "packet", [b"", bytes(5), b"\x41\x01\x00\x00\x00" + bytes(161), b"\x01\x00\x00\x00\xff\x00"]
)
def test_malformed_blocks_are_rejected(packet, firmware_codec):
    with pytest.raises(ValueError):
        audio_codec.decode(packet)
    out = (ctypes.c_int16 * 320)()
    data = (ctypes.c_uint8 * len(packet))(*packet)
    assert firmware_codec.decode(data, len(packet), out) == 0
