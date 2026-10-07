"""Independent 20 ms IMA ADPCM blocks; decoded PCM remains 16 kHz mono."""

import struct

STEPS = (
    7,
    8,
    9,
    10,
    11,
    12,
    13,
    14,
    16,
    17,
    19,
    21,
    23,
    25,
    28,
    31,
    34,
    37,
    41,
    45,
    50,
    55,
    60,
    66,
    73,
    80,
    88,
    97,
    107,
    118,
    130,
    143,
    157,
    173,
    190,
    209,
    230,
    253,
    279,
    307,
    337,
    371,
    408,
    449,
    494,
    544,
    598,
    658,
    724,
    796,
    876,
    963,
    1060,
    1166,
    1282,
    1411,
    1552,
    1707,
    1878,
    2066,
    2272,
    2499,
    2749,
    3024,
    3327,
    3660,
    4026,
    4428,
    4871,
    5358,
    5894,
    6484,
    7132,
    7845,
    8630,
    9493,
    10442,
    11487,
    12635,
    13899,
    15289,
    16818,
    18500,
    20350,
    22385,
    24623,
    27086,
    29794,
    32767,
)
INDEX = (-1, -1, -1, -1, 2, 4, 6, 8)


def advance(code, predictor, index):
    step = STEPS[index]
    delta = step >> 3
    if code & 4:
        delta += step
    if code & 2:
        delta += step >> 1
    if code & 1:
        delta += step >> 2
    predictor = max(-32768, min(32767, predictor + (-delta if code & 8 else delta)))
    index = max(0, min(88, index + INDEX[code & 7]))
    return predictor, index


def encode(pcm: bytes, state=(0, 0)):
    count = len(pcm) // 2
    if len(pcm) % 2 or not 1 <= count <= 320:
        raise ValueError("Invalid PCM frame")
    predictor, index = state
    packet = bytearray(struct.pack("<HhB", count, predictor, index))
    packet.extend(bytes((count + 1) // 2))
    for i, (sample,) in enumerate(struct.iter_unpack("<h", pcm)):
        delta = sample - predictor
        code = 8 if delta < 0 else 0
        delta = abs(delta)
        step = STEPS[index]
        for bit, threshold in ((4, step), (2, step >> 1), (1, step >> 2)):
            if delta >= threshold:
                code |= bit
                delta -= threshold
        predictor, index = advance(code, predictor, index)
        packet[5 + i // 2] |= code << (0 if i % 2 else 4)
    return bytes(packet), (predictor, index)


def decode(packet: bytes):
    if len(packet) < 6:
        raise ValueError("Truncated audio block")
    count, predictor, index = struct.unpack_from("<HhB", packet)
    if not 1 <= count <= 320 or index > 88 or len(packet) != 5 + (count + 1) // 2:
        raise ValueError("Invalid audio block")
    pcm = bytearray(count * 2)
    for i in range(count):
        code = (packet[5 + i // 2] >> (0 if i % 2 else 4)) & 15
        predictor, index = advance(code, predictor, index)
        struct.pack_into("<h", pcm, i * 2, predictor)
    return bytes(pcm)


def decode_batch(packet: bytes, max_frames=5):
    """Decode concatenated independent blocks, including a partial final frame."""
    blocks = []
    offset = 0
    while offset < len(packet):
        if len(blocks) >= max_frames or len(packet) - offset < 6:
            raise ValueError("Invalid audio batch")
        count = int.from_bytes(packet[offset : offset + 2], "little")
        size = 5 + (count + 1) // 2
        blocks.append(decode(packet[offset : offset + size]))
        offset += size
    if not blocks:
        raise ValueError("Empty audio batch")
    return b"".join(blocks)
